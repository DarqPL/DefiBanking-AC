import { Contract, JsonRpcProvider, Wallet } from "ethers";

const DEFAULT_SEPOLIA_RPC_URL = "https://ethereum-sepolia-rpc.publicnode.com";
const DEFAULT_MAX_LISTINGS = 50n;

const MARKETPLACE_ABI = [
  "function cleanListings(uint256[] depositIds) external returns (uint256 cleaned)",
  "function isListingStale(uint256 depositId) external view returns (bool)",
  "function listedCount() external view returns (uint256)",
  "function listedDepositIds(uint256 index) external view returns (uint256)",
];

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

function parseMaxListings(req: VercelRequest): bigint {
  const raw = firstValue(req.query.maxListings) ?? process.env.MARKETPLACE_CLEANUP_MAX_LISTINGS;
  if (!raw) return DEFAULT_MAX_LISTINGS;

  const value = BigInt(raw);
  if (value === 0n) throw new Error("maxListings must be greater than zero");

  return value;
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

  const marketplaceAddress = process.env.MARKETPLACE_ADDRESS;
  if (!marketplaceAddress) {
    return res.status(500).json({ error: "MARKETPLACE_ADDRESS is not configured" });
  }

  let maxListings: bigint;
  try {
    maxListings = parseMaxListings(req);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return res.status(400).json({ error: message });
  }

  const provider = new JsonRpcProvider(process.env.SEPOLIA_RPC_URL || DEFAULT_SEPOLIA_RPC_URL);
  const wallet = new Wallet(botPrivateKey, provider);
  const marketplace = new Contract(marketplaceAddress, MARKETPLACE_ABI, wallet);
  const latestBlock = await provider.getBlock("latest");
  if (!latestBlock) {
    return res.status(500).json({ error: "Unable to read latest block" });
  }

  const dryRun = firstValue(req.query.dryRun) === "1";

  const listedCount = (await marketplace.listedCount()) as bigint;
  const staleDepositIds: bigint[] = [];

  for (let index = 0n; index < listedCount; index += 1n) {
    const depositId = (await marketplace.listedDepositIds(index)) as bigint;
    if ((await marketplace.isListingStale(depositId)) as boolean) {
      staleDepositIds.push(depositId);
    }
  }

  const cleanupDepositIds = staleDepositIds.slice(0, Number(maxListings));

  if (dryRun) {
    return res.status(200).json({
      mode: "dry-run",
      network: "sepolia",
      marketplace: marketplaceAddress,
      bot: wallet.address,
      latestBlockTimestamp: latestBlock.timestamp,
      listedCount: listedCount.toString(),
      maxListings: maxListings.toString(),
      staleCount: staleDepositIds.length.toString(),
      cleanupCount: cleanupDepositIds.length.toString(),
      staleDepositIds: staleDepositIds.map((depositId) => depositId.toString()),
      cleanupDepositIds: cleanupDepositIds.map((depositId) => depositId.toString()),
    });
  }

  if (cleanupDepositIds.length === 0) {
    return res.status(200).json({
      mode: "skip",
      network: "sepolia",
      marketplace: marketplaceAddress,
      bot: wallet.address,
      latestBlockTimestamp: latestBlock.timestamp,
      listedCount: listedCount.toString(),
      maxListings: maxListings.toString(),
      staleCount: staleDepositIds.length.toString(),
      reason: "no stale listings",
    });
  }

  const cleaned = await marketplace.cleanListings.staticCall(cleanupDepositIds);
  const tx = await marketplace.cleanListings(cleanupDepositIds);
  const receipt = await tx.wait();

  return res.status(200).json({
    mode: "send-transaction",
    network: "sepolia",
    marketplace: marketplaceAddress,
    bot: wallet.address,
    latestBlockTimestamp: latestBlock.timestamp,
    listedCount: listedCount.toString(),
    maxListings: maxListings.toString(),
    staleCount: staleDepositIds.length.toString(),
    cleanupCount: cleanupDepositIds.length.toString(),
    cleaned: cleaned.toString(),
    cleanupDepositIds: cleanupDepositIds.map((depositId) => depositId.toString()),
    txHash: receipt?.hash ?? tx.hash,
  });
}
