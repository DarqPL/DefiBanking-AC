# DeFi Term Deposit Banking System

This project is a blockchain-based term-deposit banking system. Users deposit 6-decimal MockUSDC into fixed-term saving plans, receive an ERC721 deposit certificate NFT, and can withdraw, withdraw early with a penalty, manually renew, or be auto-renewed after a grace period.

The design keeps user principal and bank interest liquidity separate:

- `SavingCore` holds user principal and manages deposit NFTs.
- `VaultManager` holds bank-owned liquidity used to pay interest.
- `MockUSDC` is the 6-decimal ERC20 token used for testing and demo flows.
- `DepositMarketplace` is the only authorized transfer path for deposit NFTs, which are otherwise soulbound.

## Personal Variant

Student ID ending used for this project: `71`.

| Parameter | Value |
| --- | --- |
| `A` | `1` |
| `B` | `7` |
| Auto-renew grace period | `(1 mod 3) + 2 = 3 days` |
| Default APR | `200 + 1 * 25 = 225 bps = 2.25%` |
| Early withdrawal penalty | `300 + 7 * 50 = 650 bps = 6.5%` |
| Default tenor | `180 days` because `B` is odd |

## Contracts

### `MockUSDC.sol`

- ERC20 token with `6` decimals, matching USDC-style units.
- Anyone can call `mint(address to, uint256 amount)` for local testing and demo use.
- Used by both the Hardhat tests and frontend demo.

### `VaultManager.sol`

- Holds the bank/admin interest liquidity.
- Lets the owner fund and withdraw vault liquidity.
- Stores the `feeReceiver` that receives early-withdrawal penalties.
- Authorizes only the configured `SavingCore` contract to call `payInterest`.
- Can be paused by the owner.

### `SavingCore.sol`

- Creates, updates, enables, and disables saving plans.
- Opens deposits and mints ERC721 certificate NFTs.
- Stores APR and penalty snapshots per deposit.
- Handles maturity withdrawal, early withdrawal, manual renewal, and auto-renewal.
- Holds user principal separately from the vault interest pool.
- Can be paused by the owner.

### `DepositMarketplace.sol`

- Escrows official `SavingCore` deposit NFTs while they are listed for sale.
- Lets sellers list active, listable deposit NFTs for a fixed MockUSDC price.
- Lets buyers purchase listings and receive the deposit NFT plus all future deposit-owner rights.
- Lets sellers cancel listings before purchase.
- Provides targeted scheduled cleanup with `isListingStale(uint256 depositId)` and `cleanListings(uint256[] depositIds)` so cron only sends a transaction when stale listings exist.
- Requires users to accept the current marketplace terms hash when listing.

## Sepolia Addresses

The frontend currently points to these Sepolia deployments:

| Contract | Address |
| --- | --- |
| `MockUSDC` | `0x3Cb2AE0859d0B2aFe20d5f16Bf9e2E35A1cb2Cb8` |
| `VaultManager` | `0x68749ba818599EB6eE66fEA1Aa526C60411C78aF` |
| `SavingCore` | `0x4C1b681f4968A1524aac92c162B4422a2bf20110` |
| `DepositMarketplace` | `0x5C6016D7155C99b4E3631e65cfffBA1de5c7604a` |

Local deployments generate new addresses. Update `frontend/src/config.ts` if using a different deployment.

## User Flows

### Open Deposit

1. User gets or mints MockUSDC.
2. User approves `SavingCore` to spend the deposit amount.
3. User calls `openDeposit(planId, amount)`.
4. `SavingCore` transfers the principal into itself.
5. `SavingCore` mints an ERC721 deposit certificate NFT to the user.
6. APR and penalty values are snapshotted for that deposit.

### Withdraw At Maturity

After `maturityAt`, the NFT owner can call `withdrawAtMaturity(depositId)`.

The user receives:

- Principal from `SavingCore`.
- Interest from `VaultManager`.

Interest uses simple APR math:

```text
interest = principal * aprBpsAtOpen * tenorSeconds / (365 days * 10_000)
```

`365 days` converts annual APR into the deposit term fraction. `10_000` converts basis points into a decimal rate.

### Early Withdrawal

Before `maturityAt`, the NFT owner can call `earlyWithdraw(depositId)`.

- No interest is paid.
- Penalty is calculated from the principal and the deposit's penalty snapshot.
- User receives `principal - penalty`.
- Penalty is sent to `VaultManager.feeReceiver()`.

```text
penalty = principal * penaltyBpsAtOpen / 10_000
```

### Manual Renewal

At or after maturity, the NFT owner can call `renewDeposit(depositId, newPlanId)`.

- Old deposit status becomes `ManualRenewed`.
- Interest is pulled from `VaultManager` into `SavingCore`.
- New principal becomes `old principal + interest`.
- A new deposit NFT is minted to the user.
- The new deposit uses the selected plan's current APR and penalty.

### Auto-Renewal

After `maturityAt + 3 days`, anyone can call `autoRenewDeposit(depositId)`.

- Old deposit status becomes `AutoRenewed`.
- Interest is pulled from `VaultManager` into `SavingCore`.
- New principal becomes `old principal + interest`.
- A new deposit NFT is minted to the current NFT owner.
- The renewed deposit preserves the old deposit's original APR and penalty snapshots while the original plan remains enabled.
- Auto-renew is rejected if the original plan is disabled.

### Marketplace Listing And Purchase

Active deposit NFTs can be traded through `DepositMarketplace`.

Seller flow:

1. Seller owns an active `SavingCore` deposit NFT.
2. Seller approves `DepositMarketplace` for that NFT.
3. Seller accepts Marketplace Terms v1 in the frontend.
4. Seller calls `listDeposit(depositId, price, currentTermsHash)`.
5. Marketplace transfers the NFT into escrow.

Buyer flow:

1. Buyer approves `DepositMarketplace` to spend the listing price in MockUSDC.
2. Buyer calls `buyDeposit(depositId)`.
3. Marketplace pays the seller and transfers the NFT to the buyer.
4. Buyer becomes the deposit NFT owner and controls future withdrawal, renewal, early-withdrawal, or future marketplace-listing rights.

Direct wallet-to-wallet NFT transfers, including MetaMask "Send NFT", are rejected by `SavingCore` and do not change deposit ownership.

Listings too close to maturity are blocked by the marketplace no-listing window. Existing listings that later enter the restricted window can be cleaned up by calling `cleanListings(uint256[] depositIds)`, returning NFTs to sellers. The older `cleanExpiredListings(uint256 maxListings)` cursor cleanup remains available as a permissionless fallback.

## Admin Flows

The owner/admin can:

- Create saving plans.
- Update plan APR.
- Enable or disable plans.
- Fund the vault.
- Withdraw vault liquidity.
- Set the early-withdrawal fee receiver.
- Pause and unpause `SavingCore`.
- Pause and unpause `VaultManager`.

## Setup

Install root dependencies:

```bash
npm install
```

Install frontend dependencies:

```bash
cd frontend
npm install
```

If PowerShell blocks `npm.ps1`, use `npm.cmd`, for example `npm.cmd run compile`.

## Contract Commands

Compile contracts, export ABIs, run contract sizer, and generate TypeChain files:

```bash
npm run compile
```

Run the Hardhat test suite:

```bash
npm test
```

Run coverage:

```bash
npx hardhat coverage
```

Run contract size report:

```bash
npm run size
```

Run tests with gas reporting in PowerShell:

```powershell
$env:REPORT_GAS="1"; npm test
```

## Deployment

Start a local Hardhat node:

```bash
npm run node
```

Deploy to localhost from another terminal:

```bash
npx hardhat deploy --network localhost
```

Deploy to Sepolia:

```bash
npx hardhat deploy --network sepolia
```

Required or supported environment variables are documented in `.env_example`:

- `TESTNET_PRIVATE_KEY` for Sepolia deployments.
- `MAINNET_PRIVATE_KEY` for mainnet scripts if ever needed.
- `ETHERSCAN_API` for verification.
- `REPORT_GAS` for gas reporting.
- `BOT_PRIVATE_KEY` for the auto-renew bot wallet.
- `CRON_SECRET` for the protected bot API endpoints.
- Optional `SEPOLIA_RPC_URL` and `MAINNET_RPC_URL` overrides.

Do not commit real `.env` files or private keys.

## Frontend

The frontend is a standalone Vite React app in `frontend/` and is configured for Sepolia.

Run the dev server:

```bash
cd frontend
npm run dev
```

Run lint:

```bash
cd frontend
npm run lint
```

Build the frontend:

```bash
cd frontend
npm run build
```

Frontend features:

- MetaMask connection.
- Sepolia wrong-network warning and switch button.
- User plan list.
- MockUSDC approval flow.
- Deposit opening.
- Deposit history/details.
- Ownership-aware active deposit NFT list.
- Collapsed history for inactive, transferred, sold, or marketplace-escrowed deposits.
- Principal-safe maturity withdrawal warning when the vault cannot pay interest.
- Deferred interest claim cards with one `Claim Interest` action per deposit.
- Estimated interest display.
- Early withdrawal.
- Marketplace page for active listings, listable deposit NFTs, seller listings, buy/list/cancel actions, and Marketplace Terms v1 acceptance.
- Admin dashboard for plan, vault, fee receiver, and pause controls.

## Auto-Renew Bot

Auto-renewal is triggered off-chain because smart contracts cannot execute themselves automatically.

This project includes:

- `api/auto-renew.ts`: Vercel API endpoint for scheduled auto-renew scans.
- `scripts/autoRenewBot.ts`: local/manual Hardhat fallback script.
- `.github/workflows/auto-renew-bot.yml`: scheduled GitHub Actions fallback.
- `docs/AUTO_RENEW_BOT_SETUP.md`: setup notes for Vercel and cron-job.org.

The marketplace cleanup endpoint is `api/marketplace-cleanup.ts`. It reads the marketplace address from `deployments/sepolia/DepositMarketplace.json`, scans all current listing IDs off-chain with `isListingStale(depositId)`, and only sends a transaction when stale listings exist. If no stale listing exists, it returns `mode: "skip"`. If stale listings exist, it calls `DepositMarketplace.cleanListings(staleDepositIds)` from a bot wallet. It is intended to be triggered by cron-job.org or another scheduler.

The Vercel endpoint should be called periodically with a `CRON_SECRET`. It scans active deposits, skips deposits whose original plan is disabled, and calls `autoRenewDeposit` for enabled-plan deposits that reached `maturityAt + 3 days`.

Local dry-run or bot command:

```bash
npm run bot:auto-renew:sepolia
```

## Test And Verification Summary

Latest recorded contract verification:

- `npm.cmd run compile`: passed.
- `npm.cmd test`: passed with `74 passing`.
- `npx.cmd hardhat coverage`: passed.
- Coverage: `100%` statements, `95.45%` branches, `100%` functions, `100%` lines.

Latest recorded frontend verification:

- `npm.cmd run lint` from `frontend/`: passed.
- `npm.cmd run build` from `frontend/`: passed.

The frontend build may show a non-blocking Vite warning that the main JavaScript chunk is larger than `500 kB` after minification.

## Section 8.2 Design Answers

### 1. Soulbound Certificate With Marketplace Transfer

The current ERC721 owner controls the deposit, but users cannot freely transfer deposit NFTs. Direct wallet-to-wallet transfers are rejected, so Alice cannot bypass the marketplace by sending her deposit NFT directly to Bob. Bob only becomes the valid owner if he buys through the authorized `DepositMarketplace`.

The rule is decided by checking `ownerOf(depositId)` against the caller. In maturity withdrawal, the current NFT owner is stored as `account` and must equal the caller:

```solidity
address account = msg.sender;
if (ownerOf(depositId) != account) revert NotDepositOwner();
```

For early withdrawal, the same ownership rule is used:

```solidity
if (ownerOf(depositId) != msg.sender) revert NotDepositOwner();
```

For manual renewal, the current NFT owner must also be the caller:

```solidity
address account = ownerOf(depositId);
if (account != msg.sender) revert NotDepositOwner();
```

This preserves the marketplace as the only valid sale path while keeping ERC721 ownership as the source of truth for withdrawal and renewal rights. MetaMask or other wallet "send" flows call `transferFrom` or `safeTransferFrom`, and those calls revert unless they are initiated by the authorized marketplace.

Test coverage: `test/SavingCore.test.ts` includes direct `transferFrom` and `safeTransferFrom` rejection tests, approved-operator bypass rejection, and checks that withdrawal, early-withdrawal, renewal, and deferred-interest rights remain with the valid owner when a direct transfer is rejected. `test/DepositMarketplace.test.ts` confirms marketplace purchase still transfers ownership to the buyer.

### 2. Empty Vault

The base spec says maturity withdrawal should revert if the vault cannot pay interest. The problem is that this can block the user from receiving their own principal even though principal is held separately in `SavingCore`. That is unfair because an empty bank-funded interest vault should not lock user principal.

I chose the improved design: principal is always returned at maturity. If the vault cannot pay the full interest, the contract records the unpaid interest as a later claim.

The unpaid interest is tracked per deposit:

```solidity
mapping(uint256 depositId => uint256 amount) public unpaidInterest;
mapping(uint256 depositId => address claimant) public interestClaimant;
```

At maturity, `SavingCore` closes the deposit and transfers principal first. Then it tries to pay interest from `VaultManager`. If that payment fails, the interest is recorded instead of reverting the whole withdrawal:

```solidity
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
```

The stored claimant can later call `claimInterest(depositId)` after the vault has enough liquidity:

```solidity
uint256 amount = unpaidInterest[depositId];
if (amount == 0) revert NoUnpaidInterest();

address claimant = interestClaimant[depositId];
if (claimant != msg.sender) revert NotInterestClaimant();
if (!vaultManager.canPayInterest(amount)) revert InterestUnavailable();

unpaidInterest[depositId] = 0;
delete interestClaimant[depositId];

vaultManager.payInterest(msg.sender, amount);
```

Manual and auto-renewal still require the vault to actually pay interest before compounding. This prevents the contract from creating a new deposit with interest that was not really received:

```solidity
if (interest != 0 && !vaultManager.canPayInterest(interest)) revert InterestUnavailable();
```

Test coverage: `test/SavingCore.test.ts` includes `pays principal and records unpaid interest when the vault is empty at maturity`, `records unpaid interest instead of silently paying principal only when the vault is underfunded`, and `lets the recorded claimant claim deferred interest after the vault is funded`.

### 3. Dead Bot

If the auto-renew bot is offline, deposits are not automatically renewed. The deposit remains active until a valid action is mined, so the user does not lose principal. The NFT owner can still call maturity withdrawal after maturity, and can manually renew if the vault can pay the interest being compounded.

The protection is that auto-renew is permissionless. `autoRenewDeposit` is `external` and has no bot-only or owner-only modifier:

```solidity
function autoRenewDeposit(uint256 depositId) external whenNotPaused {
```

The function only checks that the grace period has ended and that the original plan is still enabled:

```solidity
uint256 renewAfter = uint256(oldDeposit.maturityAt) + AUTO_RENEW_GRACE_PERIOD;
if (block.timestamp < renewAfter) revert GracePeriodNotEnded();

SavingPlan storage originalPlan = _getExistingPlan(oldDeposit.planId);
if (!originalPlan.enabled) revert PlanNotEnabled();
```

The user can still withdraw at maturity because `withdrawAtMaturity` only requires NFT ownership and `block.timestamp >= maturityAt`:

```solidity
if (ownerOf(depositId) != account) revert NotDepositOwner();
if (block.timestamp < deposit.maturityAt) revert NotMatured();
```

Test coverage: `test/SavingCore.test.ts` includes `auto-renews permissionlessly after the 3-day grace period and preserves original economics`.

### 4. Rounding Dust

Interest uses integer division, so fractional token units are rounded down. The user receives the rounded-down interest amount, and the tiny unpaid dust remains in the vault or is never pulled from it.

The formula is:

```solidity
interest = (deposit.principal * deposit.aprBpsAtOpen * tenorSeconds) / (YEAR_SECONDS * BPS_DENOMINATOR);
```

The dust stays economically with the vault/protocol because the vault only pays the rounded-down `interest`. There is no separate dust variable; the fractional remainder is simply not paid. This cannot overpay users, cause a wrong balance, or cause a revert by itself because the same rounded-down value is used for both balance checks and payment.

Test coverage: `test/SavingCore.test.ts` includes `withdraws principal plus exact truncated simple interest at maturity`, which calculates the same interest value and checks both the user balance and vault balance after withdrawal.

### 5. Boundary Times

At the exact `maturityAt` timestamp, withdrawal is treated as maturity withdrawal, not early withdrawal. `withdrawAtMaturity` rejects only when `block.timestamp < maturityAt`, while `earlyWithdraw` rejects when `block.timestamp >= maturityAt`.

```solidity
if (block.timestamp < deposit.maturityAt) revert NotMatured();
if (block.timestamp >= deposit.maturityAt) revert AlreadyMatured();
```

Manual renewal is also allowed at the exact maturity timestamp because it rejects only before maturity:

```solidity
if (block.timestamp < oldDeposit.maturityAt) revert NotMatured();
```

Auto-renew is allowed at the exact end of the grace period. `autoRenewDeposit` rejects only when `block.timestamp < maturityAt + AUTO_RENEW_GRACE_PERIOD`, so `maturityAt + 3 days` is valid. At that exact point, manual renewal and auto-renewal can both be valid; whichever transaction is mined first changes the deposit status and prevents the other action from reusing the same deposit.

```solidity
uint256 renewAfter = uint256(oldDeposit.maturityAt) + AUTO_RENEW_GRACE_PERIOD;
if (block.timestamp < renewAfter) revert GracePeriodNotEnded();
```

Test coverage: `test/SavingCore.test.ts` checks `withdrawAtMaturity` reverts before maturity, `earlyWithdraw` reverts after maturity, `renewDeposit` reverts before maturity, and `autoRenewDeposit` reverts one second before grace ends then succeeds at the grace boundary.

### 6. Disabled Plan With Active Deposits

Disabling a plan does not break existing active deposits. Users who already opened deposits keep their original APR and penalty snapshots and can still withdraw early before maturity or withdraw at maturity.

New deposits into the disabled plan are blocked:

```solidity
if (!plan.enabled) revert PlanNotEnabled();
```

Manual renewal into a disabled plan is blocked because `renewDeposit` checks that the selected new plan is enabled:

```solidity
SavingPlan storage newPlan = _getExistingPlan(newPlanId);
if (!newPlan.enabled) revert PlanNotEnabled();
```

Auto-renew is also blocked if the original plan is disabled. This prevents a high-APR disabled plan from rolling forever after the admin closes it:

```solidity
SavingPlan storage originalPlan = _getExistingPlan(oldDeposit.planId);
if (!originalPlan.enabled) revert PlanNotEnabled();
```

The official Vercel endpoint and fallback script bot also read each active deposit's original plan status with a per-run cache and skip disabled-plan deposits before sending a transaction. The contract check is still required because `autoRenewDeposit` is permissionless and anyone can call it directly.

Test coverage: `test/SavingCore.test.ts` includes `rejects opening deposits for unknown plans, disabled plans, invalid limits, and maturity overflow`, `rejects invalid manual renewals`, and `blocks auto-renewal when the original plan is disabled but still allows maturity withdrawal`.

### 7. Attack Thinking

A realistic attack is double withdrawal: a user tries to withdraw the same deposit twice to receive principal or interest again.

The contract prevents this by requiring the deposit status to be `Active` through `_getActiveDeposit`, then changing the status before external token transfers. Maturity withdrawal sets the status to `Withdrawn`, early withdrawal sets it to `EarlyWithdrawn`, manual renewal sets it to `ManualRenewed`, and auto-renewal sets it to `AutoRenewed`. After the first successful action, repeated withdrawal or renewal fails because the deposit is no longer active.

The active-deposit check is:

```solidity
if (deposit.status == DepositStatus.None) revert DepositNotFound();
if (deposit.status != DepositStatus.Active) revert DepositNotActive();
```

Maturity withdrawal closes the deposit before transferring principal:

```solidity
deposit.status = DepositStatus.Withdrawn;
_burn(depositId);

token.safeTransfer(account, principal);
```

Early withdrawal follows the same pattern:

```solidity
deposit.status = DepositStatus.EarlyWithdrawn;
_burn(depositId);
```

Test coverage: `test/SavingCore.test.ts` includes `handles zero-interest maturity withdrawal and rejects non-owner or non-existent withdrawals`, which verifies a second maturity withdrawal reverts with `DepositNotActive`.

## Creative Challenge Answer

### C1: Principal Is Always Safe

The problem with the base empty-vault rule is that a user can reach maturity but still be unable to recover principal if the vault cannot pay interest. Since `SavingCore` holds user principal and `VaultManager` holds bank-funded interest liquidity, the interest vault should not be able to lock the user's own money.

The implemented solution is principal-safe maturity withdrawal:

```text
Principal is always paid from SavingCore.
Interest is paid from VaultManager only when liquidity is available.
If interest cannot be paid, unpaid interest is recorded as a later claim.
```

This is implemented by storing unpaid interest and the claimant:

```solidity
mapping(uint256 depositId => uint256 amount) public unpaidInterest;
mapping(uint256 depositId => address claimant) public interestClaimant;
```

When the user withdraws at maturity, the contract burns/closes the deposit and pays principal. Then it attempts the vault interest transfer. If the vault cannot pay, the contract emits `InterestDeferred` and stores the claim:

```solidity
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
```

The user can later claim the recorded interest:

```solidity
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
```

The trade-off is that the protocol now has extra accounting for deferred interest claims. I accepted this trade-off because it protects the most important user guarantee: principal can always be recovered at maturity.

Renewals are intentionally stricter. Manual and auto-renewal can only happen when the vault can actually pay the interest being compounded:

```solidity
if (interest != 0 && !vaultManager.canPayInterest(interest)) revert InterestUnavailable();
```

This prevents creating a new deposit with unpaid interest that `SavingCore` does not actually hold.

### C5: Built-In Escrow Marketplace For Savings NFTs

The extra problem I chose for C5 is that users may want to sell their savings positions before maturity. Because direct deposit NFT transfers would make the official marketplace irrelevant, `SavingCore` makes deposit NFTs soulbound except for transfers initiated by the authorized `DepositMarketplace`. A buyer needs to know the NFT is the real `SavingCore` certificate, that the deposit is still active, and that payment and NFT transfer happen safely.

The solution is a built-in `DepositMarketplace` contract. It escrows official `SavingCore` deposit NFTs, lets sellers list them for MockUSDC, and transfers payment and the NFT atomically during purchase.

Listing checks that the caller owns the real deposit NFT, the deposit is active, the terms hash is current, and the deposit is not inside the restricted no-listing window:

```solidity
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
```

Purchase pays the seller and transfers the escrowed NFT to the buyer:

```solidity
Listing memory listing = listings[depositId];
if (listing.seller == address(0)) revert ListingNotFound();
if (listing.seller == msg.sender) revert SelfBuyNotAllowed();

(uint64 startAt, uint64 maturityAt, ISavingCoreMarketplace.DepositStatus status) = _depositState(depositId);
if (status != ISavingCoreMarketplace.DepositStatus.Active) revert DepositNotActive();
if (_isRestricted(startAt, maturityAt)) revert RestrictedWindow();

_removeListing(depositId);

paymentToken.safeTransferFrom(msg.sender, listing.seller, listing.price);
savingCore.safeTransferFrom(address(this), msg.sender, depositId);
```

After purchase, the buyer owns the actual ERC721 deposit certificate. Since `SavingCore` uses `ownerOf(depositId)` for withdrawal and renewal authority, the buyer receives the future deposit rights. Direct peer-to-peer NFT transfers outside the marketplace revert and have no ownership effect.

This improves user experience because users do not need to rely on external marketplaces or informal OTC transfers. If a seller lists at a reasonable price, buyers can safely acquire the position through the protocol's own escrow flow. The trade-off is extra contract and frontend complexity, plus the need for marketplace terms and cleanup logic for stale listings.
