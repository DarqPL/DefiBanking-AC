import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

const MARKETPLACE_TERMS_HASH = "0x3b66a5c015a29f4b433c579a09d7e3f9be033797349ca7d673571d722c5b8676";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy } = deployments;
  const { deployer } = await getNamedAccounts();
  const protocolAdmin = process.env.PROTOCOL_ADMIN ?? deployer;

  const mockUSDC = await deployments.get("MockUSDC");
  const savingCore = await deployments.get("SavingCore");

  const marketplace = await deploy("DepositMarketplace", {
    from: deployer,
    args: [savingCore.address, mockUSDC.address, MARKETPLACE_TERMS_HASH],
    log: true,
  });

  const savingCoreContract = await hre.ethers.getContractAt("SavingCore", savingCore.address);
  const currentMarketplace = await savingCoreContract.depositMarketplace();
  if (currentMarketplace.toLowerCase() !== marketplace.address.toLowerCase()) {
    const tx = await savingCoreContract.setDepositMarketplace(marketplace.address);
    await tx.wait();
    console.log(`SavingCore marketplace set to ${marketplace.address}`);
  }

  if (!(await savingCoreContract.depositMarketplaceLocked())) {
    const tx = await savingCoreContract.lockDepositMarketplace();
    await tx.wait();
    console.log(`SavingCore marketplace locked to ${marketplace.address}`);
  }

  const marketplaceContract = await hre.ethers.getContractAt("DepositMarketplace", marketplace.address);
  if ((await marketplaceContract.admin()).toLowerCase() !== protocolAdmin.toLowerCase()) {
    const tx = await marketplaceContract.setAdmin(protocolAdmin);
    await tx.wait();
    console.log(`DepositMarketplace admin set to ${protocolAdmin}`);
  }
};

export default func;

func.tags = ["DepositMarketplace", "all"];
func.dependencies = ["MockUSDC", "SavingCore"];
