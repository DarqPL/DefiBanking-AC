import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy } = deployments;
  const { deployer } = await getNamedAccounts();

  const mockUSDC = await deployments.get("MockUSDC");

  await deploy("VaultManager", {
    from: deployer,
    args: [mockUSDC.address, deployer],
    log: true,
  });
};

export default func;

func.tags = ["VaultManager", "all"];
