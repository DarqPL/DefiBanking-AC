// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";

/**
 * @notice Minimal VaultManager interface used by SavingCore to pay maturity interest.
 */
interface IVaultManager {
    /**
     * @notice Returns the receiver for early withdrawal penalties.
     * @return Address that should receive penalty fees.
     */
    function feeReceiver() external view returns (address);

    /**
     * @notice Returns whether the vault currently has enough liquidity to pay an interest amount.
     * @param amount Interest amount to check.
     * @return canPay Whether the vault balance is at least `amount`.
     */
    function canPayInterest(uint256 amount) external view returns (bool canPay);

    /**
     * @notice Pays interest from the vault to a depositor.
     * @param to Recipient of the interest payment.
     * @param amount Amount of interest to pay.
     */
    function payInterest(address to, uint256 amount) external;
}

/**
 * @title SavingCore
 * @notice Base contract for term-deposit plans represented by future ERC721 deposit position NFTs.
 * @dev Deposit and withdrawal logic is intentionally not implemented yet.
 */
contract SavingCore is ERC721, Ownable, Pausable {
    using SafeERC20 for IERC20;
    using Strings for uint256;

    /// @notice Basis-points denominator used for APR and penalty values.
    uint16 public constant BPS_DENOMINATOR = 10_000;

    /// @notice Number of seconds used for simple-interest APR calculations.
    uint256 public constant YEAR_SECONDS = 365 days;

    /// @notice Delay after maturity before any caller can trigger auto-renewal.
    uint256 public constant AUTO_RENEW_GRACE_PERIOD = 3 days;

    /// @notice ERC20 token accepted for term deposits, expected to be USDC or MockUSDC.
    IERC20 public immutable token;

    /// @notice Vault contract that holds and pays interest liquidity.
    IVaultManager public immutable vaultManager;

    /// @notice Marketplace contract authorized to transfer active deposit NFTs between accounts.
    address public depositMarketplace;

    /// @notice Whether token metadata URI updates have been permanently disabled.
    bool public metadataLocked;

    /// @notice IPFS image URI used in dynamically generated deposit NFT metadata.
    string public metadataImageURI;

    /**
     * @notice Lifecycle status for a deposit NFT position.
     * @dev `None` is the default value for deposits that do not exist yet.
     */
    enum DepositStatus {
        None,
        Active,
        Withdrawn,
        EarlyWithdrawn,
        ManualRenewed,
        AutoRenewed
    }

    /**
     * @notice Configuration for a term-deposit plan.
     * @param minDeposit Minimum principal amount accepted for this plan.
     * @param maxDeposit Maximum principal amount accepted for this plan.
     * @param tenorDays Lock duration in days.
     * @param aprBps Annual percentage rate in basis points at the plan level.
     * @param earlyWithdrawPenaltyBps Early withdrawal penalty in basis points.
     * @param enabled Whether users will be allowed to open new deposits under this plan.
     */
    struct SavingPlan {
        uint256 minDeposit;
        uint256 maxDeposit;
        uint64 tenorDays;
        uint16 aprBps;
        uint16 earlyWithdrawPenaltyBps;
        bool enabled;
    }

    /**
     * @notice Stored data for a future deposit NFT position.
     * @param planId Saving plan selected when the deposit is opened.
     * @param principal Principal amount deposited by the user.
     * @param startAt Timestamp when the deposit starts.
     * @param maturityAt Timestamp when the deposit reaches maturity.
     * @param aprBpsAtOpen APR snapshot taken when the deposit is opened.
     * @param penaltyBpsAtOpen Early withdrawal penalty snapshot taken when the deposit is opened.
     * @param status Current lifecycle status of the deposit.
     */
    struct DepositInfo {
        uint256 planId;
        uint256 principal;
        uint64 startAt;
        uint64 maturityAt;
        uint16 aprBpsAtOpen;
        uint16 penaltyBpsAtOpen;
        DepositStatus status;
    }

    /// @notice Next saving plan id to assign.
    uint256 public nextPlanId;

    /// @notice Next deposit NFT id to assign when deposit logic is added.
    uint256 public nextDepositId;

    /// @notice Saving plan configuration by plan id.
    mapping(uint256 planId => SavingPlan plan) public savingPlans;

    /// @notice Deposit position metadata by future ERC721 token id.
    mapping(uint256 depositId => DepositInfo info) public deposits;

    /// @notice Unpaid maturity interest by closed deposit id when the vault could not pay immediately.
    mapping(uint256 depositId => uint256 amount) public unpaidInterest;

    /// @notice Account allowed to claim deferred interest after the deposit NFT is burned.
    mapping(uint256 depositId => address claimant) public interestClaimant;

    /// @dev Reverts when a tenor value is zero.
    error InvalidTenor();

    /// @dev Reverts when APR exceeds the basis-points denominator.
    error InvalidApr();

    /// @dev Reverts when early withdrawal penalty exceeds the basis-points denominator.
    error InvalidPenalty();

    /// @dev Reverts when a deposit amount boundary is zero or invalid.
    error InvalidAmount();

    /// @dev Reverts when max deposit is lower than min deposit.
    error InvalidPlanRange();

    /// @dev Reverts when a plan id does not exist.
    error PlanNotFound();

    /// @dev Reverts when an operation requires an enabled plan.
    error PlanNotEnabled();

    /// @dev Reverts when enabling an already enabled plan.
    error PlanAlreadyEnabled();

    /// @dev Reverts when disabling an already disabled plan.
    error PlanAlreadyDisabled();

    /// @dev Reverts when a constructor address is zero.
    error InvalidAddress();

    /// @dev Reverts when a deposit amount is below the selected plan minimum.
    error AmountBelowMinimum();

    /// @dev Reverts when a deposit amount is above the selected plan maximum.
    error AmountAboveMaximum();

    /// @dev Reverts when a deposit id does not exist.
    error DepositNotFound();

    /// @dev Reverts when a deposit is not active.
    error DepositNotActive();

    /// @dev Reverts when caller is not the owner of a deposit NFT.
    error NotDepositOwner();

    /// @dev Reverts when a deposit has not reached maturity.
    error NotMatured();

    /// @dev Reverts when a maturity timestamp cannot fit in deposit storage.
    error MaturityOverflow();

    /// @dev Reverts when an early withdrawal is attempted after maturity.
    error AlreadyMatured();

    /// @dev Reverts when auto-renewal is attempted before the grace period ends.
    error GracePeriodNotEnded();

    /// @dev Reverts when compounded renewal principal does not fit the target plan limits.
    error NewPrincipalOutOfRange();

    /// @dev Reverts when a caller is not the stored deferred-interest claimant.
    error NotInterestClaimant();

    /// @dev Reverts when a deposit has no unpaid interest to claim.
    error NoUnpaidInterest();

    /// @dev Reverts when a renewal needs interest liquidity that the vault cannot currently pay.
    error InterestUnavailable();

    /// @dev Reverts when a deposit NFT transfer is not initiated by the authorized marketplace.
    error UnauthorizedTransfer();

    /// @dev Reverts when trying to update metadata after it has been permanently locked.
    error MetadataLocked();

    /**
     * @notice Emitted when a saving plan is created.
     * @param planId Newly assigned plan id.
     * @param tenorDays Lock duration in days.
     * @param aprBps Annual percentage rate in basis points.
     * @param minDeposit Minimum principal amount accepted for this plan.
     * @param maxDeposit Maximum principal amount accepted for this plan.
     * @param earlyWithdrawPenaltyBps Early withdrawal penalty in basis points.
     * @param enabled Whether the plan starts enabled.
     */
    event PlanCreated(
        uint256 indexed planId,
        uint64 tenorDays,
        uint16 aprBps,
        uint256 minDeposit,
        uint256 maxDeposit,
        uint16 earlyWithdrawPenaltyBps,
        bool enabled
    );

    /**
     * @notice Emitted when mutable saving plan fields are updated.
     * @param planId Updated plan id.
     * @param aprBps Current APR in basis points after the update.
     * @param enabled Current enabled state after the update.
     */
    event PlanUpdated(uint256 indexed planId, uint16 aprBps, bool enabled);

    /**
     * @notice Emitted when a user opens a term deposit.
     * @param depositId ERC721 token id representing the deposit position.
     * @param account User that opened and received the deposit NFT.
     * @param planId Saving plan selected by the user.
     * @param principal Principal amount transferred into SavingCore.
     * @param startAt Timestamp when the deposit starts.
     * @param maturityAt Timestamp when the deposit reaches maturity.
     * @param aprBpsAtOpen APR snapshot taken when the deposit opened.
     * @param penaltyBpsAtOpen Early withdrawal penalty snapshot taken when the deposit opened.
     */
    event DepositOpened(
        uint256 indexed depositId,
        address indexed account,
        uint256 indexed planId,
        uint256 principal,
        uint64 startAt,
        uint64 maturityAt,
        uint16 aprBpsAtOpen,
        uint16 penaltyBpsAtOpen
    );

    /**
     * @notice Emitted when a deposit is withdrawn.
     * @param depositId ERC721 token id of the withdrawn deposit position.
     * @param account User that closed the deposit.
     * @param principal Original principal amount closed.
     * @param interest Interest amount paid from VaultManager, if any.
     * @param penalty Early withdrawal penalty amount, if any.
     * @param isEarly Whether the withdrawal happened before maturity.
     */
    event Withdrawn(
        uint256 indexed depositId,
        address indexed account,
        uint256 principal,
        uint256 interest,
        uint256 penalty,
        bool isEarly
    );

    /**
     * @notice Emitted when maturity interest could not be paid and was recorded as a later claim.
     * @param depositId Closed deposit id with deferred interest.
     * @param claimant Account allowed to claim the deferred interest.
     * @param amount Interest amount recorded for later payment.
     */
    event InterestDeferred(uint256 indexed depositId, address indexed claimant, uint256 amount);

    /**
     * @notice Emitted when deferred maturity interest is claimed from the vault.
     * @param depositId Closed deposit id whose deferred interest was claimed.
     * @param claimant Account that received the interest.
     * @param amount Interest amount paid from VaultManager.
     */
    event InterestClaimed(uint256 indexed depositId, address indexed claimant, uint256 amount);

    /**
     * @notice Emitted when an active matured deposit is renewed into a new deposit NFT.
     * @param oldDepositId Previous deposit NFT id that remains as historical proof.
     * @param newDepositId Newly minted deposit NFT id.
     * @param account Owner receiving the renewed deposit NFT.
     * @param newPlanId Plan id used for the new deposit.
     * @param oldPrincipal Previous deposit principal before compounding.
     * @param interest Interest compounded into the new deposit.
     * @param newPrincipal New principal amount after compounding.
     * @param startAt Timestamp when the renewed deposit starts.
     * @param maturityAt Timestamp when the renewed deposit reaches maturity.
     * @param isAuto Whether renewal was triggered by the permissionless auto-renew path.
     */
    event Renewed(
        uint256 indexed oldDepositId,
        uint256 indexed newDepositId,
        address indexed account,
        uint256 newPlanId,
        uint256 oldPrincipal,
        uint256 interest,
        uint256 newPrincipal,
        uint64 startAt,
        uint64 maturityAt,
        bool isAuto
    );

    /**
     * @notice Emitted when a user withdraws matured interest while renewing only the original principal.
     * @param oldDepositId Previous deposit NFT id that remains as historical proof.
     * @param newDepositId Newly minted deposit NFT id.
     * @param account Owner receiving the renewed deposit NFT and interest payment.
     * @param newPlanId Plan id used for the new deposit.
     * @param principal Principal carried into the new deposit.
     * @param interest Interest paid out to the user from VaultManager.
     * @param startAt Timestamp when the renewed deposit starts.
     * @param maturityAt Timestamp when the renewed deposit reaches maturity.
     */
    event InterestWithdrawnAndRenewed(
        uint256 indexed oldDepositId,
        uint256 indexed newDepositId,
        address indexed account,
        uint256 newPlanId,
        uint256 principal,
        uint256 interest,
        uint64 startAt,
        uint64 maturityAt
    );

    /**
     * @notice Emitted when the authorized deposit marketplace is updated.
     * @param oldMarketplace Previous marketplace address.
     * @param newMarketplace New marketplace address.
     */
    event DepositMarketplaceUpdated(address indexed oldMarketplace, address indexed newMarketplace);

    /**
     * @notice Emitted when the metadata image URI is updated.
     * @param oldImageURI Previous image URI.
     * @param newImageURI New image URI.
     */
    event MetadataImageURIUpdated(string oldImageURI, string newImageURI);

    /// @notice Emitted when token metadata URI updates are permanently disabled.
    event MetadataPermanentlyLocked();

    /**
     * @notice Initializes the deposit-position NFT metadata and owner.
     */
    constructor(address _token, address _vaultManager) ERC721("DeFi Saving Deposit", "DSD") Ownable(msg.sender) {
        if (_token == address(0) || _vaultManager == address(0)) revert InvalidAddress();

        token = IERC20(_token);
        vaultManager = IVaultManager(_vaultManager);
    }

    /**
     * @notice Creates a new term-deposit plan.
     * @param tenorDays Lock duration in days.
     * @param aprBps Annual percentage rate in basis points.
     * @param minDeposit Minimum principal amount accepted for this plan.
     * @param maxDeposit Maximum principal amount accepted for this plan.
     * @param earlyWithdrawPenaltyBps Early withdrawal penalty in basis points.
     * @param enabled Whether the plan should accept deposits once deposit logic is added.
     * @return planId Newly assigned plan id.
     */
    function createPlan(
        uint64 tenorDays,
        uint16 aprBps,
        uint256 minDeposit,
        uint256 maxDeposit,
        uint16 earlyWithdrawPenaltyBps,
        bool enabled
    ) external onlyOwner returns (uint256 planId) {
        _validatePlanConfig(tenorDays, aprBps, minDeposit, maxDeposit, earlyWithdrawPenaltyBps);

        planId = nextPlanId;
        unchecked {
            ++nextPlanId;
        }

        savingPlans[planId] = SavingPlan({
            minDeposit: minDeposit,
            maxDeposit: maxDeposit,
            tenorDays: tenorDays,
            aprBps: aprBps,
            earlyWithdrawPenaltyBps: earlyWithdrawPenaltyBps,
            enabled: enabled
        });

        emit PlanCreated(planId, tenorDays, aprBps, minDeposit, maxDeposit, earlyWithdrawPenaltyBps, enabled);
    }

    /**
     * @notice Updates only the APR of an existing saving plan.
     * @param planId Saving plan id to update.
     * @param newAprBps New annual percentage rate in basis points.
     */
    function updatePlan(uint256 planId, uint16 newAprBps) external onlyOwner {
        if (newAprBps > BPS_DENOMINATOR) revert InvalidApr();

        SavingPlan storage plan = _getExistingPlan(planId);
        plan.aprBps = newAprBps;

        emit PlanUpdated(planId, newAprBps, plan.enabled);
    }

    /**
     * @notice Enables an existing saving plan for future deposits.
     * @param planId Saving plan id to enable.
     */
    function enablePlan(uint256 planId) external onlyOwner {
        SavingPlan storage plan = _getExistingPlan(planId);
        if (plan.enabled) revert PlanAlreadyEnabled();

        plan.enabled = true;

        emit PlanUpdated(planId, plan.aprBps, true);
    }

    /**
     * @notice Disables an existing saving plan so future deposits cannot use it.
     * @param planId Saving plan id to disable.
     */
    function disablePlan(uint256 planId) external onlyOwner {
        SavingPlan storage plan = _getExistingPlan(planId);
        if (!plan.enabled) revert PlanAlreadyDisabled();

        plan.enabled = false;

        emit PlanUpdated(planId, plan.aprBps, false);
    }

    /**
     * @notice Opens a new term deposit and mints an ERC721 position NFT to the caller.
     * @dev The selected plan APR and penalty are snapshotted so later admin updates do not affect this deposit.
     * @param planId Saving plan id selected by the depositor.
     * @param amount Principal amount to lock in this contract.
     */
    function openDeposit(uint256 planId, uint256 amount) external whenNotPaused {
        SavingPlan storage plan = _getExistingPlan(planId);
        if (!plan.enabled) revert PlanNotEnabled();
        if (amount == 0) revert InvalidAmount();
        uint256 minDeposit = plan.minDeposit;
        uint256 maxDeposit = plan.maxDeposit;
        if (minDeposit != 0 && amount < minDeposit) revert AmountBelowMinimum();
        if (maxDeposit != 0 && amount > maxDeposit) revert AmountAboveMaximum();

        uint64 tenorDays = plan.tenorDays;
        uint16 aprBps = plan.aprBps;
        uint16 earlyWithdrawPenaltyBps = plan.earlyWithdrawPenaltyBps;
        (uint64 startAt, uint64 maturityAt) = _currentTimestampAndMaturity(uint256(tenorDays) * 1 days);
        uint256 depositId = _storeAndMintDeposit(
            msg.sender,
            planId,
            amount,
            startAt,
            maturityAt,
            aprBps,
            earlyWithdrawPenaltyBps
        );

        emit DepositOpened(
            depositId,
            msg.sender,
            planId,
            amount,
            startAt,
            maturityAt,
            aprBps,
            earlyWithdrawPenaltyBps
        );

        token.safeTransferFrom(msg.sender, address(this), amount);
    }

    /**
     * @notice Withdraws a matured deposit, always returning principal and paying interest when vault liquidity allows.
     * @dev If VaultManager cannot pay the full interest, the unpaid interest is recorded as a later claim.
     * @param depositId ERC721 token id representing the deposit position.
     */
    function withdrawAtMaturity(uint256 depositId) external whenNotPaused {
        DepositInfo storage deposit = _getActiveDeposit(depositId);
        address account = msg.sender;
        if (ownerOf(depositId) != account) revert NotDepositOwner();
        uint64 maturityAt = deposit.maturityAt;
        if (block.timestamp < maturityAt) revert NotMatured();

        uint256 principal = deposit.principal;
        uint256 interest = _calculateInterest(principal, deposit.aprBpsAtOpen, uint256(maturityAt) - deposit.startAt);
        uint256 paidInterest;

        deposit.status = DepositStatus.Withdrawn;
        _burn(depositId);

        token.safeTransfer(account, principal);
        if (interest != 0) {
            try vaultManager.payInterest(account, interest) {
                paidInterest = interest;
            } catch {
                unpaidInterest[depositId] = interest;
                interestClaimant[depositId] = account;
                emit InterestDeferred(depositId, account, interest);
            }
        }

        emit Withdrawn(depositId, account, principal, paidInterest, 0, false);
    }

    /**
     * @notice Claims deferred maturity interest after the vault has enough liquidity.
     * @param depositId Closed deposit id with recorded unpaid interest.
     */
    function claimInterest(uint256 depositId) external whenNotPaused {
        uint256 amount = unpaidInterest[depositId];
        if (amount == 0) revert NoUnpaidInterest();

        address claimant = interestClaimant[depositId];
        if (claimant != msg.sender) revert NotInterestClaimant();
        if (!vaultManager.canPayInterest(amount)) revert InterestUnavailable();

        unpaidInterest[depositId] = 0;
        delete interestClaimant[depositId];

        emit InterestClaimed(depositId, msg.sender, amount);

        vaultManager.payInterest(msg.sender, amount);
    }

    /**
     * @notice Withdraws an active deposit before maturity and routes the penalty to the vault fee receiver.
     * @dev No interest is paid for early withdrawals. The closed deposit NFT is burned.
     * @param depositId ERC721 token id representing the deposit position.
     */
    function earlyWithdraw(uint256 depositId) external whenNotPaused {
        DepositInfo storage deposit = _getActiveDeposit(depositId);
        if (ownerOf(depositId) != msg.sender) revert NotDepositOwner();
        if (block.timestamp >= deposit.maturityAt) revert AlreadyMatured();

        uint256 principal = deposit.principal;
        uint256 penalty = (principal * deposit.penaltyBpsAtOpen) / BPS_DENOMINATOR;
        uint256 payout = principal - penalty;

        deposit.status = DepositStatus.EarlyWithdrawn;
        _burn(depositId);

        emit Withdrawn(depositId, msg.sender, principal, 0, penalty, true);

        if (payout != 0) {
            token.safeTransfer(msg.sender, payout);
        }
        if (penalty != 0) {
            token.safeTransfer(vaultManager.feeReceiver(), penalty);
        }
    }

    /**
     * @notice Manually renews a matured deposit into a new enabled plan and compounds earned interest.
     * @dev The old NFT is kept and marked `ManualRenewed`; a new active NFT is minted to the owner.
     * @param depositId ERC721 token id representing the matured deposit position.
     * @param newPlanId Enabled saving plan id for the renewed deposit.
     */
    function renewDeposit(uint256 depositId, uint256 newPlanId) external whenNotPaused {
        DepositInfo storage oldDeposit = _getActiveDeposit(depositId);
        address account = ownerOf(depositId);
        if (account != msg.sender) revert NotDepositOwner();
        uint64 oldMaturityAt = oldDeposit.maturityAt;
        if (block.timestamp < oldMaturityAt) revert NotMatured();

        SavingPlan storage newPlan = _getExistingPlan(newPlanId);
        if (!newPlan.enabled) revert PlanNotEnabled();

        uint256 oldPrincipal = oldDeposit.principal;
        uint64 oldStartAt = oldDeposit.startAt;
        uint256 interest = _calculateInterest(oldPrincipal, oldDeposit.aprBpsAtOpen, uint256(oldMaturityAt) - oldStartAt);
        if (interest != 0 && !vaultManager.canPayInterest(interest)) revert InterestUnavailable();
        uint256 newPrincipal = oldPrincipal + interest;
        _validateRenewedPrincipal(newPlan, newPrincipal);

        (uint64 startAt, uint64 maturityAt) = _currentTimestampAndMaturity(uint256(newPlan.tenorDays) * 1 days);

        oldDeposit.status = DepositStatus.ManualRenewed;
        uint256 newDepositId = _storeAndMintDeposit(
            account,
            newPlanId,
            newPrincipal,
            startAt,
            maturityAt,
            newPlan.aprBps,
            newPlan.earlyWithdrawPenaltyBps
        );

        emit Renewed(
            depositId,
            newDepositId,
            account,
            newPlanId,
            oldPrincipal,
            interest,
            newPrincipal,
            startAt,
            maturityAt,
            false
        );

        if (interest != 0) {
            vaultManager.payInterest(address(this), interest);
        }
    }

    /**
     * @notice Permissionlessly auto-renews a matured deposit after the grace period and compounds earned interest.
     * @dev The renewed deposit preserves the original plan id, tenor, APR snapshot, and penalty snapshot.
     * @param depositId ERC721 token id representing the matured deposit position.
     */
    function autoRenewDeposit(uint256 depositId) external whenNotPaused {
        DepositInfo storage oldDeposit = _getActiveDeposit(depositId);
        uint64 oldMaturityAt = oldDeposit.maturityAt;
        uint256 renewAfter = uint256(oldMaturityAt) + AUTO_RENEW_GRACE_PERIOD;
        if (block.timestamp < renewAfter) revert GracePeriodNotEnded();

        uint256 planId = oldDeposit.planId;
        SavingPlan storage originalPlan = _getExistingPlan(planId);
        if (!originalPlan.enabled) revert PlanNotEnabled();

        address account = ownerOf(depositId);
        uint256 oldPrincipal = oldDeposit.principal;
        uint64 oldStartAt = oldDeposit.startAt;
        uint16 aprBpsAtOpen = oldDeposit.aprBpsAtOpen;
        uint16 penaltyBpsAtOpen = oldDeposit.penaltyBpsAtOpen;
        uint256 tenorSeconds = uint256(oldMaturityAt) - oldStartAt;
        uint256 interest = _calculateInterest(oldPrincipal, aprBpsAtOpen, tenorSeconds);
        if (interest != 0 && !vaultManager.canPayInterest(interest)) revert InterestUnavailable();
        uint256 newPrincipal = oldPrincipal + interest;
        _validateRenewedPrincipal(originalPlan, newPrincipal);

        (uint64 startAt, uint64 maturityAt) = _currentTimestampAndMaturity(tenorSeconds);

        oldDeposit.status = DepositStatus.AutoRenewed;
        uint256 newDepositId = _storeAndMintDeposit(
            account,
            planId,
            newPrincipal,
            startAt,
            maturityAt,
            aprBpsAtOpen,
            penaltyBpsAtOpen
        );

        emit Renewed(
            depositId,
            newDepositId,
            account,
            planId,
            oldPrincipal,
            interest,
            newPrincipal,
            startAt,
            maturityAt,
            true
        );

        if (interest != 0) {
            vaultManager.payInterest(address(this), interest);
        }
    }

    /**
     * @notice Withdraws matured interest to the owner and renews only the existing principal into a new plan.
     * @dev Reverts if the vault cannot pay the full interest, because this action promises an interest payout.
     * @param depositId ERC721 token id representing the matured deposit position.
     * @param newPlanId Enabled saving plan id for the renewed principal-only deposit.
     */
    function withdrawInterestAndRenewPrincipal(uint256 depositId, uint256 newPlanId) external whenNotPaused {
        DepositInfo storage oldDeposit = _getActiveDeposit(depositId);
        address account = ownerOf(depositId);
        if (account != msg.sender) revert NotDepositOwner();
        uint64 oldMaturityAt = oldDeposit.maturityAt;
        if (block.timestamp < oldMaturityAt) revert NotMatured();

        SavingPlan storage newPlan = _getExistingPlan(newPlanId);
        if (!newPlan.enabled) revert PlanNotEnabled();

        uint256 principal = oldDeposit.principal;
        uint256 interest = _calculateInterest(principal, oldDeposit.aprBpsAtOpen, uint256(oldMaturityAt) - oldDeposit.startAt);
        if (interest != 0 && !vaultManager.canPayInterest(interest)) revert InterestUnavailable();
        _validateRenewedPrincipal(newPlan, principal);

        (uint64 startAt, uint64 maturityAt) = _currentTimestampAndMaturity(uint256(newPlan.tenorDays) * 1 days);

        oldDeposit.status = DepositStatus.ManualRenewed;
        uint256 newDepositId = _storeAndMintDeposit(
            account,
            newPlanId,
            principal,
            startAt,
            maturityAt,
            newPlan.aprBps,
            newPlan.earlyWithdrawPenaltyBps
        );

        emit InterestWithdrawnAndRenewed(depositId, newDepositId, account, newPlanId, principal, interest, startAt, maturityAt);

        if (interest != 0) {
            vaultManager.payInterest(account, interest);
        }
    }

    /**
     * @notice Pauses deposits, withdrawals, and renewal operations during an emergency.
     * @dev Plan administration remains available while paused.
     */
    function pause() external onlyOwner {
        _pause();
    }

    /**
     * @notice Sets the only marketplace contract allowed to transfer deposit NFTs between accounts.
     * @param newMarketplace Marketplace address authorized to execute deposit NFT transfers.
     */
    function setDepositMarketplace(address newMarketplace) external onlyOwner {
        if (newMarketplace == address(0)) revert InvalidAddress();

        address oldMarketplace = depositMarketplace;
        depositMarketplace = newMarketplace;

        emit DepositMarketplaceUpdated(oldMarketplace, newMarketplace);
    }

    /**
     * @notice Sets the IPFS image URI used in dynamically generated NFT metadata.
     * @param newImageURI Image URI such as `ipfs://CID/deposit-certificate.png`.
     */
    function setMetadataImageURI(string calldata newImageURI) external onlyOwner {
        if (metadataLocked) revert MetadataLocked();

        string memory oldImageURI = metadataImageURI;
        metadataImageURI = newImageURI;

        emit MetadataImageURIUpdated(oldImageURI, newImageURI);
    }

    /**
     * @notice Permanently prevents future metadata image URI updates.
     */
    function lockMetadata() external onlyOwner {
        metadataLocked = true;

        emit MetadataPermanentlyLocked();
    }

    /**
     * @notice Unpauses deposits, withdrawals, and renewal operations after an emergency is resolved.
     */
    function unpause() external onlyOwner {
        _unpause();
    }

    /**
     * @notice Previews the principal, interest, and current vault funding status for an active deposit.
     * @param depositId Deposit NFT id to preview.
     * @return principal Principal that will be returned at maturity.
     * @return interest Interest owed for the term.
     * @return canPayInterest Whether the vault can currently pay the full interest amount.
     */
    function previewMaturitySettlement(uint256 depositId)
        external
        view
        returns (uint256 principal, uint256 interest, bool canPayInterest)
    {
        DepositInfo storage deposit = _getActiveDeposit(depositId);
        principal = deposit.principal;
        interest = _calculateInterest(principal, deposit.aprBpsAtOpen, uint256(deposit.maturityAt) - deposit.startAt);
        canPayInterest = interest == 0 || vaultManager.canPayInterest(interest);
    }

    /**
     * @notice Returns Base64-encoded JSON metadata generated from current deposit state.
     * @param tokenId Deposit NFT id.
     */
    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);

        DepositInfo storage deposit = deposits[tokenId];
        bytes memory json = abi.encodePacked(
            "{",
            '"name":"DeFi Saving Deposit #',
            tokenId.toString(),
            '","description":"Soulbound DeFi term-deposit certificate. Transferable only through the official marketplace.",',
            '"image":"',
            metadataImageURI,
            '","attributes":[',
            '{"trait_type":"Principal","value":"',
            _formatUsdc(deposit.principal),
            '"},',
            '{"trait_type":"APR","value":"',
            _formatBps(deposit.aprBpsAtOpen),
            '"},',
            '{"trait_type":"Maturity Timestamp","value":"',
            uint256(deposit.maturityAt).toString(),
            '"},',
            '{"trait_type":"Status","value":"',
            _statusName(deposit.status),
            '"},',
            '{"trait_type":"Transfer Policy","value":"Marketplace only"}',
            "]}"
        );

        return string.concat("data:application/json;base64,", Base64.encode(json));
    }

    /**
     * @dev Formats a 6-decimal token amount for display in NFT metadata.
     */
    function _formatUsdc(uint256 amount) private pure returns (string memory) {
        uint256 whole = amount / 1e6;
        uint256 fractional = amount % 1e6;
        return string.concat(whole.toString(), ".", _sixDigitFraction(fractional), " USDC");
    }

    /**
     * @dev Formats basis points as a percentage string with two decimal places.
     */
    function _formatBps(uint16 bps) private pure returns (string memory) {
        uint256 whole = uint256(bps) / 100;
        uint256 fractional = uint256(bps) % 100;
        return string.concat(whole.toString(), ".", fractional < 10 ? "0" : "", fractional.toString(), "%");
    }

    /**
     * @dev Left-pads a 6-decimal fractional token amount.
     */
    function _sixDigitFraction(uint256 value) private pure returns (string memory) {
        string memory digits = value.toString();
        if (value >= 100_000) return digits;
        if (value >= 10_000) return string.concat("0", digits);
        if (value >= 1_000) return string.concat("00", digits);
        if (value >= 100) return string.concat("000", digits);
        if (value >= 10) return string.concat("0000", digits);
        return string.concat("00000", digits);
    }

    /**
     * @dev Returns a human-readable deposit lifecycle status for NFT metadata.
     */
    function _statusName(DepositStatus status) private pure returns (string memory) {
        string[6] memory statusNames = ["None", "Active", "Withdrawn", "Early Withdrawn", "Manual Renewed", "Auto Renewed"];
        return statusNames[uint256(status)];
    }

    /**
     * @dev Makes deposit NFTs soulbound except for minting, burning, and marketplace-mediated sales.
     */
    function _update(address to, uint256 tokenId, address auth) internal override returns (address from) {
        from = _ownerOf(tokenId);
        if (from != address(0) && to != address(0) && auth != depositMarketplace) revert UnauthorizedTransfer();

        return super._update(to, tokenId, auth);
    }

    /**
     * @notice Stores an active deposit and mints its ERC721 position NFT.
     * @param account Account receiving the deposit NFT.
     * @param planId Saving plan id assigned to the deposit.
     * @param principal Principal amount backing the deposit.
     * @param startAt Deposit start timestamp.
     * @param maturityAt Deposit maturity timestamp.
     * @param aprBpsAtOpen APR snapshot for this deposit.
     * @param penaltyBpsAtOpen Early withdrawal penalty snapshot for this deposit.
     * @return depositId Newly minted deposit NFT id.
     */
    function _storeAndMintDeposit(
        address account,
        uint256 planId,
        uint256 principal,
        uint64 startAt,
        uint64 maturityAt,
        uint16 aprBpsAtOpen,
        uint16 penaltyBpsAtOpen
    ) private returns (uint256 depositId) {
        depositId = nextDepositId;
        unchecked {
            ++nextDepositId;
        }

        deposits[depositId] = DepositInfo({
            planId: planId,
            principal: principal,
            startAt: startAt,
            maturityAt: maturityAt,
            aprBpsAtOpen: aprBpsAtOpen,
            penaltyBpsAtOpen: penaltyBpsAtOpen,
            status: DepositStatus.Active
        });

        _safeMint(account, depositId);
    }

    /**
     * @notice Returns the current timestamp and bounded maturity timestamp for a duration.
     * @param durationSeconds Lock duration in seconds.
     * @return startAt Current block timestamp as uint64.
     * @return maturityAt Maturity timestamp as uint64.
     */
    function _currentTimestampAndMaturity(uint256 durationSeconds) private view returns (uint64 startAt, uint64 maturityAt) {
        uint256 start = block.timestamp;
        uint256 maturity = start + durationSeconds;
        if (maturity > type(uint64).max) revert MaturityOverflow();

        startAt = uint64(start);
        maturityAt = uint64(maturity);
    }

    /**
     * @notice Calculates simple interest for a deposit using its opening APR snapshot and locked tenor.
     * @param principal Principal amount used for interest calculation.
     * @param aprBps APR snapshot in basis points.
     * @param tenorSeconds Deposit duration in seconds.
     * @return interest Simple interest amount owed for the deposit tenor.
     */
    function _calculateInterest(uint256 principal, uint16 aprBps, uint256 tenorSeconds) private pure returns (uint256 interest) {
        interest = (principal * aprBps * tenorSeconds) / (YEAR_SECONDS * BPS_DENOMINATOR);
    }

    /**
     * @dev Reverts when a renewed principal does not fit the selected plan limits.
     */
    function _validateRenewedPrincipal(SavingPlan storage plan, uint256 principal) private view {
        if (!_isRenewedPrincipalInRange(plan, principal)) revert NewPrincipalOutOfRange();
    }

    /**
     * @dev Returns whether a renewed principal fits the selected plan limits.
     */
    function _isRenewedPrincipalInRange(SavingPlan storage plan, uint256 principal) private view returns (bool) {
        return (plan.minDeposit == 0 || principal >= plan.minDeposit) && (plan.maxDeposit == 0 || principal <= plan.maxDeposit);
    }

    /**
     * @notice Loads an active deposit or reverts.
     * @param depositId Deposit NFT id to load.
     * @return deposit Storage pointer to the active deposit.
     */
    function _getActiveDeposit(uint256 depositId) private view returns (DepositInfo storage deposit) {
        deposit = deposits[depositId];
        if (deposit.status == DepositStatus.None) revert DepositNotFound();
        if (deposit.status != DepositStatus.Active) revert DepositNotActive();
    }

    /**
     * @notice Validates saving plan configuration.
     * @param tenorDays Lock duration in days.
     * @param aprBps Annual percentage rate in basis points.
     * @param minDeposit Minimum principal amount accepted for this plan.
     * @param maxDeposit Maximum principal amount accepted for this plan.
     * @param earlyWithdrawPenaltyBps Early withdrawal penalty in basis points.
     */
    function _validatePlanConfig(
        uint64 tenorDays,
        uint16 aprBps,
        uint256 minDeposit,
        uint256 maxDeposit,
        uint16 earlyWithdrawPenaltyBps
    ) private pure {
        if (tenorDays == 0) revert InvalidTenor();
        if (aprBps > BPS_DENOMINATOR) revert InvalidApr();
        if (earlyWithdrawPenaltyBps > BPS_DENOMINATOR) revert InvalidPenalty();
        if (maxDeposit != 0 && minDeposit > maxDeposit) revert InvalidPlanRange();
    }

    /**
     * @notice Loads an existing saving plan or reverts.
     * @param planId Saving plan id to load.
     * @return plan Storage pointer to the requested plan.
     */
    function _getExistingPlan(uint256 planId) private view returns (SavingPlan storage plan) {
        plan = savingPlans[planId];
        if (plan.tenorDays == 0) revert PlanNotFound();
    }
}
