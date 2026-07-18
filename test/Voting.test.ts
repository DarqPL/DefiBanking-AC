import "@nomicfoundation/hardhat-ethers";
import { ethers } from "hardhat";
import { expect } from "chai";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { Voting } from "../typechain";

describe("Voting (Unit Test)", function () {
  let owner: SignerWithAddress;
  let voter1: SignerWithAddress;
  let voter2: SignerWithAddress;
  let voter3: SignerWithAddress;
  let other: SignerWithAddress;

  let voting: Voting;

  before(async function () {
    [owner, voter1, voter2, voter3, other] = await ethers.getSigners();

    voting = await (await ethers.getContractFactory("Voting", owner)).deploy();
  });

  describe("Deployment", function () {
    it("Should set the deployer as owner", async function () {
      expect(await voting.owner()).to.equal(owner.address);
    });

    it("Should start with zero candidates", async function () {
      expect(await voting.candidatesCount()).to.equal(0n);
    });

    it("Should initialize hasVoted as false for any address", async function () {
      expect(await voting.hasVoted(voter1.address)).to.equal(false);
    });
  });

  describe("addCandidate", function () {
    it("Should allow owner to add a candidate", async function () {
      const tx = await voting.addCandidate("Alice");
      await tx.wait();

      expect(await voting.candidatesCount()).to.equal(1n);
      const candidate = await voting.candidates(0);
      expect(candidate.name).to.equal("Alice");
      expect(candidate.voteCount).to.equal(0n);
    });

    it("Should emit CandidateAdded event", async function () {
      const tx = await voting.addCandidate("Bob");
      const receipt = await tx.wait();

      expect(receipt?.logs.length).to.be.greaterThan(0);
    });

    it("Should revert when non-owner tries to add a candidate", async function () {
      try {
        await voting.connect(voter1).addCandidate("Charlie");
        expect.fail("Should have reverted");
      } catch {
        // expected
      }
    });

    it("Should allow adding multiple candidates", async function () {
      await voting.addCandidate("Charlie");
      await voting.addCandidate("Diana");

      expect(await voting.candidatesCount()).to.equal(4n);
    });

    it("Should allow adding a candidate with an empty name", async function () {
      await voting.addCandidate("");

      expect(await voting.candidatesCount()).to.equal(5n);
      const candidate = await voting.candidates(4);
      expect(candidate.name).to.equal("");
    });
  });

  describe("vote", function () {
    it("Should allow a voter to vote for a valid candidate", async function () {
      const tx = await voting.connect(voter1).vote(0);
      await tx.wait();

      expect(await voting.hasVoted(voter1.address)).to.equal(true);
      const candidate = await voting.candidates(0);
      expect(candidate.voteCount).to.equal(1n);
    });

    it("Should emit Voted event", async function () {
      const tx = await voting.connect(voter2).vote(0);
      const receipt = await tx.wait();

      expect(receipt?.logs.length).to.be.greaterThan(0);
    });

    it("Should revert when voting twice", async function () {
      try {
        await voting.connect(voter1).vote(0);
        expect.fail("Should have reverted");
      } catch {
        // expected
      }
    });

    it("Should revert when voting for an invalid candidate ID", async function () {
      const count = await voting.candidatesCount();
      try {
        await voting.connect(voter3).vote(count);
        expect.fail("Should have reverted");
      } catch {
        // expected
      }
    });

    it("Should allow different voters to vote for different candidates", async function () {
      await voting.addCandidate("Candidate X");
      await voting.addCandidate("Candidate Y");

      await voting.connect(voter3).vote(1);
      await voting.connect(other).vote(2);

      const c1 = await voting.candidates(1);
      const c2 = await voting.candidates(2);
      expect(c1.voteCount).to.equal(1n);
      expect(c2.voteCount).to.equal(1n);
    });

    it("Should correctly accumulate votes for the same candidate", async function () {
      const freshVoting = await (await ethers.getContractFactory("Voting", owner)).deploy();
      await freshVoting.addCandidate("Popular");

      const signers = await ethers.getSigners();
      for (let i = 0; i < 5; i++) {
        await freshVoting.connect(signers[i + 2]).vote(0);
      }

      const candidate = await freshVoting.candidates(0);
      expect(candidate.voteCount).to.equal(5n);
    });
  });

  describe("Edge cases", function () {
    it("Should allow voting for the first candidate (ID 0)", async function () {
      const freshVoting = await (await ethers.getContractFactory("Voting", owner)).deploy();
      await freshVoting.addCandidate("First");
      await freshVoting.addCandidate("Second");

      await freshVoting.connect(voter1).vote(0);
      const candidate = await freshVoting.candidates(0);
      expect(candidate.voteCount).to.equal(1n);
    });

    it("Should return correct candidate data from mapping", async function () {
      const c0 = await voting.candidates(0);
      expect(c0.name).to.equal("Alice");
      expect(c0.voteCount).to.equal(2n);
    });
  });
});
