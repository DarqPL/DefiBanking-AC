import hre from "hardhat";
import { verifyDeployments } from "./verifyDeployments";

async function main() {
  await hre.run("deploy");
  await verifyDeployments(hre);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
