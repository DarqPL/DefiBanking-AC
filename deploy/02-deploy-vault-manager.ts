import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy } = deployments;
  const { deployer } = await getNamedAccounts();
  const protocolAdmin = process.env.PROTOCOL_ADMIN ?? deployer;

  const mockUSDC = await deployments.get("MockUSDC");

  const vaultManager = await deploy("VaultManager", {
    from: deployer,
    args: [mockUSDC.address, deployer],
    log: true,
  });

  const vaultManagerContract = await hre.ethers.getContractAt("VaultManager", vaultManager.address);
  if ((await vaultManagerContract.admin()).toLowerCase() !== protocolAdmin.toLowerCase()) {
    const tx = await vaultManagerContract.setAdmin(protocolAdmin);
    await tx.wait();
    console.log(`VaultManager admin set to ${protocolAdmin}`);
  }
};

export default func;

func.tags = ["VaultManager", "all"];
