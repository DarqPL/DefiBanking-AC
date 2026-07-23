# Use Case Workflows

This document visualizes the main workflows implemented by the DeFi term-deposit system. It is based on the current contracts, deployment scripts, frontend flows, and project documentation.

## System Overview

```mermaid
flowchart LR
    User[Depositor / NFT Owner]
    Admin[Bank Admin / Owner]
    Bot[Bot / Keeper]
    Token[MockUSDC]
    Core[SavingCore]
    Vault[VaultManager]
    Market[DepositMarketplace]

    User -->|open, withdraw, renew| Core
    User -->|approve / transfer token| Token
    User -->|list, buy, cancel| Market
    Admin -->|plans, pause| Core
    Admin -->|fund, withdraw, fee receiver, pause| Vault
    Admin -->|terms, pause, recovery| Market
    Bot -->|auto renew| Core
    Bot -->|cleanup stale listings| Market
    Core -->|holds user principal| Token
    Vault -->|holds bank interest liquidity| Token
    Market -->|escrows deposit NFTs| Core
    Core -->|pay interest request| Vault
```

Core fund separation rule:

- `SavingCore` holds user principal and deposit NFT state.
- `VaultManager` holds bank-funded interest liquidity.
- `MockUSDC` is a 6-decimal ERC20 token used for tests and demo flows.
- `DepositMarketplace` escrows authentic `SavingCore` deposit NFTs during sale listings.

## Deployment Workflow

```mermaid
flowchart TD
    A[Start deployment] --> B[Deploy MockUSDC]
    B --> C[Deploy VaultManager]
    C --> D[constructor token = MockUSDC]
    D --> E[constructor feeReceiver = deployer]
    E --> F[Deploy SavingCore]
    F --> G[constructor token = MockUSDC]
    G --> H[constructor vaultManager = VaultManager]
    H --> I[VaultManager.setSavingCore SavingCore]
    I --> J{SavingCore.nextPlanId == 0?}
    J -->|Yes| K[Create default plan: 180 days, 225 bps APR, 650 bps penalty]
    J -->|No| L[Keep existing plans]
    K --> M[Deploy DepositMarketplace]
    L --> M
    M --> N[constructor savingCore = SavingCore]
    N --> O[constructor paymentToken = MockUSDC]
    O --> P[constructor termsHash = marketplace terms v1]
```

Relevant files:

- `deploy/01-deploy-mock-usdc.ts`
- `deploy/02-deploy-vault-manager.ts`
- `deploy/03-deploy-saving-core.ts`
- `deploy/04-deploy-deposit-marketplace.ts`

## Admin Plan Management

```mermaid
flowchart TD
    A[Admin] --> B{Action}
    B -->|Create plan| C[SavingCore.createPlan]
    C --> C1[Validate tenor, APR, penalty, min/max range]
    C1 --> C2[Store SavingPlan]
    C2 --> C3[Emit PlanCreated]

    B -->|Update APR| D[SavingCore.updatePlan]
    D --> D1[Validate APR <= 10000 bps]
    D1 --> D2[Update plan APR only]
    D2 --> D3[Emit PlanUpdated]

    B -->|Enable plan| E[SavingCore.enablePlan]
    E --> E1[Reject already enabled]
    E1 --> E2[Set enabled = true]

    B -->|Disable plan| F[SavingCore.disablePlan]
    F --> F1[Reject already disabled]
    F1 --> F2[Set enabled = false]
```

Important behavior:

- Plan updates affect future deposits only.
- Existing deposits keep their `aprBpsAtOpen` and `penaltyBpsAtOpen` snapshots.
- A disabled plan blocks new deposits, manual renewal into that plan, and auto-renewal of deposits from that original plan.
- Existing active deposits from a disabled plan can still be withdrawn normally.

## Admin Vault Management

```mermaid
flowchart TD
    A[Admin wants to fund vault] --> B[MockUSDC.approve VaultManager, amount]
    B --> C[VaultManager.fundVault amount]
    C --> D[VaultManager validates owner, not paused, amount > 0]
    D --> E[MockUSDC.safeTransferFrom Admin to VaultManager]
    E --> F[Emit VaultFunded]

    G[Admin wants to withdraw vault liquidity] --> H[VaultManager.withdrawVault amount]
    H --> I[VaultManager validates owner, not paused, amount > 0]
    I --> J{Vault balance >= amount?}
    J -->|No| J1[Revert InsufficientVaultBalance]
    J -->|Yes| K[MockUSDC.safeTransfer owner, amount]
    K --> L[Emit VaultWithdrawn]
```

Vault admin controls:

- `fundVault(amount)` requires ERC20 approval for `VaultManager` first.
- `withdrawVault(amount)` transfers bank vault liquidity back to the owner.
- `setFeeReceiver(address)` updates where early-withdrawal penalties go.
- `setSavingCore(address)` configures the only contract allowed to call `payInterest`.
- `pause()` and `unpause()` stop or resume vault funding, withdrawals, and interest payments.

## Open Deposit

```mermaid
flowchart TD
    A[User selects plan and amount] --> B[MockUSDC.approve SavingCore, amount]
    B --> C[SavingCore.openDeposit planId, amount]
    C --> D[Load saving plan]
    D --> E{Plan enabled?}
    E -->|No| E1[Revert PlanNotEnabled]
    E -->|Yes| F{amount != 0 and inside min/max?}
    F -->|No| F1[Revert amount error]
    F -->|Yes| G[Calculate startAt and maturityAt]
    G --> H[Store DepositInfo with APR and penalty snapshots]
    H --> I[Mint ERC721 deposit NFT to user]
    I --> J[MockUSDC.safeTransferFrom user to SavingCore]
    J --> K[Emit DepositOpened]
```

Result:

- Principal is held by `SavingCore`.
- User receives a deposit NFT.
- The NFT owner controls future withdrawal, renewal, transfer, or marketplace sale rights.
- `minDeposit = 0` means no lower limit, and `maxDeposit = 0` means no upper limit.

## Withdraw At Maturity

```mermaid
flowchart TD
    A[User calls withdrawAtMaturity depositId] --> B[Load active deposit]
    B --> C{caller owns NFT?}
    C -->|No| C1[Revert NotDepositOwner]
    C -->|Yes| D{block.timestamp >= maturityAt?}
    D -->|No| D1[Revert NotMatured]
    D -->|Yes| E[Calculate principal and simple interest]
    E --> F[Set status = Withdrawn]
    F --> G[Burn deposit NFT]
    G --> H[Transfer principal from SavingCore to user]
    H --> I{interest == 0?}
    I -->|Yes| J[Emit Withdrawn]
    I -->|No| K[Try VaultManager.payInterest user]
    K -->|Vault pays| L[Emit Withdrawn with paid interest]
    K -->|Vault fails| M[Record unpaidInterest and interestClaimant]
    M --> N[Emit InterestDeferred]
    N --> O[Emit Withdrawn with paidInterest = 0]
```

Interest formula:

```text
interest = principal * aprBpsAtOpen * tenorSeconds / (365 days * 10_000)
```

Principal-safe behavior:

- Principal is returned from `SavingCore` even if the vault cannot pay interest.
- If interest cannot be paid, the unpaid amount is recorded for later `claimInterest`.
- The closed NFT is burned, so `interestClaimant[depositId]` stores who can claim later.

## Claim Deferred Interest

```mermaid
flowchart TD
    A[User calls claimInterest depositId] --> B[Read unpaidInterest]
    B --> C{amount > 0?}
    C -->|No| C1[Revert NoUnpaidInterest]
    C -->|Yes| D{caller == interestClaimant?}
    D -->|No| D1[Revert NotInterestClaimant]
    D -->|Yes| E{VaultManager.canPayInterest amount?}
    E -->|No| E1[Revert InterestUnavailable]
    E -->|Yes| F[Clear unpaidInterest]
    F --> G[Delete interestClaimant]
    G --> H[Emit InterestClaimed]
    H --> I[VaultManager.payInterest caller]
```

Claim rules:

- Claims are independent and first-come, first-served once the vault is funded.
- Partial claims are not implemented.
- Interest is still paid only by `VaultManager`, never from user principal in `SavingCore`.

## Early Withdrawal

```mermaid
flowchart TD
    A[User calls earlyWithdraw depositId] --> B[Load active deposit]
    B --> C{caller owns NFT?}
    C -->|No| C1[Revert NotDepositOwner]
    C -->|Yes| D{block.timestamp < maturityAt?}
    D -->|No| D1[Revert AlreadyMatured]
    D -->|Yes| E[Calculate penalty]
    E --> F[payout = principal - penalty]
    F --> G[Set status = EarlyWithdrawn]
    G --> H[Burn deposit NFT]
    H --> I{payout != 0?}
    I -->|Yes| J[Transfer payout to user]
    I -->|No| K{penalty != 0?}
    J --> K
    K -->|Yes| L[Read VaultManager.feeReceiver]
    L --> M[Transfer penalty to feeReceiver]
    K -->|No| N[Emit Withdrawn with isEarly = true]
    M --> N
```

Important behavior:

- No interest is paid for early withdrawal.
- Penalty is calculated from the deposit's snapshotted penalty rate.
- Penalty goes to `VaultManager.feeReceiver()`.
- Early withdrawal is rejected at or after `maturityAt`.

## Manual Renewal

```mermaid
flowchart TD
    A[User calls renewDeposit oldDepositId, newPlanId] --> B[Load active old deposit]
    B --> C{caller owns NFT?}
    C -->|No| C1[Revert NotDepositOwner]
    C -->|Yes| D{old deposit matured?}
    D -->|No| D1[Revert NotMatured]
    D -->|Yes| E[Load new plan]
    E --> F{new plan enabled?}
    F -->|No| F1[Revert PlanNotEnabled]
    F -->|Yes| G[Calculate old interest]
    G --> H{Vault can pay interest?}
    H -->|No| H1[Revert InterestUnavailable]
    H -->|Yes| I[newPrincipal = oldPrincipal + interest]
    I --> J{newPrincipal inside new plan min/max?}
    J -->|No| J1[Revert NewPrincipalOutOfRange]
    J -->|Yes| K[Set old status = ManualRenewed]
    K --> L[Store and mint new deposit NFT]
    L --> M[VaultManager.payInterest SavingCore]
    M --> N[Emit Renewed with isAuto = false]
```

Manual renewal rules:

- Manual renewal compounds interest into the new principal.
- The renewed deposit uses the selected new plan's current APR and penalty.
- If the vault cannot pay the interest, renewal reverts instead of creating a principal-only renewal.

## Auto Renewal

```mermaid
flowchart TD
    A[Any caller calls autoRenewDeposit depositId] --> B[Load active old deposit]
    B --> C{timestamp >= maturityAt + 3 days?}
    C -->|No| C1[Revert GracePeriodNotEnded]
    C -->|Yes| D[Load original plan]
    D --> E{original plan enabled?}
    E -->|No| E1[Revert PlanNotEnabled]
    E -->|Yes| F[Read current NFT owner]
    F --> G[Calculate old interest]
    G --> H{Vault can pay interest?}
    H -->|No| H1[Revert InterestUnavailable]
    H -->|Yes| I[newPrincipal = oldPrincipal + interest]
    I --> J[Preserve old tenor, planId, APR snapshot, penalty snapshot]
    J --> K[Set old status = AutoRenewed]
    K --> L[Store and mint new deposit NFT to NFT owner]
    L --> M[VaultManager.payInterest SavingCore]
    M --> N[Emit Renewed with isAuto = true]
```

Auto-renew rules:

- Auto-renew is permissionless; any account or bot can call it after the grace period.
- The current grace period is `3 days` for student variant ending `71`.
- Auto-renew preserves the old deposit's APR and penalty snapshots while the original plan remains enabled.
- If the bot is offline, the deposit remains active and the user can still withdraw or manually renew.

## Auto-Renew Bot

```mermaid
flowchart TD
    A[cron-job.org every 15 minutes] --> B[Vercel /api/auto-renew]
    B --> C[Validate CRON_SECRET]
    C --> D[Connect to Sepolia]
    D --> E[Read SavingCore.nextDepositId]
    E --> F[Scan deposit IDs 0 to nextDepositId - 1]
    F --> G{Deposit active?}
    G -->|No| H[Skip]
    G -->|Yes| I{Original plan enabled?}
    I -->|No| H
    I -->|Yes| J{Grace period ended?}
    J -->|No| H
    J -->|Yes| K[Call autoRenewDeposit]
    K --> L[Record success or failure]
    H --> M{More deposits?}
    L --> M
    M -->|Yes| F
    M -->|No| N[Return JSON summary]
```

Operational notes:

- The bot wallet pays gas.
- The endpoint supports dry-run mode.
- The contract does not depend on a trusted bot because `autoRenewDeposit` is permissionless.
- `scripts/autoRenewBot.ts` remains available as a local/manual Hardhat fallback.

## Marketplace Listing

```mermaid
flowchart TD
    A[Seller owns active deposit NFT] --> B[SavingCore.approve DepositMarketplace, depositId]
    B --> C[DepositMarketplace.listDeposit depositId, price, currentTermsHash]
    C --> D{price > 0 and fits uint96?}
    D -->|No| D1[Revert InvalidPrice]
    D -->|Yes| E{terms hash matches currentTermsHash?}
    E -->|No| E1[Revert InvalidTerms]
    E -->|Yes| F{listing already exists?}
    F -->|Yes| F1[Revert AlreadyListed]
    F -->|No| G{seller owns NFT?}
    G -->|No| G1[Revert NotDepositOwner]
    G -->|Yes| H{deposit Active and outside no-listing window?}
    H -->|No| H1[Revert DepositNotActive or RestrictedWindow]
    H -->|Yes| I[Store listing]
    I --> J[Transfer NFT from seller to marketplace escrow]
    J --> K[Emit Listed]
```

Listing rules:

- Only the current NFT owner can list.
- Only active deposits can be listed.
- Seller must accept the current marketplace terms hash.
- Listing transfers the deposit NFT into marketplace escrow.
- While escrowed, the seller no longer owns the NFT and cannot withdraw or renew it.

## Marketplace Purchase

```mermaid
flowchart TD
    A[Buyer wants listed deposit NFT] --> B[MockUSDC.approve DepositMarketplace, price]
    B --> C[DepositMarketplace.buyDeposit depositId]
    C --> D{Listing exists?}
    D -->|No| D1[Revert ListingNotFound]
    D -->|Yes| E{buyer is seller?}
    E -->|Yes| E1[Revert SelfBuyNotAllowed]
    E -->|No| F{deposit Active and outside restricted window?}
    F -->|No| F1[Revert DepositNotActive or RestrictedWindow]
    F -->|Yes| G[Remove listing]
    G --> H[MockUSDC.safeTransferFrom buyer to seller]
    H --> I[Transfer NFT from marketplace escrow to buyer]
    I --> J[Emit ListingPurchased]
```

Purchase result:

- Seller receives the listing price in `MockUSDC`.
- Buyer receives the actual `SavingCore` deposit NFT.
- Buyer becomes the deposit owner and controls future withdrawal, renewal, transfer, or sale rights.

## Marketplace Cancel And Cleanup

```mermaid
flowchart TD
    A{Listing removal path} -->|Seller cancel| B[cancelListing depositId]
    B --> C{caller is seller?}
    C -->|No| C1[Revert NotSeller]
    C -->|Yes| D[Remove listing]
    D --> E[Transfer escrowed NFT back to seller]
    E --> F[Emit ListingCancelled]

    A -->|Permissionless cleanup| G[cleanListings depositIds or cleanExpiredListings maxListings]
    G --> H{Listing exists and is stale?}
    H -->|No| I[Skip]
    H -->|Yes| J[Remove listing]
    J --> K[Transfer escrowed NFT back to seller]
    K --> L[Emit ListingExpired]
```

Stale listing conditions:

- Deposit is no longer active.
- Deposit entered the no-listing window.
- Marketplace no longer escrows the NFT.

No-listing window formula:

```text
D = min(max(10, floor(tenorDays * 5 / 100)), 30)
blocked when block.timestamp >= maturityAt - D days
```

For the default `180 days` plan, the restricted window is the final `10 days`.

## Pause And Emergency Controls

```mermaid
flowchart LR
    Admin[Admin] --> CorePause[SavingCore.pause]
    Admin --> VaultPause[VaultManager.pause]
    Admin --> MarketPause[DepositMarketplace.pause]

    CorePause --> A[Blocks openDeposit]
    CorePause --> B[Blocks withdrawAtMaturity]
    CorePause --> C[Blocks claimInterest]
    CorePause --> D[Blocks earlyWithdraw]
    CorePause --> E[Blocks renewDeposit]
    CorePause --> F[Blocks autoRenewDeposit]

    VaultPause --> G[Blocks fundVault]
    VaultPause --> H[Blocks withdrawVault]
    VaultPause --> I[Blocks payInterest]

    MarketPause --> J[Blocks listDeposit]
    MarketPause --> K[Blocks buyDeposit]
```

Notes:

- `SavingCore` plan administration remains available while `SavingCore` is paused.
- `DepositMarketplace.cancelListing` is not paused, so sellers can still recover listed NFTs through cancellation.
- Marketplace cleanup functions are permissionless and are not paused.

## Deposit State Lifecycle

```mermaid
stateDiagram-v2
    [*] --> None
    None --> Active: openDeposit / renewal mint
    Active --> Withdrawn: withdrawAtMaturity
    Active --> EarlyWithdrawn: earlyWithdraw
    Active --> ManualRenewed: renewDeposit
    Active --> AutoRenewed: autoRenewDeposit
    Withdrawn --> [*]
    EarlyWithdrawn --> [*]
    ManualRenewed --> [*]
    AutoRenewed --> [*]
```

Lifecycle rules:

- Only `Active` deposits can be withdrawn, renewed, listed, or bought.
- Withdrawals and renewals close the old deposit, preventing double withdrawal.
- Marketplace transfers do not change deposit status; they only change ERC721 ownership.
- The current ERC721 owner owns the deposit action rights.

## Approval Matrix

| Use case | Approval target | Approval type | Why |
| --- | --- | --- | --- |
| Open deposit | `SavingCore` | ERC20 `MockUSDC.approve` | `SavingCore.openDeposit` pulls principal with `safeTransferFrom`. |
| Fund vault | `VaultManager` | ERC20 `MockUSDC.approve` | `VaultManager.fundVault` pulls interest liquidity with `safeTransferFrom`. |
| List deposit NFT | `DepositMarketplace` | ERC721 `SavingCore.approve` | Marketplace must transfer the NFT into escrow. |
| Buy listed NFT | `DepositMarketplace` | ERC20 `MockUSDC.approve` | Marketplace pulls payment from buyer and pays seller. |
| Withdraw / renew / claim interest | None | None | Contracts transfer funds out or update state; no token pull from caller is needed. |

## Primary Source Files

| Area | Files |
| --- | --- |
| ERC20 test token | `contracts/MockUSDC.sol` |
| Principal, plans, deposits, renewals | `contracts/SavingCore.sol` |
| Interest vault and fee receiver | `contracts/VaultManager.sol` |
| NFT marketplace escrow | `contracts/DepositMarketplace.sol` |
| Deployment wiring | `deploy/*.ts` |
| Auto-renew operations | `api/auto-renew.ts`, `scripts/autoRenewBot.ts`, `docs/AUTO_RENEW_BOT_SETUP.md` |
| Marketplace cleanup operations | `api/marketplace-cleanup.ts`, `docs/PHASE_16_ESCROW_MARKETPLACE.md` |
| Frontend flows | `frontend/src/pages/UserDashboard.tsx`, `frontend/src/pages/AdminDashboard.tsx`, `frontend/src/pages/Marketplace.tsx` |
