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

  it("sets token metadata and deployer admin", async function () {
    const { deployer, mockUSDC } = await deployMockUSDCFixture();

    expect(await mockUSDC.name()).to.equal("Mock USDC");
    expect(await mockUSDC.symbol()).to.equal("USDC");
    expect(await mockUSDC.decimals()).to.equal(6n);
    expect(await mockUSDC.admin()).to.equal(deployer.address);
  });

  it("mints the initial supply to the deployer", async function () {
    const { deployer, mockUSDC } = await deployMockUSDCFixture();

    expect(await mockUSDC.totalSupply()).to.equal(initialSupply);
    expect(await mockUSDC.balanceOf(deployer.address)).to.equal(initialSupply);
  });

  it("allows the admin to mint tokens", async function () {
    const { deployer, user, mockUSDC } = await deployMockUSDCFixture();
    const amount = 2_500n * 10n ** 6n;

    await mockUSDC.connect(deployer).mint(user.address, amount);

    expect(await mockUSDC.balanceOf(user.address)).to.equal(amount);
    expect(await mockUSDC.totalSupply()).to.equal(initialSupply + amount);
  });

  it("reverts when a non-admin tries to mint", async function () {
    const { user, other, mockUSDC } = await deployMockUSDCFixture();
    const amount = 100n * 10n ** 6n;

    try {
      await mockUSDC.connect(user).mint.staticCall(other.address, amount);
      expect.fail("Expected mint to revert");
    } catch (error) {
      const data = (error as { data: string | { data: string } }).data;
      const revertData = typeof data === "string" ? data : data.data;
      const parsedError = mockUSDC.interface.parseError(revertData);
      expect(parsedError?.name).to.equal("NotAdmin");
    }
  });
});
