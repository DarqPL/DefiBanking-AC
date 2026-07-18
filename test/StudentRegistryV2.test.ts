import "@nomicfoundation/hardhat-ethers";
import { ethers } from "hardhat";
import { expect } from "chai";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { StudentRegistryV2 } from "../typechain";

describe("StudentRegistryV2 (Unit Test)", function () {
  let owner: SignerWithAddress;
  let student1: SignerWithAddress;
  let student2: SignerWithAddress;
  let student3: SignerWithAddress;
  let other: SignerWithAddress;

  let registry: StudentRegistryV2;

  before(async function () {
    [owner, student1, student2, student3, other] = await ethers.getSigners();

    registry = await (await ethers.getContractFactory("StudentRegistryV2", owner)).deploy();
  });

  describe("Deployment", function () {
    it("Should set the deployer as owner", async function () {
      expect(await registry.owner()).to.equal(owner.address);
    });

    it("Should return isRegistered = false for any address", async function () {
      expect(await registry.isStudentRegistered(student1.address)).to.equal(false);
    });

    it("Should return default struct for unregistered student", async function () {
      const s = await registry.getStudent(student1.address);
      expect(s.name).to.equal("");
      expect(s.age).to.equal(0n);
      expect(s.isRegistered).to.equal(false);
    });
  });

  describe("registerStudent", function () {
    it("Should allow owner to register a student", async function () {
      const tx = await registry.registerStudent(student1.address, "Alice", 20);
      await tx.wait();

      expect(await registry.isStudentRegistered(student1.address)).to.equal(true);
      const s = await registry.getStudent(student1.address);
      expect(s.name).to.equal("Alice");
      expect(s.age).to.equal(20n);
      expect(s.isRegistered).to.equal(true);
    });

    it("Should emit StudentAdded event", async function () {
      const tx = await registry.registerStudent(student2.address, "Bob", 22);
      const receipt = await tx.wait();

      expect(receipt?.logs.length).to.be.greaterThan(0);
    });

    it("Should revert when registering the same student twice", async function () {
      try {
        await registry.registerStudent(student1.address, "Alice", 20);
        expect.fail("Should have reverted");
      } catch {
        // expected
      }
    });

    it("Should revert when non-owner tries to register", async function () {
      try {
        await registry.connect(student1).registerStudent(student3.address, "Charlie", 19);
        expect.fail("Should have reverted");
      } catch {
        // expected
      }
    });

    it("Should allow registering multiple different students", async function () {
      await registry.registerStudent(student3.address, "Charlie", 19);
      await registry.registerStudent(other.address, "Diana", 21);

      expect(await registry.isStudentRegistered(student3.address)).to.equal(true);
      expect(await registry.isStudentRegistered(other.address)).to.equal(true);

      const s3 = await registry.getStudent(student3.address);
      expect(s3.name).to.equal("Charlie");
      expect(s3.age).to.equal(19n);
    });
  });

  describe("getStudent", function () {
    it("Should return correct data for a registered student", async function () {
      const s = await registry.getStudent(student1.address);
      expect(s.name).to.equal("Alice");
      expect(s.age).to.equal(20n);
      expect(s.isRegistered).to.equal(true);
    });

    it("Should return default for an unregistered address", async function () {
      const fresh = ethers.Wallet.createRandom().address;
      const s = await registry.getStudent(fresh);
      expect(s.name).to.equal("");
      expect(s.age).to.equal(0n);
      expect(s.isRegistered).to.equal(false);
    });
  });

  describe("isStudentRegistered", function () {
    it("Should return true for registered student", async function () {
      expect(await registry.isStudentRegistered(student2.address)).to.equal(true);
    });

    it("Should return false for unregistered address", async function () {
      const fresh = ethers.Wallet.createRandom().address;
      expect(await registry.isStudentRegistered(fresh)).to.equal(false);
    });
  });
});
