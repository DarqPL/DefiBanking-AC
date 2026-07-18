import "@nomicfoundation/hardhat-ethers";
import { ethers } from "hardhat";
import { expect } from "chai";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { MyMintableToken } from "../typechain";

describe("MyMintableToken", function () {
  let deployer: SignerWithAddress;
  let addr1: SignerWithAddress;
  let myMintableToken: MyMintableToken;

  const deploy = async () => {
    [deployer, addr1] = await ethers.getSigners();
    myMintableToken = await (await ethers.getContractFactory("MyMintableToken", deployer)).deploy();
  };

  before(async () => {
    console.log("Deploying MyMintableToken contract...");
    await deploy();
  });

  describe("Deployment", function () {
    it("Should set the correct name", async function () {
      expect(await myMintableToken.name()).to.equal("MyMintableToken");
    });

    it("Should set the correct symbol", async function () {
      expect(await myMintableToken.symbol()).to.equal("MMT");
    });

    it("Should set deployer as owner", async function () {
      expect(await myMintableToken.owner()).to.equal(deployer.address);
    });

    it("Should have 0 initial supply", async function () {
      expect(await myMintableToken.totalSupply()).to.equal(0n);
    });
  });

  describe("Minting", function () {
    it("Should mint 1000 tokens to deployer", async function () {
      const mintAmount = 1000n * 10n ** 18n;
      const tx = await myMintableToken.mint(deployer.address, mintAmount);
      await tx.wait();

      expect(await myMintableToken.balanceOf(deployer.address)).to.equal(mintAmount);
      expect(await myMintableToken.totalSupply()).to.equal(mintAmount);
    });

    it("Should mint to another address", async function () {
      const mintAmount = 500n * 10n ** 18n;
      const tx = await myMintableToken.mint(addr1.address, mintAmount);
      await tx.wait();

      expect(await myMintableToken.balanceOf(addr1.address)).to.equal(mintAmount);
    });
  });

  describe("Only owner", function () {
    it("Should revert when non-owner tries to mint", async function () {
      try {
        const myMintableTokenAsAddr1 = myMintableToken.connect(addr1);
        await myMintableTokenAsAddr1.mint(addr1.address, 100n * 10n ** 18n);
        expect.fail("Expected revert not received");
      } catch (error: any) {
        expect(error.message).to.include("OwnableUnauthorizedAccount");
      }
    });
  });
});
