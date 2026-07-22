import { Contract, JsonRpcProvider, Wallet } from "ethers";
import savingCoreDeployment from "../deployments/sepolia/SavingCore.json";

const DEPOSIT_STATUS_ACTIVE = 1;
const DEFAULT_SEPOLIA_RPC_URL = "https://ethereum-sepolia-rpc.publicnode.com";

type VercelRequest = {
  method?: string;
  query: Record<string, string | string[] | undefined>;
  headers: Record<string, string | string[] | undefined>;
};

type VercelResponse = {
  status: (statusCode: number) => VercelResponse;
  json: (body: unknown) => void;
  setHeader: (name: string, value: string) => void;
};

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function normalizeSecret(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function isAuthorized(req: VercelRequest): boolean {
  const cronSecret = normalizeSecret(process.env.CRON_SECRET);
  if (!cronSecret) return false;

  const querySecret = normalizeSecret(firstValue(req.query.secret) ?? firstValue(req.query.cronSecret));
  const headerSecret = normalizeSecret(firstValue(req.headers["x-cron-secret"]));
  const authorization = normalizeSecret(firstValue(req.headers.authorization));
  const bearerSecret = authorization?.startsWith("Bearer ") ? normalizeSecret(authorization.slice("Bearer ".length)) : undefined;

  return querySecret === cronSecret || headerSecret === cronSecret || bearerSecret === cronSecret;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!isAuthorized(req)) {
    return res.status(401).json({
      error: "Unauthorized",
      hint: "Pass ?secret=<CRON_SECRET> or an x-cron-secret/Bearer header that exactly matches the Vercel CRON_SECRET value.",
    });
  }

  const botPrivateKey = process.env.BOT_PRIVATE_KEY;
  if (!botPrivateKey) {
    return res.status(500).json({ error: "BOT_PRIVATE_KEY is not configured" });
  }

  const provider = new JsonRpcProvider(process.env.SEPOLIA_RPC_URL || DEFAULT_SEPOLIA_RPC_URL);
  const wallet = new Wallet(botPrivateKey, provider);
  const savingCore = new Contract(savingCoreDeployment.address, savingCoreDeployment.abi, wallet);
  const latestBlock = await provider.getBlock("latest");
  if (!latestBlock) {
    return res.status(500).json({ error: "Unable to read latest block" });
  }

  const now = BigInt(latestBlock.timestamp);
  const gracePeriod = await savingCore.AUTO_RENEW_GRACE_PERIOD();
  const nextDepositId = await savingCore.nextDepositId();
  const dryRun = firstValue(req.query.dryRun) === "1";

  const results = [];
  let checked = 0;
  let eligible = 0;
  let renewed = 0;
  let failed = 0;
  const planEnabledCache = new Map<string, boolean>();

  async function isPlanEnabled(planId: bigint): Promise<boolean> {
    const key = planId.toString();
    const cached = planEnabledCache.get(key);
    if (cached !== undefined) return cached;

    const plan = await savingCore.savingPlans(planId);
    planEnabledCache.set(key, plan.enabled);
    return plan.enabled;
  }

  for (let depositId = 0n; depositId < nextDepositId; depositId++) {
    checked += 1;

    const deposit = await savingCore.deposits(depositId);
    if (Number(deposit.status) !== DEPOSIT_STATUS_ACTIVE) continue;
    if (!(await isPlanEnabled(deposit.planId))) continue;

    const renewAfter = BigInt(deposit.maturityAt) + gracePeriod;
    if (now < renewAfter) continue;

    eligible += 1;

    if (dryRun) {
      results.push({ depositId: depositId.toString(), status: "eligible-dry-run" });
      continue;
    }

    try {
      const tx = await savingCore.autoRenewDeposit(depositId);
      const receipt = await tx.wait();
      renewed += 1;
      results.push({ depositId: depositId.toString(), status: "renewed", txHash: receipt?.hash ?? tx.hash });
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      results.push({ depositId: depositId.toString(), status: "failed", error: message });
    }
  }

  return res.status(200).json({
    mode: dryRun ? "dry-run" : "send-transactions",
    network: "sepolia",
    savingCore: savingCoreDeployment.address,
    bot: wallet.address,
    latestBlockTimestamp: latestBlock.timestamp,
    checked,
    eligible,
    renewed,
    failed,
    results,
  });
}
