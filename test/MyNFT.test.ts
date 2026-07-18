import "@nomicfoundation/hardhat-ethers";
import { ethers } from "hardhat";
import { expect } from "chai";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { MyNFT } from "../typechain";

describe("MyNFT", function () {
  let deployer: SignerWithAddress;
  let addr1: SignerWithAddress;
  let addr2: SignerWithAddress;
  let myNFT: MyNFT;

  const deploy = async () => {
    [deployer, addr1, addr2] = await ethers.getSigners();
    myNFT = await (await ethers.getContractFactory("MyNFT", deployer)).deploy();
  };

  before(async () => {
    console.log("Deploying MyNFT contract...");
    await deploy();
  });

  describe("Deployment", function () {
    it("Should set the correct name and symbol", async function () {
      expect(await myNFT.name()).to.equal("MyNFT");
      expect(await myNFT.symbol()).to.equal("MNFT");
    });

    it("Should set nextTokenId to 0", async function () {
      expect(await myNFT.nextTokenId()).to.equal(0n);
    });

    it("Should set deployer as owner", async function () {
      expect(await myNFT.owner()).to.equal(deployer.address);
    });
  });

  describe("Minting", function () {
    it("Should mint NFT #0 to deployer", async function () {
      const tx = await myNFT.mint(deployer.address);
      await tx.wait();

      expect(await myNFT.ownerOf(0)).to.equal(deployer.address);
      expect(await myNFT.nextTokenId()).to.equal(1n);
      expect(await myNFT.balanceOf(deployer.address)).to.equal(1n);
    });

    it("Should mint NFT #1 to addr1", async function () {
      const tx = await myNFT.mint(addr1.address);
      await tx.wait();

      expect(await myNFT.ownerOf(1)).to.equal(addr1.address);
      expect(await myNFT.nextTokenId()).to.equal(2n);
      expect(await myNFT.balanceOf(addr1.address)).to.equal(1n);
    });

    it("Should increment nextTokenId correctly", async function () {
      const tx1 = await myNFT.mint(addr1.address);
      await tx1.wait();
      expect(await myNFT.nextTokenId()).to.equal(3n);

      const tx2 = await myNFT.mint(addr2.address);
      await tx2.wait();
      expect(await myNFT.nextTokenId()).to.equal(4n);
    });
  });

  describe("Only owner", function () {
    it("Should revert when non-owner tries to mint", async function () {
      try {
        const myNFTAsAddr1 = myNFT.connect(addr1);
        await myNFTAsAddr1.mint(addr1.address);
        expect.fail("Expected revert not received");
      } catch (error: any) {
        expect(error.message).to.include("OwnableUnauthorizedAccount");
      }
    });
  });
});
