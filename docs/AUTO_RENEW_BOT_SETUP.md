# Auto-Renew Bot Setup

## Selected Design

The auto-renew bot now uses a Vercel API endpoint plus cron-job.org.

- `api/auto-renew.ts` exposes `/api/auto-renew` on Vercel.
- cron-job.org calls the endpoint every 15 minutes.
- The endpoint connects to Sepolia, scans active deposits, and calls `SavingCore.autoRenewDeposit(depositId)` for eligible deposits.
- `.github/workflows/auto-renew-bot.yml` remains as a 15-minute scheduled fallback in case Vercel or cron-job.org goes down.

This design is preferred as the primary bot because GitHub scheduled workflows can be delayed by the shared execution queue. The GitHub workflow is still useful as a backup runner.

## Required Environment Variables

Configure these in Vercel Project Settings > Environment Variables:

- `BOT_PRIVATE_KEY`: Private key of the Sepolia bot wallet that pays gas.
- `CRON_SECRET`: Secret used to protect `/api/auto-renew` from public calls.

Optional:

- `SEPOLIA_RPC_URL`: Custom Sepolia RPC URL. If omitted, the endpoint uses the public Sepolia RPC from the code.

The bot wallet must have Sepolia ETH for gas.

## Vercel Setup

1. Deploy this repository to Vercel.
2. Keep the Vercel project root as the repository root, not `frontend/`, so the root `api/` folder is deployed.
3. Use the root `vercel.json` to build the frontend from `frontend/` and serve `frontend/dist`.
4. Add `BOT_PRIVATE_KEY`, `CRON_SECRET`, and optionally `SEPOLIA_RPC_URL` in Vercel environment variables.
5. Redeploy after adding or changing environment variables.
6. Test the endpoint manually with dry-run mode:

```text
https://<your-project-name>.vercel.app/api/auto-renew?secret=<CRON_SECRET>&dryRun=1
```

If `CRON_SECRET` contains special URL characters such as `#`, `&`, `?`, `%`, `+`, or spaces, URL-encode it before putting it in the query string. Otherwise the browser may split or truncate the secret and the endpoint will return `Unauthorized`.

For example, this secret:

```text
abc#123&xyz
```

must be sent as:

```text
abc%23123%26xyz
```

The endpoint also accepts `?cronSecret=<CRON_SECRET>`, an `x-cron-secret` header, or an `Authorization: Bearer <CRON_SECRET>` header.

Expected response shape:

```json
{
  "mode": "dry-run",
  "network": "sepolia",
  "checked": 1,
  "eligible": 0,
  "renewed": 0,
  "failed": 0,
  "results": []
}
```

The root `vercel.json` keeps both pieces working together:

- `/api/auto-renew` is served by the root Vercel API function.
- `/` and other frontend routes are served from `frontend/dist`.
- Non-API routes rewrite to `/index.html` for the Vite single-page app.

## cron-job.org Setup

1. Create a free account at `https://cron-job.org`.
2. Create a new cron job.
3. Set the URL to:

```text
https://<your-project-name>.vercel.app/api/auto-renew?secret=<CRON_SECRET>
```

4. Set the schedule to every 15 minutes.
5. Use `GET` as the request method.
6. Enable notifications for failed runs if desired.
7. Save and run the job once manually to confirm it works.

## Endpoint Security

The endpoint rejects requests unless one of these matches `CRON_SECRET`:

- Query string: `?secret=<CRON_SECRET>`.
- Query string: `?cronSecret=<CRON_SECRET>`.
- Header: `x-cron-secret: <CRON_SECRET>`.
- Authorization header: `Bearer <CRON_SECRET>`.

cron-job.org can use the query-string version for easiest setup. If a different scheduler supports custom headers, the header options are cleaner because the secret is not visible in the URL.

## Bot Behavior

For each request, the endpoint:

- Reads `SavingCore.nextDepositId()`.
- Scans deposit IDs from `0` to `nextDepositId - 1` because the first deposit NFT id is `0`.
- Reads each deposit from `SavingCore.deposits(depositId)`.
- Skips deposits that are not `Active`.
- Reads each active deposit's original plan status with a per-run cache.
- Skips deposits whose original plan is disabled, so the bot does not waste gas on renewals the contract will reject.
- Checks `block.timestamp >= maturityAt + AUTO_RENEW_GRACE_PERIOD`.
- Calculates `principal + interest` and skips deposits whose compounded principal is outside the original plan's min/max limits, so a permanent max-limit breach does not consume gas in later runs.
- Calls `autoRenewDeposit(depositId)` for eligible deposits.
- Continues scanning even if one renewal fails.
- Returns a JSON summary with checked, eligible, renewed, and failed counts.

The full-scan design is simple and appropriate for the current assignment/demo deployment. A production deployment with many deposits should use event indexing, batching, or a dedicated keeper/indexer.

## Timing Notes

The bot cannot renew at the exact second of the grace-period deadline. cron-job.org calls the endpoint every 15 minutes, and the renewal transaction still needs to be mined. The practical behavior is renewal shortly after `maturityAt + AUTO_RENEW_GRACE_PERIOD`.

## Dead Bot Case

If cron-job.org, Vercel, or the bot wallet fails, deposits do not lose principal or earned interest. They remain active until someone interacts with them.

The contract keeps `autoRenewDeposit` permissionless, so any caller can trigger an eligible auto-renewal. The NFT owner can also withdraw at maturity or manually renew before auto-renew is executed.

## APR Rule

Admin APR updates do not change the APR of an already active deposit. Each deposit stores `aprBpsAtOpen`, and interest for that term is calculated from that snapshot.

Manual renew and auto-renew intentionally use different APR rules:

- Manual renew creates a new deposit using the selected new plan's current APR.
- Auto-renew creates a new deposit using the old deposit's original APR snapshot only while the original plan remains enabled.

This matches the assignment rule that auto-renew protects the user from an admin lowering the APR before the bot renews the deposit.
If the admin disables the original plan, both the bot and contract block auto-renew because disabling a plan closes it for future terms.

## Plan Limit Rule

Auto-renew compounds earned interest into the new principal. If the original plan has a maximum deposit and `principal + interest` exceeds that maximum, the contract rejects auto-renew with `NewPrincipalOutOfRange`.

The bot pre-checks this deterministic condition before sending a transaction. Such deposits are returned as `skipped-new-principal-out-of-range` and remain active for the NFT owner to withdraw, manually renew into a suitable plan, or withdraw interest while continuing only the principal.
