import { deployments, ethers, network } from "hardhat";
import { Wallet } from "ethers";

const DEPOSIT_STATUS_ACTIVE = 1;

async function main() {
  if (network.name !== "sepolia") {
    throw new Error(`autoRenewBot is intended for sepolia, received network: ${network.name}`);
  }

  const dryRun = process.env.AUTO_RENEW_DRY_RUN === "1";
  const botPrivateKey = process.env.BOT_PRIVATE_KEY;
  const bot = botPrivateKey ? new Wallet(botPrivateKey, ethers.provider) : undefined;
  if (!bot && !dryRun) {
    throw new Error("No bot signer configured. Set BOT_PRIVATE_KEY before running the bot.");
  }

  const savingCoreDeployment = await deployments.get("SavingCore");
  const savingCore = await ethers.getContractAt("SavingCore", savingCoreDeployment.address, bot ?? ethers.provider);
  const latestBlock = await ethers.provider.getBlock("latest");
  if (!latestBlock) throw new Error("Unable to read latest block");

  const now = BigInt(latestBlock.timestamp);
  const gracePeriod = await savingCore.AUTO_RENEW_GRACE_PERIOD();
  const nextDepositId = await savingCore.nextDepositId();

  let checked = 0;
  let eligible = 0;
  let renewed = 0;
  let failed = 0;

  console.log(`Auto-renew bot running on ${network.name}`);
  console.log(`Mode: ${dryRun ? "dry run" : "send transactions"}`);
  console.log(`Bot signer: ${bot?.address ?? "not configured"}`);
  console.log(`SavingCore: ${savingCoreDeployment.address}`);
  console.log(`Latest block timestamp: ${latestBlock.timestamp}`);

  for (let depositId = 0n; depositId < nextDepositId; depositId++) {
    checked += 1;

    const deposit = await savingCore.deposits(depositId);
    if (Number(deposit.status) !== DEPOSIT_STATUS_ACTIVE) continue;

    const renewAfter = BigInt(deposit.maturityAt) + gracePeriod;
    if (now < renewAfter) continue;

    eligible += 1;

    if (dryRun) {
      console.log(`Dry run: deposit ${depositId.toString()} is eligible for auto-renew`);
      continue;
    }

    try {
      console.log(`Renewing deposit ${depositId.toString()}...`);
      const tx = await savingCore.autoRenewDeposit(depositId);
      const receipt = await tx.wait();
      renewed += 1;
      console.log(`Renewed deposit ${depositId.toString()} in tx ${receipt?.hash ?? tx.hash}`);
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.log(`Failed to renew deposit ${depositId.toString()}: ${message}`);
    }
  }

  console.log(`Checked deposits: ${checked}`);
  console.log(`Eligible deposits: ${eligible}`);
  console.log(`Renewed deposits: ${renewed}`);
  console.log(`Failed renewals: ${failed}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
