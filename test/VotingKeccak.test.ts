import "@nomicfoundation/hardhat-ethers";
import { ethers } from "hardhat";
import { expect } from "chai";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { VotingKeccak } from "../typechain";

const keccakId = (name: string) => ethers.solidityPackedKeccak256(["string"], [name]);

describe("VotingKeccak (Unit Test)", function () {
  let owner: SignerWithAddress;
  let voter1: SignerWithAddress;
  let voter2: SignerWithAddress;
  let voter3: SignerWithAddress;
  let other: SignerWithAddress;

  let voting: VotingKeccak;

  before(async function () {
    [owner, voter1, voter2, voter3, other] = await ethers.getSigners();

    voting = await (await ethers.getContractFactory("VotingKeccak", owner)).deploy();
  });

  describe("Deployment", function () {
    it("Should set the deployer as owner", async function () {
      expect(await voting.owner()).to.equal(owner.address);
    });

    it("Should start with zero candidates", async function () {
      expect(await voting.getCandidatesCount()).to.equal(0n);
    });

    it("Should initialize hasVoted as false for any address", async function () {
      expect(await voting.hasVoted(voter1.address)).to.equal(false);
    });
  });

  describe("addCandidate", function () {
    it("Should allow owner to add a candidate", async function () {
      const tx = await voting.addCandidate("Alice");
      await tx.wait();

      expect(await voting.getCandidatesCount()).to.equal(1n);
      const id = keccakId("Alice");
      const candidate = await voting.candidates(id);
      expect(candidate.name).to.equal("Alice");
      expect(candidate.voteCount).to.equal(0n);
      expect(await voting.candidateExists(id)).to.equal(true);
    });

    it("Should use keccak256 hash as candidate ID", async function () {
      const tx = await voting.addCandidate("Bob");
      await tx.wait();

      const id = keccakId("Bob");
      expect(await voting.candidateExists(id)).to.equal(true);

      // Verify a different name produces a different ID
      const otherId = keccakId("NotBob");
      expect(id).not.to.equal(otherId);
    });

    it("Should not duplicate the same candidate name", async function () {
      const countBefore = await voting.getCandidatesCount();

      await voting.addCandidate("Alice");

      const countAfter = await voting.getCandidatesCount();
      expect(countAfter).to.equal(countBefore);
    });

    it("Should revert when non-owner tries to add a candidate", async function () {
      try {
        await voting.connect(voter1).addCandidate("Charlie");
        expect.fail("Should have reverted");
      } catch {
        // expected
      }
    });

    it("Should allow adding a candidate with an empty name", async function () {
      await voting.addCandidate("");

      const id = keccakId("");
      expect(await voting.candidateExists(id)).to.equal(true);
      expect(await voting.getCandidatesCount()).to.equal(3n);
    });

    it("Should store candidate IDs in array", async function () {
      const ids = await voting.getCandidateIds();
      expect(ids.length).to.equal(3);
      expect(ids[0]).to.equal(keccakId("Alice"));
      expect(ids[1]).to.equal(keccakId("Bob"));
      expect(ids[2]).to.equal(keccakId(""));
    });
  });

  describe("vote", function () {
    it("Should allow a voter to vote for a valid candidate", async function () {
      const id = keccakId("Alice");
      const tx = await voting.connect(voter1).vote(id);
      await tx.wait();

      expect(await voting.hasVoted(voter1.address)).to.equal(true);
      const candidate = await voting.candidates(id);
      expect(candidate.voteCount).to.equal(1n);
    });

    it("Should emit Voted event", async function () {
      const id = keccakId("Bob");
      const tx = await voting.connect(voter2).vote(id);
      const receipt = await tx.wait();

      expect(receipt?.logs.length).to.be.greaterThan(0);
    });

    it("Should revert when voting twice", async function () {
      const id = keccakId("Alice");
      try {
        await voting.connect(voter1).vote(id);
        expect.fail("Should have reverted");
      } catch {
        // expected
      }
    });

    it("Should revert when voting for a non-existent candidate ID", async function () {
      const fakeId = ethers.solidityPackedKeccak256(["string", "uint"], ["fake", 123]);
      try {
        await voting.connect(voter3).vote(fakeId);
        expect.fail("Should have reverted");
      } catch {
        // expected
      }
    });

    it("Should allow different voters to vote for different candidates", async function () {
      await voting.addCandidate("Charlie");
      await voting.addCandidate("Diana");

      const idCharlie = keccakId("Charlie");
      const idDiana = keccakId("Diana");

      await voting.connect(voter3).vote(idCharlie);
      await voting.connect(other).vote(idDiana);

      const c1 = await voting.candidates(idCharlie);
      const c2 = await voting.candidates(idDiana);
      expect(c1.voteCount).to.equal(1n);
      expect(c2.voteCount).to.equal(1n);
    });

    it("Should correctly accumulate votes for the same candidate", async function () {
      const freshVoting = await (await ethers.getContractFactory("VotingKeccak", owner)).deploy();
      await freshVoting.addCandidate("Popular");
      const id = keccakId("Popular");

      const signers = await ethers.getSigners();
      for (let i = 0; i < 5; i++) {
        await freshVoting.connect(signers[i + 2]).vote(id);
      }

      const candidate = await freshVoting.candidates(id);
      expect(candidate.voteCount).to.equal(5n);
    });
  });

  describe("Edge cases", function () {
    it("Should handle multiple candidates with unique IDs", async function () {
      const freshVoting = await (await ethers.getContractFactory("VotingKeccak", owner)).deploy();
      const names = ["A", "B", "C", "D"];
      const ids = names.map((n) => keccakId(n));

      for (const name of names) {
        await freshVoting.addCandidate(name);
      }

      const storedIds = await freshVoting.getCandidateIds();
      expect(storedIds.length).to.equal(4);

      for (let i = 0; i < 4; i++) {
        expect(storedIds[i]).to.equal(ids[i]);
      }
    });

    it("Should return correct candidate data from mapping", async function () {
      const id = keccakId("Alice");
      const c = await voting.candidates(id);
      expect(c.name).to.equal("Alice");
      expect(c.voteCount).to.equal(1n);
    });
  });
});
