# Phase 17: Principal-Safe Maturity Withdrawals

## Goal

Implement the Section 8.3 C1 design improvement: users must be able to recover their principal at maturity even when the interest vault is empty or underfunded.

The core rule is:

```text
Principal is always paid from SavingCore.
Interest is paid from VaultManager only when vault liquidity is available.
Unpaid interest is recorded as a later claim.
```

This preserves the assignment's separation between user principal and bank interest liquidity.

## Source Rules

The assignment requires strict separation between principal and bank-owned interest funds:

- `SavingCore` holds user principal.
- `VaultManager` holds the bank's interest pool.
- Interest must never be paid from other users' principal.
- Admin vault withdrawals apply to `VaultManager`, not to `SavingCore` principal.

The project should not add an admin function that withdraws user principal from `SavingCore`. If principal can be withdrawn by the bank/admin and invested elsewhere, then principal is no longer guaranteed on-chain.

## Current Behavior

The current base implementation follows the simple spec rule:

- `withdrawAtMaturity(depositId)` calculates principal and interest.
- `SavingCore` pays principal from its own balance.
- `SavingCore` calls `VaultManager.payInterest(...)` for interest.
- `VaultManager.payInterest(...)` reverts if the vault lacks enough funds.
- Because the transaction reverts, the user receives neither principal nor interest.

This is simple, but unfair: an empty bank-funded vault can block the return of the user's own principal.

## Chosen Design

Use independent unpaid-interest claims instead of a queue.

At maturity:

- If the vault can pay the full interest, pay principal plus interest and close the deposit.
- If the vault cannot pay the full interest, pay principal, close the deposit, and record the unpaid interest.
- The NFT is burned when the deposit is closed.
- Because the NFT is burned, the interest claimant must be stored before burning.

Recommended state:

```solidity
mapping(uint256 depositId => uint256 amount) public unpaidInterest;
mapping(uint256 depositId => address claimant) public interestClaimant;
```

Only `interestClaimant[depositId]` can later claim the unpaid interest.

## Why No Queue

A FIFO queue is not selected for this phase.

Reasons:

- It is more complex to implement and test.
- A naive queue can be blocked if the first claimant never calls claim.
- A robust queue needs permissionless processing, partial payments, or both.
- Independent claims are easier to explain during the oral review.

Trade-off:

```text
Unpaid interest claims are first-come, first-served once the vault is funded.
```

Example:

```text
Vault balance: 10 USDC
Alice unpaid interest: 10 USDC
Bob unpaid interest: 10 USDC
```

If Alice claims first, Alice is paid and Bob's claim remains unpaid. Bob can claim after the vault is funded again.

## Maturity Withdrawal Rules

`withdrawAtMaturity(depositId)` should become principal-safe.

Required behavior:

- Caller must be the current NFT owner before the NFT is burned.
- Deposit must be matured.
- Deposit must still be active.
- Principal must be transferred to the caller even when the vault cannot pay interest.
- If interest is zero, no interest claim is recorded.
- If the vault can pay the full interest, pay it immediately from `VaultManager`.
- If the vault cannot pay the full interest, record `unpaidInterest[depositId]` and `interestClaimant[depositId]`.
- The same deposit must not be withdrawable twice.
- The same interest must not be claimable twice.

The design should avoid pretending unpaid interest exists inside `SavingCore`.

## Interest Claim Rules

Add a function such as:

```solidity
function claimInterest(uint256 depositId) external;
```

Required behavior:

- Caller must equal `interestClaimant[depositId]`.
- `unpaidInterest[depositId]` must be greater than zero.
- The vault must have enough liquidity to pay the full unpaid amount.
- Clear the unpaid claim before or safely around the external transfer.
- Pay interest from `VaultManager`, not from `SavingCore` principal.
- Emit an event when unpaid interest is recorded and when it is claimed.

Partial claims are not required for this phase. If the vault has less than the full claim amount, the claim can revert and the recorded debt remains unchanged.

## Manual Renew Rules

Manual renewal must only compound paid interest.

Allowed:

```text
Vault can pay interest -> manual renewal creates new principal = old principal + paid interest.
```

Blocked:

```text
Vault cannot pay interest -> manual renewal reverts for that deposit.
```

This block is per deposit, not global. One underfunded deposit should not disable renewal for unrelated deposits whose interest can be funded.

Do not silently renew principal-only through the existing `renewDeposit(...)` function. Users expect renewal to compound earned interest, so a principal-only renewal would be confusing and creates product responsibility risk.

## Auto-Renew Rules

Auto-renew follows the same solvency rule as manual renewal.

Allowed:

```text
Vault can pay interest -> auto-renew creates new principal = old principal + paid interest.
```

Blocked:

```text
Vault cannot pay interest -> auto-renew reverts for that deposit.
```

The bot and any user can still call auto-renew permissionlessly, but the contract must check vault liquidity at execution time.

If auto-renew is blocked because interest cannot be paid, the deposit remains available for the NFT owner to withdraw principal and record unpaid interest.

## No Principal-Only Renewal

Do not implement principal-only renewal in this phase.

Reasons:

- It is a separate product choice from normal compounding renewal.
- Users may wrongly believe unpaid interest was compounded.
- It needs extra frontend warnings and terms.
- It adds another state path to test and explain.

If this feature is added in a later phase, it should be a separate explicit function and UI action, not a silent fallback inside `renewDeposit(...)`.

## No Principal Withdrawal By Admin

Do not add a function that lets the bank/admin withdraw user principal from `SavingCore`.

Reason:

```text
If user principal leaves SavingCore for bank investment, principal is no longer guaranteed by the smart contract.
```

The current project is bank-like in user experience, but it is not a fractional-reserve bank. The on-chain safety claim depends on principal remaining segregated in `SavingCore`.

If a future version wants to invest user principal, it must be treated as a different risk model with new accounting and disclosures, such as:

- `totalPrincipalOwed`.
- `principalLiquidityAvailable`.
- `principalDeployed`.
- `principalShortfall`.
- Reserve ratios.
- Withdrawal queues.
- Collateral or liquidation logic.
- Clear user risk terms.

That future model should not claim that principal is guaranteed on-chain unless the guarantee is actually collateralized and enforceable by contract logic.

## Contract Tasks

- Add unpaid-interest state to `SavingCore` or a dedicated helper contract if separation becomes cleaner.
- Add claimant tracking because the deposit NFT is burned when the deposit closes.
- Add events for unpaid interest recording and later claim payment.
- Add a view path for frontend checks, such as claim amount and claimant.
- Add a vault liquidity check path that allows `SavingCore` to decide whether interest can be paid without relying on frontend state.
- Update `withdrawAtMaturity(...)` so principal is not blocked by an underfunded vault.
- Add `claimInterest(depositId)` or equivalent.
- Keep `renewDeposit(...)` and `autoRenewDeposit(...)` solvent by requiring paid interest before compounding.
- Ensure all external token and vault calls happen after state updates where practical.
- Preserve existing custom-error and NatSpec style.

## Possible New Contracts

Adding a new contract is allowed if it keeps the design simpler or safer.

Acceptable reasons to add a contract:

- Separate unpaid-interest claim accounting from core deposit lifecycle logic.
- Keep `SavingCore` smaller if contract size becomes a concern.
- Isolate future queue or distribution logic from the base saving logic.
- Provide a dedicated claim registry if unpaid claims become more complex.

Do not add a new contract just for abstraction. The smallest correct implementation is preferred.

If a new contract is added, it must preserve these rules:

- Interest still comes from `VaultManager`.
- Principal still remains in `SavingCore`.
- Only authorized saving logic can create unpaid claims.
- Claims cannot be duplicated or reassigned accidentally.
- Deployment scripts and frontend config must be updated.

## Test Tasks

- Mature withdrawal with fully funded vault pays principal plus interest.
- Mature withdrawal with empty vault pays principal and records unpaid interest.
- Mature withdrawal with partially funded vault pays principal and records full unpaid interest if full interest cannot be paid.
- The claimant can claim unpaid interest after the vault is funded.
- A non-claimant cannot claim unpaid interest.
- Unpaid interest cannot be claimed twice.
- Principal cannot be withdrawn twice.
- Manual renewal succeeds when vault can pay interest.
- Manual renewal reverts for that deposit when vault cannot pay interest.
- Auto-renew succeeds when vault can pay interest.
- Auto-renew reverts for that deposit when vault cannot pay interest.
- Another user's solvent renewal or withdrawal is not globally blocked by one underfunded deposit.
- Frontend-facing views return correct unpaid claim and vault status data.

## Frontend Tasks

- Show `Withdraw Principal + Interest` when the vault can fund the deposit's interest.
- Show `Withdraw Principal` when the vault cannot fund the deposit's interest.
- Show unpaid interest status after a principal-safe withdrawal records a claim.
- Show `Claim Interest` only for the stored claimant and only when a claim exists.
- Keep normal manual renewal visible only when interest can be paid and compounded.
- Do not globally disable all renewals because one deposit is underfunded.
- Handle race conditions where the frontend showed enough vault liquidity but another transaction used it first.
- Explain that vault liquidity is checked on-chain at execution time.

## README Tasks

- Update the Section 8.2 empty-vault answer to describe principal-safe withdrawal and independent unpaid claims.
- Explain why no FIFO queue was chosen.
- Explain that renewals only compound paid interest.
- Explain why principal-only renewal is not implemented.
- Explain why the bank/admin cannot withdraw user principal in this design.
- Clarify that the system is bank-like, but not a fractional-reserve banking model.

## Exit Criteria

- Users can always recover principal at maturity, even when `VaultManager` is empty.
- Interest is never paid from other users' principal.
- Unpaid interest is tracked per deposit and claimant.
- Unpaid interest can be claimed later after vault funding.
- Renewals only create new principal from actual principal plus actually paid interest.
- No principal-only renewal exists in this phase.
- No admin principal withdrawal exists.
- Tests cover funded, empty-vault, underfunded-vault, claim, and renewal cases.
- README design answers match the implemented contract behavior.
