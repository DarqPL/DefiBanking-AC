import "dotenv/config";
import { ethers } from "ethers";

// ===== CONFIG: Update these before running =====
const CONTRACT_ADDRESS = "0x864B4F7945d6DbCfC3d86D8F5507Fd216Cc82F66";
const RPC_URL = "https://ethereum-sepolia-rpc.publicnode.com";
// ===============================================

const abi = [
  "function owner() view returns (address)",
  "function candidatesCount() view returns (uint256)",
  "function candidates(uint256) view returns (string name, uint256 voteCount)",
  "function hasVoted(address) view returns (bool)",
  "function addCandidate(string calldata _name)",
  "function vote(uint256 _candidateId)",
  "event CandidateAdded(uint256 candidateId, string name)",
  "event Voted(address indexed voter, uint256 candidateId)",
];

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC_URL);

  const pkOwner = process.env.TESTNET_PRIVATE_KEY;
  const pkVoter1 = process.env.TESTNET_PRIVATE_KEY2;
  const pkVoter2 = process.env.TESTNET_PRIVATE_KEY3;
  const pkVoter3 = process.env.TESTNET_PRIVATE_KEY4;

  if (!pkOwner || !pkVoter1 || !pkVoter2 || !pkVoter3) {
    throw new Error(
      "Missing private keys in .env (TESTNET_PRIVATE_KEY, TESTNET_PRIVATE_KEY2, TESTNET_PRIVATE_KEY3, TESTNET_PRIVATE_KEY4)"
    );
  }

  const owner = new ethers.Wallet(pkOwner, provider);
  const voter1 = new ethers.Wallet(pkVoter1, provider);
  const voter2 = new ethers.Wallet(pkVoter2, provider);
  const voter3 = new ethers.Wallet(pkVoter3, provider);

  const contract = new ethers.Contract(CONTRACT_ADDRESS, abi, owner);

  console.log("=== Voting Contract Test ===");
  console.log("Owner address:", owner.address);
  console.log("Voter1 address:", voter1.address);
  console.log("Voter2 address:", voter2.address);
  console.log("Voter3 address:", voter3.address);

  // 1. owner()
  const contractOwner = await contract.owner();
  console.log("\n1. owner():", contractOwner);
  if (contractOwner !== owner.address) throw new Error("Owner mismatch");

  // 2. candidatesCount() — initial = 0
  let count = await contract.candidatesCount();
  console.log("2. Initial candidatesCount:", count.toString());
  if (count !== 0n) throw new Error("Expected 0 candidates initially");

  // 3. addCandidate — owner adds Alice
  let tx = await contract.addCandidate("Alice");
  let receipt = await tx.wait();
  console.log("3. Added candidate 'Alice' — tx:", receipt?.hash);
  count = await contract.candidatesCount();
  if (count !== 1n) throw new Error("Expected 1 candidate after add");

  let candidate = await contract.candidates(0);
  console.log("   candidate(0): name =", candidate.name, ", votes =", candidate.voteCount.toString());
  if (candidate.name !== "Alice") throw new Error("Candidate name mismatch");

  // 4. addCandidate — owner adds Bob
  tx = await contract.addCandidate("Bob");
  receipt = await tx.wait();
  console.log("4. Added candidate 'Bob' — tx:", receipt?.hash);
  count = await contract.candidatesCount();
  if (count !== 2n) throw new Error("Expected 2 candidates");

  // 5. addCandidate — non-owner reverts
  try {
    await contract.connect(voter1).addCandidate("Charlie");
    throw new Error("Should have reverted");
  } catch {
    console.log("5. Non-owner addCandidate correctly reverted");
  }

  // 6. vote — voter1 votes for Alice (ID=0)
  tx = await contract.connect(voter1).vote(0);
  receipt = await tx.wait();
  console.log("6. Voter1 voted for Alice — tx:", receipt?.hash);

  const voted = await contract.hasVoted(voter1.address);
  if (voted !== true) throw new Error("Voter1 should have voted");

  candidate = await contract.candidates(0);
  console.log("   Alice votes:", candidate.voteCount.toString());
  if (candidate.voteCount !== 1n) throw new Error("Alice should have 1 vote");

  // 7. double vote — voter1 votes again → revert
  try {
    await contract.connect(voter1).vote(0);
    throw new Error("Should have reverted");
  } catch {
    console.log("7. Double vote correctly reverted");
  }

  // 8. invalid candidate ID → revert
  const invalidId = count; // = 2, but only IDs 0,1 exist
  try {
    await contract.connect(voter2).vote(invalidId);
    throw new Error("Should have reverted");
  } catch {
    console.log("8. Invalid candidate vote correctly reverted");
  }

  // 9. voter2 votes for Bob (ID=1)
  tx = await contract.connect(voter2).vote(1);
  receipt = await tx.wait();
  console.log("9. Voter2 voted for Bob — tx:", receipt?.hash);

  candidate = await contract.candidates(1);
  console.log("   Bob votes:", candidate.voteCount.toString());
  if (candidate.voteCount !== 1n) throw new Error("Bob should have 1 vote");

  // 10. voter3 votes for Alice (ID=0) — different voter, same candidate
  tx = await contract.connect(voter3).vote(0);
  receipt = await tx.wait();
  console.log("10. Voter3 voted for Alice — tx:", receipt?.hash);

  candidate = await contract.candidates(0);
  console.log("   Alice votes:", candidate.voteCount.toString());
  if (candidate.voteCount !== 2n) throw new Error("Alice should have 2 votes");

  console.log("\n=== All Voting contract tests passed! ===");
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exitCode = 1;
});
