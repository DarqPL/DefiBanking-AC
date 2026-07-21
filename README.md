# DeFi Term Deposit Banking System

This project is a blockchain-based term-deposit banking system. Users deposit 6-decimal MockUSDC into fixed-term saving plans, receive an ERC721 deposit certificate NFT, and can withdraw, withdraw early with a penalty, manually renew, or be auto-renewed after a grace period.

The design keeps user principal and bank interest liquidity separate:

- `SavingCore` holds user principal and manages deposit NFTs.
- `VaultManager` holds bank-owned liquidity used to pay interest.
- `MockUSDC` is the 6-decimal ERC20 token used for testing and demo flows.

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

## Sepolia Addresses

The frontend currently points to these Sepolia deployments:

| Contract | Address |
| --- | --- |
| `MockUSDC` | `0x3Cb2AE0859d0B2aFe20d5f16Bf9e2E35A1cb2Cb8` |
| `VaultManager` | `0x8b7FbAca6606610BD953EE65e77911d69573BC81` |
| `SavingCore` | `0xF2e14533C7920bBE40bB86F16B0F268229382FA5` |

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
- The renewed deposit preserves the old deposit's original APR and penalty snapshots.

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
- `CRON_SECRET` for the protected auto-renew API endpoint.
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
- Estimated interest display.
- Early withdrawal.
- Admin dashboard for plan, vault, fee receiver, and pause controls.

## Auto-Renew Bot

Auto-renewal is triggered off-chain because smart contracts cannot execute themselves automatically.

This project includes:

- `api/auto-renew.ts`: Vercel API endpoint for scheduled auto-renew scans.
- `scripts/autoRenewBot.ts`: local/manual Hardhat fallback script.
- `.github/workflows/auto-renew-bot.yml`: scheduled GitHub Actions fallback.
- `docs/AUTO_RENEW_BOT_SETUP.md`: setup notes for Vercel and cron-job.org.

The Vercel endpoint should be called periodically with a `CRON_SECRET`. It scans active deposits and calls `autoRenewDeposit` for deposits that reached `maturityAt + 3 days`.

Local dry-run or bot command:

```bash
npm run bot:auto-renew:sepolia
```

## Test And Verification Summary

Latest recorded contract verification:

- `npm.cmd run compile`: passed.
- `npm.cmd test`: passed with `39 passing`.
- `npx.cmd hardhat coverage`: passed.
- Coverage: `100%` statements, `92.97%` branches, `100%` functions, `100%` lines.

Latest recorded frontend verification:

- `npm.cmd run lint` from `frontend/`: passed.
- `npm.cmd run build` from `frontend/`: passed.

The frontend build may show a non-blocking Vite warning that the main JavaScript chunk is larger than `500 kB` after minification.

## Design Answers

### Transferable Certificate

The current NFT owner controls withdrawal and renewal. This means if Alice transfers or sells the deposit NFT to Bob, Bob can withdraw or renew the deposit.

The deciding checks are in `SavingCore.withdrawAtMaturity`, `SavingCore.earlyWithdraw`, and `SavingCore.renewDeposit`, where the contract compares `ownerOf(depositId)` with `msg.sender`. This is useful because the NFT represents ownership of the deposit position, but it also means users must understand that transferring the NFT transfers control of the deposit.

### Empty Vault

The base design follows the assignment rule: if the vault cannot pay required interest, the maturity withdrawal or renewal reverts. Principal is held in `SavingCore`, but the transaction cannot complete because the full principal-plus-interest flow requires `VaultManager.payInterest` to succeed.

This can be inconvenient because a user may be blocked from closing a matured deposit until the vault is funded. A better future design would allow principal withdrawal first and record unpaid interest as a later claim, but this implementation keeps the base behavior simple and matches the assignment requirement.

### Dead Bot

If the auto-renew bot is offline, deposits are not automatically renewed. The deposit remains active until a valid action is mined.

The user does not lose principal. Before any auto-renew transaction is mined, the NFT owner can still call maturity withdrawal or manual renewal after maturity. A future improvement could add a user-facing stale-deposit recovery flow or multiple independent bot runners.

### Rounding Dust

Interest uses integer division, so fractional token units are rounded down. The user receives the rounded-down interest amount, and the tiny unpaid dust remains in the vault or is never pulled from it.

This cannot overpay users because multiplication happens before division and the final division truncates downward. The tests include rounding behavior for maturity withdrawals to prove the formula pays the expected truncated value.

### Boundary Times

At the exact `maturityAt` timestamp, withdrawal is treated as maturity withdrawal, not early withdrawal. `withdrawAtMaturity` rejects only when `block.timestamp < maturityAt`, while `earlyWithdraw` rejects when `block.timestamp >= maturityAt`.

Auto-renew is allowed at the exact end of the grace period. `autoRenewDeposit` rejects only when `block.timestamp < maturityAt + AUTO_RENEW_GRACE_PERIOD`, so `maturityAt + 3 days` is valid. At that exact point, manual renewal and auto-renewal can both be valid; whichever transaction is mined first changes the deposit status and prevents the other action from reusing the same deposit.

### Disabled Plan With Active Deposits

Disabling a plan only blocks future deposits into that plan. Existing active deposits keep their original APR and penalty snapshots and can still be withdrawn at maturity or withdrawn early.

Manual renewal into a disabled plan is blocked because `renewDeposit` checks that the selected new plan is enabled. This keeps disabled plans from accepting new principal while preserving rights for already-open deposits.

### Attack Thinking

A realistic attack is double withdrawal: a user tries to withdraw the same deposit twice to receive principal or interest again.

The contract prevents this by requiring the deposit status to be `Active` through `_getActiveDeposit`, then changing the status before external token transfers. Maturity withdrawal sets the status to `Withdrawn`, early withdrawal sets it to `EarlyWithdrawn`, manual renewal sets it to `ManualRenewed`, and auto-renewal sets it to `AutoRenewed`. After the first successful action, repeated withdrawal or renewal fails because the deposit is no longer active.