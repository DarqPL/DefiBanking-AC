# Admin Risk Mitigation Plan

## Decision

The protocol will not use multisig for this project.

The target admin model is:

- One deployer address remains the contract `owner()` through OpenZeppelin `Ownable`.
- One admin address is configured by the deployer.
- The deployer can set or replace the admin address.
- Both deployer and admin can execute operational functions that currently need owner permission.
- No Safe wallet, Safe signer checks, Safe SDK, or multisig proposal flow is required.
- Deployer-owner compromise remains out of scope for this project.

This keeps administration simple while separating the deployment owner from the day-to-day operator.

## Problem

The current baseline uses a single deployer/admin account as the owner of the main protocol contracts. This is simple, but it makes day-to-day operations depend on the deployer key.

If that one account is compromised, the attacker may not be able to directly withdraw user principal from `SavingCore`, but they can still damage the protocol by changing configuration, draining bank-funded interest liquidity, pausing user flows, or redirecting privileged contract relationships.

## Existing Principal Protection

The system already has one important safety property:

- `SavingCore` holds user principal.
- `VaultManager` holds bank-funded interest liquidity.
- There is no admin function that withdraws user principal from `SavingCore`.
- Interest is paid from `VaultManager`, not from other users' principal.

This means a compromised admin cannot directly drain user principal with the current code. The main risks are availability, configuration integrity, and interest-liquidity safety.

## Compromised Admin Impact

If an authorized admin key is compromised, an attacker could:

- Withdraw available `VaultManager` liquidity.
- Pause `SavingCore`, blocking normal deposits, withdrawals, renewals, and interest claims.
- Pause `VaultManager`, blocking interest payments.
- Change the early-withdrawal `feeReceiver`.
- Change the authorized `savingCore` address in `VaultManager` if it is not locked.
- Change the authorized `depositMarketplace` address in `SavingCore` if it is not locked.
- Disable saving plans and block new deposits or auto-renewals.
- Change plan APRs for future deposits.

The user principal risk remains indirect: users may lose availability or expected interest, but the admin should not have a path to withdraw principal from `SavingCore`.

## Mitigation Summary

The recommended non-multisig mitigation plan is:

- Keep OpenZeppelin `Ownable` and keep the deployer as `owner()`.
- Add one configurable `admin` address to each admin-controlled protocol contract.
- Add a shared authorization rule for operational admin functions: deployer owner or configured admin.
- Keep ownership transfer restricted to the deployer owner only.
- Add lock-once protection for critical protocol addresses.
- Add emergency principal-only exit for users.
- Add vault reserve accounting so promised interest cannot be withdrawn by admin.
- Update the frontend admin dashboard to allow either deployer owner or configured admin.

## 1. Deployer And Admin Roles

The deployer owner is the highest-privilege address.

The configured admin is the operational address used for normal protocol management.

Recommended state per contract:

```solidity
address public admin;
```

Recommended event:

```solidity
event AdminUpdated(address indexed previousAdmin, address indexed newAdmin);
```

Recommended error:

```solidity
error UnauthorizedAdmin(address account);
```

Recommended setter:

```solidity
function setAdmin(address newAdmin) external onlyOwner;
```

Recommended modifier:

```solidity
modifier onlyOwnerOrAdmin() {
    if (msg.sender != owner() && msg.sender != admin) revert UnauthorizedAdmin(msg.sender);
    _;
}
```

`setAdmin(address)` should reject the zero address unless the project intentionally wants to support removing the admin. If admin removal is needed, prefer an explicit `clearAdmin()` function so the action is clear in transactions and events.

## 2. Function Permission Split

Operational functions can use `onlyOwnerOrAdmin`.

Examples:

- `SavingCore.createPlan(...)`
- `SavingCore.updatePlan(...)`
- `SavingCore.enablePlan(...)`
- `SavingCore.disablePlan(...)`
- `SavingCore.pause()` and `SavingCore.unpause()`
- `SavingCore.setDepositMarketplace(...)` until locked
- `VaultManager.fundVault(...)`
- `VaultManager.withdrawVault(...)`
- `VaultManager.setFeeReceiver(...)`
- `VaultManager.setSavingCore(...)` until locked
- `VaultManager.pause()` and `VaultManager.unpause()`
- `DepositMarketplace.setTermsHash(...)`
- `DepositMarketplace.pause()` and `DepositMarketplace.unpause()`
- `DepositMarketplace.recoverUnlistedDeposit(...)`

Highest-privilege ownership functions should remain deployer-only through `onlyOwner`.

Examples:

- `setAdmin(address)`
- `transferOwnership(address)`
- `renounceOwnership()` if it remains enabled

This means the deployer can always replace a compromised admin, but the admin cannot replace the deployer.

## 3. Deployment Flow

Recommended deployment flow:

- Deployer deploys `MockUSDC`, `VaultManager`, `SavingCore`, and `DepositMarketplace`.
- Deployer wires contract references.
- Deployer sets the same admin address on `SavingCore`, `VaultManager`, and `DepositMarketplace`.
- Deployer locks critical addresses after verifying deployment wiring.
- Deployer keeps ownership and does not transfer ownership to a Safe or any other multisig.

The admin address should be stored in deployment documentation and verified in deployment artifacts or post-deploy checks.

## 4. Lock-Once Critical Configuration

Some protocol addresses should be configurable during deployment, but immutable after setup is complete.

### VaultManager SavingCore Lock

`VaultManager.setSavingCore(address)` controls which contract can call `payInterest`. If an attacker changes this address to a malicious contract, they may be able to drain interest liquidity.

Recommended change:

- Add `bool public savingCoreLocked`.
- Add `lockSavingCore()` callable by deployer owner or admin.
- Make `setSavingCore(address)` revert once `savingCoreLocked == true`.
- Emit `SavingCoreLocked(address indexed savingCore)`.

After deployment wires the correct `SavingCore`, the deployer or admin should call `lockSavingCore()`.

### SavingCore Marketplace Lock

`SavingCore.setDepositMarketplace(address)` controls the only marketplace address allowed to transfer deposit NFTs between users. If an attacker changes it to a malicious marketplace, they can break normal marketplace assumptions.

Recommended change:

- Add `bool public depositMarketplaceLocked`.
- Add `lockDepositMarketplace()` callable by deployer owner or admin.
- Make `setDepositMarketplace(address)` revert once `depositMarketplaceLocked == true`.
- Emit `DepositMarketplaceLocked(address indexed depositMarketplace)`.

After deployment wires the correct `DepositMarketplace`, the deployer or admin should call `lockDepositMarketplace()`.

## 5. Emergency Principal Exit

Users should have a way to recover principal during an emergency even when normal protocol flows are paused or unavailable.

Recommended function:

```solidity
function emergencyWithdrawPrincipal(uint256 depositId) external;
```

Recommended activation rule:

```text
emergencyWithdrawPrincipal() is available when SavingCore is paused.
```

The emergency exit should:

- Require `ownerOf(depositId) == msg.sender`.
- Require the deposit to be active.
- Mark the deposit as closed or emergency-withdrawn.
- Burn or retire the deposit NFT.
- Transfer only the original principal from `SavingCore` to the user.
- Release any reserved interest for that deposit.
- Prevent the same deposit from being withdrawn twice.

The emergency exit should not:

- Pay interest.
- Charge an early-withdrawal penalty.
- Depend on `VaultManager` paying anything.
- Allow deployer or admin to withdraw user principal.

Emergency withdrawal protects principal, but the user gives up expected interest. This is acceptable in an emergency because the priority is principal recovery and system safety.

## 6. Vault Reserve Accounting

The vault should not allow deployer or admin to withdraw interest liquidity that has already been promised to users.

Recommended state in `VaultManager`:

```solidity
uint256 public reservedInterest;
```

Recommended view:

```solidity
function withdrawableVaultBalance() external view returns (uint256);
```

The withdrawable vault balance should be calculated as:

```text
withdrawableVaultBalance = vaultBalance - reservedInterest
```

`withdrawVault(amount)` should revert if the requested amount is greater than the withdrawable vault balance.

When a deposit closes through maturity withdrawal, early withdrawal, renewal, or emergency principal exit, the reserved interest for that deposit should be consumed or released according to the path used.

## 7. Frontend Requirements

The admin dashboard should allow access when the connected wallet is either:

- The contract deployer owner returned by `owner()`.
- The configured `admin()` address.

The frontend should not check Safe signer membership and should not require Safe SDK.

Recommended dashboard behavior:

- Show the connected role: deployer owner, admin, or unauthorized.
- Enable admin actions for both deployer and admin when the contract permits them.
- Keep admin-address management visible only for the deployer owner.
- Show clear errors when the connected account is unauthorized.

## 8. Residual Risks

This design does not protect against one compromised admin key as strongly as multisig would. The tradeoff is intentional for this project: simpler operations with one deployer owner and one admin operator.

This design also does not protect against a compromised deployer-owner key. The deployer owner can replace the operational admin and still controls owner-only actions such as setting admin addresses and ownership transfer. This is accepted project scope.

Risk reduction depends on:

- Keeping the deployer key separate from the daily admin key.
- Using a hardware wallet for deployer if possible.
- Locking critical addresses after deployment.
- Reserving promised interest so operational accounts cannot withdraw already-promised liquidity.
- Monitoring admin transactions.
- Quickly replacing the admin if compromise is suspected.

## Implementation Status

The deployer/admin single-address model is implemented across the main protocol contracts.

Implemented contract protections:

- `SavingCore`, `VaultManager`, and `DepositMarketplace` each expose `admin()` and owner-only `setAdmin(address)`.
- Operational admin functions now use owner-or-admin authorization.
- Admin replacement remains owner-only, so a compromised operational admin cannot replace the deployer owner or appoint a new admin.
- `VaultManager.lockSavingCore()` permanently locks the authorized `SavingCore` address after deployment wiring.
- `SavingCore.lockDepositMarketplace()` permanently locks the authorized marketplace address after deployment wiring.
- `SavingCore.emergencyWithdrawPrincipal(depositId)` lets the NFT owner recover principal while `SavingCore` is paused, without interest or early-withdrawal penalty.
- `VaultManager.reservedInterest` and `withdrawableVaultBalance()` prevent owner/admin vault withdrawals from taking liquidity reserved for promised interest.
- Reserve accounting is withdrawal protection only. New deposits are not blocked just because existing vault liquidity is below total promised interest.
- Deferred maturity interest keeps its reserve until the claimant successfully calls `claimInterest(depositId)`.

Implemented deployment and frontend support:

- Deploy scripts set the operational admin from `PROTOCOL_ADMIN`, defaulting to the deployer when the variable is not provided.
- Deploy scripts lock `VaultManager.savingCore` and `SavingCore.depositMarketplace` after wiring.
- The frontend admin dashboard allows connected wallets that match either `owner()` or `admin()` and displays reserved and withdrawable vault balances.

Implemented test coverage:

- Owner/admin operational access and unauthorized-account reverts.
- Owner-only admin replacement.
- Lock-once behavior for critical protocol addresses.
- Reserve-protected vault withdrawals and surplus withdrawals.
- Emergency principal withdrawal while paused, including reserve release and repeated-withdrawal prevention.
