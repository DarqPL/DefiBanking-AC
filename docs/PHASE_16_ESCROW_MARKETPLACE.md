# Phase 16: Escrow Marketplace For Savings NFTs

## Goal

Build a native marketplace where users can sell transferable savings-account NFTs while preserving the core rule that the current `SavingCore` NFT owner owns the withdrawal right.

The official deposit passbook identity is:

```text
chainId + SavingCore contract address + depositId
```

An NFT with the same metadata, APR, principal, and maturity date is not authentic unless it is the actual ERC721 token minted by the deployed `SavingCore` contract.

## Current Behavior

`SavingCore` already uses ERC721 ownership as the withdrawal authority:

- `withdrawAtMaturity(depositId)` requires `ownerOf(depositId) == msg.sender`.
- `earlyWithdraw(depositId)` requires `ownerOf(depositId) == msg.sender`.
- `renewDeposit(depositId, newPlanId)` requires `ownerOf(depositId) == msg.sender`.

This means transferred NFTs are valid passbooks. If Alice transfers a deposit NFT to Bob, Bob can withdraw or renew and Alice cannot.

The frontend must be updated because it currently discovers deposits from `DepositOpened(account)` events. That shows deposits originally opened by a wallet, not deposits currently owned by a wallet.

## Marketplace Contract

Add a new `DepositMarketplace` contract instead of adding marketplace storage to `SavingCore`.

Recommended responsibilities:

- Accept only the official `SavingCore` contract address.
- Accept only the official USDC or `MockUSDC` payment token.
- Hold listed savings NFTs in escrow.
- Verify seller ownership before listing.
- Verify deposit status is `Active` before listing and purchase.
- Reject listings that are too close to maturity.
- Return expired listings from escrow to sellers.
- Keep `SavingCore` as the only source of truth for deposit ownership and withdrawal rights.

## Escrow Listing Flow

Seller approves and lists:

```solidity
savingCore.approve(address(marketplace), depositId);
marketplace.listDeposit(depositId, price, acceptedTermsHash);
```

The marketplace should check:

- `price > 0`.
- `savingCore.ownerOf(depositId) == msg.sender`.
- `savingCore.deposits(depositId).status == Active`.
- The deposit is outside the no-listing window.
- `acceptedTermsHash == currentTermsHash`.

Then it transfers the NFT into escrow:

```solidity
savingCore.safeTransferFrom(msg.sender, address(this), depositId);
```

While escrowed, the seller cannot withdraw because the seller no longer owns the NFT.

## Purchase Flow

Buyer approves and buys:

```solidity
paymentToken.approve(address(marketplace), price);
marketplace.buyDeposit(depositId);
```

The marketplace should check the listing again at purchase time:

- Listing exists.
- Deposit is still `Active`.
- Deposit is still outside the restricted purchase window.
- Marketplace still owns the NFT.

Then it transfers payment to the seller and the NFT to the buyer.

The buyer becomes the current ERC721 owner and can later withdraw or renew through `SavingCore`.

## No-Listing Window

Let `T` be the original deposit duration in days:

```text
T = floor((maturityAt - startAt) / 1 days)
```

Let `D` be the number of final days during which listing is not allowed:

```text
D = min(max(10, floor(T * 5 / 100)), 30)
```

The marketplace should reject listing and purchase when:

```text
block.timestamp >= maturityAt - (D * 1 days)
```

For the default 180-day plan:

```text
D = min(max(10, floor(180 * 5 / 100)), 30)
D = min(max(10, 9), 30)
D = 10
```

So the marketplace blocks listing and buying during the final 10 days.

## Expired Listing Cleanup

Smart contracts cannot execute automatically. A listed NFT that later enters the no-listing window must be cleaned by an external caller.

Add a permissionless cleanup function to `DepositMarketplace`:

```solidity
function cleanExpiredListings(uint256 maxListings) external returns (uint256 cleaned);
```

Expected behavior:

- Scan up to `maxListings` active listings.
- If a listing is now inside the no-listing window or the deposit is no longer active, delete the listing.
- Return the escrowed NFT to the original seller wallet.
- Emit `ListingExpired(depositId, seller)` or a similar event.
- Continue scanning even when some listings are not expired.

The function must be safe for anyone to call. The project bot, frontend, a third-party keeper, or cron-job.org can trigger it.

The buyer path must also re-check eligibility. This prevents buying stale listings even if the cleanup bot is delayed.

## Cleanup API

Add `/api/marketplace-cleanup` as a Vercel API endpoint.

The endpoint is designed for cron-job.org every 15 minutes:

```text
https://<your-project-name>.vercel.app/api/marketplace-cleanup?secret=<CRON_SECRET>
```

Required Vercel environment variables:

- `BOT_PRIVATE_KEY`: Sepolia bot wallet private key for gas.
- `CRON_SECRET`: Shared secret used to protect the endpoint.
- `MARKETPLACE_ADDRESS`: Deployed `DepositMarketplace` address.

Optional environment variables:

- `SEPOLIA_RPC_URL`: Custom Sepolia RPC URL.
- `MARKETPLACE_CLEANUP_MAX_LISTINGS`: Default maximum listings to scan per call.

Manual dry-run URL:

```text
https://<your-project-name>.vercel.app/api/marketplace-cleanup?secret=<CRON_SECRET>&dryRun=1
```

The dry run calls `cleanExpiredListings.staticCall(maxListings)` and reports how many listings would be cleaned without sending a transaction.

## Frontend Updates

Update the user dashboard to derive current ownership from ERC721 `Transfer` events, not just `DepositOpened(account)` events.

Minimum frontend behavior:

- Seller no longer sees a deposit after transferring or listing it into marketplace escrow.
- Buyer sees the deposit after purchase.
- Escrowed deposits appear in marketplace listings, not in the seller's wallet dashboard.
- Matured, withdrawn, early-withdrawn, or renewed deposits are excluded from sellable listings.

Add a marketplace page with:

- Active listings.
- List deposit form.
- Terms agreement checkbox.
- Price input in USDC.
- Buy button.
- Cancel listing button for sellers.
- Cleanup prompt or background cleanup trigger for expired listings.

## Contract Test Plan

Add `test/DepositMarketplace.test.ts` covering:

- Eligible active deposit can be listed.
- Listing transfers the NFT into marketplace escrow.
- Seller cannot withdraw while listed.
- Buyer can buy and receives the NFT.
- Buyer can withdraw at maturity after purchase.
- Seller cannot withdraw after sale.
- Non-owner cannot list.
- Unknown deposit cannot be listed.
- Inactive deposit cannot be listed.
- Deposit inside the no-listing window cannot be listed.
- Stale listing cannot be bought.
- `cleanExpiredListings` returns expired listings to sellers.
- Seller can cancel before sale.
- Non-seller cannot cancel.
- Wrong terms hash rejects listing.

## Deployment Plan

1. Implement `DepositMarketplace.sol`.
2. Add tests and run `npm.cmd test`.
3. Add deploy script after `SavingCore` deployment.
4. Run `npm.cmd run compile` to regenerate ABI exports and TypeChain.
5. Copy generated marketplace ABI into `frontend/src/abi/` if the frontend imports static ABIs.
6. Add `MARKETPLACE_ADDRESS` to frontend config after Sepolia deployment.
7. Configure Vercel `MARKETPLACE_ADDRESS` and redeploy.
8. Configure cron-job.org to call `/api/marketplace-cleanup` every 15 minutes.

## Current Progress: Phase 16 Question 1

Phase 16 Question 1 is implemented at the contract and deployment-script level.

Completed contract work:

- `SavingCore` now uses `_safeMint` for deposit NFTs, allowing marketplace escrow to reject renewal mints while preserving normal EOA minting.
- `DepositMarketplace` was added as a separate escrow marketplace contract.
- The marketplace verifies the official `SavingCore` NFT, active deposit status, seller ownership, terms hash, and the no-listing window before accepting listings.
- The marketplace blocks self-buying; sellers should cancel listings instead.
- The marketplace returns expired/stale listings to sellers through permissionless cleanup.
- The marketplace implements `cleanExpiredListings(uint256 maxListings)` for the Vercel cron API.
- The marketplace rejects direct `safeTransferFrom` deposits and rejects `_safeMint` renewal mints from `SavingCore` while escrowed.
- The marketplace owner can recover an unlisted NFT sent by raw ERC721 `transferFrom`.

Completed deployment work:

- `deploy/04-deploy-deposit-marketplace.ts` deploys `DepositMarketplace` after `SavingCore`.
- The deployment uses the committed `MockUSDC` and `SavingCore` deployment addresses from `hardhat-deploy`.
- The initial marketplace terms hash is:

```text
0x3b66a5c015a29f4b433c579a09d7e3f9be033797349ca7d673571d722c5b8676
```

This is computed as:

```text
ethers.id("phase-16-marketplace-terms-v1")
```

Deployment command:

```bash
npx.cmd hardhat deploy --network sepolia
```

After Sepolia deployment:

- Set Vercel `MARKETPLACE_ADDRESS` to the deployed `DepositMarketplace` address.
- Update frontend config with the deployed marketplace address during the frontend marketplace phase.
- Configure cron-job.org to call `/api/marketplace-cleanup` every 15 minutes.

Latest verification:

- `npm.cmd run compile`: passed.
- `npm.cmd test`: passed with `63 passing`.
- `npx.cmd hardhat coverage`: passed with every contract above 90% coverage.

Latest coverage:

```text
DepositMarketplace.sol | 100 stmts | 96.15 branch | 100 funcs | 100 lines
MockUSDC.sol           | 100 stmts | 100 branch   | 100 funcs | 100 lines
SavingCore.sol         | 100 stmts | 95.35 branch | 100 funcs | 100 lines
VaultManager.sol       | 100 stmts | 95.24 branch | 100 funcs | 100 lines
All files              | 100 stmts | 95.63 branch | 100 funcs | 100 lines
```

## Frontend Implementation

The frontend now includes a marketplace route at `/marketplace` and the user dashboard is ownership-aware.

User dashboard behavior:

- The active list is now `My Active Deposit NFTs`.
- Active cards only show deposits where the connected wallet is the current ERC721 owner and the deposit status is active.
- Deposit discovery includes both `DepositOpened` events and ERC721 `Transfer` events so purchased or received deposit NFTs appear for the recipient.
- Deposits transferred or sold away no longer appear in the sender's active list.
- Inactive, transferred, sold, or marketplace-escrowed deposits are shown in a collapsed history section opened by `View History`.
- Mature but still-active NFTs remain in the active list because they are still actionable.

Marketplace page behavior:

- `Active Listings` shows public listings from `listedCount`, `listedDepositIds`, `listings`, and `SavingCore.deposits`.
- Buyers can purchase listings through `buyDeposit`; the UI checks and submits USDC approval first when needed.
- `My Listable Deposit NFTs` shows active, currently owned deposits that pass `DepositMarketplace.isListable`.
- Sellers must enter a USDC price and explicitly accept Marketplace Terms v1 before listing.
- The listing flow checks NFT approval and approves `DepositMarketplace` when needed before calling `listDeposit`.
- `My Listings` shows escrowed listings where the connected wallet is the seller.
- Sellers can call `cancelListing` to return the NFT from escrow.
- Marketplace custom errors are parsed into user-facing messages.

Marketplace Terms v1 shown in the UI:

```text
By listing a deposit NFT, the seller confirms that the NFT represents an active SavingCore deposit position and agrees to transfer that NFT into DepositMarketplace escrow.

While the NFT is held in escrow, the seller will not control the deposit NFT and cannot withdraw, renew, early-withdraw, transfer, or otherwise exercise deposit-owner rights unless the listing is cancelled or cleaned up and the NFT is returned.

If a buyer purchases the listing, the buyer receives the deposit NFT and becomes the holder of all future rights attached to that deposit position, including eligible maturity withdrawal, renewal, transfer, or early-withdrawal rights under the SavingCore contract.

The seller receives the listed USDC sale price when a purchase transaction succeeds. The protocol does not guarantee that the sale price equals the deposit principal, accrued interest, fair market value, or expected maturity value.

Listings may be cancelled by the seller before purchase. Listings that enter the no-listing window or otherwise become invalid may be cleaned up by anyone, returning the NFT to the seller.

All listing, purchase, cancellation, cleanup, ownership, withdrawal, renewal, and transfer outcomes are determined by the deployed smart contracts. This interface is informational and does not override on-chain contract behavior.
```

README updates are intentionally deferred until final review of the frontend is complete.

## Security Notes

- Use OpenZeppelin `IERC721Receiver` so escrow can receive safe ERC721 transfers.
- Use `SafeERC20` for payment transfers.
- Delete listing state before external transfers where possible.
- Re-check listing eligibility in `buyDeposit`.
- Avoid automatic withdrawal from cleanup. Cleanup should return the NFT to the seller wallet.
- Keep cleanup permissionless and idempotent enough that repeated cron calls are harmless.
