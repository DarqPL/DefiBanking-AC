import "dotenv/config";
import { ethers } from "ethers";

async function main() {
  try {
    const provider = new ethers.JsonRpcProvider("https://ethereum-sepolia-rpc.publicnode.com");

    const abi = [
      "function mint(address to) external",
      "function ownerOf(uint256 tokenId) view returns (address)",
      "function nextTokenId() view returns (uint256)",
      "function balanceOf(address owner) view returns (uint256)",
    ];
    const contractAddress = "0x06B7f9676ef6fBE6C84dA1A48850D926901503D6"; // TODO: update after deploy

    const privateKey = process.env.TESTNET_PRIVATE_KEY;
    if (!privateKey) {
      throw new Error("Missing TESTNET_PRIVATE_KEY in .env");
    }

    const wallet = new ethers.Wallet(privateKey, provider);
    const contract = new ethers.Contract(contractAddress, abi, wallet);

    const currentId = await contract.nextTokenId();
    console.log("Current nextTokenId:", currentId.toString());

    console.log("Minting NFT #" + currentId.toString() + " to deployer...");
    const tx = await contract.mint(wallet.address);
    await tx.wait();
    console.log("Mint transaction confirmed!");

    const owner = await contract.ownerOf(currentId);
    console.log("ownerOf(" + currentId.toString() + "):", owner);

    const balance = await contract.balanceOf(wallet.address);
    console.log("Deployer NFT balance:", balance.toString());
  } catch (error) {
    console.error("Error:", error);
  }
}

main();
