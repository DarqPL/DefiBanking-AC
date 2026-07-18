import { ethers, deployments } from "hardhat";
import { StudentRegistryV2 } from "../typechain";

async function main() {
  const [deployer, student1, student2] = await ethers.getSigners();
  console.log("Testing StudentRegistryV2 contract with account:", deployer.address);

  await deployments.fixture(["deploy"]);

  const registry: StudentRegistryV2 = await ethers.getContract("StudentRegistryV2");

  // 1. Check deployment
  const owner = await registry.owner();
  console.log("Owner:", owner);
  if (owner !== deployer.address) throw new Error("Owner mismatch");

  const unregistered = await registry.isStudentRegistered(student1.address);
  console.log("Is student1 registered initially?", unregistered);
  if (unregistered !== false) throw new Error("Should be unregistered initially");

  // 2. Register student1
  let tx = await registry.registerStudent(student1.address, "Alice", 20);
  let receipt = await tx.wait();
  console.log("\nRegistered Alice — tx:", receipt?.hash);

  let registered = await registry.isStudentRegistered(student1.address);
  if (registered !== true) throw new Error("Alice should be registered");

  let s = await registry.getStudent(student1.address);
  console.log("Alice:", s.name, ", age:", s.age.toString(), ", registered:", s.isRegistered);
  if (s.name !== "Alice") throw new Error("Name mismatch");
  if (s.age !== 20n) throw new Error("Age mismatch");
  if (s.isRegistered !== true) throw new Error("isRegistered should be true");

  // 3. Register student2
  tx = await registry.registerStudent(student2.address, "Bob", 22);
  receipt = await tx.wait();
  console.log("\nRegistered Bob — tx:", receipt?.hash);

  s = await registry.getStudent(student2.address);
  console.log("Bob:", s.name, ", age:", s.age.toString(), ", registered:", s.isRegistered);
  if (s.name !== "Bob") throw new Error("Name mismatch");

  // 4. Double register — revert
  try {
    await registry.registerStudent(student1.address, "Alice", 20);
    throw new Error("Should have reverted");
  } catch {
    console.log("\nDuplicate register correctly reverted");
  }

  // 5. Non-owner register — revert
  try {
    await registry.connect(student1).registerStudent(student2.address, "Charlie", 19);
    throw new Error("Should have reverted");
  } catch {
    console.log("Non-owner register correctly reverted");
  }

  // 6. Unregistered address
  const unreg = await registry.isStudentRegistered(deployer.address);
  console.log("\nIs deployer registered?", unreg);
  if (unreg !== false) throw new Error("Deployer should not be registered");

  console.log("\n=== All StudentRegistryV2 contract tests passed! ===");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
