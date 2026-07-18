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
  console.log("Deploy MyNFT Contract");
  console.log("====================");

  const deployResult = await deploy("MyNFT", {
    contract: "MyNFT",
    args: [],
    from: deployer,
    log: true,
    autoMine: true,
    skipIfAlreadyDeployed: false,
  });

  console.log("MyNFT deployed at:", deployResult.address);

  const myNFT = await ethers.getContractAt("MyNFT", deployResult.address);
  const deployerSigner = await ethers.getSigner(deployer);

  console.log("Minting NFT #0 to deployer...");
  const tx = await myNFT.connect(deployerSigner).mint(deployer);
  await tx.wait();

  const owner0 = await myNFT.ownerOf(0);
  console.log("ownerOf(0):", owner0);
  console.log("NFT #0 minted successfully!");
};

func.tags = ["deploy", "MyNFT"];
export default func;
