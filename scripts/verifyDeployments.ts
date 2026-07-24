import { HardhatRuntimeEnvironment } from "hardhat/types";
import hre from "hardhat";

const MARKETPLACE_TERMS_HASH = "0x3b66a5c015a29f4b433c579a09d7e3f9be033797349ca7d673571d722c5b8676";
const RETRIES = 3;
const RETRY_DELAY_MS = 15_000;

type VerificationTarget = {
  name: string;
  address: string;
  constructorArguments: unknown[];
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isAlreadyVerified(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.toLowerCase().includes("already verified");
}

async function verifyWithRetry(hre: HardhatRuntimeEnvironment, target: VerificationTarget) {
  for (let attempt = 1; attempt <= RETRIES; attempt += 1) {
    try {
      await hre.run("verify:verify", {
        address: target.address,
        constructorArguments: target.constructorArguments,
      });
      console.log(`Verified ${target.name} at ${target.address}`);
      return;
    } catch (error) {
      if (isAlreadyVerified(error)) {
        console.log(`${target.name} is already verified at ${target.address}`);
        return;
      }

      if (attempt === RETRIES) throw error;

      const message = error instanceof Error ? error.message : String(error);
      console.log(`Verification attempt ${attempt} failed for ${target.name}: ${message}`);
      console.log(`Waiting ${RETRY_DELAY_MS / 1000}s before retrying...`);
      await sleep(RETRY_DELAY_MS);
    }
  }
}

async function buildTargets(hre: HardhatRuntimeEnvironment): Promise<VerificationTarget[]> {
  const { deployments, getNamedAccounts } = hre;
  const { deployer } = await getNamedAccounts();

  const mockUSDC = await deployments.get("MockUSDC");
  const vaultManager = await deployments.get("VaultManager");
  const savingCore = await deployments.get("SavingCore");
  const depositMarketplace = await deployments.get("DepositMarketplace");

  return [
    {
      name: "MockUSDC",
      address: mockUSDC.address,
      constructorArguments: [],
    },
    {
      name: "VaultManager",
      address: vaultManager.address,
      constructorArguments: [mockUSDC.address, deployer],
    },
    {
      name: "SavingCore",
      address: savingCore.address,
      constructorArguments: [mockUSDC.address, vaultManager.address],
    },
    {
      name: "DepositMarketplace",
      address: depositMarketplace.address,
      constructorArguments: [savingCore.address, mockUSDC.address, MARKETPLACE_TERMS_HASH],
    },
  ];
}

export async function verifyDeployments(hre: HardhatRuntimeEnvironment) {
  if (hre.network.name === "hardhat" || hre.network.name === "localhost") {
    console.log(`Skipping verification on ${hre.network.name}.`);
    return;
  }

  if (!process.env.ETHERSCAN_API) {
    console.log("Skipping verification because ETHERSCAN_API is not set.");
    return;
  }

  const targets = await buildTargets(hre);
  for (const target of targets) {
    await verifyWithRetry(hre, target);
  }
}

async function main() {
  await verifyDeployments(hre);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
