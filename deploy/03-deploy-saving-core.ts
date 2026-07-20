import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, ethers, getNamedAccounts } = hre;
  const { deploy } = deployments;
  const { deployer } = await getNamedAccounts();

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

  const savingCoreContract = await ethers.getContractAt("SavingCore", savingCore.address);
  if ((await savingCoreContract.nextPlanId()) === 0n) {
    const tx = await savingCoreContract.createPlan(180, 225, 1_000_000, 10_000_000_000, 650, true);
    await tx.wait();
  }
};

export default func;

func.tags = ["SavingCore", "all"];
func.dependencies = ["MockUSDC", "VaultManager"];
