import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

const MARKETPLACE_TERMS_HASH = "0x3b66a5c015a29f4b433c579a09d7e3f9be033797349ca7d673571d722c5b8676";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy } = deployments;
  const { deployer } = await getNamedAccounts();

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
};

export default func;

func.tags = ["DepositMarketplace", "all"];
func.dependencies = ["MockUSDC", "SavingCore"];
