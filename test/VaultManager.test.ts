import { expect } from "chai";
import { ethers } from "hardhat";

describe("VaultManager", function () {
  const oneUsdc = 10n ** 6n;

  function getRevertData(error: unknown): string {
    const data = (error as { data?: string | { data?: string; reason?: { Revert?: string } } }).data;

    if (typeof data === "string") return data;
    if (data?.data) return data.data;
    if (data?.reason?.Revert) return data.reason.Revert;

    throw error;
  }

  async function expectCustomError(
    action: Promise<unknown>,
    contractInterface: { parseError(data: string): { name: string } | null },
    expectedName: string,
  ) {
    try {
      await action;
      expect.fail(`Expected ${expectedName} revert`);
    } catch (error) {
      const parsedError = contractInterface.parseError(getRevertData(error));
      expect(parsedError?.name).to.equal(expectedName);
    }
  }

  async function deployVaultManagerFixture() {
    const [deployer, feeReceiver, newFeeReceiver, user] = await ethers.getSigners();

    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    const mockUSDC = await MockUSDC.deploy();

    const VaultManager = await ethers.getContractFactory("VaultManager");
    const vaultManager = await VaultManager.deploy(await mockUSDC.getAddress(), feeReceiver.address);

    return { deployer, feeReceiver, newFeeReceiver, user, mockUSDC, vaultManager };
  }

  it("initializes the token, owner, fee receiver, and pause state", async function () {
    const { deployer, feeReceiver, mockUSDC, vaultManager } = await deployVaultManagerFixture();

    expect(await vaultManager.token()).to.equal(await mockUSDC.getAddress());
    expect(await vaultManager.owner()).to.equal(deployer.address);
    expect(await vaultManager.feeReceiver()).to.equal(feeReceiver.address);
    expect(await vaultManager.paused()).to.equal(false);
  });

  it("rejects invalid constructor addresses", async function () {
    const { feeReceiver, mockUSDC, vaultManager } = await deployVaultManagerFixture();
    const VaultManager = await ethers.getContractFactory("VaultManager");

    await expectCustomError(
      VaultManager.deploy(ethers.ZeroAddress, feeReceiver.address),
      vaultManager.interface,
      "InvalidAddress",
    );
    await expectCustomError(
      VaultManager.deploy(await mockUSDC.getAddress(), ethers.ZeroAddress),
      vaultManager.interface,
      "InvalidAddress",
    );
    await expectCustomError(
      VaultManager.deploy(ethers.ZeroAddress, ethers.ZeroAddress),
      vaultManager.interface,
      "InvalidAddress",
    );
  });

  it("lets the owner update the fee receiver", async function () {
    const { newFeeReceiver, vaultManager } = await deployVaultManagerFixture();

    await vaultManager.setFeeReceiver(newFeeReceiver.address);

    expect(await vaultManager.feeReceiver()).to.equal(newFeeReceiver.address);
  });

  it("lets the owner update the authorized SavingCore address", async function () {
    const { user, vaultManager } = await deployVaultManagerFixture();

    await vaultManager.setSavingCore(user.address);

    expect(await vaultManager.savingCore()).to.equal(user.address);
  });

  it("rejects invalid fee receiver updates", async function () {
    const { vaultManager } = await deployVaultManagerFixture();

    await expectCustomError(
      vaultManager.setFeeReceiver.staticCall(ethers.ZeroAddress),
      vaultManager.interface,
      "InvalidAddress",
    );
  });

  it("rejects invalid SavingCore updates", async function () {
    const { vaultManager } = await deployVaultManagerFixture();

    await expectCustomError(
      vaultManager.setSavingCore.staticCall(ethers.ZeroAddress),
      vaultManager.interface,
      "InvalidAddress",
    );
  });

  it("lets the owner fund the vault after approval", async function () {
    const { deployer, mockUSDC, vaultManager } = await deployVaultManagerFixture();
    const vaultAddress = await vaultManager.getAddress();
    const amount = 25_000n * oneUsdc;
    const ownerBalanceBefore = await mockUSDC.balanceOf(deployer.address);

    await mockUSDC.approve(vaultAddress, amount);
    await vaultManager.fundVault(amount);

    expect(await mockUSDC.balanceOf(vaultAddress)).to.equal(amount);
    expect(await mockUSDC.balanceOf(deployer.address)).to.equal(ownerBalanceBefore - amount);
    expect(await vaultManager.vaultBalance()).to.equal(amount);
    expect(await vaultManager.canPayInterest(amount)).to.equal(true);
    expect(await vaultManager.canPayInterest(amount + 1n)).to.equal(false);
  });

  it("lets the owner withdraw vault liquidity", async function () {
    const { deployer, mockUSDC, vaultManager } = await deployVaultManagerFixture();
    const vaultAddress = await vaultManager.getAddress();
    const fundedAmount = 10_000n * oneUsdc;
    const withdrawAmount = 4_000n * oneUsdc;

    await mockUSDC.approve(vaultAddress, fundedAmount);
    await vaultManager.fundVault(fundedAmount);

    const ownerBalanceBefore = await mockUSDC.balanceOf(deployer.address);
    await vaultManager.withdrawVault(withdrawAmount);

    expect(await mockUSDC.balanceOf(vaultAddress)).to.equal(fundedAmount - withdrawAmount);
    expect(await mockUSDC.balanceOf(deployer.address)).to.equal(ownerBalanceBefore + withdrawAmount);
  });

  it("rejects zero-amount funding and withdrawals", async function () {
    const { vaultManager } = await deployVaultManagerFixture();

    await expectCustomError(vaultManager.fundVault.staticCall(0), vaultManager.interface, "ZeroAmount");
    await expectCustomError(vaultManager.withdrawVault.staticCall(0), vaultManager.interface, "ZeroAmount");
  });

  it("rejects withdrawals above vault balance", async function () {
    const { vaultManager } = await deployVaultManagerFixture();

    await expectCustomError(
      vaultManager.withdrawVault.staticCall(oneUsdc),
      vaultManager.interface,
      "InsufficientVaultBalance",
    );
  });

  it("restricts owner-only functions", async function () {
    const { newFeeReceiver, user, vaultManager } = await deployVaultManagerFixture();

    await expectCustomError(
      vaultManager.connect(user).setFeeReceiver.staticCall(newFeeReceiver.address),
      vaultManager.interface,
      "OwnableUnauthorizedAccount",
    );
    await expectCustomError(
      vaultManager.connect(user).setSavingCore.staticCall(newFeeReceiver.address),
      vaultManager.interface,
      "OwnableUnauthorizedAccount",
    );
    await expectCustomError(vaultManager.connect(user).pause.staticCall(), vaultManager.interface, "OwnableUnauthorizedAccount");
    await expectCustomError(vaultManager.connect(user).unpause.staticCall(), vaultManager.interface, "OwnableUnauthorizedAccount");
  });

  it("lets the owner pause and unpause vault token movement", async function () {
    const { mockUSDC, vaultManager } = await deployVaultManagerFixture();
    const vaultAddress = await vaultManager.getAddress();
    const amount = 1_000n * oneUsdc;

    await mockUSDC.approve(vaultAddress, amount);
    await vaultManager.pause();

    expect(await vaultManager.paused()).to.equal(true);
    await expectCustomError(vaultManager.fundVault.staticCall(amount), vaultManager.interface, "EnforcedPause");
    await expectCustomError(vaultManager.withdrawVault.staticCall(amount), vaultManager.interface, "EnforcedPause");

    await vaultManager.unpause();
    await vaultManager.fundVault(amount);

    expect(await vaultManager.paused()).to.equal(false);
    expect(await mockUSDC.balanceOf(vaultAddress)).to.equal(amount);
  });

  it("rejects repeated pause and unpause calls", async function () {
    const { vaultManager } = await deployVaultManagerFixture();

    await expectCustomError(vaultManager.unpause.staticCall(), vaultManager.interface, "ExpectedPause");

    await vaultManager.pause();
    await expectCustomError(vaultManager.pause.staticCall(), vaultManager.interface, "EnforcedPause");
  });

  it("allows only the authorized SavingCore address to pay interest", async function () {
    const { user, newFeeReceiver, mockUSDC, vaultManager } = await deployVaultManagerFixture();
    const vaultAddress = await vaultManager.getAddress();
    const amount = 500n * oneUsdc;

    await mockUSDC.approve(vaultAddress, amount);
    await vaultManager.fundVault(amount);
    await vaultManager.setSavingCore(user.address);

    const vaultBefore = await mockUSDC.balanceOf(vaultAddress);
    const recipientBefore = await mockUSDC.balanceOf(newFeeReceiver.address);
    await vaultManager.connect(user).payInterest(newFeeReceiver.address, amount);

    expect(await mockUSDC.balanceOf(vaultAddress)).to.equal(vaultBefore - amount);
    expect(await mockUSDC.balanceOf(newFeeReceiver.address)).to.equal(recipientBefore + amount);
  });

  it("rejects invalid interest payouts", async function () {
    const { user, newFeeReceiver, mockUSDC, vaultManager } = await deployVaultManagerFixture();
    const vaultAddress = await vaultManager.getAddress();
    const amount = 100n * oneUsdc;

    await mockUSDC.approve(vaultAddress, amount);
    await vaultManager.fundVault(amount);
    await vaultManager.setSavingCore(user.address);

    await expectCustomError(
      vaultManager.connect(newFeeReceiver).payInterest.staticCall(user.address, amount),
      vaultManager.interface,
      "NotSavingCore",
    );
    await expectCustomError(vaultManager.connect(user).payInterest.staticCall(ethers.ZeroAddress, amount), vaultManager.interface, "InvalidAddress");
    await expectCustomError(vaultManager.connect(user).payInterest.staticCall(newFeeReceiver.address, 0), vaultManager.interface, "ZeroAmount");
    await expectCustomError(
      vaultManager.connect(user).payInterest.staticCall(newFeeReceiver.address, amount + 1n),
      vaultManager.interface,
      "InsufficientVaultBalance",
    );

    await vaultManager.pause();
    await expectCustomError(
      vaultManager.connect(user).payInterest.staticCall(newFeeReceiver.address, amount),
      vaultManager.interface,
      "EnforcedPause",
    );
  });
});
