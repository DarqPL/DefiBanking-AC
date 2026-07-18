import "dotenv/config";
import { ethers } from "ethers";

async function main() {
  try {
    const provider = new ethers.JsonRpcProvider("https://ethereum-sepolia-rpc.publicnode.com");

    const abi = [
      "function getCount() public view returns (uint)",
      "function increment() public"
    ];
    const contractAddress = "0xe1eC91D27dA81f20a731Df4aE5b52F2A2E7F59D5";

    const privateKey = process.env.TESTNET_PRIVATE_KEY;
    if (!privateKey) {
      throw new Error("Missing TESTNET_PRIVATE_KEY in .env");
    }

    const wallet = new ethers.Wallet(privateKey, provider);
    const contract = new ethers.Contract(contractAddress, abi, wallet);

    const countBefore = await contract.getCount();
    console.log("Count before increment:", countBefore.toString());

    const tx = await contract.increment();
    console.log("Transaction hash:", tx.hash);

    const receipt = await tx.wait();
    console.log("Transaction confirmed in block:", receipt?.blockNumber);

    const countAfter = await contract.getCount();
    console.log("Count after increment:", countAfter.toString());
  } catch (error) {
    console.error("Error:", error);
  }
}

main();