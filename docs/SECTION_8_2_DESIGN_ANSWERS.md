# Section 8.2 Design Answers Draft

This file is a working draft for the remaining final README `Design Answers` items. `Transferable Certificate` and `Empty Vault` are already handled in the README, so this note focuses on the other questions and the planned change that blocks auto-renewal when the original plan is disabled.

## Dead Bot

If the auto-renew bot goes offline for one month, user deposits do not break and users do not lose principal. Matured deposits remain active until the owner withdraws or renews, so the user can still withdraw manually. The only thing lost is the convenience of automatic renewal during the bot downtime. The protection is that auto-renew is permissionless, so any keeper, frontend helper, or public bot can call it after the grace period instead of depending on one trusted bot.

## Rounding Dust

Interest is calculated with integer division, so fractional token units are rounded down. The user receives the rounded-down interest amount, and the tiny leftover dust stays economically with the vault/protocol because it is never paid out. There is no special dust balance variable; the vault simply pays less than the exact mathematical fraction by less than one smallest token unit. This rounding cannot cause overpayment, wrong balances, or a revert by itself because the same rounded value is used for payment and liquidity checks.

## Boundary Times

At exactly `maturityAt`, the deposit is treated as matured, not early. Early withdrawal is rejected when `block.timestamp >= maturityAt`, while maturity withdrawal and manual renewal reject only when `block.timestamp < maturityAt`. Auto-renew is allowed at exactly `maturityAt + AUTO_RENEW_GRACE_PERIOD` because it rejects only when `block.timestamp < renewAfter`. These operators make the boundary clear: before maturity is early, at maturity is mature, and at the grace-end timestamp permissionless auto-renew can begin.

## Disabled Plan With Active Deposits

Disabling a plan should not punish users who already opened deposits under that plan. Existing active deposits can still be withdrawn normally, including early withdrawal before maturity and maturity withdrawal after maturity, because their APR, tenor, and penalty were snapshotted when opened. Manual renewal into a disabled plan is blocked because renewal creates a new term and should follow the current admin decision that the product is closed. Auto-renew should also be blocked when the original plan is disabled, because otherwise a high-APR disabled plan could continue rolling forever and bypass the admin's decision to close it.

## Attack Thinking

A realistic attack is double withdrawal. A user could try to withdraw a matured deposit, receive principal and interest, then call withdrawal again for the same deposit to steal another payout. The contract prevents this by marking the deposit as no longer active and burning or retiring the NFT during withdrawal or renewal. Any later call must pass the active-deposit check, so a second withdrawal or renewal reverts because the deposit status is no longer `Active`.

Another useful protection is ownership checking. A user cannot withdraw or renew someone else's deposit because the contract checks the current ERC721 owner with `ownerOf(depositId)`. This also makes transfers clear: whoever owns the NFT owns the right to act on the deposit.

# Planned Auto-Renew Disable Change

## Goal

Block `autoRenewDeposit` when the original plan has been disabled.

## Reason

The current auto-renew design preserves the old deposit's plan id, APR snapshot, tenor, and penalty. That is good while the plan is still open, but it becomes risky after the admin disables the plan. Without a disabled-plan check, old deposits from a very favorable plan could be auto-renewed forever even though the admin intended to close that product.

## Intended Rule

Existing deposits remain valid after a plan is disabled. Users can still early withdraw before maturity or withdraw at maturity. Users cannot open new deposits into the disabled plan, cannot manually renew into the disabled plan, and cannot auto-renew deposits whose original plan is disabled.

## Code Plan

1. In `SavingCore.autoRenewDeposit`, load the original plan with `_getExistingPlan(oldDeposit.planId)` before creating the renewed deposit.
2. If the plan is disabled, revert with the existing `PlanNotEnabled` error.
3. Keep using the old deposit's snapshotted APR, tenor, and penalty after the enabled check, so admin APR updates still do not change existing deposit economics.
4. Add or update a test that opens a deposit, disables its plan, moves time past maturity plus grace, then expects `autoRenewDeposit` to revert with `PlanNotEnabled`.
5. Update the Vercel endpoint and fallback script bot to skip disabled-plan deposits before sending transactions, using a per-run plan-enabled cache.
6. Keep the existing test that auto-renew preserves original economics when the plan remains enabled.

## Expected User Impact

Users with deposits in disabled plans still receive the deal they already opened. They just cannot roll that deal into another automatic term after the admin closes the plan. This protects the bank/vault from indefinite exposure to closed high-APR plans while keeping existing user principal and earned interest safe.
