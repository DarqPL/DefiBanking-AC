import { ethers } from "hardhat";
import { MyMintableToken } from "../typechain";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Interacting with MyMintableToken from account:", deployer.address);

  const myMintableToken: MyMintableToken = await ethers.getContract("MyMintableToken");

  const mintAmount = 1000n * 10n ** 18n;
  console.log("Minting 1000 MMT to deployer...");
  const tx = await myMintableToken.mint(deployer.address, mintAmount);
  await tx.wait();

  const balance = await myMintableToken.balanceOf(deployer.address);
  console.log("Deployer balance:", balance.toString(), "MMT");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
