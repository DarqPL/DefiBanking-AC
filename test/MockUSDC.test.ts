import { expect } from "chai";
import { ethers } from "hardhat";

describe("MockUSDC", function () {
  const initialSupply = 1_000_000n * 10n ** 6n;

  async function deployMockUSDCFixture() {
    const [deployer, user, other] = await ethers.getSigners();
    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    const mockUSDC = await MockUSDC.deploy();

    return { deployer, user, other, mockUSDC };
  }

  it("sets token metadata", async function () {
    const { mockUSDC } = await deployMockUSDCFixture();

    expect(await mockUSDC.name()).to.equal("Mock USDC");
    expect(await mockUSDC.symbol()).to.equal("USDC");
    expect(await mockUSDC.decimals()).to.equal(6n);
  });

  it("mints the initial supply to the deployer", async function () {
    const { deployer, mockUSDC } = await deployMockUSDCFixture();

    expect(await mockUSDC.totalSupply()).to.equal(initialSupply);
    expect(await mockUSDC.balanceOf(deployer.address)).to.equal(initialSupply);
  });

  it("allows the deployer to mint tokens", async function () {
    const { deployer, user, mockUSDC } = await deployMockUSDCFixture();
    const amount = 2_500n * 10n ** 6n;

    await mockUSDC.connect(deployer).mint(user.address, amount);

    expect(await mockUSDC.balanceOf(user.address)).to.equal(amount);
    expect(await mockUSDC.totalSupply()).to.equal(initialSupply + amount);
  });

  it("allows any account to mint tokens for testing", async function () {
    const { user, other, mockUSDC } = await deployMockUSDCFixture();
    const amount = 100n * 10n ** 6n;

    await mockUSDC.connect(user).mint(other.address, amount);

    expect(await mockUSDC.balanceOf(other.address)).to.equal(amount);
    expect(await mockUSDC.totalSupply()).to.equal(initialSupply + amount);
  });
});
