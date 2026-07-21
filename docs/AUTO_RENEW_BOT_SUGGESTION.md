# Auto-Renew Bot

## Current Status

`SavingCore.autoRenewDeposit(depositId)` is implemented as a permissionless on-chain function. However, a smart contract cannot call itself automatically at a future time, so this project now uses a free GitHub Actions scheduled bot to trigger auto-renewals after the grace period ends.

Example:

- Deposit opens: July 21, 2026, 10:44 AM.
- Deposit matures: July 22, 2026, 10:44 AM.
- Grace period ends: July 25, 2026, 10:44 AM.
- Bot should call `autoRenewDeposit(depositId)` at or after July 25, 2026, 10:44 AM.

The renewal may not happen at the exact second because the bot must submit a transaction and wait for block confirmation. The practical guarantee is that renewal happens as soon as possible after `maturityAt + AUTO_RENEW_GRACE_PERIOD`.

## Selected Bot

The selected implementation is:

- `scripts/autoRenewBot.ts`: Hardhat script that scans deposits and calls `autoRenewDeposit` when eligible.
- `.github/workflows/auto-renew-bot.yml`: GitHub Actions workflow that runs the bot every 15 minutes and can also be started manually.
- `npm run bot:auto-renew:sepolia`: local command for running the bot against Sepolia.
- `AUTO_RENEW_DRY_RUN=1 npm run bot:auto-renew:sepolia`: local read-only check that reports eligible deposits without sending transactions.

GitHub Actions was selected because it is free, easy to explain for the assignment, and does not require a paid keeper service.

## Required GitHub Secrets

The workflow needs this secret to submit transactions:

- `BOT_PRIVATE_KEY`: Private key of the Sepolia bot wallet.

Optional secret:

- `SEPOLIA_RPC_URL`: Custom Sepolia RPC URL. If this is not set, the project uses the public Sepolia RPC from `hardhat.config.ts`.

## Suggested Bot Logic

The bot currently:

- Reads `nextDepositId` from `SavingCore`.
- Scans deposit IDs from `1` to `nextDepositId - 1`.
- For each deposit, reads `maturityAt` and `status` from the contract.
- Check whether `block.timestamp >= maturityAt + AUTO_RENEW_GRACE_PERIOD`.
- Call `autoRenewDeposit(depositId)` only when the deposit is still active and eligible.
- Handle expected failures safely, for example if the user already withdrew or manually renewed before the bot transaction was mined.
- Retry later if the transaction fails because of temporary RPC, gas, or vault-liquidity issues.

This full-scan approach is simple and appropriate for the current assignment/demo deployment. A production system with many deposits should replace it with an indexed event database or a keeper-compatible batching design.

## Dead Bot Case

If the bot goes offline, deposits do not lose their principal or earned interest. They remain active until someone interacts with them.

The current contract already helps here because `autoRenewDeposit` is permissionless, so any caller can trigger the renewal after the grace period. A user can also still withdraw at maturity or manually renew before auto-renew is executed.

## APR Rule

Admin APR updates do not change the APR of an already active deposit. The deposit stores `aprBpsAtOpen`, and interest for that term is calculated from that snapshot.

Manual renew and auto-renew intentionally use different APR rules:

- Manual renew creates a new deposit using the selected new plan's current APR.
- Auto-renew creates a new deposit using the old deposit's original APR snapshot.

This matches the assignment rule that auto-renew protects the user from an admin lowering the APR before the bot renews the deposit.
