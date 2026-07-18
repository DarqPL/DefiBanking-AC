import { ethers, deployments } from "hardhat";
import { Voting } from "../typechain";

async function main() {
  const [deployer, voter1, voter2] = await ethers.getSigners();
  console.log("Testing Voting contract with account:", deployer.address);

  // Re-run deploy scripts to ensure contract is deployed
  await deployments.fixture(["deploy"]);

  const voting: Voting = await ethers.getContract("Voting");

  // 1. Check deployment
  const owner = await voting.owner();
  console.log("Owner:", owner);
  if (owner !== deployer.address) throw new Error("Owner mismatch");

  let candidatesCount = await voting.candidatesCount();
  console.log("Initial candidatesCount:", candidatesCount.toString());
  if (candidatesCount !== 0n) throw new Error("Candidates count should be 0");

  // 2. Add candidates
  const tx1 = await voting.addCandidate("Alice");
  await tx1.wait();
  console.log("Added candidate: Alice");

  const tx2 = await voting.addCandidate("Bob");
  await tx2.wait();
  console.log("Added candidate: Bob");

  candidatesCount = await voting.candidatesCount();
  if (candidatesCount !== 2n) throw new Error("Candidates count should be 2");

  const alice = await voting.candidates(0);
  console.log("Candidate 0:", alice.name, "- votes:", alice.voteCount.toString());
  if (alice.name !== "Alice") throw new Error("Candidate 0 name mismatch");
  if (alice.voteCount !== 0n) throw new Error("Candidate 0 vote count should be 0");

  // 3. Vote
  const tx3 = await voting.connect(voter1).vote(0);
  await tx3.wait();
  console.log(voter1.address, "voted for Alice");

  const hasVoted = await voting.hasVoted(voter1.address);
  if (hasVoted !== true) throw new Error("Voter should have voted");

  const aliceAfter = await voting.candidates(0);
  console.log("Alice votes after:", aliceAfter.voteCount.toString());
  if (aliceAfter.voteCount !== 1n) throw new Error("Alice vote count should be 1");

  // 4. Check double vote reverts
  try {
    await voting.connect(voter1).vote(0);
    throw new Error("Should have reverted");
  } catch {
    console.log("Double vote correctly reverted");
  }

  // 5. Check invalid candidate reverts
  try {
    await voting.connect(voter2).vote(99);
    throw new Error("Should have reverted");
  } catch {
    console.log("Invalid candidate vote correctly reverted");
  }

  // 6. Check non-owner addCandidate reverts
  try {
    await voting.connect(voter1).addCandidate("Charlie");
    throw new Error("Should have reverted");
  } catch {
    console.log("Non-owner addCandidate correctly reverted");
  }

  // 7. Vote for another candidate
  const tx4 = await voting.connect(voter2).vote(1);
  await tx4.wait();
  console.log(voter2.address, "voted for Bob");

  const bob = await voting.candidates(1);
  console.log("Bob votes:", bob.voteCount.toString());
  if (bob.voteCount !== 1n) throw new Error("Bob vote count should be 1");

  console.log("\n=== All Voting contract tests passed! ===");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
