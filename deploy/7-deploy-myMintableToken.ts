import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts, ethers } = hre;
  const { deploy } = deployments;
  const { deployer } = await getNamedAccounts();

  console.log("====================");
  console.log(hre.network.name);
  console.log("====================");

  console.log("====================");
  console.log("Deploy MyMintableToken Contract");
  console.log("====================");

  const deployResult = await deploy("MyMintableToken", {
    contract: "MyMintableToken",
    args: [],
    from: deployer,
    log: true,
    autoMine: true,
    skipIfAlreadyDeployed: false,
  });

  console.log("MyMintableToken deployed at:", deployResult.address);

  const myMintableToken = await ethers.getContractAt("MyMintableToken", deployResult.address);
  const deployerSigner = await ethers.getSigner(deployer);

  const mintAmount = 1000n * 10n ** 18n;
  console.log("Minting 1000 MMT to deployer...");
  const tx = await myMintableToken.connect(deployerSigner).mint(deployer, mintAmount);
  await tx.wait();

  const balance = await myMintableToken.balanceOf(deployer);
  console.log("Deployer balance:", balance.toString(), "MMT");
};

func.tags = ["deploy", "MyMintableToken"];
export default func;
