# Section 8.2 Design Answers Draft

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
