# Phase Completion Log

## Purpose

This file tracks which phases from `doc/PHASED_PROJECT_PLAN.md` have been completed, what was actually done, and what evidence exists in the repository. It should be updated whenever a future phase is finished so the project has a clear implementation history and a practical checklist for final review.

## Status Legend

- `Completed`: Phase work is implemented and has visible repository evidence.
- `Partially Completed`: Some work exists, but the phase still needs verification, cleanup, missing requirements, or documentation.
- `Deferred`: Phase is intentionally postponed.
- `Not Started`: No meaningful project work has been completed for this phase yet.

## Current Snapshot

| Phase | Status | Summary |
| --- | --- | --- |
| Phase 1: Base Requirements Lockdown | Completed | Assignment was read, Section 8 was deferred, and student ID values were confirmed for ID ending `71`: `A=1`, `B=7`, grace period `3 days`, APR `225 bps`, penalty `650 bps`, tenor `180 days`. |
| Phase 2: Contract Architecture Review | Completed | Required three-contract architecture exists, compiles, is tested, and follows the intended separation between principal logic and vault liquidity. |
| Phase 3: `MockUSDC` Finalization | Completed | `MockUSDC.sol` exists with 6 decimals, anyone-can-mint test behavior, and passing tests. |
| Phase 4: `VaultManager` Finalization | Completed | `VaultManager.sol` exists with vault funding, withdrawal, fee receiver, SavingCore authorization, interest payment, and pause functions. Tests pass and coverage is above 90%. |
| Phase 5: `SavingCore` Plan Management | Completed | Plan structs and admin functions exist, tests pass, and zero min/max deposit values now mean no limit as required by the assignment. |
| Phase 6: Deposit Opening Flow | Completed | `openDeposit` exists, mints an ERC721 deposit certificate, snapshots APR and penalty, transfers principal into `SavingCore`, and is covered by passing tests. |
| Phase 7: Maturity Withdrawal Flow | Completed | `withdrawAtMaturity` exists and is covered by passing tests for interest math, ownership, maturity timing, and invalid withdrawals. |
| Phase 8: Early Withdrawal Flow | Completed | `earlyWithdraw` exists and is covered by passing tests for the `6.5%` penalty, fee receiver payout, zero/full penalty branches, and invalid withdrawals. |
| Phase 9: Manual Renewal Flow | Completed | `renewDeposit` exists and is covered by passing tests for compounding, status update, invalid renewals, and zero-interest renewal behavior. |
| Phase 10: Auto-Renewal Flow | Completed | `autoRenewDeposit` exists and is covered by passing tests for the student-specific `3-day` grace period, permissionless triggering, and APR preservation. A Vercel API endpoint plus cron-job.org now triggers eligible Sepolia auto-renewals every 15 minutes. |
| Phase 11: Security, Gas, and Code Quality Pass | Completed | Contracts use OpenZeppelin, `SafeERC20`, custom errors, events, NatSpec, status checks, and pass the full test suite. Gas data is emitted during `npm.cmd test`. |
| Phase 12: Hardhat Test Suite and Coverage | Completed | `npm.cmd test` passes with `39 passing`; `npx.cmd hardhat coverage` reports `100%` statements, functions, and lines, with `92.97%` branch coverage. |
| Phase 13: Deployment Scripts and Local Demo Data | Completed | Contracts were redeployed after spec-alignment fixes, frontend addresses were updated, and deploy scripts remain correct. |
| Phase 14: Frontend Demo Implementation | Partially Completed | React frontend exists, accepts zero min/max values, displays zero limits as unlimited, and `npm.cmd run build` passes. Lint and manual MetaMask flow still need final verification. |
| Phase 15: Base README and Runbook | Not Started | Root `README.md` is still the sample Hardhat README and needs replacement. |
| Phase 16: Deferred Section 8 Design and Improvement Pass | Deferred | Section 8 brainstorming and final structural improvements are intentionally postponed until after the base implementation is complete. |
| Phase 17: Bonus Challenge Implementation, Optional | Deferred | No bonus challenge should be treated as selected until Phase 16 decisions are made. |
| Phase 18: Final README and Design Answers | Deferred | Final design answers depend on Phase 16 and any optional improvements. |
| Phase 19: End-to-End Verification | Not Started | Compile, test, coverage, deploy, frontend build, and local demo verification need to be run and recorded. |
| Phase 20: Demo Video Preparation | Not Started | Demo video preparation has not been completed. |
| Phase 21: Final Submission Checklist | Not Started | Final submission readiness has not been completed. |

## Completed Or Created Project Assets

### Auto-Renew Bot Implementation

Status: Completed

Files added or updated:

- `api/auto-renew.ts` exposes the Vercel `/api/auto-renew` endpoint that scans deployed Sepolia deposits and calls `autoRenewDeposit` for active deposits whose grace period has ended.
- `docs/AUTO_RENEW_BOT_SETUP.md` records the selected Vercel API plus cron-job.org design, setup requirements, dead-bot behavior, and APR rules.
- `.github/workflows/auto-renew-bot.yml` remains available as a 15-minute scheduled fallback and supports manual `workflow_dispatch` runs.
- `scripts/autoRenewBot.ts` remains available as a local/manual Hardhat fallback.
- `package.json` adds `npm run bot:auto-renew:sepolia`.
- `.env_example` documents `BOT_PRIVATE_KEY`, `CRON_SECRET`, and optional RPC URL variables.
- `hardhat.config.ts` supports optional `SEPOLIA_RPC_URL` and `MAINNET_RPC_URL`, and does not require private keys for local compile/test tasks.
- `vercel.json` keeps the Vercel project root at the repository root for `/api/auto-renew`, while building and serving the frontend from `frontend/dist`.

APR behavior confirmed:

- Active deposits keep their `aprBpsAtOpen` snapshot if the admin later changes the plan APR.
- Manual renew starts a new deposit using the selected plan's current APR.
- Auto-renew starts a new deposit using the old deposit's original APR snapshot.

Operational notes:

- Vercel environment variable `BOT_PRIVATE_KEY` is required for the bot wallet.
- Vercel environment variable `CRON_SECRET` is required to protect the public API endpoint.
- Vercel environment variable `SEPOLIA_RPC_URL` is optional; the endpoint uses a public Sepolia RPC if omitted.
- cron-job.org should call `https://<your-project-name>.vercel.app/api/auto-renew?secret=<CRON_SECRET>` every 15 minutes.
- The bot cannot renew at the exact second because cron-job.org calls periodically and transactions must be mined. It renews as soon as practical after the grace period.

Verification after bot implementation:

- `npm.cmd run compile`: passed.
- `npx.cmd tsc --noEmit --target es2020 --module commonjs --moduleResolution node --esModuleInterop --resolveJsonModule --skipLibCheck api/auto-renew.ts`: passed.
- Local Vercel API handler dry run with `CRON_SECRET`, dummy `BOT_PRIVATE_KEY`, and `dryRun=1`: passed, checked the Sepolia deployment without sending transactions, found `0` eligible deposits.
- `$env:AUTO_RENEW_DRY_RUN="1"; npm.cmd run bot:auto-renew:sepolia; $env:AUTO_RENEW_DRY_RUN=$null`: passed, checked the Sepolia deployment without sending transactions, found `0` eligible deposits.
- `npm.cmd test`: passed with `39 passing`.

Bot scan boundary fix:

- The Vercel endpoint and fallback Hardhat script now scan deposit IDs from `0` to `nextDepositId - 1`.
- This matches `SavingCore.nextDepositId`, where a value of `3` means existing deposit IDs are `0`, `1`, and `2`.
- Sepolia dry-run verification after the fix reported `checked: 3`, `eligible: 0`, `renewed: 0`, and `failed: 0`.

Vercel root/frontend configuration:

- Added root `vercel.json` so Vercel deploys root `api/auto-renew.ts` while building the frontend from `frontend/`.
- Frontend output is served from `frontend/dist`.
- Non-API routes rewrite to `/index.html` for the Vite SPA, while `/api/*` remains handled by Vercel API functions.
- Verification: `npm.cmd run build` from `frontend/` passed, `api/auto-renew.ts` TypeScript check passed, and `npm.cmd run compile` passed.

## Verification Run: 2026-07-20

### Student ID Personal Variant

Status: Completed

What was confirmed:

- Student ID: `22645171`.
- Final two digits: `71`.
- `A = 1`, the last digit.
- `B = 7`, the second-to-last digit.

Computed assignment values:

- Grace period: `(1 mod 3) + 2 = 3 days`.
- Default APR: `200 + 1 * 25 = 225 bps`, equal to `2.25%`.
- Early withdrawal penalty: `300 + 7 * 50 = 650 bps`, equal to `6.5%`.
- Default tenor: `180 days` because `B=7` is odd.

Evidence:

- `deploy/03-deploy-saving-core.ts` creates the default plan with `createPlan(180, 225, 1_000_000, 10_000_000_000, 650, true)`.
- `test/SavingCore.test.ts` test names and passing output confirm `6.5%` penalty and `3-day` auto-renew grace period behavior.
- `frontend/src/pages/AdminDashboard.tsx` default create-plan form uses `180`, `2.25`, and `6.5`.

### Compile Result

Status: Passed

Command run:

- `npm.cmd run compile`

Result:

- Passed.
- Output: `Compiled 27 Solidity files successfully` and TypeChain generated `80` typings.
- Contract sizer output showed `SavingCore`, `VaultManager`, and `MockUSDC` under the EVM contract size limit.

Important environment note:

- Running `npm run compile` directly failed because PowerShell blocked `npm.ps1` with an execution policy error.
- Use `npm.cmd` commands in this environment, for example `npm.cmd run compile` and `npm.cmd test`.

Fixes needed after compile:

- No Solidity compile fixes are needed.
- Documentation should mention `npm.cmd` only if working specifically in this restricted PowerShell environment. Normal users can still use `npm run compile`.

### Test Result

Status: Passed

Command run:

- `npm.cmd test`

Result:

- Passed.
- Output: `39 passing`.
- Test groups passed for `MockUSDC`, `SavingCore`, and `VaultManager`.

Fixes needed after tests:

- No failing tests need to be fixed.
- Assignment/spec alignment fixes completed:
  - `MockUSDC.mint` is now callable by any account for local testing.
  - `SavingCore` now treats zero `minDeposit` and zero `maxDeposit` as no limit.
  - `SavingCore.openDeposit` still rejects a zero deposit amount with `InvalidAmount`.

### Coverage Result

Status: Passed

Command run:

- `npx.cmd hardhat coverage`

Result:

- Passed.
- Output: `39 passing` under coverage instrumentation.
- Coverage summary:
  - Statements: `100%`.
  - Branches: `92.97%`.
  - Functions: `100%`.
  - Lines: `100%`.
- Assignment requires coverage above `90%`, so the current suite satisfies the requirement.

Fixes needed after coverage:

- No coverage fixes are needed.

### Spec-Alignment Fixes: 2026-07-20

Status: Completed

What was changed:

- `contracts/MockUSDC.sol`:
  - Removed the admin-only mint restriction.
  - `mint(address to, uint256 amount)` is now external and callable by any account.
  - This matches the assignment requirement that the mock token is mintable by anyone for testing.
- `contracts/SavingCore.sol`:
  - `createPlan` now allows `minDeposit = 0`, `maxDeposit = 0`, or both.
  - `0` min deposit means no lower deposit limit.
  - `0` max deposit means no upper deposit limit.
  - `maxDeposit < minDeposit` only reverts when `maxDeposit` is non-zero.
  - `openDeposit` now explicitly rejects `amount == 0` with `InvalidAmount`.
  - `openDeposit` only enforces min/max checks when each configured limit is non-zero.
  - `renewDeposit` only enforces new-plan min/max checks when each configured limit is non-zero.

Tests updated:

- `test/MockUSDC.test.ts` now verifies any account can mint.
- `test/SavingCore.test.ts` now verifies zero min/max values mean no limit.
- `test/SavingCore.test.ts` now verifies zero deposit amount still reverts.

Verification after fixes:

- `npm.cmd run compile`: passed.
- `npm.cmd test`: passed with `39 passing`.
- `npx.cmd hardhat coverage`: passed with `100%` statements, `92.97%` branches, `100%` functions, and `100%` lines.

### Deploy Script Review

Status: Passed

Files reviewed:

- `deploy/01-deploy-mock-usdc.ts`.
- `deploy/02-deploy-vault-manager.ts`.
- `deploy/03-deploy-saving-core.ts`.

What was verified:

- `MockUSDC` deploys first with no constructor arguments.
- `VaultManager` deploys second with `MockUSDC` address and deployer as fee receiver.
- `SavingCore` deploys third with `MockUSDC` and `VaultManager` addresses.
- `VaultManager.setSavingCore(savingCore.address)` is called if needed.
- The default plan uses the student-specific values: `180 days`, `225 bps`, and `650 bps`.

Original deployment artifact evidence from earlier review:

- Sepolia `MockUSDC`: `0x98d695947d9b7867421DE8c334e130Fc5696a37B`.
- Sepolia `VaultManager`: `0x1BdE69a1dF8a8607f60f57a16a29370A750F3a3b`.
- Sepolia `SavingCore`: `0x3AE0E04Bd3E63379c504a8f73454d0f839cBa6B9`.
- Artifacts are present in `deployments/sepolia/`.

Latest redeployment evidence after spec-alignment fixes:

- Frontend `MockUSDC`: `0x3Cb2AE0859d0B2aFe20d5f16Bf9e2E35A1cb2Cb8`.
- Frontend `VaultManager`: `0x8b7FbAca6606610BD953EE65e77911d69573BC81`.
- Frontend `SavingCore`: `0xF2e14533C7920bBE40bB86F16B0F268229382FA5`.
- Evidence file: `frontend/src/config.ts`.
- `frontend/src/abi/MockUSDC.json` was checked and no longer exposes the removed `admin` getter or `NotAdmin` error.

Fixes needed after deploy review:

- No deploy script correctness fix is needed based on static review.
- If final demo uses the frontend, verify the latest addresses in `frontend/src/config.ts` match the latest `deployments/sepolia/` artifacts or deployed Etherscan addresses.

### Frontend Zero-Limit Plan Check: 2026-07-20

Status: Completed

What was checked:

- `frontend/src/pages/AdminDashboard.tsx` already allowed entering `0` for both `Min Deposit (USDC)` and `Max Deposit (USDC)` because both inputs use `min="0"`.
- `parseUsdc("0")` correctly converts the value to `0` token units before calling `savingCore.createPlan(...)`.
- The Create Plan button was not blocked by `0` min or max values.

What was improved:

- `frontend/src/pages/AdminDashboard.tsx` now displays zero limits as `No minimum` or `No maximum` in the plan table.
- `frontend/src/pages/UserDashboard.tsx` now displays zero limits as `No minimum` or `No maximum` in plan cards.
- This keeps the UI aligned with the contract rule that `0` means no limit.

Verification:

- `npm.cmd run build` from `frontend/`: passed.
- Build warning remains non-blocking: Vite reports the main chunk is larger than `500 kB`.

### Frontend Build and Lint Result

Status: Build passed, lint failed

Commands run:

- `npm.cmd run build` from `frontend/`.
- `npm.cmd run lint` from `frontend/`.

Build result:

- Passed.
- Vite generated `dist/` successfully.
- Non-blocking warning: the main JavaScript chunk is larger than `500 kB` after minification.

Lint result:

- Failed with `6 errors` and `4 warnings`.

Frontend fixes needed:

- `frontend/src/Web3Context.tsx`:
  - Avoid direct synchronous `setProvider(nextProvider)` inside `useEffect` or adjust structure to satisfy `react-hooks/set-state-in-effect`.
  - Fix missing dependency warning for `connectWallet` in `useMemo`, likely by stabilizing callbacks or restructuring context value creation.
  - Move `useWeb3` to a separate file or adjust exports because `react-refresh/only-export-components` complains about exporting non-components from a component file.
- `frontend/src/pages/AdminDashboard.tsx`:
  - Avoid effect pattern that directly calls a state-setting function in `useEffect` according to `react-hooks/set-state-in-effect`.
  - Fix missing dependency warnings for `parseError` and `refreshAdminData`, likely by stabilizing functions or restructuring effects.
- `frontend/src/pages/UserDashboard.tsx`:
  - Replace render-time `Date.now()` usage in `useState` initialization.
  - Avoid `Date.now()` in places flagged by `react-hooks/purity`; prefer block timestamp from provider or a controlled state update outside render-sensitive code.
  - Avoid effect pattern that directly calls a state-setting function in `useEffect` according to `react-hooks/set-state-in-effect`.
  - Fix missing dependency warning for `refreshDashboard`.

Frontend demo suggestions:

- For the next frontend pass, prioritize demo usability over visual changes.
- Verify the connected wallet is on Sepolia because `Web3Context.tsx` is hard-coded to Sepolia.
- Use the deployed Sepolia addresses already configured in `frontend/src/config.ts`.
- Make sure the admin wallet is the same deployer/owner wallet before using the admin dashboard.
- Add a simple user checklist to the README: connect wallet, switch to Sepolia, mint or receive MockUSDC, approve `SavingCore`, open deposit, view deposit, withdraw early or use tests to demonstrate maturity/renewal.
- Because a `180-day` real maturity is not practical for video, demonstrate maturity and renewal through tests, or deploy a separate short-tenor demo plan only if the instructor allows it.

### Planning Documentation

Status: Completed

What was done:

- `doc/ASSIGNMENT.MD` was read and used as the source of truth.
- `doc/PHASED_PROJECT_PLAN.md` was created as the detailed phase-by-phase roadmap.
- The plan was updated so Section 8 is deferred until after the base implementation is completed.

Evidence:

- `doc/ASSIGNMENT.MD`
- `doc/PHASED_PROJECT_PLAN.md`
- `doc/PHASE_COMPLETION_LOG.md`

Remaining follow-up:

- Keep this completion log updated as phases move from partial or deferred status to completed.

### Contract Implementation Baseline

Status: Completed

What was done:

- `contracts/MockUSDC.sol` exists as the mock 6-decimal ERC20 token.
- `contracts/VaultManager.sol` exists as the separate vault for interest liquidity and fee receiver management.
- `contracts/SavingCore.sol` exists as the ERC721 certificate and term-deposit logic contract.
- Contract code includes custom errors, events, NatSpec, OpenZeppelin imports, and `SafeERC20` usage.
- `MockUSDC` now supports anyone-can-mint behavior for testing.
- `SavingCore` now supports zero min/max values as no-limit plan boundaries.

Evidence:

- `contracts/MockUSDC.sol`
- `contracts/VaultManager.sol`
- `contracts/SavingCore.sol`

How it was accomplished:

- The implementation follows the assignment's required contract split.
- User principal is held in `SavingCore`.
- Interest liquidity is held separately in `VaultManager`.
- `SavingCore` requests interest payment from `VaultManager` instead of paying interest from deposited principal.
- Deposits are represented by ERC721 NFTs.
- Plan APR and penalty values are snapshotted into deposit records.

Remaining follow-up:

- No known contract implementation follow-up for Phases 1-13.
- If contracts are changed again, rerun compile, tests, and coverage.

### Test Suite Baseline

Status: Completed

What was done:

- Test files exist for the token, vault, and saving core contracts.

Evidence:

- `test/MockUSDC.test.ts`
- `test/VaultManager.test.ts`
- `test/SavingCore.test.ts`

How it was accomplished:

- The repository includes Hardhat test structure using TypeScript.
- The tests are organized by contract, which maps cleanly to the three required contracts.

Remaining follow-up:

- If contract behavior changes again, update tests and rerun `npm.cmd test` and `npx.cmd hardhat coverage`.

### Deployment Baseline

Status: Completed

What was done:

- Numbered `hardhat-deploy` scripts exist for all three required contracts.
- Sepolia deployment artifacts exist in the repository.
- Contracts were redeployed after the latest `MockUSDC` and `SavingCore` spec-alignment changes.
- Frontend contract addresses were updated in `frontend/src/config.ts`.

Evidence:

- `deploy/01-deploy-mock-usdc.ts`
- `deploy/02-deploy-vault-manager.ts`
- `deploy/03-deploy-saving-core.ts`
- `deployments/sepolia/MockUSDC.json`
- `deployments/sepolia/VaultManager.json`
- `deployments/sepolia/SavingCore.json`

How it was accomplished:

- Deployment is structured in the expected order: token first, vault second, saving core third.
- Deployment artifacts indicate the contracts have previously been deployed to Sepolia.
- The frontend now points at the latest redeployed contract addresses.

Remaining follow-up:

- Confirm no sensitive `.env` values are committed before final submission.
- If contracts are redeployed again, refresh deployment artifacts, frontend addresses, and frontend ABI files again.

### Frontend Baseline

Status: Partially Completed

What was done:

- A React frontend exists under `frontend/`.
- User and admin dashboard files exist.
- Web3 context, config, and ABI files exist.

Evidence:

- `frontend/src/App.tsx`
- `frontend/src/Web3Context.tsx`
- `frontend/src/pages/UserDashboard.tsx`
- `frontend/src/pages/AdminDashboard.tsx`
- `frontend/src/config.ts`
- `frontend/src/abi/MockUSDC.json`
- `frontend/src/abi/VaultManager.json`
- `frontend/src/abi/SavingCore.json`

How it was accomplished:

- The frontend was scaffolded with Vite and React.
- ABI files were placed inside the frontend for contract interaction.
- Separate user and admin dashboard pages were created to map to the two assignment roles.

Remaining follow-up:

- Verify MetaMask connection, wrong-network handling, user rejection handling, and pending transaction states.
- Verify user flows: view plans, open deposit, view active deposits, withdraw, and renew.
- Verify admin flows if they are intended for the demo.
- Fix lint errors if using lint as part of final quality criteria.

### README Baseline

Status: Not Started

What was done:

- Root README has been inspected and is still the default sample Hardhat README.

Evidence:

- `README.md`

Remaining follow-up:

- Replace root README with base runbook after base implementation is verified.
- Later, after Section 8 is completed, add final design answers.

## Future Update Template

Use this template whenever a phase is completed or materially updated.

```md
## Phase N: Phase Name

Status: Completed

Completed on: YYYY-MM-DD

What was done:

- Item 1.
- Item 2.
- Item 3.

How it was accomplished:

- Implementation detail 1.
- Implementation detail 2.
- Implementation detail 3.

Evidence:

- `path/to/file.sol`
- `path/to/test.ts`
- Command: `npm test`
- Result: Passed or failed output summary.

Verification:

- `npm run compile`: result.
- `npm test`: result.
- `npx hardhat coverage`: result.
- Frontend build or demo result if applicable.

Remaining follow-up:

- Any known gaps, blockers, or later improvements.
```

## Immediate Next Updates To Record

- Sepolia redeployment result after latest contract changes, if using Sepolia for demo.
- Result of fixing and rerunning `npm.cmd run lint` in `frontend/`.
- Manual MetaMask demo result for user and admin dashboards.
- Base README/runbook completion.
