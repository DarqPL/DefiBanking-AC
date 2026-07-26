# Frontend Redesign Implementation Plan

## Goal

Redesign the original `frontend/` application into a lighter, friendlier banking interface that synthesizes:

- `frontend_example` UX patterns: clear panels, explicit states, transaction feedback, confirmation dialogs, readable wallet flow, and user-friendly copy.
- MBBank-inspired visual language: white background, blue corporate accents, clean banking cards, subtle shadows, and professional financial-product layout.

The redesign must preserve all current original frontend capabilities:

- Sepolia-only MetaMask connection and network switching.
- User dashboard for plans, deposit opening, active deposits, history, emergency withdrawal, maturity withdrawal, renewal, and deferred interest claims.
- Marketplace page for listing, buying, cancellation, listable deposits, seller listings, and marketplace terms.
- Admin dashboard for plan, vault, pause, reserved-interest, and owner/admin controls.

No smart contract behavior should change during this frontend pass.

## Design Direction

### Visual System

Use a light banking theme:

- Page background: soft white or pale blue-gray, such as `#f4f8fc`.
- Card background: `#ffffff`.
- Primary blue: `#005baa` or `#0068c9`.
- Dark navy text: `#102a43`.
- Muted text: `#60758a`.
- Light blue surfaces: `#eef6ff` and `#e5f1ff`.
- Border: `#d8e6f3`.
- Success: green.
- Warning: amber.
- Danger: red.

Avoid directly copying MBBank branding assets, logo, or exact proprietary layout. Use the color and banking-product feel as inspiration only.

### UX Tone

Make copy more helpful and less technical:

- Explain Sepolia and MockUSDC clearly.
- Use `Deposit Certificate` or `Savings Certificate` alongside NFT wording.
- Show why buttons are disabled where practical.
- Prefer clear empty states over short plain text.
- Keep warnings explicit for early withdrawal, deferred interest, vault underfunding, and marketplace escrow.

## Target Frontend Structure

Keep the existing routes:

- `/`: User dashboard.
- `/marketplace`: Deposit NFT marketplace.
- `/admin`: Admin dashboard.

Gradually move toward the `frontend_example` structure by introducing reusable components instead of rewriting everything at once.

Recommended component additions:

- `src/components/ApplicationShell.tsx`
- `src/components/UiStatePanel.tsx`
- `src/components/ConfirmationDialog.tsx`
- `src/components/TransactionFeedback.tsx`
- `src/components/StatusBadge.tsx`
- `src/components/InfoCard.tsx`

Recommended helper additions:

- `src/lib/format.ts`
- `src/lib/finance.ts`
- `src/lib/address.ts`
- `src/lib/transactions.ts`
- `src/hooks/useTransaction.ts`

Keep changes minimal and incremental. Do not split every function immediately if doing so risks regressions.

## Implementation Phases

### Phase 1: Theme And Layout Foundation

Files likely touched:

- `frontend/src/index.css`
- `frontend/src/App.css`
- `frontend/src/App.tsx`

Tasks:

- Replace the current purple/dark-leaning theme variables with the white/blue banking palette.
- Update the navbar into a cleaner banking header.
- Add a testnet notice area in the app shell.
- Improve mobile nav stacking and button sizing.
- Keep existing class names where possible to reduce code churn.

Acceptance criteria:

- App visually reads as a light blue/white banking interface.
- Desktop and mobile layouts remain usable.
- Existing routes still render.

### Phase 2: Shared UX Components

Files likely added:

- `frontend/src/components/UiStatePanel.tsx`
- `frontend/src/components/ConfirmationDialog.tsx`
- `frontend/src/components/TransactionFeedback.tsx`
- `frontend/src/hooks/useTransaction.ts`

Tasks:

- Add `UiStatePanel` for loading, empty, error, and retry states.
- Add `ConfirmationDialog` for consequential actions.
- Add `TransactionFeedback` for transaction phase messaging and optional Etherscan links.
- Add `useTransaction` to standardize wallet-signature, submitted, confirming, confirmed, and failed states.

Acceptance criteria:

- Components are reusable and styled consistently with the new theme.
- No existing page behavior is removed.
- Components can be adopted one page at a time.

Status update:

- Added shared `StatusBadge`, `UiStatePanel`, and `TransactionFeedback` components.
- Added shared formatting helpers in `frontend/src/lib/format.ts` for USDC, APR, dates, addresses, interest, progress, and status tones.
- Adopted these shared pieces in the User Dashboard first, while keeping existing transaction toasts.

### Phase 3: User Dashboard Polish

Files likely touched:

- `frontend/src/pages/UserDashboard.tsx`
- `frontend/src/App.css`
- possible new components/helpers under `frontend/src/components/`, `frontend/src/lib/`, and `frontend/src/hooks/`

Tasks:

- Add a friendlier hero/introduction for user savings.
- Add a wallet guidance panel or improve existing wallet messages.
- Add a MockUSDC faucet button using public `MockUSDC.mint(account, amount)`.
- Improve plan cards with banking-product styling.
- Improve deposit cards with clearer lifecycle labels and action grouping.
- Add confirmation dialogs for:
  - Open deposit.
  - Early withdrawal.
  - Maturity withdrawal.
  - Emergency principal withdrawal.
  - Compound renewal.
  - Withdraw interest and renew principal.
  - Deferred interest claim.
- Improve empty states for no wallet, no plans, no active deposits, no history, and no claims.

Acceptance criteria:

- User can still approve and open deposits.
- User can still view active and historical deposits.
- Existing deferred-interest, emergency-withdrawal, and renewal paths still work.
- Faucet makes demo setup easier without needing an external token transfer.

Status update:

- Added a wallet overview panel with connected address, MockUSDC balance, Sepolia readiness, and faucet action.
- Added a portfolio summary for active principal, estimated interest, certificate count, next maturity, and deferred interest.
- Improved plan cards with a more prominent APR, selected-plan state, and status badges.
- Improved deposit cards with maturity progress, remaining time, colored status badges, and clearer action group labels.
- Replaced plain empty states on user plans, active deposits, and history with reusable `UiStatePanel` messages.
- Added inline disabled-action guidance for opening deposits, including no wallet, paused system, no plans, missing amount, and active transaction states.

### Phase 4: Marketplace Polish

Files likely touched:

- `frontend/src/pages/Marketplace.tsx`
- `frontend/src/App.css`

Tasks:

- Apply the same white/blue card system to listings and listable deposits.
- Add friendlier marketplace explanation copy.
- Make terms easier to scan without removing required content.
- Add confirmation dialogs for:
  - List deposit NFT.
  - Buy deposit NFT.
  - Cancel listing.
- Show escrow and ownership implications in plain language.
- Keep pagination and seller listing behavior intact.

Acceptance criteria:

- Public listings, seller listings, listable deposits, listing, buying, and canceling still work.
- Marketplace terms remain visible and accurate.
- Buyer/seller action states are clear.

### Phase 5: Admin Dashboard Polish

Files likely touched:

- `frontend/src/pages/AdminDashboard.tsx`
- `frontend/src/App.css`

Tasks:

- Convert admin page into a banking-style control center.
- Improve metric cards for:
  - Total principal locked.
  - Vault interest fund.
  - Reserved interest.
  - Withdrawable vault.
  - Fee receiver.
  - SavingCore status.
  - VaultManager status.
- Replace `window.prompt` APR editing with an inline form or dialog.
- Add confirmation dialogs for risky actions:
  - Vault withdrawal.
  - Plan disable.
  - Pause and unpause.
  - Fee receiver change if implemented in UI.
- Keep owner/admin permission checks intact.

Acceptance criteria:

- Owner/admin flow remains unchanged at contract level.
- Unauthorized users still see access denied.
- Admin actions are clearer and harder to trigger accidentally.

Status update:

- Reused shared formatting helpers and `StatusBadge` in the admin dashboard.
- Added colored status badges for plan enabled/disabled state, deposit status, audit categories, and contract pause state.
- Added a simplified interest-vault summary showing interest to pay, USDC safe to withdraw, and whether the vault has enough funds to pay reserved interest.
- Added fee receiver update UI with address validation and confirmation before calling `VaultManager.setFeeReceiver`.
- Improved admin table mobile behavior with scroll hints, bordered table containers, hover styling, and tighter small-screen spacing.

### Phase 5A: Admin Deposit Explorer And Audit Logs

Files likely touched:

- `frontend/src/pages/AdminDashboard.tsx`
- `frontend/src/App.css`

Tasks:

- Add an admin-only deposit explorer sourced from `SavingCore.nextDepositId()` and `SavingCore.deposits(depositId)`.
- Show all deposits with status, owner, plan, principal, APR snapshot, penalty snapshot, maturity, and unpaid interest.
- Add filter options for all deposits, active, withdrawn, early withdrawn, manual renewed, auto renewed, deferred interest, and marketplace escrowed.
- Add 5-deposit-per-page pagination.
- Add an event-based audit log for owner/admin actions across `SavingCore`, `VaultManager`, and `DepositMarketplace`.
- Add audit filters for all logs, plans, vault, admin/pause, and marketplace.
- Add 5-log-per-page pagination.
- Include Sepolia Etherscan transaction links for audit entries.

Acceptance criteria:

- Admin can review every deposit without changing contract state.
- Deposit filters update the table and reset pagination.
- Audit logs are sorted newest-first and include transaction links.
- Audit logs are read-only and derived from emitted contract events.

### Phase 6: Helper Extraction And Cleanup

Files likely added or touched:

- `frontend/src/lib/format.ts`
- `frontend/src/lib/finance.ts`
- `frontend/src/lib/address.ts`
- `frontend/src/utils/parseTransactionError.ts`
- dashboard and marketplace pages using these helpers

Tasks:

- Move repeated formatting functions out of page files.
- Centralize:
  - `formatUsdc`.
  - `formatApr`.
  - `formatDate`.
  - `shortenAddress`.
  - `isSameAddress`.
  - `calculateInterest`.
- Keep extraction small and safe. Avoid broad rewrites that make review difficult.

Acceptance criteria:

- No duplicated formatting logic remains in all major pages where easy to remove.
- TypeScript build still passes.

## Suggested Brand Copy

Use a custom identity, not a direct MBBank copy.

Recommended app name:

```text
BlueBank DeFi Savings
```

Alternative app names:

- `DeFi Savings Portal`
- `MB-Inspired DeFi Savings Demo`
- `Term Savings Portal`

Recommended hero copy:

```text
Open fixed-term MockUSDC savings, receive an on-chain certificate, and manage withdrawals, renewals, and marketplace listings from one Sepolia demo portal.
```

Recommended testnet notice:

```text
Sepolia demo only. MockUSDC is freely mintable for testing and has no real-world monetary value.
```

## Validation Commands

Run from `frontend/`:

```bash
npm.cmd run lint
npm.cmd run build
```

If PowerShell execution policy is not blocking `npm.ps1`, normal npm commands are also acceptable:

```bash
npm run lint
npm run build
```

Manual checks:

- Connect MetaMask.
- Switch to Sepolia from wrong network.
- Mint MockUSDC through faucet.
- Approve and open a deposit.
- View active deposit certificate.
- View history toggle.
- Try early withdrawal warning flow.
- View deferred interest state when available.
- View marketplace listings.
- List, buy, and cancel if test accounts and balances are available.
- Access admin page as owner/admin and as unauthorized wallet.
- Confirm mobile layout at narrow width.

## Risks And Constraints

- Do not edit `frontend/src/abi/` manually unless contract ABIs actually changed.
- Do not change contract addresses unless deployments changed.
- Do not change Solidity contracts in this frontend redesign pass.
- Do not remove existing marketplace, deferred-interest, emergency-withdrawal, or admin functionality.
- Avoid introducing a new state-management library.
- Prefer small, reviewable changes over a full rewrite.

## Ready-To-Implement Checklist

- [x] Update theme variables to white/blue banking palette.

- [x] Restyle app shell, navbar, panels, cards, forms, buttons, and messages.

- [x] Add reusable `UiStatePanel`.

- [x] Add reusable `ConfirmationDialog`.

- [x] Add reusable `TransactionFeedback` or `useTransaction`.

- [x] Add MockUSDC faucet to user dashboard.

- [x] Improve user dashboard copy, empty states, and action confirmations.

- [x] Add user wallet balance card, portfolio summary, selected plan states, deposit progress, and disabled-action guidance.

- [x] Improve marketplace copy, terms readability, and action confirmations.

- [x] Improve admin metric cards and replace APR `window.prompt`.

- [x] Add admin status badges, simplified interest-vault summary, fee receiver update UI, and mobile table polish.

- [x] Add admin deposit explorer with filters and 5-item pagination.

- [x] Add admin audit logs with filters, transaction links, and 5-item pagination.

- [x] Extract repeated formatting helpers where safe.

- [x] Run `npm.cmd run lint` from `frontend/`.

- [x] Run `npm.cmd run build` from `frontend/`.

- [ ] Manually verify desktop and mobile layouts.
