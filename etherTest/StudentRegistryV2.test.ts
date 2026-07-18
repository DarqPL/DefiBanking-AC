import "dotenv/config";
import { ethers } from "ethers";

// ===== CONFIG: Update these before running =====
const CONTRACT_ADDRESS = "0x01bE3905f5de558d0Fe603B26467466c1395F9a1";
const RPC_URL = "https://ethereum-sepolia-rpc.publicnode.com";
// ===============================================

const abi = [
  "function owner() view returns (address)",
  "function registerStudent(address _student, string calldata _name, uint _age)",
  "function getStudent(address _student) view returns (string name, uint age, bool isRegistered)",
  "function isStudentRegistered(address _student) view returns (bool)",
  "event StudentAdded(address indexed studentAddress, string name, uint age)",
];

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC_URL);

  const pkOwner = process.env.TESTNET_PRIVATE_KEY;
  const pkStudent1 = process.env.TESTNET_PRIVATE_KEY2;
  const pkStudent2 = process.env.TESTNET_PRIVATE_KEY3;

  if (!pkOwner || !pkStudent1 || !pkStudent2) {
    throw new Error("Missing private keys in .env (TESTNET_PRIVATE_KEY, TESTNET_PRIVATE_KEY2, TESTNET_PRIVATE_KEY3)");
  }

  const owner = new ethers.Wallet(pkOwner, provider);
  const student1 = new ethers.Wallet(pkStudent1, provider);
  const student2 = new ethers.Wallet(pkStudent2, provider);

  const contract = new ethers.Contract(CONTRACT_ADDRESS, abi, owner);

  console.log("=== StudentRegistryV2 Contract Test ===");
  console.log("Owner address:", owner.address);
  console.log("Student1 address:", student1.address);
  console.log("Student2 address:", student2.address);

  // 1. owner()
  const contractOwner = await contract.owner();
  console.log("\n1. owner():", contractOwner);
  if (contractOwner !== owner.address) throw new Error("Owner mismatch");

  // 2. isStudentRegistered — unregistered
  let reg = await contract.isStudentRegistered(student1.address);
  console.log("2. Is student1 registered initially?", reg);
  if (reg !== false) throw new Error("Should be false");

  // 3. getStudent — default values
  let s = await contract.getStudent(student1.address);
  console.log("3. getStudent(student1): name='", s.name, "', age=", s.age.toString(), ", registered=", s.isRegistered);
  if (s.isRegistered !== false) throw new Error("Should be unregistered");

  // 4. registerStudent — owner registers student1
  let tx = await contract.registerStudent(student1.address, "Alice", 20);
  let receipt = await tx.wait();
  console.log("4. Registered Alice — tx:", receipt?.hash);

  reg = await contract.isStudentRegistered(student1.address);
  if (reg !== true) throw new Error("Alice should be registered");

  s = await contract.getStudent(student1.address);
  console.log("   getStudent: name=", s.name, ", age=", s.age.toString());
  if (s.name !== "Alice") throw new Error("Name mismatch");
  if (s.age !== 20n) throw new Error("Age mismatch");

  // 5. registerStudent — owner registers student2
  tx = await contract.registerStudent(student2.address, "Bob", 22);
  receipt = await tx.wait();
  console.log("5. Registered Bob — tx:", receipt?.hash);

  s = await contract.getStudent(student2.address);
  console.log("   getStudent: name=", s.name, ", age=", s.age.toString());
  if (s.name !== "Bob") throw new Error("Name mismatch");
  if (s.age !== 22n) throw new Error("Age mismatch");

  // 6. duplicate register — revert
  try {
    await contract.registerStudent(student1.address, "Alice", 20);
    throw new Error("Should have reverted");
  } catch {
    console.log("6. Duplicate register correctly reverted");
  }

  // 7. non-owner register — revert
  try {
    await contract.connect(student1).registerStudent(student2.address, "Charlie", 19);
    throw new Error("Should have reverted");
  } catch {
    console.log("7. Non-owner register correctly reverted");
  }

  console.log("\n=== All StudentRegistryV2 contract tests passed! ===");
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exitCode = 1;
});
