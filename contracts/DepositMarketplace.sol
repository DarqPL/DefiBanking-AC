// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @notice Minimal SavingCore interface used by DepositMarketplace.
 */
interface ISavingCoreMarketplace {
    /**
     * @notice Lifecycle status for a deposit NFT position.
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
     * @notice Returns the owner of a deposit NFT.
     * @param tokenId Deposit NFT id.
     * @return owner Current owner address.
     */
    function ownerOf(uint256 tokenId) external view returns (address owner);

    /**
     * @notice Transfers a deposit NFT between accounts.
     * @param from Current owner.
     * @param to Recipient.
     * @param tokenId Deposit NFT id.
     */
    function safeTransferFrom(address from, address to, uint256 tokenId) external;

    /**
     * @notice Returns deposit metadata.
     */
    function deposits(uint256 depositId)
        external
        view
        returns (
            uint256 planId,
            uint256 principal,
            uint64 startAt,
            uint64 maturityAt,
            uint16 aprBpsAtOpen,
            uint16 penaltyBpsAtOpen,
            DepositStatus status
        );
}

/**
 * @title DepositMarketplace
 * @notice Escrow marketplace for authentic SavingCore term-deposit NFTs.
 */
contract DepositMarketplace is IERC721Receiver, Ownable, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice Lower bound for the restricted no-listing window in days.
    uint256 public constant MIN_NO_LISTING_DAYS = 10;

    /// @notice Upper bound for the restricted no-listing window in days.
    uint256 public constant MAX_NO_LISTING_DAYS = 30;

    /// @notice Percent of deposit tenor used for the no-listing window.
    uint256 public constant NO_LISTING_PERCENT = 5;

    /// @notice Official SavingCore contract whose NFTs are accepted.
    ISavingCoreMarketplace public immutable savingCore;

    /// @notice ERC20 token used to pay sellers, expected to be USDC or MockUSDC.
    IERC20 public immutable paymentToken;

    /// @notice Current marketplace terms hash sellers must accept when listing.
    bytes32 public currentTermsHash;

    /**
     * @notice Active marketplace listing.
     * @param seller Seller that owns the sale proceeds and receives cleanup/cancel returns.
     * @param price Sale price in the payment token's smallest unit.
     */
    struct Listing {
        address seller;
        uint96 price;
    }

    /// @notice Active listing by deposit NFT id.
    mapping(uint256 depositId => Listing listing) public listings;

    /// @notice Active listed deposit ids used for cleanup scans and frontend reads.
    uint256[] public listedDepositIds;

    /// @dev Active listing array index plus one by deposit id. Zero means not listed.
    mapping(uint256 depositId => uint256 indexPlusOne) private listingIndexPlusOne;

    /// @notice Cursor used by repeated cleanup calls to avoid always scanning from index zero.
    uint256 public cleanupCursor;

    /// @dev Listing transfer guard: expected deposit id plus one while receiving the escrow NFT.
    uint256 private expectedDepositIdPlusOne;

    /// @dev Reverts when an address parameter is zero.
    error InvalidAddress();

    /// @dev Reverts when a price is zero.
    error InvalidPrice();

    /// @dev Reverts when terms are missing or do not match the current terms hash.
    error InvalidTerms();

    /// @dev Reverts when a listing does not exist.
    error ListingNotFound();

    /// @dev Reverts when a deposit is already listed.
    error AlreadyListed();

    /// @dev Reverts when caller is not the listing seller.
    error NotSeller();

    /// @dev Reverts when caller is not the current deposit NFT owner.
    error NotDepositOwner();

    /// @dev Reverts when a deposit is not active.
    error DepositNotActive();

    /// @dev Reverts when a deposit is inside the marketplace restricted window.
    error RestrictedWindow();

    /// @dev Reverts when an NFT is not from the official SavingCore contract.
    error InvalidNFT();

    /// @dev Reverts when an ERC721 is sent without the listing flow.
    error DirectTransferRejected();

    /// @dev Reverts when SavingCore tries to mint a renewed NFT into marketplace custody.
    error RenewalMintRejected();

    /// @dev Reverts when the marketplace does not hold the listed NFT.
    error NotEscrowed();

    /// @dev Reverts when maxListings is zero.
    error InvalidMaxListings();

    /// @dev Reverts when the seller tries to buy their own listing.
    error SelfBuyNotAllowed();

    /**
     * @notice Emitted when a deposit NFT is listed.
     */
    event Listed(uint256 indexed depositId, address indexed seller, uint256 price, bytes32 termsHash);

    /**
     * @notice Emitted when a deposit NFT listing is purchased.
     */
    event ListingPurchased(uint256 indexed depositId, address indexed seller, address indexed buyer, uint256 price);

    /**
     * @notice Emitted when a seller cancels a listing.
     */
    event ListingCancelled(uint256 indexed depositId, address indexed seller);

    /**
     * @notice Emitted when cleanup removes a stale listing.
     */
    event ListingExpired(uint256 indexed depositId, address indexed seller);

    /**
     * @notice Emitted when the required marketplace terms hash is updated.
     */
    event TermsHashUpdated(bytes32 indexed oldTermsHash, bytes32 indexed newTermsHash);

    /**
     * @notice Emitted when the owner recovers an unlisted NFT accidentally sent with raw transferFrom.
     */
    event UnlistedDepositRecovered(uint256 indexed depositId, address indexed recipient);

    /**
     * @notice Initializes the marketplace with official protocol contracts and terms.
     * @param _savingCore Official SavingCore contract address.
     * @param _paymentToken ERC20 token used for marketplace payments.
     * @param _termsHash Initial terms hash sellers must accept.
     */
    constructor(address _savingCore, address _paymentToken, bytes32 _termsHash) Ownable(msg.sender) {
        if (_savingCore == address(0) || _paymentToken == address(0)) revert InvalidAddress();
        if (_termsHash == bytes32(0)) revert InvalidTerms();

        savingCore = ISavingCoreMarketplace(_savingCore);
        paymentToken = IERC20(_paymentToken);
        currentTermsHash = _termsHash;
    }

    /**
     * @notice Lists an eligible active deposit NFT and transfers it into marketplace escrow.
     * @param depositId Deposit NFT id to list.
     * @param price Sale price in the payment token's smallest unit.
     * @param acceptedTermsHash Terms hash accepted by the seller.
     */
    function listDeposit(uint256 depositId, uint256 price, bytes32 acceptedTermsHash)
        external
        whenNotPaused
        nonReentrant
    {
        if (price == 0 || price > type(uint96).max) revert InvalidPrice();
        if (acceptedTermsHash != currentTermsHash) revert InvalidTerms();
        if (listingIndexPlusOne[depositId] != 0) revert AlreadyListed();
        if (savingCore.ownerOf(depositId) != msg.sender) revert NotDepositOwner();

        (uint64 startAt, uint64 maturityAt, ISavingCoreMarketplace.DepositStatus status) = _depositState(depositId);
        if (status != ISavingCoreMarketplace.DepositStatus.Active) revert DepositNotActive();
        if (_isRestricted(startAt, maturityAt)) revert RestrictedWindow();

        listings[depositId] = Listing({seller: msg.sender, price: uint96(price)});
        _addListing(depositId);

        expectedDepositIdPlusOne = depositId + 1;
        savingCore.safeTransferFrom(msg.sender, address(this), depositId);
        expectedDepositIdPlusOne = 0;

        emit Listed(depositId, msg.sender, price, acceptedTermsHash);
    }

    /**
     * @notice Buys a listed deposit NFT with the configured payment token.
     * @param depositId Deposit NFT listing to buy.
     */
    function buyDeposit(uint256 depositId) external whenNotPaused nonReentrant {
        Listing memory listing = listings[depositId];
        if (listing.seller == address(0)) revert ListingNotFound();
        if (listing.seller == msg.sender) revert SelfBuyNotAllowed();
        (uint64 startAt, uint64 maturityAt, ISavingCoreMarketplace.DepositStatus status) = _depositState(depositId);
        if (status != ISavingCoreMarketplace.DepositStatus.Active) revert DepositNotActive();
        if (_isRestricted(startAt, maturityAt)) revert RestrictedWindow();
        if (savingCore.ownerOf(depositId) != address(this)) revert NotEscrowed();

        _removeListing(depositId);

        paymentToken.safeTransferFrom(msg.sender, listing.seller, listing.price);
        savingCore.safeTransferFrom(address(this), msg.sender, depositId);

        emit ListingPurchased(depositId, listing.seller, msg.sender, listing.price);
    }

    /**
     * @notice Cancels a listing and returns the deposit NFT to the seller.
     * @param depositId Deposit NFT listing to cancel.
     */
    function cancelListing(uint256 depositId) external nonReentrant {
        Listing memory listing = listings[depositId];
        if (listing.seller == address(0)) revert ListingNotFound();
        if (listing.seller != msg.sender) revert NotSeller();
        if (savingCore.ownerOf(depositId) != address(this)) revert NotEscrowed();

        _removeListing(depositId);
        savingCore.safeTransferFrom(address(this), listing.seller, depositId);

        emit ListingCancelled(depositId, listing.seller);
    }

    /**
     * @notice Removes stale listings and returns escrowed NFTs to their sellers when possible.
     * @param maxListings Maximum listing slots to scan during this call.
     * @return cleaned Number of stale listings removed.
     */
    function cleanExpiredListings(uint256 maxListings) external nonReentrant returns (uint256 cleaned) {
        if (maxListings == 0) revert InvalidMaxListings();

        uint256 checked;
        while (checked < maxListings) {
            uint256 length = listedDepositIds.length;
            if (length == 0) break;

            uint256 cursor = cleanupCursor;
            if (cursor >= length) cursor = 0;

            uint256 depositId = listedDepositIds[cursor];
            if (_isStale(depositId)) {
                Listing memory listing = listings[depositId];
                _removeListing(depositId);

                if (_isEscrowed(depositId)) {
                    savingCore.safeTransferFrom(address(this), listing.seller, depositId);
                }

                emit ListingExpired(depositId, listing.seller);
                unchecked {
                    ++cleaned;
                }
            } else {
                unchecked {
                    cleanupCursor = cursor + 1;
                }
            }

            unchecked {
                ++checked;
            }
        }
    }

    /**
     * @notice Recovers an unlisted deposit NFT accidentally sent to the marketplace without safe listing flow.
     * @param depositId Deposit NFT id to recover.
     * @param recipient Account that should receive the NFT.
     */
    function recoverUnlistedDeposit(uint256 depositId, address recipient) external onlyOwner nonReentrant {
        if (recipient == address(0)) revert InvalidAddress();
        if (listingIndexPlusOne[depositId] != 0) revert AlreadyListed();
        if (savingCore.ownerOf(depositId) != address(this)) revert NotEscrowed();

        savingCore.safeTransferFrom(address(this), recipient, depositId);

        emit UnlistedDepositRecovered(depositId, recipient);
    }

    /**
     * @notice Returns whether a deposit can currently be listed on this marketplace.
     * @param depositId Deposit NFT id to check.
     */
    function isListable(uint256 depositId) public view returns (bool) {
        (uint64 startAt, uint64 maturityAt, ISavingCoreMarketplace.DepositStatus status) = _depositState(depositId);
        return status == ISavingCoreMarketplace.DepositStatus.Active && !_isRestricted(startAt, maturityAt);
    }

    /**
     * @notice Returns the no-listing window for a deposit in days.
     * @param depositId Deposit NFT id to check.
     */
    function noListingDays(uint256 depositId) public view returns (uint256 daysCount) {
        (,, uint64 startAt, uint64 maturityAt,,,) = savingCore.deposits(depositId);
        uint256 tenorDays = (uint256(maturityAt) - startAt) / 1 days;
        daysCount = _noListingDaysFromTenor(tenorDays);
    }

    /**
     * @notice Returns the number of active listings.
     */
    function listedCount() external view returns (uint256) {
        return listedDepositIds.length;
    }

    /**
     * @notice Updates the marketplace terms hash sellers must accept for new listings.
     * @param newTermsHash New terms hash.
     */
    function setTermsHash(bytes32 newTermsHash) external onlyOwner {
        if (newTermsHash == bytes32(0)) revert InvalidTerms();

        bytes32 oldTermsHash = currentTermsHash;
        currentTermsHash = newTermsHash;

        emit TermsHashUpdated(oldTermsHash, newTermsHash);
    }

    /**
     * @notice Pauses listing and buying during an emergency.
     */
    function pause() external onlyOwner {
        _pause();
    }

    /**
     * @notice Unpauses listing and buying after an emergency is resolved.
     */
    function unpause() external onlyOwner {
        _unpause();
    }

    /**
     * @notice Receives official SavingCore NFTs only during marketplace listing transfers.
     */
    function onERC721Received(address, address from, uint256 tokenId, bytes calldata)
        external
        view
        returns (bytes4)
    {
        if (msg.sender != address(savingCore)) revert InvalidNFT();
        if (from == address(0)) revert RenewalMintRejected();
        if (expectedDepositIdPlusOne != tokenId + 1) revert DirectTransferRejected();

        return IERC721Receiver.onERC721Received.selector;
    }

    /**
     * @dev Adds a deposit id to the active listing index.
     */
    function _addListing(uint256 depositId) private {
        listedDepositIds.push(depositId);
        listingIndexPlusOne[depositId] = listedDepositIds.length;
    }

    /**
     * @dev Removes a deposit id from the active listing index and clears listing state.
     */
    function _removeListing(uint256 depositId) private {
        uint256 indexPlusOne = listingIndexPlusOne[depositId];
        if (indexPlusOne == 0) revert ListingNotFound();

        uint256 index = indexPlusOne - 1;
        uint256 lastIndex = listedDepositIds.length - 1;

        if (index != lastIndex) {
            uint256 movedDepositId = listedDepositIds[lastIndex];
            listedDepositIds[index] = movedDepositId;
            listingIndexPlusOne[movedDepositId] = indexPlusOne;
        }

        listedDepositIds.pop();
        delete listingIndexPlusOne[depositId];
        delete listings[depositId];

        uint256 length = listedDepositIds.length;
        if (cleanupCursor > length) cleanupCursor = length;
    }

    /**
     * @dev Returns true when a deposit status is Active.
     */
    function _depositState(uint256 depositId)
        private
        view
        returns (uint64 startAt, uint64 maturityAt, ISavingCoreMarketplace.DepositStatus status)
    {
        (,, startAt, maturityAt,,, status) = savingCore.deposits(depositId);
    }

    /**
     * @dev Returns true when a deposit is inside or past the marketplace restricted window.
     */
    function _isRestricted(uint64 startAt, uint64 maturityAt) private view returns (bool) {
        uint256 blockedAt = uint256(maturityAt) - (_noListingDaysFromTimestamps(startAt, maturityAt) * 1 days);
        return block.timestamp >= blockedAt;
    }

    /**
     * @dev Returns true when a listing should be removed by cleanup.
     */
    function _isStale(uint256 depositId) private view returns (bool) {
        (uint64 startAt, uint64 maturityAt, ISavingCoreMarketplace.DepositStatus status) = _depositState(depositId);
        return status != ISavingCoreMarketplace.DepositStatus.Active || _isRestricted(startAt, maturityAt) || !_isEscrowed(depositId);
    }

    /**
     * @dev Returns true when the marketplace currently owns a deposit NFT.
     */
    function _isEscrowed(uint256 depositId) private view returns (bool) {
        try savingCore.ownerOf(depositId) returns (address owner) {
            return owner == address(this);
        } catch {
            return false;
        }
    }

    /**
     * @dev Calculates no-listing days from deposit timestamps.
     */
    function _noListingDaysFromTimestamps(uint64 startAt, uint64 maturityAt) private pure returns (uint256 daysCount) {
        uint256 tenorDays = (uint256(maturityAt) - startAt) / 1 days;
        daysCount = _noListingDaysFromTenor(tenorDays);
    }

    /**
     * @dev Applies the marketplace no-listing formula to a tenor in days.
     */
    function _noListingDaysFromTenor(uint256 tenorDays) private pure returns (uint256 daysCount) {
        daysCount = (tenorDays * NO_LISTING_PERCENT) / 100;
        if (daysCount < MIN_NO_LISTING_DAYS) return MIN_NO_LISTING_DAYS;
        if (daysCount > MAX_NO_LISTING_DAYS) return MAX_NO_LISTING_DAYS;
    }
}
