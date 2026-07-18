import { ethers, deployments } from "hardhat";
import { VotingKeccak } from "../typechain";

const keccakId = (name: string) => ethers.solidityPackedKeccak256(["string"], [name]);

async function main() {
  const [deployer, voter1, voter2] = await ethers.getSigners();
  console.log("Testing VotingKeccak contract with account:", deployer.address);

  await deployments.fixture(["deploy"]);

  const voting: VotingKeccak = await ethers.getContract("VotingKeccak");

  // 1. Check deployment
  const owner = await voting.owner();
  console.log("Owner:", owner);
  if (owner !== deployer.address) throw new Error("Owner mismatch");

  let count = await voting.getCandidatesCount();
  console.log("Initial candidates count:", count.toString());
  if (count !== 0n) throw new Error("Candidates count should be 0");

  // 2. Add candidates
  const tx1 = await voting.addCandidate("Alice");
  await tx1.wait();
  console.log("Added candidate: Alice (id:", keccakId("Alice"), ")");

  const tx2 = await voting.addCandidate("Bob");
  await tx2.wait();
  console.log("Added candidate: Bob (id:", keccakId("Bob"), ")");

  count = await voting.getCandidatesCount();
  if (count !== 2n) throw new Error("Candidates count should be 2");

  // 3. Verify using keccak256 IDs
  const aliceId = keccakId("Alice");
  const exists = await voting.candidateExists(aliceId);
  if (exists !== true) throw new Error("Alice should exist");

  const alice = await voting.candidates(aliceId);
  console.log("Candidate Alice:", alice.name, "- votes:", alice.voteCount.toString());
  if (alice.name !== "Alice") throw new Error("Alice name mismatch");
  if (alice.voteCount !== 0n) throw new Error("Alice vote count should be 0");

  // 4. Vote using keccak256 ID
  const tx3 = await voting.connect(voter1).vote(aliceId);
  await tx3.wait();
  console.log(voter1.address, "voted for Alice");

  const hasVoted = await voting.hasVoted(voter1.address);
  if (hasVoted !== true) throw new Error("Voter should have voted");

  const aliceAfter = await voting.candidates(aliceId);
  console.log("Alice votes after:", aliceAfter.voteCount.toString());
  if (aliceAfter.voteCount !== 1n) throw new Error("Alice vote count should be 1");

  // 5. Check double vote reverts
  try {
    await voting.connect(voter1).vote(aliceId);
    throw new Error("Should have reverted");
  } catch {
    console.log("Double vote correctly reverted");
  }

  // 6. Check invalid candidate (random keccak) reverts
  const fakeId = ethers.solidityPackedKeccak256(["string", "uint"], ["fake", 999]);
  try {
    await voting.connect(voter2).vote(fakeId);
    throw new Error("Should have reverted");
  } catch {
    console.log("Invalid candidate vote correctly reverted");
  }

  // 7. Check non-owner addCandidate reverts
  try {
    await voting.connect(voter1).addCandidate("Charlie");
    throw new Error("Should have reverted");
  } catch {
    console.log("Non-owner addCandidate correctly reverted");
  }

  // 8. Vote for Bob using his keccak ID
  const bobId = keccakId("Bob");
  const tx4 = await voting.connect(voter2).vote(bobId);
  await tx4.wait();
  console.log(voter2.address, "voted for Bob");

  const bob = await voting.candidates(bobId);
  console.log("Bob votes:", bob.voteCount.toString());
  if (bob.voteCount !== 1n) throw new Error("Bob vote count should be 1");

  // 9. Verify candidate IDs array
  const ids = await voting.getCandidateIds();
  console.log("Stored candidate IDs:", ids);
  if (ids.length !== 2) throw new Error("Should have 2 candidate IDs");

  console.log("\n=== All VotingKeccak contract tests passed! ===");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
