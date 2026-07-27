import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

const METADATA_IMAGE_URI = "https://gray-solid-damselfly-388.mypinata.cloud/ipfs/bafybeihzzgfeo5tp2zrjtczo3jn5zke5yhjntthlnir2g3duhitfnotlbe";
const DEFAULT_TENOR_SECONDS = 180 * 24 * 60 * 60;

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, ethers, getNamedAccounts } = hre;
  const { deploy } = deployments;
  const { deployer } = await getNamedAccounts();
  const protocolAdmin = process.env.PROTOCOL_ADMIN ?? deployer;

  const mockUSDC = await deployments.get("MockUSDC");
  const vaultManager = await deployments.get("VaultManager");

  const savingCore = await deploy("SavingCore", {
    from: deployer,
    args: [mockUSDC.address, vaultManager.address],
    log: true,
  });

  const vaultManagerContract = await ethers.getContractAt("VaultManager", vaultManager.address);
  if ((await vaultManagerContract.savingCore()) !== savingCore.address) {
    const tx = await vaultManagerContract.setSavingCore(savingCore.address);
    await tx.wait();
  }

  if (!(await vaultManagerContract.savingCoreLocked())) {
    const tx = await vaultManagerContract.lockSavingCore();
    await tx.wait();
    console.log(`VaultManager SavingCore locked to ${savingCore.address}`);
  }

  const savingCoreContract = await ethers.getContractAt("SavingCore", savingCore.address);
  if ((await savingCoreContract.admin()).toLowerCase() !== protocolAdmin.toLowerCase()) {
    const tx = await savingCoreContract.setAdmin(protocolAdmin);
    await tx.wait();
    console.log(`SavingCore admin set to ${protocolAdmin}`);
  }

  const currentMetadataImageURI = await savingCoreContract.metadataImageURI();
  if (currentMetadataImageURI !== METADATA_IMAGE_URI) {
    if (await savingCoreContract.metadataLocked()) {
      throw new Error(`SavingCore metadata is locked with image URI: ${currentMetadataImageURI}`);
    }

    const tx = await savingCoreContract.setMetadataImageURI(METADATA_IMAGE_URI);
    await tx.wait();
    console.log(`SavingCore metadata image URI set to ${METADATA_IMAGE_URI}`);
  }

  if ((await savingCoreContract.nextPlanId()) === 0n) {
    const tx = await savingCoreContract.createPlan(DEFAULT_TENOR_SECONDS, 225, 1_000_000, 10_000_000_000, 650, true);
    await tx.wait();
  }

  const configuredGraceSeconds = process.env.AUTO_RENEW_GRACE_SECONDS;
  if (configuredGraceSeconds !== undefined) {
    const graceSeconds = BigInt(configuredGraceSeconds);
    if ((await savingCoreContract.autoRenewGracePeriod()) !== graceSeconds) {
      const tx = await savingCoreContract.setAutoRenewGracePeriod(graceSeconds);
      await tx.wait();
      console.log(`SavingCore auto-renew grace set to ${graceSeconds.toString()} seconds`);
    }
  }
};

export default func;

func.tags = ["SavingCore", "all"];
func.dependencies = ["MockUSDC", "VaultManager"];
