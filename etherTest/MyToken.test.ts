import "dotenv/config";
import { ethers } from "ethers";

async function main() {
  try {
    const provider = new ethers.JsonRpcProvider("https://ethereum-sepolia-rpc.publicnode.com");

    const abi = [
      "function balanceOf(address account) view returns (uint256)",
      "function totalSupply() view returns (uint256)",
    ];
    const contractAddress = "0x64F7f96d89fb18Ceb3aA41C2Fb222c236e52E2AA";

    const privateKey = process.env.TESTNET_PRIVATE_KEY;
    if (!privateKey) {
      throw new Error("Missing TESTNET_PRIVATE_KEY in .env");
    }

    const wallet = new ethers.Wallet(privateKey, provider);
    const contract = new ethers.Contract(contractAddress, abi, wallet);

    const totalSupply = await contract.totalSupply();
    console.log("Total Supply:", ethers.formatUnits(totalSupply, 18), "MTK");

    const balance = await contract.balanceOf(wallet.address);
    console.log("Deployer balance:", ethers.formatUnits(balance, 18), "MTK");

    if (balance === totalSupply) {
      console.log("Deployer holds 100% of total supply");
    } else {
      console.log("There is a mismatch.");
    }
  } catch (error) {
    console.error("Error:", error);
  }
}

main();
