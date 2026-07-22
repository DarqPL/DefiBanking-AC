import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

describe("SavingCore", function () {
  const oneUsdc = 10n ** 6n;
  const minDeposit = 1n * oneUsdc;
  const maxDeposit = 10_000n * oneUsdc;
  const depositAmount = 1_000n * oneUsdc;
  const userFunds = 100_000n * oneUsdc;
  const vaultFunds = 100_000n * oneUsdc;
  const tenorDays = 180n;
  const tenorSeconds = tenorDays * 24n * 60n * 60n;
  const aprBps = 225n;
  const penaltyBps = 650n;
  const bpsDenominator = 10_000n;
  const yearSeconds = 365n * 24n * 60n * 60n;
  const autoRenewGracePeriod = 3n * 24n * 60n * 60n;

  function getRevertData(error: unknown): string {
    const data = (error as { data?: string | { data?: string; reason?: { Revert?: string } } }).data;

    if (typeof data === "string") return data;
    if (data?.data) return data.data;
    if (data?.reason?.Revert) return data.reason.Revert;

    throw error;
  }

  async function expectCustomError(action: Promise<unknown>, contractInterface: any, expectedName: string) {
    try {
      await action;
      expect.fail(`Expected ${expectedName} revert`);
    } catch (error) {
      const revertData = getRevertData(error);
      expect(revertData.slice(0, 10)).to.equal(contractInterface.getError(expectedName).selector);
    }
  }

  function calculateInterest(principal: bigint, apr: bigint, durationSeconds: bigint) {
    return (principal * apr * durationSeconds) / (yearSeconds * bpsDenominator);
  }

  function parsedEventNames(receipt: any, contractInterface: any) {
    return receipt.logs
      .map((log: any) => {
        try {
          return contractInterface.parseLog(log)?.name;
        } catch {
          return undefined;
        }
      })
      .filter((name: string | undefined) => name !== undefined);
  }

  async function deploySavingCoreFixture() {
    const [deployer, feeReceiver, user, other, bot] = await ethers.getSigners();

    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    const mockUSDC = await MockUSDC.deploy();

    const VaultManager = await ethers.getContractFactory("VaultManager");
    const vaultManager = await VaultManager.deploy(await mockUSDC.getAddress(), feeReceiver.address);

    const SavingCore = await ethers.getContractFactory("SavingCore");
    const savingCore = await SavingCore.deploy(await mockUSDC.getAddress(), await vaultManager.getAddress());

    const vaultAddress = await vaultManager.getAddress();
    const savingCoreAddress = await savingCore.getAddress();

    await vaultManager.setSavingCore(savingCoreAddress);
    await mockUSDC.mint(user.address, userFunds);
    await mockUSDC.approve(vaultAddress, vaultFunds);
    await vaultManager.fundVault(vaultFunds);
    await savingCore.createPlan(tenorDays, aprBps, minDeposit, maxDeposit, penaltyBps, true);

    async function openDefaultDeposit(amount = depositAmount) {
      await mockUSDC.connect(user).approve(savingCoreAddress, amount);
      await savingCore.connect(user).openDeposit(0, amount);
    }

    return {
      deployer,
      feeReceiver,
      user,
      other,
      bot,
      mockUSDC,
      vaultManager,
      savingCore,
      vaultAddress,
      savingCoreAddress,
      openDefaultDeposit,
    };
  }

  describe("Admin Functions", function () {
    it("creates the default plan in the fixture", async function () {
      const { savingCore } = await deploySavingCoreFixture();
      const plan = await savingCore.savingPlans(0);

      expect(await savingCore.nextPlanId()).to.equal(1n);
      expect(plan.tenorDays).to.equal(tenorDays);
      expect(plan.aprBps).to.equal(aprBps);
      expect(plan.minDeposit).to.equal(minDeposit);
      expect(plan.maxDeposit).to.equal(maxDeposit);
      expect(plan.earlyWithdrawPenaltyBps).to.equal(penaltyBps);
      expect(plan.enabled).to.equal(true);
    });

    it("creates, updates, enables, and disables additional plans", async function () {
      const { savingCore } = await deploySavingCoreFixture();

      await savingCore.createPlan(365, 400, minDeposit, maxDeposit, 300, false);
      let plan = await savingCore.savingPlans(1);
      expect(await savingCore.nextPlanId()).to.equal(2n);
      expect(plan.tenorDays).to.equal(365n);
      expect(plan.aprBps).to.equal(400n);
      expect(plan.enabled).to.equal(false);

      await savingCore.updatePlan(1, 450);
      plan = await savingCore.savingPlans(1);
      expect(plan.aprBps).to.equal(450n);

      await savingCore.enablePlan(1);
      plan = await savingCore.savingPlans(1);
      expect(plan.enabled).to.equal(true);

      await savingCore.disablePlan(1);
      plan = await savingCore.savingPlans(1);
      expect(plan.enabled).to.equal(false);
    });

    it("rejects invalid plan configuration and unauthorized admin calls", async function () {
      const { other, savingCore } = await deploySavingCoreFixture();

      await expectCustomError(savingCore.createPlan.staticCall(0, aprBps, minDeposit, maxDeposit, penaltyBps, true), savingCore.interface, "InvalidTenor");
      await expectCustomError(savingCore.createPlan.staticCall(tenorDays, 10_001, minDeposit, maxDeposit, penaltyBps, true), savingCore.interface, "InvalidApr");
      await expectCustomError(savingCore.createPlan.staticCall(tenorDays, aprBps, minDeposit, maxDeposit, 10_001, true), savingCore.interface, "InvalidPenalty");
      await expectCustomError(savingCore.createPlan.staticCall(tenorDays, aprBps, maxDeposit, minDeposit, penaltyBps, true), savingCore.interface, "InvalidPlanRange");
      await expectCustomError(
        savingCore.connect(other).createPlan.staticCall(tenorDays, aprBps, minDeposit, maxDeposit, penaltyBps, true),
        savingCore.interface,
        "OwnableUnauthorizedAccount",
      );
    });

    it("rejects invalid plan lifecycle updates", async function () {
      const { savingCore } = await deploySavingCoreFixture();

      await expectCustomError(savingCore.updatePlan.staticCall(0, 10_001), savingCore.interface, "InvalidApr");
      await expectCustomError(savingCore.enablePlan.staticCall(0), savingCore.interface, "PlanAlreadyEnabled");
      await savingCore.disablePlan(0);
      await expectCustomError(savingCore.disablePlan.staticCall(0), savingCore.interface, "PlanAlreadyDisabled");
      await expectCustomError(savingCore.updatePlan.staticCall(99, 500), savingCore.interface, "PlanNotFound");
    });

    it("rejects invalid constructor addresses", async function () {
      const { mockUSDC, vaultManager, savingCore } = await deploySavingCoreFixture();
      const SavingCore = await ethers.getContractFactory("SavingCore");

      await expectCustomError(SavingCore.deploy(ethers.ZeroAddress, await vaultManager.getAddress()), savingCore.interface, "InvalidAddress");
      await expectCustomError(SavingCore.deploy(await mockUSDC.getAddress(), ethers.ZeroAddress), savingCore.interface, "InvalidAddress");
    });

    it("allows zero min or max deposit limits to mean no limit", async function () {
      const { user, mockUSDC, savingCore, savingCoreAddress } = await deploySavingCoreFixture();

      await savingCore.createPlan(tenorDays, aprBps, 0, 0, penaltyBps, true);
      await savingCore.createPlan(tenorDays, aprBps, 0, depositAmount, penaltyBps, true);
      await savingCore.createPlan(tenorDays, aprBps, depositAmount, 0, penaltyBps, true);
      await mockUSDC.connect(user).approve(savingCoreAddress, depositAmount * 3n);

      await savingCore.connect(user).openDeposit(1, depositAmount);
      await savingCore.connect(user).openDeposit(2, depositAmount);
      await savingCore.connect(user).openDeposit(3, depositAmount);

      expect((await savingCore.deposits(0)).principal).to.equal(depositAmount);
      expect((await savingCore.deposits(1)).principal).to.equal(depositAmount);
      expect((await savingCore.deposits(2)).principal).to.equal(depositAmount);
    });
  });

  describe("Deposit & Withdraw", function () {
    it("opens deposits at the min, normal, and max boundaries", async function () {
      const { user, mockUSDC, savingCore, savingCoreAddress } = await deploySavingCoreFixture();
      const totalApproval = minDeposit + depositAmount + maxDeposit;
      await mockUSDC.connect(user).approve(savingCoreAddress, totalApproval);

      const userBefore = await mockUSDC.balanceOf(user.address);
      const coreBefore = await mockUSDC.balanceOf(savingCoreAddress);

      await savingCore.connect(user).openDeposit(0, minDeposit);
      await savingCore.connect(user).openDeposit(0, depositAmount);
      await savingCore.connect(user).openDeposit(0, maxDeposit);

      const minPosition = await savingCore.deposits(0);
      const normalPosition = await savingCore.deposits(1);
      const maxPosition = await savingCore.deposits(2);

      expect(await savingCore.nextDepositId()).to.equal(3n);
      expect(await savingCore.ownerOf(0)).to.equal(user.address);
      expect(await savingCore.ownerOf(1)).to.equal(user.address);
      expect(await savingCore.ownerOf(2)).to.equal(user.address);
      expect(minPosition.principal).to.equal(minDeposit);
      expect(normalPosition.principal).to.equal(depositAmount);
      expect(maxPosition.principal).to.equal(maxDeposit);
      expect(normalPosition.maturityAt - normalPosition.startAt).to.equal(tenorSeconds);
      expect(normalPosition.aprBpsAtOpen).to.equal(aprBps);
      expect(normalPosition.penaltyBpsAtOpen).to.equal(penaltyBps);
      expect(normalPosition.status).to.equal(1n);
      expect(await mockUSDC.balanceOf(user.address)).to.equal(userBefore - totalApproval);
      expect(await mockUSDC.balanceOf(savingCoreAddress)).to.equal(coreBefore + totalApproval);
    });

    it("rejects opening deposits for unknown plans, disabled plans, invalid limits, and maturity overflow", async function () {
      const { user, mockUSDC, savingCore, savingCoreAddress } = await deploySavingCoreFixture();
      await mockUSDC.connect(user).approve(savingCoreAddress, maxDeposit);

      await expectCustomError(savingCore.connect(user).openDeposit.staticCall(99, depositAmount), savingCore.interface, "PlanNotFound");
      await savingCore.disablePlan(0);
      await expectCustomError(savingCore.connect(user).openDeposit.staticCall(0, depositAmount), savingCore.interface, "PlanNotEnabled");
      await savingCore.enablePlan(0);
      await expectCustomError(savingCore.connect(user).openDeposit.staticCall(0, minDeposit - 1n), savingCore.interface, "AmountBelowMinimum");
      await expectCustomError(savingCore.connect(user).openDeposit.staticCall(0, maxDeposit + 1n), savingCore.interface, "AmountAboveMaximum");
      await expectCustomError(savingCore.connect(user).openDeposit.staticCall(0, 0), savingCore.interface, "InvalidAmount");

      await savingCore.createPlan(2n ** 64n - 1n, aprBps, minDeposit, maxDeposit, penaltyBps, true);
      await expectCustomError(savingCore.connect(user).openDeposit.staticCall(1, depositAmount), savingCore.interface, "MaturityOverflow");
    });

    it("withdraws principal plus exact truncated simple interest at maturity", async function () {
      const { user, mockUSDC, vaultAddress, savingCore, savingCoreAddress, openDefaultDeposit } = await deploySavingCoreFixture();
      await openDefaultDeposit();

      const deposit = await savingCore.deposits(0);
      await expectCustomError(savingCore.connect(user).withdrawAtMaturity.staticCall(0), savingCore.interface, "NotMatured");
      await time.increase(Number(tenorSeconds));

      const interest = calculateInterest(deposit.principal, deposit.aprBpsAtOpen, deposit.maturityAt - deposit.startAt);
      const userBefore = await mockUSDC.balanceOf(user.address);
      const coreBefore = await mockUSDC.balanceOf(savingCoreAddress);
      const vaultBefore = await mockUSDC.balanceOf(vaultAddress);

      await savingCore.connect(user).withdrawAtMaturity(0);

      expect((await savingCore.deposits(0)).status).to.equal(2n);
      expect(await savingCore.unpaidInterest(0)).to.equal(0n);
      expect(await savingCore.interestClaimant(0)).to.equal(ethers.ZeroAddress);
      expect(await mockUSDC.balanceOf(user.address)).to.equal(userBefore + depositAmount + interest);
      expect(await mockUSDC.balanceOf(savingCoreAddress)).to.equal(coreBefore - depositAmount);
      expect(await mockUSDC.balanceOf(vaultAddress)).to.equal(vaultBefore - interest);
      await expectCustomError(savingCore.ownerOf.staticCall(0), savingCore.interface, "ERC721NonexistentToken");
    });

    it("handles zero-interest maturity withdrawal and rejects non-owner or non-existent withdrawals", async function () {
      const { user, other, mockUSDC, vaultAddress, savingCore, savingCoreAddress } = await deploySavingCoreFixture();
      await savingCore.createPlan(tenorDays, 0, minDeposit, maxDeposit, penaltyBps, true);
      await mockUSDC.connect(user).approve(savingCoreAddress, depositAmount);
      await savingCore.connect(user).openDeposit(1, depositAmount);

      await expectCustomError(savingCore.connect(other).withdrawAtMaturity.staticCall(0), savingCore.interface, "NotDepositOwner");
      await expectCustomError(savingCore.connect(user).withdrawAtMaturity.staticCall(99), savingCore.interface, "DepositNotFound");

      await time.increase(Number(tenorSeconds));
      const userBefore = await mockUSDC.balanceOf(user.address);
      const vaultBefore = await mockUSDC.balanceOf(vaultAddress);

      await savingCore.connect(user).withdrawAtMaturity(0);

      expect(await mockUSDC.balanceOf(user.address)).to.equal(userBefore + depositAmount);
      expect(await mockUSDC.balanceOf(vaultAddress)).to.equal(vaultBefore);
      await expectCustomError(savingCore.connect(user).withdrawAtMaturity.staticCall(0), savingCore.interface, "DepositNotActive");
    });

    it("previews whether a matured deposit's interest can currently be paid", async function () {
      const { vaultManager, savingCore, openDefaultDeposit } = await deploySavingCoreFixture();
      await openDefaultDeposit();
      const deposit = await savingCore.deposits(0);
      const interest = calculateInterest(deposit.principal, deposit.aprBpsAtOpen, deposit.maturityAt - deposit.startAt);

      let preview = await savingCore.previewMaturitySettlement(0);
      expect(preview.principal).to.equal(depositAmount);
      expect(preview.interest).to.equal(interest);
      expect(preview.canPayInterest).to.equal(true);

      await vaultManager.withdrawVault(vaultFunds);

      preview = await savingCore.previewMaturitySettlement(0);
      expect(preview.principal).to.equal(depositAmount);
      expect(preview.interest).to.equal(interest);
      expect(preview.canPayInterest).to.equal(false);
      await expectCustomError(savingCore.previewMaturitySettlement.staticCall(99), savingCore.interface, "DepositNotFound");
    });

    it("pays principal and records unpaid interest when the vault is empty at maturity", async function () {
      const { user, mockUSDC, vaultManager, vaultAddress, savingCore, savingCoreAddress, openDefaultDeposit } = await deploySavingCoreFixture();
      await openDefaultDeposit();
      const deposit = await savingCore.deposits(0);
      const interest = calculateInterest(deposit.principal, deposit.aprBpsAtOpen, deposit.maturityAt - deposit.startAt);
      await vaultManager.withdrawVault(vaultFunds);
      await time.increase(Number(tenorSeconds));

      const userBefore = await mockUSDC.balanceOf(user.address);
      const coreBefore = await mockUSDC.balanceOf(savingCoreAddress);

      const tx = await savingCore.connect(user).withdrawAtMaturity(0);
      const receipt = await tx.wait();
      const eventNames = parsedEventNames(receipt, savingCore.interface);
      expect(eventNames).to.include("InterestDeferred");
      expect(eventNames).to.include("Withdrawn");

      expect((await savingCore.deposits(0)).status).to.equal(2n);
      expect(await savingCore.unpaidInterest(0)).to.equal(interest);
      expect(await savingCore.interestClaimant(0)).to.equal(user.address);
      expect(await mockUSDC.balanceOf(user.address)).to.equal(userBefore + depositAmount);
      expect(await mockUSDC.balanceOf(savingCoreAddress)).to.equal(coreBefore - depositAmount);
      expect(await mockUSDC.balanceOf(vaultAddress)).to.equal(0n);
      await expectCustomError(savingCore.ownerOf.staticCall(0), savingCore.interface, "ERC721NonexistentToken");
    });

    it("records unpaid interest instead of silently paying principal only when the vault is underfunded", async function () {
      const { user, mockUSDC, vaultManager, vaultAddress, savingCore, openDefaultDeposit } = await deploySavingCoreFixture();
      await openDefaultDeposit();
      const deposit = await savingCore.deposits(0);
      const interest = calculateInterest(deposit.principal, deposit.aprBpsAtOpen, deposit.maturityAt - deposit.startAt);
      await vaultManager.withdrawVault(vaultFunds);
      await mockUSDC.approve(vaultAddress, interest - 1n);
      await vaultManager.fundVault(interest - 1n);
      await time.increase(Number(tenorSeconds));

      await savingCore.connect(user).withdrawAtMaturity(0);

      expect(await savingCore.unpaidInterest(0)).to.equal(interest);
      expect(await savingCore.interestClaimant(0)).to.equal(user.address);
      expect(await mockUSDC.balanceOf(vaultAddress)).to.equal(interest - 1n);
    });

    it("lets the recorded claimant claim deferred interest after the vault is funded", async function () {
      const { user, other, mockUSDC, vaultManager, vaultAddress, savingCore, openDefaultDeposit } = await deploySavingCoreFixture();
      await openDefaultDeposit();
      const deposit = await savingCore.deposits(0);
      const interest = calculateInterest(deposit.principal, deposit.aprBpsAtOpen, deposit.maturityAt - deposit.startAt);
      await vaultManager.withdrawVault(vaultFunds);
      await time.increase(Number(tenorSeconds));
      await savingCore.connect(user).withdrawAtMaturity(0);

      await expectCustomError(savingCore.connect(other).claimInterest.staticCall(0), savingCore.interface, "NotInterestClaimant");
      await expectCustomError(savingCore.connect(user).claimInterest.staticCall(0), savingCore.interface, "InterestUnavailable");

      await mockUSDC.approve(vaultAddress, interest);
      await vaultManager.fundVault(interest);
      const userBefore = await mockUSDC.balanceOf(user.address);

      const tx = await savingCore.connect(user).claimInterest(0);
      const receipt = await tx.wait();
      expect(parsedEventNames(receipt, savingCore.interface)).to.include("InterestClaimed");

      expect(await mockUSDC.balanceOf(user.address)).to.equal(userBefore + interest);
      expect(await savingCore.unpaidInterest(0)).to.equal(0n);
      expect(await savingCore.interestClaimant(0)).to.equal(ethers.ZeroAddress);
      await expectCustomError(savingCore.connect(user).claimInterest.staticCall(0), savingCore.interface, "NoUnpaidInterest");
    });

    it("stores the transferred NFT owner as the deferred-interest claimant", async function () {
      const { user, other, vaultManager, savingCore, openDefaultDeposit } = await deploySavingCoreFixture();
      await openDefaultDeposit();
      await savingCore.connect(user).transferFrom(user.address, other.address, 0);
      await vaultManager.withdrawVault(vaultFunds);
      await time.increase(Number(tenorSeconds));

      await savingCore.connect(other).withdrawAtMaturity(0);

      expect(await savingCore.interestClaimant(0)).to.equal(other.address);
      await expectCustomError(savingCore.connect(user).claimInterest.staticCall(0), savingCore.interface, "NotInterestClaimant");
    });

    it("lets the transferred deposit NFT owner withdraw at maturity", async function () {
      const { user, other, savingCore, openDefaultDeposit } = await deploySavingCoreFixture();
      await openDefaultDeposit();

      await savingCore.connect(user).transferFrom(user.address, other.address, 0);
      expect(await savingCore.ownerOf(0)).to.equal(other.address);

      await expectCustomError(savingCore.connect(user).withdrawAtMaturity.staticCall(0), savingCore.interface, "NotDepositOwner");
      await time.increase(Number(tenorSeconds));

      await savingCore.connect(other).withdrawAtMaturity(0);
      expect((await savingCore.deposits(0)).status).to.equal(2n);
    });
  });

  describe("Early Withdraw", function () {
    it("deducts the 6.5% penalty and sends it to the fee receiver", async function () {
      const { feeReceiver, user, mockUSDC, vaultAddress, savingCore, savingCoreAddress, openDefaultDeposit } = await deploySavingCoreFixture();
      await openDefaultDeposit();

      const penalty = (depositAmount * penaltyBps) / bpsDenominator;
      const payout = depositAmount - penalty;
      const userBefore = await mockUSDC.balanceOf(user.address);
      const feeBefore = await mockUSDC.balanceOf(feeReceiver.address);
      const coreBefore = await mockUSDC.balanceOf(savingCoreAddress);
      const vaultBefore = await mockUSDC.balanceOf(vaultAddress);

      await savingCore.connect(user).earlyWithdraw(0);

      expect((await savingCore.deposits(0)).status).to.equal(3n);
      expect(await mockUSDC.balanceOf(user.address)).to.equal(userBefore + payout);
      expect(await mockUSDC.balanceOf(feeReceiver.address)).to.equal(feeBefore + penalty);
      expect(await mockUSDC.balanceOf(savingCoreAddress)).to.equal(coreBefore - depositAmount);
      expect(await mockUSDC.balanceOf(vaultAddress)).to.equal(vaultBefore);
      await expectCustomError(savingCore.ownerOf.staticCall(0), savingCore.interface, "ERC721NonexistentToken");
    });

    it("covers zero-penalty and full-penalty early withdrawal branches", async function () {
      const { feeReceiver, user, mockUSDC, savingCore, savingCoreAddress } = await deploySavingCoreFixture();
      await savingCore.createPlan(tenorDays, aprBps, minDeposit, maxDeposit, 0, true);
      await savingCore.createPlan(tenorDays, aprBps, minDeposit, maxDeposit, 10_000, true);
      await mockUSDC.connect(user).approve(savingCoreAddress, depositAmount * 2n);

      await savingCore.connect(user).openDeposit(1, depositAmount);
      const zeroPenaltyUserBefore = await mockUSDC.balanceOf(user.address);
      const zeroPenaltyFeeBefore = await mockUSDC.balanceOf(feeReceiver.address);
      await savingCore.connect(user).earlyWithdraw(0);
      expect(await mockUSDC.balanceOf(user.address)).to.equal(zeroPenaltyUserBefore + depositAmount);
      expect(await mockUSDC.balanceOf(feeReceiver.address)).to.equal(zeroPenaltyFeeBefore);

      await savingCore.connect(user).openDeposit(2, depositAmount);
      const fullPenaltyUserBefore = await mockUSDC.balanceOf(user.address);
      const fullPenaltyFeeBefore = await mockUSDC.balanceOf(feeReceiver.address);
      await savingCore.connect(user).earlyWithdraw(1);
      expect(await mockUSDC.balanceOf(user.address)).to.equal(fullPenaltyUserBefore);
      expect(await mockUSDC.balanceOf(feeReceiver.address)).to.equal(fullPenaltyFeeBefore + depositAmount);
    });

    it("rejects early withdrawal by non-owner, after maturity, and for non-existent deposits", async function () {
      const { user, other, savingCore, openDefaultDeposit } = await deploySavingCoreFixture();
      await openDefaultDeposit();

      await expectCustomError(savingCore.connect(other).earlyWithdraw.staticCall(0), savingCore.interface, "NotDepositOwner");
      await expectCustomError(savingCore.connect(user).earlyWithdraw.staticCall(99), savingCore.interface, "DepositNotFound");
      await time.increase(Number(tenorSeconds));
      await expectCustomError(savingCore.connect(user).earlyWithdraw.staticCall(0), savingCore.interface, "AlreadyMatured");
    });

    it("lets the transferred deposit NFT owner withdraw early", async function () {
      const { user, other, savingCore, openDefaultDeposit } = await deploySavingCoreFixture();
      await openDefaultDeposit();

      await savingCore.connect(user).transferFrom(user.address, other.address, 0);

      await expectCustomError(savingCore.connect(user).earlyWithdraw.staticCall(0), savingCore.interface, "NotDepositOwner");
      await savingCore.connect(other).earlyWithdraw(0);
      expect((await savingCore.deposits(0)).status).to.equal(3n);
    });
  });

  describe("Renewals", function () {
    it("manually renews a matured deposit into a new plan and compounds exact interest", async function () {
      const { user, mockUSDC, vaultAddress, savingCore, savingCoreAddress, openDefaultDeposit } = await deploySavingCoreFixture();
      await openDefaultDeposit();
      await savingCore.createPlan(365, 400, minDeposit, 20_000n * oneUsdc, 300, true);

      const oldDeposit = await savingCore.deposits(0);
      await time.increase(Number(tenorSeconds));
      const interest = calculateInterest(oldDeposit.principal, oldDeposit.aprBpsAtOpen, oldDeposit.maturityAt - oldDeposit.startAt);
      const userBefore = await mockUSDC.balanceOf(user.address);
      const coreBefore = await mockUSDC.balanceOf(savingCoreAddress);
      const vaultBefore = await mockUSDC.balanceOf(vaultAddress);

      await savingCore.connect(user).renewDeposit(0, 1);

      const renewedOldDeposit = await savingCore.deposits(0);
      const newDeposit = await savingCore.deposits(1);
      expect(renewedOldDeposit.status).to.equal(4n);
      expect(await savingCore.ownerOf(0)).to.equal(user.address);
      expect(await savingCore.ownerOf(1)).to.equal(user.address);
      expect(newDeposit.planId).to.equal(1n);
      expect(newDeposit.principal).to.equal(depositAmount + interest);
      expect(newDeposit.maturityAt - newDeposit.startAt).to.equal(365n * 24n * 60n * 60n);
      expect(newDeposit.aprBpsAtOpen).to.equal(400n);
      expect(newDeposit.penaltyBpsAtOpen).to.equal(300n);
      expect(await mockUSDC.balanceOf(user.address)).to.equal(userBefore);
      expect(await mockUSDC.balanceOf(savingCoreAddress)).to.equal(coreBefore + interest);
      expect(await mockUSDC.balanceOf(vaultAddress)).to.equal(vaultBefore - interest);
    });

    it("rejects invalid manual renewals", async function () {
      const { user, other, savingCore, openDefaultDeposit } = await deploySavingCoreFixture();
      await openDefaultDeposit();
      await savingCore.createPlan(365, 400, minDeposit, maxDeposit, 300, true);

      await expectCustomError(savingCore.connect(user).renewDeposit.staticCall(0, 1), savingCore.interface, "NotMatured");
      await time.increase(Number(tenorSeconds));
      await expectCustomError(savingCore.connect(other).renewDeposit.staticCall(0, 1), savingCore.interface, "NotDepositOwner");

      await savingCore.createPlan(365, 400, minDeposit, maxDeposit, 300, false);
      await expectCustomError(savingCore.connect(user).renewDeposit.staticCall(0, 2), savingCore.interface, "PlanNotEnabled");

      await savingCore.createPlan(365, 400, minDeposit, depositAmount, 300, true);
      await expectCustomError(savingCore.connect(user).renewDeposit.staticCall(0, 3), savingCore.interface, "NewPrincipalOutOfRange");

      await savingCore.createPlan(365, 400, depositAmount * 2n, maxDeposit, 300, true);
      await expectCustomError(savingCore.connect(user).renewDeposit.staticCall(0, 4), savingCore.interface, "NewPrincipalOutOfRange");
      await expectCustomError(savingCore.connect(user).renewDeposit.staticCall(99, 1), savingCore.interface, "DepositNotFound");
    });

    it("lets the transferred deposit NFT owner manually renew at maturity", async function () {
      const { user, other, savingCore, openDefaultDeposit } = await deploySavingCoreFixture();
      await openDefaultDeposit();
      await savingCore.createPlan(365, 400, minDeposit, 20_000n * oneUsdc, 300, true);
      await savingCore.connect(user).transferFrom(user.address, other.address, 0);

      await time.increase(Number(tenorSeconds));

      await expectCustomError(savingCore.connect(user).renewDeposit.staticCall(0, 1), savingCore.interface, "NotDepositOwner");
      await savingCore.connect(other).renewDeposit(0, 1);

      expect((await savingCore.deposits(0)).status).to.equal(4n);
      expect(await savingCore.ownerOf(1)).to.equal(other.address);
    });

    it("blocks manual renewal for a deposit when the vault cannot pay the interest to compound", async function () {
      const { user, vaultManager, savingCore, openDefaultDeposit } = await deploySavingCoreFixture();
      await openDefaultDeposit();
      await savingCore.createPlan(365, 400, minDeposit, 20_000n * oneUsdc, 300, true);
      await vaultManager.withdrawVault(vaultFunds);
      await time.increase(Number(tenorSeconds));

      await expectCustomError(savingCore.connect(user).renewDeposit.staticCall(0, 1), savingCore.interface, "InterestUnavailable");
      expect((await savingCore.deposits(0)).status).to.equal(1n);
    });

    it("does not globally block another deposit's solvent manual renewal", async function () {
      const { user, mockUSDC, vaultManager, vaultAddress, savingCore, savingCoreAddress } = await deploySavingCoreFixture();
      const smallDeposit = minDeposit;
      await savingCore.createPlan(365, 400, minDeposit, 20_000n * oneUsdc, 300, true);
      await mockUSDC.connect(user).approve(savingCoreAddress, depositAmount + smallDeposit);
      await savingCore.connect(user).openDeposit(0, depositAmount);
      await savingCore.connect(user).openDeposit(0, smallDeposit);

      const large = await savingCore.deposits(0);
      const small = await savingCore.deposits(1);
      const largeInterest = calculateInterest(large.principal, large.aprBpsAtOpen, large.maturityAt - large.startAt);
      const smallInterest = calculateInterest(small.principal, small.aprBpsAtOpen, small.maturityAt - small.startAt);
      expect(largeInterest > smallInterest).to.equal(true);

      await vaultManager.withdrawVault(vaultFunds);
      await mockUSDC.approve(vaultAddress, smallInterest);
      await vaultManager.fundVault(smallInterest);
      await time.increase(Number(tenorSeconds));

      await expectCustomError(savingCore.connect(user).renewDeposit.staticCall(0, 1), savingCore.interface, "InterestUnavailable");
      await savingCore.connect(user).renewDeposit(1, 1);

      expect((await savingCore.deposits(0)).status).to.equal(1n);
      expect((await savingCore.deposits(1)).status).to.equal(4n);
      expect((await savingCore.deposits(2)).principal).to.equal(smallDeposit + smallInterest);
    });

    it("auto-renews permissionlessly after the 3-day grace period and preserves original economics", async function () {
      const { user, bot, mockUSDC, vaultAddress, savingCore, savingCoreAddress, openDefaultDeposit } = await deploySavingCoreFixture();
      await openDefaultDeposit();
      await savingCore.updatePlan(0, 1_000);

      const oldDeposit = await savingCore.deposits(0);
      const beforeGraceTarget = oldDeposit.maturityAt + autoRenewGracePeriod - 1n;
      await time.increase(Number(beforeGraceTarget - BigInt(await time.latest())));
      await expectCustomError(savingCore.connect(bot).autoRenewDeposit.staticCall(0), savingCore.interface, "GracePeriodNotEnded");
      await time.increase(1);

      const interest = calculateInterest(oldDeposit.principal, oldDeposit.aprBpsAtOpen, oldDeposit.maturityAt - oldDeposit.startAt);
      const coreBefore = await mockUSDC.balanceOf(savingCoreAddress);
      const vaultBefore = await mockUSDC.balanceOf(vaultAddress);

      await savingCore.connect(bot).autoRenewDeposit(0);

      const renewedOldDeposit = await savingCore.deposits(0);
      const newDeposit = await savingCore.deposits(1);
      expect(renewedOldDeposit.status).to.equal(5n);
      expect(await savingCore.ownerOf(0)).to.equal(user.address);
      expect(await savingCore.ownerOf(1)).to.equal(user.address);
      expect(newDeposit.planId).to.equal(oldDeposit.planId);
      expect(newDeposit.principal).to.equal(depositAmount + interest);
      expect(newDeposit.maturityAt - newDeposit.startAt).to.equal(oldDeposit.maturityAt - oldDeposit.startAt);
      expect(newDeposit.aprBpsAtOpen).to.equal(aprBps);
      expect(newDeposit.penaltyBpsAtOpen).to.equal(penaltyBps);
      expect(await mockUSDC.balanceOf(savingCoreAddress)).to.equal(coreBefore + interest);
      expect(await mockUSDC.balanceOf(vaultAddress)).to.equal(vaultBefore - interest);
    });

    it("blocks auto-renewal for a deposit when the vault cannot pay the interest to compound", async function () {
      const { bot, vaultManager, savingCore, openDefaultDeposit } = await deploySavingCoreFixture();
      await openDefaultDeposit();
      await vaultManager.withdrawVault(vaultFunds);
      await time.increase(Number(tenorSeconds + autoRenewGracePeriod));

      await expectCustomError(savingCore.connect(bot).autoRenewDeposit.staticCall(0), savingCore.interface, "InterestUnavailable");
      expect((await savingCore.deposits(0)).status).to.equal(1n);
    });

    it("blocks auto-renewal when the original plan is disabled but still allows maturity withdrawal", async function () {
      const { user, bot, savingCore, openDefaultDeposit } = await deploySavingCoreFixture();
      await openDefaultDeposit();
      await savingCore.disablePlan(0);
      await time.increase(Number(tenorSeconds + autoRenewGracePeriod));

      await expectCustomError(savingCore.connect(bot).autoRenewDeposit.staticCall(0), savingCore.interface, "PlanNotEnabled");
      expect((await savingCore.deposits(0)).status).to.equal(1n);

      await savingCore.connect(user).withdrawAtMaturity(0);
      expect((await savingCore.deposits(0)).status).to.equal(2n);
    });

    it("handles zero-interest manual and auto renewals without touching the vault", async function () {
      const { user, bot, mockUSDC, vaultAddress, savingCore, savingCoreAddress } = await deploySavingCoreFixture();
      await savingCore.createPlan(tenorDays, 0, minDeposit, maxDeposit, penaltyBps, true);
      await savingCore.createPlan(365, 0, minDeposit, maxDeposit, penaltyBps, true);
      await mockUSDC.connect(user).approve(savingCoreAddress, depositAmount * 2n);

      await savingCore.connect(user).openDeposit(1, depositAmount);
      await time.increase(Number(tenorSeconds));
      const manualCoreBefore = await mockUSDC.balanceOf(savingCoreAddress);
      const manualVaultBefore = await mockUSDC.balanceOf(vaultAddress);
      await savingCore.connect(user).renewDeposit(0, 2);
      expect((await savingCore.deposits(1)).principal).to.equal(depositAmount);
      expect(await mockUSDC.balanceOf(savingCoreAddress)).to.equal(manualCoreBefore);
      expect(await mockUSDC.balanceOf(vaultAddress)).to.equal(manualVaultBefore);

      await savingCore.connect(user).openDeposit(1, depositAmount);
      await time.increase(Number(tenorSeconds + autoRenewGracePeriod));
      const autoCoreBefore = await mockUSDC.balanceOf(savingCoreAddress);
      const autoVaultBefore = await mockUSDC.balanceOf(vaultAddress);
      await savingCore.connect(bot).autoRenewDeposit(2);
      expect((await savingCore.deposits(3)).principal).to.equal(depositAmount);
      expect(await mockUSDC.balanceOf(savingCoreAddress)).to.equal(autoCoreBefore);
      expect(await mockUSDC.balanceOf(vaultAddress)).to.equal(autoVaultBefore);
    });
  });

  describe("Pausable Security", function () {
    it("blocks openDeposit, withdrawAtMaturity, renewDeposit, and autoRenewDeposit when paused", async function () {
      const { user, bot, mockUSDC, savingCore, savingCoreAddress } = await deploySavingCoreFixture();
      await savingCore.createPlan(365, 400, minDeposit, maxDeposit, 300, true);
      await mockUSDC.connect(user).approve(savingCoreAddress, depositAmount * 3n);

      await savingCore.pause();
      await expectCustomError(savingCore.connect(user).openDeposit.staticCall(0, depositAmount), savingCore.interface, "EnforcedPause");

      await savingCore.unpause();
      await savingCore.connect(user).openDeposit(0, depositAmount);
      await savingCore.connect(user).openDeposit(0, depositAmount);
      await savingCore.connect(user).openDeposit(0, depositAmount);
      await time.increase(Number(tenorSeconds + autoRenewGracePeriod));

      await savingCore.pause();
      expect(await savingCore.paused()).to.equal(true);
      await expectCustomError(savingCore.connect(user).withdrawAtMaturity.staticCall(0), savingCore.interface, "EnforcedPause");
      await expectCustomError(savingCore.connect(user).renewDeposit.staticCall(1, 1), savingCore.interface, "EnforcedPause");
      await expectCustomError(savingCore.connect(bot).autoRenewDeposit.staticCall(2), savingCore.interface, "EnforcedPause");

      await savingCore.unpause();
      await savingCore.connect(user).withdrawAtMaturity(0);
      expect((await savingCore.deposits(0)).status).to.equal(2n);
    });

    it("blocks earlyWithdraw when paused", async function () {
      const { user, savingCore, openDefaultDeposit } = await deploySavingCoreFixture();
      await openDefaultDeposit();

      await savingCore.pause();
      await expectCustomError(savingCore.connect(user).earlyWithdraw.staticCall(0), savingCore.interface, "EnforcedPause");
    });

    it("restricts pause controls to the owner and rejects invalid pause state transitions", async function () {
      const { user, savingCore } = await deploySavingCoreFixture();

      await expectCustomError(savingCore.connect(user).pause.staticCall(), savingCore.interface, "OwnableUnauthorizedAccount");
      await expectCustomError(savingCore.unpause.staticCall(), savingCore.interface, "ExpectedPause");

      await savingCore.pause();
      await expectCustomError(savingCore.pause.staticCall(), savingCore.interface, "EnforcedPause");
    });
  });
});
