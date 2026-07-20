// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title VaultManager
 * @notice Holds protocol liquidity used for interest payouts and tracks the early-withdrawal fee receiver.
 */
contract VaultManager is Ownable, Pausable {
    using SafeERC20 for IERC20;

    /// @notice ERC20 token held by the vault, expected to be USDC or MockUSDC.
    IERC20 public immutable token;

    /// @notice Address that receives early withdrawal penalty fees.
    address public feeReceiver;

    /// @notice SavingCore contract allowed to pay interest from this vault.
    address public savingCore;

    /// @dev Reverts when an address parameter is zero.
    error InvalidAddress();

    /// @dev Reverts when an amount parameter is zero.
    error ZeroAmount();

    /// @dev Reverts when the vault does not have enough token liquidity.
    error InsufficientVaultBalance();

    /// @dev Reverts when a caller is not the configured SavingCore contract.
    error NotSavingCore();

    /**
     * @notice Restricts function access to the configured SavingCore contract.
     */
    modifier onlySavingCore() {
        if (msg.sender != savingCore) revert NotSavingCore();
        _;
    }

    /**
     * @notice Emitted when the fee receiver is updated.
     * @param oldReceiver Previous fee receiver address.
     * @param newReceiver New fee receiver address.
     */
    event FeeReceiverUpdated(address indexed oldReceiver, address indexed newReceiver);

    /**
     * @notice Emitted when the vault receives funding.
     * @param funder Address that transferred tokens into the vault.
     * @param amount Amount of tokens transferred.
     */
    event VaultFunded(address indexed funder, uint256 amount);

    /**
     * @notice Emitted when the owner withdraws vault liquidity.
     * @param recipient Address that received the withdrawn tokens.
     * @param amount Amount of tokens withdrawn.
     */
    event VaultWithdrawn(address indexed recipient, uint256 amount);

    /**
     * @notice Emitted when the authorized SavingCore contract is updated.
     * @param oldSavingCore Previous SavingCore address.
     * @param newSavingCore New SavingCore address.
     */
    event SavingCoreUpdated(address indexed oldSavingCore, address indexed newSavingCore);

    /**
     * @notice Emitted when interest liquidity is paid to a depositor.
     * @param recipient Address that received the interest payment.
     * @param amount Amount of interest paid.
     */
    event InterestPaid(address indexed recipient, uint256 amount);

    /**
     * @notice Initializes the vault with its ERC20 token and initial penalty fee receiver.
     * @param _token ERC20 token address used by the vault.
     * @param _initialFeeReceiver Initial address that receives penalty fees.
     */
    constructor(address _token, address _initialFeeReceiver) Ownable(msg.sender) {
        if (_token == address(0) || _initialFeeReceiver == address(0)) revert InvalidAddress();

        token = IERC20(_token);
        feeReceiver = _initialFeeReceiver;
    }

    /**
     * @notice Updates the address that receives early withdrawal penalty fees.
     * @param newReceiver New fee receiver address.
     */
    function setFeeReceiver(address newReceiver) external onlyOwner {
        if (newReceiver == address(0)) revert InvalidAddress();

        address oldReceiver = feeReceiver;
        feeReceiver = newReceiver;

        emit FeeReceiverUpdated(oldReceiver, newReceiver);
    }

    /**
     * @notice Updates the SavingCore contract authorized to pay interest from this vault.
     * @param newSavingCore SavingCore contract address.
     */
    function setSavingCore(address newSavingCore) external onlyOwner {
        if (newSavingCore == address(0)) revert InvalidAddress();

        address oldSavingCore = savingCore;
        savingCore = newSavingCore;

        emit SavingCoreUpdated(oldSavingCore, newSavingCore);
    }

    /**
     * @notice Funds the vault with tokens from the owner.
     * @dev Caller must approve this contract before calling.
     * @param amount Amount of tokens to transfer into the vault.
     */
    function fundVault(uint256 amount) external onlyOwner whenNotPaused {
        if (amount == 0) revert ZeroAmount();

        emit VaultFunded(msg.sender, amount);

        token.safeTransferFrom(msg.sender, address(this), amount);
    }

    /**
     * @notice Withdraws vault liquidity to the owner.
     * @param amount Amount of tokens to withdraw.
     */
    function withdrawVault(uint256 amount) external onlyOwner whenNotPaused {
        if (amount == 0) revert ZeroAmount();

        IERC20 vaultToken = token;
        if (vaultToken.balanceOf(address(this)) < amount) revert InsufficientVaultBalance();

        address recipient = owner();

        emit VaultWithdrawn(recipient, amount);

        vaultToken.safeTransfer(recipient, amount);
    }

    /**
     * @notice Pays interest liquidity to a matured depositor.
     * @dev Callable only by the configured SavingCore contract.
     * @param to Recipient of the interest payment.
     * @param amount Amount of interest to pay.
     */
    function payInterest(address to, uint256 amount) external onlySavingCore whenNotPaused {
        if (to == address(0)) revert InvalidAddress();
        if (amount == 0) revert ZeroAmount();

        IERC20 vaultToken = token;
        if (vaultToken.balanceOf(address(this)) < amount) revert InsufficientVaultBalance();

        emit InterestPaid(to, amount);

        vaultToken.safeTransfer(to, amount);
    }

    /**
     * @notice Pauses vault funding and withdrawals.
     */
    function pause() external onlyOwner {
        _pause();
    }

    /**
     * @notice Unpauses vault funding and withdrawals.
     */
    function unpause() external onlyOwner {
        _unpause();
    }
}
