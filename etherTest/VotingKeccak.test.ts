import "dotenv/config";
import { ethers } from "ethers";

// ===== CONFIG: Update these before running =====
const CONTRACT_ADDRESS = "0x4fE8cEddD22B36e2Ea587Ef89b1E7A074F40b387";
const RPC_URL = "https://ethereum-sepolia-rpc.publicnode.com";
// ===============================================

const keccakId = (name: string) => ethers.solidityPackedKeccak256(["string"], [name]);

const abi = [
  "function owner() view returns (address)",
  "function candidates(bytes32) view returns (string name, uint256 voteCount)",
  "function candidateExists(bytes32) view returns (bool)",
  "function hasVoted(address) view returns (bool)",
  "function addCandidate(string calldata _name)",
  "function vote(bytes32 _candidateId)",
  "function getCandidateIds() view returns (bytes32[])",
  "function getCandidatesCount() view returns (uint256)",
  "event CandidateAdded(bytes32 candidateId, string name)",
  "event Voted(address indexed voter, bytes32 candidateId)",
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

  console.log("=== VotingKeccak Contract Test ===");
  console.log("Owner address:", owner.address);
  console.log("Voter1 address:", voter1.address);
  console.log("Voter2 address:", voter2.address);
  console.log("Voter3 address:", voter3.address);

  // 1. owner()
  const contractOwner = await contract.owner();
  console.log("\n1. owner():", contractOwner);
  if (contractOwner !== owner.address) throw new Error("Owner mismatch");

  // 2. getCandidatesCount() — initial = 0
  let count = await contract.getCandidatesCount();
  console.log("2. Initial candidatesCount:", count.toString());
  if (count !== 0n) throw new Error("Expected 0 candidates initially");

  // 3. addCandidate — owner adds Alice
  let tx = await contract.addCandidate("Alice");
  let receipt = await tx.wait();
  console.log("3. Added candidate 'Alice' — tx:", receipt?.hash);

  const aliceId = keccakId("Alice");
  let exists = await contract.candidateExists(aliceId);
  if (exists !== true) throw new Error("Alice should exist");

  count = await contract.getCandidatesCount();
  if (count !== 1n) throw new Error("Expected 1 candidate");

  let candidate = await contract.candidates(aliceId);
  console.log("   Alice id:", aliceId);
  console.log("   candidate(aliceId): name =", candidate.name, ", votes =", candidate.voteCount.toString());
  if (candidate.name !== "Alice") throw new Error("Alice name mismatch");

  // 4. addCandidate — owner adds Bob
  tx = await contract.addCandidate("Bob");
  receipt = await tx.wait();
  console.log("4. Added candidate 'Bob' — tx:", receipt?.hash);

  const bobId = keccakId("Bob");
  exists = await contract.candidateExists(bobId);
  if (exists !== true) throw new Error("Bob should exist");

  count = await contract.getCandidatesCount();
  if (count !== 2n) throw new Error("Expected 2 candidates");

  // 5. addCandidate — duplicate name (no-op)
  tx = await contract.addCandidate("Alice");
  receipt = await tx.wait();
  console.log("5. Duplicate 'Alice' — tx:", receipt?.hash);
  count = await contract.getCandidatesCount();
  if (count !== 2n) throw new Error("Count should remain 2 after duplicate");

  // 6. addCandidate — non-owner reverts
  try {
    await contract.connect(voter1).addCandidate("Charlie");
    throw new Error("Should have reverted");
  } catch {
    console.log("6. Non-owner addCandidate correctly reverted");
  }

  // 7. vote — voter1 votes for Alice
  tx = await contract.connect(voter1).vote(aliceId);
  receipt = await tx.wait();
  console.log("7. Voter1 voted for Alice — tx:", receipt?.hash);

  const voted = await contract.hasVoted(voter1.address);
  if (voted !== true) throw new Error("Voter1 should have voted");

  candidate = await contract.candidates(aliceId);
  console.log("   Alice votes:", candidate.voteCount.toString());
  if (candidate.voteCount !== 1n) throw new Error("Alice should have 1 vote");

  // 8. double vote — voter1 votes again → revert
  try {
    await contract.connect(voter1).vote(aliceId);
    throw new Error("Should have reverted");
  } catch {
    console.log("8. Double vote correctly reverted");
  }

  // 9. invalid candidate ID (random keccak) → revert
  const fakeId = ethers.solidityPackedKeccak256(["string", "uint"], ["fake", 999]);
  try {
    await contract.connect(voter2).vote(fakeId);
    throw new Error("Should have reverted");
  } catch {
    console.log("9. Invalid candidate vote correctly reverted");
  }

  // 10. voter2 votes for Bob
  tx = await contract.connect(voter2).vote(bobId);
  receipt = await tx.wait();
  console.log("10. Voter2 voted for Bob — tx:", receipt?.hash);

  candidate = await contract.candidates(bobId);
  console.log("    Bob votes:", candidate.voteCount.toString());
  if (candidate.voteCount !== 1n) throw new Error("Bob should have 1 vote");

  // 11. voter3 votes for Alice — different voter, same candidate
  tx = await contract.connect(voter3).vote(aliceId);
  receipt = await tx.wait();
  console.log("11. Voter3 voted for Alice — tx:", receipt?.hash);

  candidate = await contract.candidates(aliceId);
  console.log("    Alice votes:", candidate.voteCount.toString());
  if (candidate.voteCount !== 2n) throw new Error("Alice should have 2 votes");

  // 12. getCandidateIds() — verify stored IDs
  const ids = await contract.getCandidateIds();
  console.log("12. Stored candidate IDs:", ids);
  if (ids.length !== 2) throw new Error("Should have 2 IDs");
  if (ids[0] !== aliceId) throw new Error("First ID should be Alice's");
  if (ids[1] !== bobId) throw new Error("Second ID should be Bob's");

  console.log("\n=== All VotingKeccak contract tests passed! ===");
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exitCode = 1;
});
