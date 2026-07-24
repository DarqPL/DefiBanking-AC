# DeFi Term-Deposit Banking System Phased Plan

## Purpose

This plan translates `doc/ASSIGNMENT.MD` into an implementation roadmap for the blockchain-based term-deposit banking project. The final product must let users lock a 6-decimal ERC20 token into fixed-term saving plans, receive an ERC721 certificate NFT, withdraw principal plus vault-funded interest at maturity, withdraw early with a penalty, manually renew, and support permissionless auto-renewal after a grace period.

The required base contracts are:

- `MockUSDC.sol`: 6-decimal ERC20 token for local testing and demo use.
- `VaultManager.sol`: separate vault for bank-owned interest liquidity, penalty fee receiver, funding, withdrawals, and pause controls.
- `SavingCore.sol`: saving plan management, deposit lifecycle logic, principal custody, interest math, renewals, and ERC721 certificate NFTs.

The required non-contract deliverables are:

- Hardhat tests with more than 90% coverage.
- A simple React frontend demo connected to MetaMask.
- A root `README.md` explaining setup, deployment, personal variant values, and, after the deferred design phase, all design answers from Section 8.2.
- A short 3-5 minute demo video.

## Current Repository Baseline

The repository already contains a Hardhat + TypeScript setup with Solidity `0.8.28`, Ethers v6, TypeChain, ABI export, contract sizer, gas reporter, and Solidity coverage support.

Observed project assets:

- Contracts exist under `contracts/`: `MockUSDC.sol`, `VaultManager.sol`, and `SavingCore.sol`.
- Tests exist under `test/`: `MockUSDC.test.ts`, `VaultManager.test.ts`, and `SavingCore.test.ts`.
- Deploy scripts exist under `deploy/`: `01-deploy-mock-usdc.ts`, `02-deploy-vault-manager.ts`, and `03-deploy-saving-core.ts`.
- A React frontend exists under `frontend/` with ABI files and dashboard pages.
- Sepolia deployment artifacts exist under `deployments/sepolia/`.
- Root `README.md` is still the sample Hardhat README and must be replaced before submission.

Important assignment-specific gaps to confirm during execution:

- Personal variant values require the student's final two ID digits, `A` and `B`. These are not present in the assignment file, so they must be supplied before finalizing constants, tests, README values, and demo numbers.
- The assignment says `minDeposit / maxDeposit` are optional and zero means no limit. Current contract validation should be checked against this rule.
- The assignment says auto-renew uses `(A mod 3) + 2 days`; current code must be checked against the student's actual `A` value.
- The assignment requires root README design answers. Current root README does not satisfy this.

## Phase 1: Base Requirements Lockdown

### Goals

Capture the base implementation requirements needed to build the working system first. Section 8 brainstorming, optional improvements, and final design-answer refinement are intentionally deferred until after the base contracts, tests, deployment flow, and frontend are working.

### Tasks

- Read `doc/ASSIGNMENT.MD` completely and treat it as the source of truth.
- Record the student's last two ID digits:
  - `A`: last digit of Student ID.
  - `B`: second-to-last digit of Student ID.
- Compute the required personal variant values:
  - Grace period: `(A mod 3) + 2 days`.
  - Default plan APR: `200 + A * 25` basis points.
  - Early withdraw penalty: `300 + B * 50` basis points.
  - Default tenor: `90 days` if `B` is even, otherwise `180 days`.
- Mark Section 8 as deferred work:
  - Do not finalize Section 8.2 open design answers during the first implementation pass.
  - Do not implement Section 8.3 bonus challenges during the first implementation pass.
  - Build the base assignment behavior first, then revisit Section 8 to brainstorm improvements and refine contract structure.
- Define only the minimum base behavior needed to avoid blocking implementation:
  - Use the current NFT owner for deposit actions, with ownership transfer limited to the authorized marketplace.
  - Follow the base empty-vault rule unless Section 8 later changes it.
  - Use the assignment formulas for interest, penalty, maturity, and grace-period checks.
  - Preserve principal and vault separation from the beginning.

### Deliverables

- A short internal requirements note or README draft section containing personal variant values.
- A clear note that Section 8 design work is deferred until the later improvement phase.
- A list of base formulas and minimum edge-case rules needed for implementation tests.

### Exit Criteria

- Student ID digits are known or documented as a blocker.
- All base formulas and required personal variant values are written in one place.
- No contract implementation work proceeds with placeholder personal variant values unless the student explicitly accepts placeholders.
- Section 8 remains out of scope for the first implementation pass except where the base assignment directly requires a value, such as the personal variant grace period.

## Phase 2: Contract Architecture Review

### Goals

Ensure the contract architecture matches the assignment's separation-of-funds requirement and is defensible during oral review.

### Tasks

- Confirm `MockUSDC` behaves like test USDC:
  - Name and symbol are reasonable for demo use.
  - `decimals()` returns `6`.
  - Minting exists for testing and demo setup.
  - Mint permissions are clearly documented.
- Confirm `VaultManager` only holds bank-owned liquidity:
  - `fundVault(amount)` transfers tokens from admin or owner into the vault.
  - `withdrawVault(amount)` only allows the admin or owner to remove vault funds.
  - `payInterest(to, amount)` can only be called by the configured `SavingCore`.
  - `feeReceiver` can be set by the admin and cannot be zero.
  - Pause behavior is clear and consistent with the assignment.
- Confirm `SavingCore` only holds user principal:
  - User deposits are transferred into `SavingCore`.
  - Principal is paid from `SavingCore`.
  - Interest is requested from `VaultManager`.
  - Early-withdrawal penalties are routed to `feeReceiver`.
  - No function allows the admin to modify active deposit data.
- Confirm ownership and deployment wiring:
  - Deploy `MockUSDC` first.
  - Deploy `VaultManager` with token and fee receiver.
  - Deploy `SavingCore` with token and vault manager.
  - Set `VaultManager.savingCore` to the deployed `SavingCore` address.
- Decide whether pausing is owned separately in both contracts or controlled by one contract only.
- Decide whether `SavingCore.pause()` and `VaultManager.pause()` both need to be called for full emergency shutdown.

### Deliverables

- Architecture notes for root README.
- Deployment flow that can be repeated locally and on Sepolia.
- A clear explanation of why principal and vault funds are separated.

### Exit Criteria

- No function mixes user principal and vault interest liquidity.
- The deployment sequence is known and tested.
- Contract ownership and permissions are clear enough to explain live.

## Phase 3: `MockUSDC` Finalization

### Goals

Make the mock token assignment-compliant, simple, and reliable for tests and demo.

### Tasks

- Verify the compiler pragma aligns with project compiler settings or intentionally remains compatible.
- Confirm `decimals()` returns `6` and all tests use 6-decimal units.
- Confirm anyone-can-mint versus admin-only minting requirement:
  - Assignment says anyone can mint for testing.
  - If code uses admin-only minting, either change it to public minting or document the intentional restriction and ensure graders will not treat it as non-compliant.
- Add or verify tests for:
  - Initial supply if used.
  - `decimals()` equals `6`.
  - Minting behavior.
  - Transfers and approvals needed by `SavingCore` and `VaultManager`.
- Ensure mint amounts in tests are expressed in smallest units, for example `1_000n * 10n ** 6n`.

### Deliverables

- Final `MockUSDC.sol`.
- Passing `MockUSDC.test.ts`.

### Exit Criteria

- Token has exactly 6 decimals.
- Minting behavior matches the README explanation and tests.
- No test accidentally assumes 18 decimals.

## Phase 4: `VaultManager` Finalization

### Goals

Make the vault a secure, isolated source of interest payments and early-withdrawal fee configuration.

### Tasks

- Confirm constructor validates token and initial fee receiver are non-zero.
- Confirm `setFeeReceiver(address)`:
  - Is admin-only.
  - Rejects zero address.
  - Emits an event.
- Confirm `setSavingCore(address)`:
  - Is admin-only.
  - Rejects zero address.
  - Emits an event.
  - Is called in deploy scripts after `SavingCore` deployment.
- Confirm `fundVault(amount)`:
  - Is admin-only if that is the chosen design.
  - Rejects zero amount.
  - Uses `SafeERC20.safeTransferFrom`.
  - Emits an event.
- Confirm `withdrawVault(amount)`:
  - Is admin-only.
  - Rejects zero amount.
  - Reverts when amount exceeds vault balance.
  - Emits an event before or after transfer consistently with project event policy.
  - If C2 is implemented, blocks withdrawals that would make promised interest undercollateralized.
- Confirm `payInterest(to, amount)`:
  - Is callable only by `SavingCore`.
  - Rejects zero amount unless the caller avoids zero-interest calls.
  - Rejects zero recipient.
  - Reverts on insufficient vault balance for base spec compliance.
  - Emits `InterestPaid`.
- Confirm pause behavior:
  - `pause()` and `unpause()` are admin-only.
  - Funding, vault withdrawal, and interest payment pause behavior is documented.
  - User withdrawals and renewals are also blocked through `SavingCore` pause or vault pause.
- Add custom errors where useful to reduce gas and improve tests.
- Add NatSpec for all public and external functions.

### Deliverables

- Final `VaultManager.sol`.
- Passing `VaultManager.test.ts`.
- README notes for vault separation and empty vault behavior.

### Exit Criteria

- Interest can only leave the vault through authorized `SavingCore` calls.
- Admin cannot accidentally configure zero addresses.
- Empty vault behavior is tested and matches the selected design.

## Phase 5: `SavingCore` Plan Management

### Goals

Implement and verify saving plan lifecycle management with immutable snapshots for opened deposits.

### Tasks

- Confirm `SavingPlan` stores:
  - `tenorDays`.
  - `aprBps`.
  - `minDeposit`.
  - `maxDeposit`.
  - `earlyWithdrawPenaltyBps`.
  - `enabled`.
- Confirm plan IDs are unique and predictable.
- Implement or verify `createPlan(...)`:
  - Admin-only.
  - Rejects zero tenor.
  - Rejects invalid APR above `10_000` bps.
  - Rejects invalid penalty above `10_000` bps.
  - Handles min and max exactly as the assignment says.
  - Emits `PlanCreated(planId, tenorDays, aprBps)` at minimum, with optional extra indexed data if already present.
- Reconcile min/max behavior:
  - If following assignment literally, `0` means no limit.
  - Deposit checks should only enforce `minDeposit` when non-zero.
  - Deposit checks should only enforce `maxDeposit` when non-zero.
  - Tests must include zero-limit plans.
- Implement or verify `updatePlan(planId, newAprBps)`:
  - Admin-only.
  - Rejects unknown plan.
  - Rejects invalid APR.
  - Does not change existing deposit snapshots.
  - Emits `PlanUpdated(planId, newAprBps)` at minimum.
- Implement or verify `enablePlan(planId)` and `disablePlan(planId)`:
  - Admin-only.
  - Reject unknown plan.
  - Decide whether repeated enable or disable is idempotent or reverts.
  - Emit plan update event.
- Use the personal variant values for a default demo plan in deploy scripts and README examples.

### Deliverables

- Plan management code and tests.
- README explanation of plan snapshots.
- README personal variant section with computed plan values.

### Exit Criteria

- Admin can create, update, enable, and disable plans.
- Existing deposits are unaffected by plan updates.
- Tests prove min/max and disabled-plan behavior.

## Phase 6: Deposit Opening Flow

### Goals

Implement the user flow where a depositor opens a fixed-term saving position and receives an ERC721 certificate NFT.

### Tasks

- Implement or verify `openDeposit(planId, amount)`:
  - External user function.
  - Blocked when paused if selected design blocks deposit opening during emergency.
  - Rejects unknown plan.
  - Rejects disabled plan.
  - Rejects zero deposit amount.
  - Enforces non-zero min and max limits.
  - Transfers exactly the accepted principal from user to `SavingCore`.
  - Mints ERC721 certificate NFT to the depositor.
  - Stores deposit metadata.
  - Emits `DepositOpened(depositId, owner, planId, principal, maturityAt, aprBpsAtOpen)` at minimum.
- Confirm deposit metadata stores:
  - Plan ID at opening.
  - Principal amount.
  - Start timestamp.
  - Maturity timestamp.
  - APR snapshot.
  - Penalty snapshot.
  - Active status.
- Handle fee-on-transfer token behavior explicitly:
  - Assignment uses `MockUSDC`, but README or code should define behavior if a deflationary token is used.
  - Recommended base approach: assume non-fee ERC20; document that fee-on-transfer tokens are unsupported.
- Decide NFT ID start value:
  - `0` is valid but should be tested and documented if used.
  - `1` may be more user-friendly but requires changing current counters.
- Confirm transferability behavior:
  - ERC721 certificates are soulbound unless transferred by the authorized marketplace.
  - Withdraw and renew functions authorize `ownerOf(depositId)`, so marketplace buyers receive deposit rights while direct wallet sends have no effect.

### Deliverables

- Deposit opening implementation.
- Tests for happy path, below min, above max, disabled plan, unknown plan, zero amount, and snapshot behavior.
- README design answer for marketplace-only certificate transfer ownership.

### Exit Criteria

- A user can approve tokens, call `openDeposit`, and receive an NFT.
- `SavingCore` receives principal and does not touch vault funds.
- Deposit snapshot data remains unchanged after admin updates the plan.

## Phase 7: Maturity Withdrawal Flow

### Goals

Implement correct principal-plus-interest withdrawal after maturity, with interest always paid from `VaultManager`.

### Tasks

- Implement or verify `withdrawAtMaturity(depositId)`:
  - Blocked when paused.
  - Rejects missing deposit.
  - Rejects inactive, withdrawn, manually renewed, or auto-renewed deposits.
  - Requires caller to own the NFT.
  - Requires `block.timestamp >= maturityAt`.
  - Calculates simple interest using stored principal, APR snapshot, and tenor seconds.
  - Updates status before external transfers.
  - Burns the NFT or otherwise makes the certificate unusable, then documents the choice.
  - Transfers principal from `SavingCore` to the owner.
  - Calls `VaultManager.payInterest(owner, interest)` for non-zero interest.
  - Reverts if the vault cannot pay interest under the base spec.
  - Emits `Withdrawn(depositId, owner, principal, interest, isEarly=false)` at minimum.
- Confirm interest formula:
  - `interest = principal * aprBpsAtOpen * tenorSeconds / (365 days * 10_000)`.
  - Multiplication happens before division.
  - Uses 6-decimal token units.
- Confirm status changes and NFT burn prevent repeated withdrawals.
- Add tests for exact-second maturity boundary.
- Add tests for rounding dust using values that produce truncation.

### Deliverables

- Maturity withdrawal implementation.
- Tests for correct interest, too early, exact maturity, insufficient vault, repeat withdrawal, and direct NFT transfer rejection.
- README design answers for empty vault, rounding dust, boundary times, and attack prevention.

### Exit Criteria

- Mature withdrawals pay the exact calculated principal and interest.
- Interest never comes from other users' principal.
- Double withdrawal is impossible and tested.

## Phase 8: Early Withdrawal Flow

### Goals

Implement early withdrawal with zero interest and a principal penalty sent to the configured fee receiver.

### Tasks

- Implement or verify `earlyWithdraw(depositId)`:
  - Blocked when paused.
  - Rejects missing or inactive deposit.
  - Requires caller to own the NFT.
  - Requires `block.timestamp < maturityAt`.
  - Calculates penalty using the penalty snapshot.
  - Sends `principal - penalty` to the user.
  - Sends penalty to `VaultManager.feeReceiver()`.
  - Pays no interest.
  - Updates status before external transfers.
  - Burns or invalidates the NFT.
  - Emits `Withdrawn(depositId, owner, principal, interest=0, isEarly=true)` at minimum.
- Add tests for:
  - Correct penalty with personal variant value.
  - Zero penalty if allowed.
  - Maximum penalty if allowed.
  - No vault interaction for interest.
  - Penalty receiver receives exact amount.
  - Attempting early withdrawal at exact maturity reverts or routes to maturity withdrawal according to documented boundary rule.
  - Repeat early withdrawal fails.
- Confirm fee receiver changes affect future early withdrawals because the receiver is not snapshotted unless deliberately chosen otherwise.

### Deliverables

- Early withdrawal implementation.
- Penalty and fee receiver tests.
- README design answer for early withdrawal and boundary behavior.

### Exit Criteria

- Early withdrawal pays no interest.
- Penalty math is exact and uses 6-decimal units.
- Penalties are not retained in `SavingCore` unless intentionally documented.

## Phase 9: Manual Renewal Flow

### Goals

Allow a matured deposit owner to compound principal plus earned interest into a new enabled saving plan.

### Tasks

- Implement or verify `renewDeposit(depositId, newPlanId)`:
  - Blocked when paused.
  - Requires active deposit.
  - Requires caller to own the old NFT.
  - Requires `block.timestamp >= maturityAt`.
  - Requires new plan to exist.
  - Requires new plan to be enabled, if that is the selected design.
  - Calculates interest from the old deposit's snapshot.
  - Pulls interest from `VaultManager` into `SavingCore` so the new compounded principal is fully backed.
  - Sets old deposit status to `ManualRenewed`.
  - Mints a new NFT to the same owner.
  - Stores new deposit snapshot using the new plan's current APR and penalty.
  - Emits `Renewed(oldDepositId, newDepositId, newPrincipal, newPlanId)` at minimum.
- Confirm old NFT behavior:
  - If old NFT is kept, ensure it cannot be used for withdrawal.
  - If old NFT is burned, ensure README explains historical certificate handling.
- Confirm `newPrincipal = old principal + interest` respects new plan min/max limits.
- Add tests for:
  - Renewal at maturity.
  - Renewal before maturity fails.
  - Renewal into disabled plan fails if selected.
  - Old status becomes `ManualRenewed`.
  - New deposit principal includes interest.
  - New APR comes from new plan, not old deposit.
  - Insufficient vault for compounded interest reverts under base spec.

### Deliverables

- Manual renewal implementation.
- Renewal tests.
- README answer for disabled plan with active deposits.

### Exit Criteria

- Manual renew compounds only one term of simple interest.
- Renewed principal is fully backed by actual tokens held by `SavingCore`.
- Old deposit cannot be withdrawn after renewal.

## Phase 10: Auto-Renewal Flow

### Goals

Support permissionless auto-renewal after the grace period while protecting the user's original APR.

### Tasks

- Implement or verify `autoRenewDeposit(depositId)`:
  - Callable by any account, including a bot.
  - Blocked when paused.
  - Requires active deposit.
  - Requires `block.timestamp >= maturityAt + gracePeriod`.
  - Uses the same tenor as the original deposit.
  - Locks the new deposit APR to the original `aprBpsAtOpen`, not the current plan APR.
  - Carries forward the original penalty snapshot unless a different documented design is chosen.
  - Calculates old term interest once.
  - Pulls interest from `VaultManager` into `SavingCore` to back the compounded principal.
  - Sets old deposit status to `AutoRenewed`.
  - Mints a new NFT to the current owner of the old NFT.
  - Emits `Renewed(..., isAuto=true)` or equivalent.
- Confirm grace period uses the personal variant value from Student ID, not a hard-coded default unless it matches the computed value.
- Confirm users can still manually withdraw or manually renew after maturity and before the bot executes auto-renew.
- Decide what happens if the bot is offline for a month:
  - Recommended base behavior: the deposit remains active and user can still withdraw or renew until auto-renew is triggered.
  - README should explain that the user does not lose principal or accrued one-term interest, but automatic compounding is delayed.
- Add tests for:
  - Before grace period fails.
  - Exact grace boundary succeeds if using `>=`.
  - After grace period succeeds.
  - APR remains locked to old APR even after admin lowers the plan APR.
  - New principal includes interest.
  - Any caller can trigger auto-renew.
  - Transferred NFT owner receives the new NFT.
  - Insufficient vault reverts under base spec.

### Deliverables

- Auto-renewal implementation.
- Auto-renew tests with personal grace period.
- README answer for dead bot and boundary times.

### Exit Criteria

- Auto-renew cannot happen early.
- Auto-renew protects the original APR.
- Auto-renew creates a fully backed compounded deposit.

## Phase 11: Security, Gas, and Code Quality Pass

### Goals

Prepare the smart contracts for grading and oral defense by tightening security, readability, and gas efficiency without overengineering.

### Tasks

- Check all external token transfers use `SafeERC20`.
- Check functions follow checks-effects-interactions:
  - Validate inputs and permissions first.
  - Update deposit status before transfers.
  - Perform external token and vault calls last.
- Confirm repeated withdrawal and repeated renewal fail by status checks.
- Confirm `ownerOf(depositId)` is used where NFT transferability should control rights.
- Confirm zero addresses are rejected in constructors and setters.
- Confirm zero amounts are rejected or explicitly handled.
- Confirm admin-only functions use `Ownable` or equivalent.
- Confirm all public and external Solidity functions have useful NatSpec.
- Confirm custom errors are used for important reverts.
- Confirm storage layout is sensible:
  - Smaller fields such as `uint64` and `uint16` are used where appropriate.
  - Storage reads are cached in local variables where helpful.
  - No unbounded loops exist in core user functions.
- Run static reasoning for common attacks:
  - Double withdrawal.
  - Reentrancy through token callbacks or malicious ERC20 behavior.
  - Unauthorized vault interest draining.
  - Admin plan update affecting existing deposits.
  - Fake token or wrong token assumption.
- Decide whether to add `ReentrancyGuard`:
  - If status changes before external calls and trusted ERC20 is used, it may not be strictly necessary.
  - If using arbitrary ERC20s or wanting stronger oral-defense simplicity, add it to withdraw and renew paths.
- Ensure event signatures satisfy assignment-required names and core fields, even if extra fields are emitted.

### Deliverables

- Finalized contract code with NatSpec.
- A README attack-thinking answer with exact code references.
- Optional gas report notes if `REPORT_GAS=1 npm test` is used.

### Exit Criteria

- Contract behavior is deterministic, documented, and testable.
- Security answers match actual implementation lines.
- No unnecessary complex abstraction was added.

## Phase 12: Hardhat Test Suite and Coverage

### Goals

Prove all required base user flows, admin flows, and edge cases with automated tests above 90% coverage before revisiting Section 8 improvements.

### Tasks

- Standardize test helpers:
  - `USDC = 10n ** 6n`.
  - `amount(n) = BigInt(n) * USDC` or parse helper for fractional USDC.
  - Interest calculation helper matching contract formula.
  - Penalty calculation helper matching contract formula.
  - Fixture deployment helper for token, vault, saving core, and plans.
  - Time travel helper using Hardhat network helpers.
- Cover `createPlan`:
  - Valid plan.
  - Disabled plan at creation.
  - Invalid APR.
  - Invalid penalty.
  - Invalid tenor.
  - Min and max limit edge cases, including zero-as-no-limit if implemented.
  - Non-owner rejection.
- Cover `openDeposit`:
  - Happy path.
  - Below minimum.
  - Above maximum.
  - Disabled plan.
  - Unknown plan.
  - Zero amount.
  - Token approval missing or insufficient.
  - APR and penalty snapshots survive later plan updates.
- Cover `withdrawAtMaturity`:
  - Correct interest.
  - Too early fails.
  - Exact maturity succeeds.
  - Already withdrawn fails.
  - Non-owner fails.
  - Transferred NFT owner succeeds.
  - Insufficient vault fails under base spec.
  - Rounding dust behavior.
- Cover `earlyWithdraw`:
  - Correct penalty.
  - No interest paid.
  - Penalty receiver gets fee.
  - Exact maturity is not early.
  - Already withdrawn fails.
  - Non-owner fails.
  - Fee receiver update affects payout address.
- Cover `renewDeposit`:
  - Correct new principal.
  - Old status update.
  - New NFT minted.
  - New APR and penalty snapshot from new plan.
  - Before maturity fails.
  - Disabled new plan fails if selected.
  - Insufficient vault fails under base spec.
- Cover `autoRenewDeposit`:
  - Before grace period fails.
  - Exact grace boundary succeeds if using `>=`.
  - After grace period succeeds.
  - APR locked to original snapshot.
  - New principal includes old interest.
  - Any caller can trigger.
  - New NFT belongs to current certificate owner.
- Cover `VaultManager`:
  - Fund vault.
  - Withdraw vault.
  - Insufficient vault balance.
  - Unauthorized interest payout rejected.
  - Unauthorized admin calls rejected.
  - Zero address and zero amount validation.
- Cover pause behavior:
  - Withdrawal blocked when `SavingCore` is paused.
  - Renewal blocked when `SavingCore` is paused.
  - Vault interest payment blocked when `VaultManager` is paused, if that behavior is selected.
  - Unpause restores behavior.
- Cover deploy scripts enough through compile or a smoke deployment test if practical.
- Run test commands:
  - `npm run compile`.
  - `npm test`.
  - `npx hardhat coverage` if available through installed `solidity-coverage`.
  - `$env:REPORT_GAS="1"; npm test` if gas data is desired.

### Deliverables

- Complete Hardhat test suite.
- Coverage output showing more than 90% coverage.
- Any coverage report artifacts as appropriate.

### Exit Criteria

- All tests pass.
- Coverage exceeds assignment threshold.
- Tests use the student's personal variant values.

## Phase 13: Deployment Scripts and Local Demo Data

### Goals

Make the contracts easy to deploy locally and to Sepolia, with predictable demo data for the frontend and video.

### Tasks

- Verify deploy script order:
  - `01-deploy-mock-usdc.ts`.
  - `02-deploy-vault-manager.ts`.
  - `03-deploy-saving-core.ts`.
- Ensure deploy scripts use `hardhat-deploy` conventions:
  - `DeployFunction` type.
  - `func.tags`.
  - Named deployer account.
  - Deterministic dependency flow if tags are used.
- Ensure `SavingCore` deployment receives the correct `MockUSDC` and `VaultManager` addresses.
- Ensure `VaultManager.setSavingCore` is executed after `SavingCore` deployment.
- Add or verify a default saving plan using personal variant values.
- Add or verify local demo setup steps:
  - Mint MockUSDC to depositor account.
  - Mint or transfer MockUSDC to admin for vault funding.
  - Approve and fund the vault.
  - Approve `SavingCore` for deposit opening.
- Ensure generated ABI files are available for frontend consumption:
  - Compile exports ABI to `data/abi/`.
  - Frontend ABI files are updated only through an intentional copy or script.
- Verify `.env_example` lists required environment variables:
  - `TESTNET_PRIVATE_KEY`.
  - `MAINNET_PRIVATE_KEY`.
  - `BOT_PRIVATE_KEY` for the auto-renew bot wallet.
  - `CRON_SECRET` for the protected auto-renew API endpoint.
  - `ETHERSCAN_API`.
  - `REPORT_GAS`.
- Never commit real `.env` secrets.

### Deliverables

- Working deploy scripts.
- Local deployment instructions for README.
- Sepolia deployment instructions if required for demo.

### Exit Criteria

- `npx hardhat deploy --network localhost` or equivalent deployment path works.
- Sepolia deployment path is documented but not run without explicit intent and funded testnet key.
- Frontend config can point to deployed contract addresses.

## Phase 14: Frontend Demo Implementation

### Goals

Provide a simple React demo that proves core user and admin flows through MetaMask.

### Tasks

- Confirm frontend stack and scripts in `frontend/package.json`.
- Confirm contract address configuration in `frontend/src/config.ts`.
- Confirm ABI files match current compiled contracts.
- Implement or verify wallet connection:
  - Detect MetaMask.
  - Connect account.
  - Show connected address.
  - Handle user rejection.
  - Handle wrong network.
  - Offer network switching if supported.
- Implement or verify user dashboard:
  - Show available enabled plans.
  - Show plan tenor, APR, limits, penalty, and enabled status.
  - Let user approve MockUSDC for deposit.
  - Let user open a deposit.
  - Show user's deposit NFTs and metadata.
  - Show maturity countdown or maturity state.
  - Let user withdraw at maturity.
  - Let user early withdraw when before maturity.
  - Let user manually renew into an enabled plan after maturity.
  - Show pending transaction state and success or error state.
- Implement or verify admin dashboard if present:
  - Create plan.
  - Update APR.
  - Enable and disable plans.
  - Fund vault.
  - Withdraw vault.
  - Set fee receiver.
  - Pause and unpause.
- Keep demo UX simple but robust:
  - Avoid silent failures.
  - Display balances in USDC with 6 decimals.
  - Disable buttons when prerequisites are not met.
  - Show exact transaction hashes when available.
- Build and lint frontend:
  - `npm install` inside `frontend/` if dependencies are missing.
  - `npm run build`.
  - `npm run lint` if configured.
- Ensure frontend works on desktop and mobile widths.

### Deliverables

- Working React frontend under `frontend/`.
- Updated frontend README if useful.
- Root README demo instructions.

### Exit Criteria

- A user can connect MetaMask, see plans, open a deposit, see deposits, and withdraw or renew.
- Frontend displays values using 6-decimal USDC units.
- Demo can be completed reliably in 3-5 minutes.

## Phase 15: Base README and Runbook

### Goals

Replace the sample Hardhat README with a base project runbook after the core implementation is working. This phase documents how to run, test, deploy, and demo the base system, but it does not finalize Section 8 design answers yet.

### Required README Structure

- Project title and short description.
- Personal variant values:
  - Student ID final digits or masked form if privacy is desired.
  - `A` and `B`.
  - Computed grace period.
  - Computed default APR.
  - Computed early withdrawal penalty.
  - Computed default tenor.
- Architecture overview:
  - `MockUSDC` purpose.
  - `VaultManager` purpose.
  - `SavingCore` purpose.
  - Separation between user principal and bank interest liquidity.
- Contract addresses:
  - Local placeholders or instructions.
  - Sepolia addresses if deployed.
- Setup instructions:
  - Install dependencies.
  - Compile.
  - Test.
  - Coverage.
  - Local node.
  - Deploy.
  - Frontend startup.
- Main user flows:
  - Open deposit.
  - Withdraw at maturity.
  - Early withdraw.
  - Manual renew.
  - Auto-renew.
- Admin flows:
  - Create and update plans.
  - Enable and disable plans.
  - Fund and withdraw vault.
  - Set fee receiver.
  - Pause and unpause.
- Events emitted.
- Section 8 deferred-work note.
- Test coverage summary.

### Deliverables

- Base root `README.md`.
- Optional screenshots or demo notes if helpful.

### Exit Criteria

- README no longer contains the sample Hardhat content.
- README contains accurate setup, testing, deployment, frontend, and base architecture instructions.
- README clearly states that Section 8 design answers and bonus improvements are deferred to the later design phase.

## Phase 16: Deferred Section 8 Design and Improvement Pass

### Goals

Handle Section 8 only after the overall base implementation is complete. This phase is for brainstorming, defining improved structures, updating contracts if needed, and then preparing final design answers that match the actual code.

### Section 8.1 Personal Variant Confirmation

- Reconfirm the final two Student ID digits used by the implemented contracts and tests.
- Verify the grace period, default APR, early withdrawal penalty, and default tenor still match the computed values.
- Confirm demo numbers match those values.

### Section 8.2 Open Design Questions

- Transferable certificate:
  - Decide whether the current ERC721 owner or original depositor controls withdrawal and renewal.
  - If current owner controls actions, verify code uses `ownerOf(depositId)` or equivalent.
  - If original depositor controls actions, add explicit depositor storage and explain why NFT transferability is limited.
- Empty vault:
  - Start from the base implementation behavior.
  - Decide whether to keep the required revert behavior or improve it with deferred interest claims.
  - If changed, update contracts and tests so principal safety and interest accounting remain correct.
- Dead bot:
  - Analyze what happens when no one calls `autoRenewDeposit` for a long time.
  - Decide whether users should retain manual withdrawal or renewal rights after the grace period.
  - Consider adding a user-triggered recovery or clearer stale-auto-renew behavior if needed.
- Rounding dust:
  - Confirm who keeps truncated interest dust.
  - Add or verify a test that proves rounding cannot overpay or cause a wrong balance.
- Boundary times:
  - Confirm exact comparison operators for maturity and grace period.
  - Add or verify tests for exact `maturityAt` and exact `maturityAt + gracePeriod`.
- Disabled plan with active deposits:
  - Decide what users can still do after the admin disables their original plan.
  - Decide whether manual renewal into a disabled plan is blocked.
  - Add or verify tests for that rule.
- Attack thinking:
  - Pick one realistic attack to explain in the final README.
  - Prefer an attack that is already covered by tests, such as double withdrawal, unauthorized vault drain, or reentrancy-style sequencing.
  - Reference the exact code mechanism that prevents it.

### Section 8.3 Bonus Challenge Decision

- Decide whether the base implementation should remain unchanged or whether up to two bonus improvements should be added.
- Only implement bonus work if the base system, tests, frontend, and README runbook are already stable.
- Limit implementation to at most two challenges because the assignment caps bonus credit at +10.
- Recommended bonus choices, if time allows:
  - C1, principal is always safe, because it fixes the largest fairness issue in the base spec.
  - C2, solvency guard, because it strengthens vault safety and is easy to explain in an oral defense.

### Deliverables

- A Section 8 decision log.
- Any contract, test, deploy, or frontend changes required by selected Section 8 improvements.
- Final wording for the README `Design Answers` section.

### Exit Criteria

- Section 8 decisions are made after the base implementation is working.
- Any structural improvements are implemented and tested.
- Final design answers match the actual code, not an earlier plan.

## Phase 17: Bonus Challenge Implementation, Optional

### Goals

Implement up to two Section 8.3 creative challenges only if Phase 16 selects bonus work after the base requirements are stable.

### Option C1: Principal Is Always Safe

Tasks:

- Change maturity withdrawal behavior so the user can always reclaim principal even if vault interest is unavailable.
- Track unpaid interest as a claimable debt if vault funds are insufficient.
- Add `claimInterest(depositId)` or similar for later interest claiming.
- Ensure principal withdrawal cannot be repeated.
- Ensure interest claim cannot exceed owed amount.
- Add tests for empty vault principal withdrawal and later interest claim after vault funding.
- Document the trade-off: user fairness improves, but state and claim logic become more complex.

Exit criteria:

- Principal can never be locked by an empty vault at maturity.
- Unpaid interest is tracked accurately and claimable later.

### Option C2: Solvency Guard

Tasks:

- Track promised interest for active deposits.
- Increase promised interest when deposits open or renew.
- Decrease promised interest when deposits withdraw, early withdraw, or renew.
- Block `withdrawVault` if it would reduce the vault balance below promised interest.
- Decide how to handle promised interest for auto-renewed deposits.
- Add tests for admin withdrawal blocked by promised interest and allowed when surplus exists.
- Document the trade-off: stronger depositor protection but more accounting complexity.

Exit criteria:

- Admin cannot withdraw interest liquidity that is already owed under active deposits.
- Accounting remains correct across all lifecycle transitions.

### Option C3: Partial Early Withdrawal

Tasks:

- Add a function to withdraw part of principal before maturity.
- Apply penalty only to the withdrawn amount.
- Reduce remaining principal.
- Decide whether NFT remains the same or a new NFT is minted for the remaining position.
- Recalculate interest on remaining principal only.
- Add tests for partial amount, full remaining withdrawal, penalties, and maturity interest.
- Document the fairness and complexity trade-off.

Exit criteria:

- Users can access part of their money without breaking the entire deposit.
- Remaining principal continues under clear interest rules.

### Option C4: Top-Up Deposit

Tasks:

- Add a function to add principal to an active deposit.
- Decide how APR and tenor apply to the top-up amount.
- Recommended design: treat top-up as a separate deposit unless strong weighted-interest accounting is implemented.
- If adding to the same NFT, store weighted start time or separate tranches.
- Add tests for top-up before maturity, interest calculation, limits, and disabled plans.
- Document why the chosen math is fair.

Exit criteria:

- Top-up principal is handled without overpaying interest.
- The design can be explained simply during oral review.

### Option C5: Custom Idea

Tasks:

- Identify a real gap in the base assignment.
- Write the README problem statement before implementing.
- Implement the smallest safe fix.
- Add targeted tests.
- Document trade-offs.

Exit criteria:

- The feature solves a real protocol issue and is not just cosmetic.
- The README explains the problem, solution, and trade-off.

## Phase 18: Final README and Design Answers

### Goals

Finalize the root README only after Section 8 decisions and any optional improvements are complete, so the written explanation exactly matches the final contracts, tests, frontend, and demo behavior.

### Required Final README Additions

- Add a `Design Answers` section that answers every Section 8.2 question in the student's own words.
- Add exact code references for each answer where the assignment asks for them.
- Update the architecture section if Section 8 changed any contract structure.
- Update setup, test, coverage, deployment, and frontend instructions if any commands changed.
- Update personal variant values and demo values if they were corrected during Phase 16.
- Add bonus feature notes if Phase 17 implemented any challenge.
- Add limitations and trade-offs if the base behavior was intentionally kept.

### Required Design Answers

- Transferable certificate:
  - State who can withdraw or renew after NFT transfer.
  - Reference the exact authorization code.
  - Explain why this behavior is acceptable or risky.
- Empty vault:
  - Explain whether withdrawal reverts or principal can still be claimed.
  - Explain the user impact and selected trade-off.
- Dead bot:
  - Explain what happens if no bot calls auto-renew for one month.
  - Explain whether the user loses anything.
  - Propose one future protection.
- Rounding dust:
  - Explain integer division truncation.
  - State who keeps the dust.
  - Reference the test that proves the behavior.
- Boundary times:
  - Show the exact `>=` or `>` operators used for maturity and grace.
  - Explain exact-second maturity and grace-end behavior.
- Disabled plan with active deposits:
  - Explain what active users can still do.
  - Explain whether renewal into disabled plans is allowed.
  - Justify the rule.
- Attack thinking:
  - Describe one realistic attack.
  - Reference the exact code mechanism and test that prevent it.

### Deliverables

- Final root `README.md`.
- Final Design Answers section.
- Updated bonus notes if bonus work was implemented.

### Exit Criteria

- README no longer has temporary Section 8 deferral language except as historical process notes if desired.
- All Section 8.2 questions are answered.
- README explanations match the final code and tests.

## Phase 19: End-to-End Verification

### Goals

Run the project exactly as a grader or demo viewer would and fix any mismatches before submission.

### Tasks

- Clean and compile:
  - `npm run clean`.
  - `npm run compile`.
- Run all tests:
  - `npm test`.
- Run coverage:
  - `npx hardhat coverage`.
- Run contract size:
  - `npm run size`.
- Optionally run gas report:
  - PowerShell: `$env:REPORT_GAS="1"; npm test`.
- Verify deploy scripts on a local Hardhat node:
  - Start local node with `npm run node`.
  - Deploy to localhost in a second terminal.
  - Confirm contract addresses and setup transactions.
- Verify frontend against local deployment:
  - Start frontend dev server.
  - Connect MetaMask to localhost.
  - Open a deposit.
  - Fast-forward time through tests or use short demo plan locally if supported.
  - Withdraw or renew.
- Verify frontend against Sepolia only if intended:
  - Confirm `.env` contains testnet key and no mainnet action is needed.
  - Confirm account has Sepolia ETH.
  - Deploy.
  - Update frontend addresses.
  - Perform a small demo flow.
- Check generated artifacts:
  - `data/abi/` updated by compile.
  - `typechain/` updated by compile.
  - Do not hand-edit generated files.
- Check git status:
  - Ensure no `.env` or secret file is staged or committed.
  - Ensure generated files included or ignored according to repository convention.

### Deliverables

- Passing command output for compile, tests, coverage, and frontend build.
- Final list of known limitations if any.

### Exit Criteria

- Project can be built, tested, deployed locally, and demonstrated from the README.
- Coverage is above 90%.
- No secret material is included.

## Phase 20: Demo Video Preparation

### Goals

Prepare a concise 3-5 minute demo that proves the assignment flows and personal variant values.

### Suggested Demo Script

- Show README personal variant values and explain `A` and `B` calculations.
- Show the three-contract architecture:
  - `SavingCore` holds principal.
  - `VaultManager` holds interest liquidity.
  - `MockUSDC` uses 6 decimals.
- Show tests passing or coverage result briefly.
- Open frontend and connect MetaMask.
- Show available plans with personal APR, tenor, and penalty values.
- Mint or confirm MockUSDC balance if needed.
- Approve and open a deposit.
- Show the minted NFT/deposit record.
- Demonstrate one maturity path:
  - Use a preconfigured short local plan for demo if allowed, or show test output for time travel.
  - Withdraw at maturity or manually renew.
- Demonstrate early withdrawal penalty with a second deposit if time allows.
- Show vault funding and interest source.
- End with README design answers summary.

### Demo Risks to Avoid

- Do not use numbers that differ from the personal variant values.
- Do not show 18-decimal units for USDC.
- Do not depend on long real-time waits for maturity.
- Do not perform mainnet transactions.
- Do not reveal private keys, `.env`, or wallet seed phrases.

### Deliverables

- 3-5 minute demo video.
- Final README link or submission note if required by the course.

### Exit Criteria

- Demo clearly shows the frontend and contract behavior.
- Demo numbers match tests and README.
- Demo can be understood without extra verbal correction.

## Phase 21: Final Submission Checklist

### Contracts

- `contracts/MockUSDC.sol` exists and uses 6 decimals.
- `contracts/VaultManager.sol` exists and separates interest liquidity.
- `contracts/SavingCore.sol` exists and handles plans, deposits, withdrawals, renewals, and ERC721 certificates.
- All public and external functions have NatSpec.
- Required events are emitted.
- Personal variant values are used where required.

### Tests

- Required test categories from Section 7.2 are covered.
- Edge cases for boundaries, rounding, repeated withdrawals, and insufficient vault are covered.
- Coverage is above 90%.
- Tests use 6-decimal token units.
- Tests use personal variant values.

### Frontend

- MetaMask connection works.
- User can view plans.
- User can open a deposit.
- User can view active deposits.
- User can withdraw or renew.
- Loading, pending transaction, wrong network, and user rejection states are handled.

### README

- Root README is complete and no longer the sample Hardhat README.
- Setup, test, deployment, and frontend instructions are present.
- Personal variant values are at the top.
- All Section 8.2 design questions are answered.
- Bonus challenge notes are included if implemented.

### Submission Hygiene

- No private keys or `.env` contents are committed.
- Generated artifacts are consistent with project conventions.
- Sepolia addresses are documented if used.
- Demo video is prepared.
- GitHub repository contains all required source code.

## Recommended Execution Order

1. Get student ID digits and compute personal variant values.
2. Fix any contract/spec mismatches, especially optional min/max limits and grace period.
3. Complete tests until all base flows and edge cases pass.
4. Run coverage and raise it above 90%.
5. Finalize deploy scripts and local demo data.
6. Verify frontend flows against current ABIs and addresses.
7. Replace root README with base project documentation and mark Section 8 as deferred.
8. Revisit Section 8 after the base system works, then brainstorm improvements and finalize design decisions.
9. Optionally implement up to two bonus challenges only if Section 8 selects them.
10. Finalize root README design answers so they match the final code.
11. Run full end-to-end verification.
12. Record demo video and submit.
