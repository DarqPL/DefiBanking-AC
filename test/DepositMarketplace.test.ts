import { expect } from "chai";
import { ethers } from "hardhat";
import { impersonateAccount, setBalance, time } from "@nomicfoundation/hardhat-network-helpers";

describe("DepositMarketplace", function () {
  const oneUsdc = 10n ** 6n;
  const minDeposit = 1n * oneUsdc;
  const maxDeposit = 10_000n * oneUsdc;
  const depositAmount = 1_000n * oneUsdc;
  const userFunds = 100_000n * oneUsdc;
  const buyerFunds = 100_000n * oneUsdc;
  const vaultFunds = 100_000n * oneUsdc;
  const tenorDays = 180n;
  const day = 24n * 60n * 60n;
  const tenorSeconds = tenorDays * day;
  const autoRenewGracePeriod = 3n * day;
  const aprBps = 225n;
  const penaltyBps = 650n;
  const termsHash = ethers.id("phase-16-marketplace-terms-v1");
  const otherTermsHash = ethers.id("phase-16-marketplace-terms-v2");
  const salePrice = 900n * oneUsdc;

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

  async function deployMarketplaceFixture() {
    const [deployer, feeReceiver, seller, buyer, other, bot] = await ethers.getSigners();

    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    const mockUSDC = await MockUSDC.deploy();

    const VaultManager = await ethers.getContractFactory("VaultManager");
    const vaultManager = await VaultManager.deploy(await mockUSDC.getAddress(), feeReceiver.address);

    const SavingCore = await ethers.getContractFactory("SavingCore");
    const savingCore = await SavingCore.deploy(await mockUSDC.getAddress(), await vaultManager.getAddress());

    const DepositMarketplace = await ethers.getContractFactory("DepositMarketplace");
    const marketplace = await DepositMarketplace.deploy(await savingCore.getAddress(), await mockUSDC.getAddress(), termsHash);

    const vaultAddress = await vaultManager.getAddress();
    const savingCoreAddress = await savingCore.getAddress();
    const marketplaceAddress = await marketplace.getAddress();

    await vaultManager.setSavingCore(savingCoreAddress);
    await savingCore.setDepositMarketplace(marketplaceAddress);
    await mockUSDC.mint(seller.address, userFunds);
    await mockUSDC.mint(buyer.address, buyerFunds);
    await mockUSDC.approve(vaultAddress, vaultFunds);
    await vaultManager.fundVault(vaultFunds);
    await savingCore.createPlan(tenorDays, aprBps, minDeposit, maxDeposit, penaltyBps, true);

    async function openDeposit(planId = 0n, amount = depositAmount) {
      await mockUSDC.connect(seller).approve(savingCoreAddress, amount);
      await savingCore.connect(seller).openDeposit(planId, amount);
      return (await savingCore.nextDepositId()) - 1n;
    }

    async function listDeposit(depositId: bigint, price = salePrice) {
      await savingCore.connect(seller).approve(marketplaceAddress, depositId);
      await marketplace.connect(seller).listDeposit(depositId, price, termsHash);
    }

    return {
      deployer,
      feeReceiver,
      seller,
      buyer,
      other,
      bot,
      mockUSDC,
      vaultManager,
      savingCore,
      marketplace,
      vaultAddress,
      savingCoreAddress,
      marketplaceAddress,
      openDeposit,
      listDeposit,
    };
  }

  describe("Deployment", function () {
    it("stores the official contracts and terms hash", async function () {
      const { deployer, mockUSDC, savingCore, marketplace } = await deployMarketplaceFixture();

      expect(await marketplace.owner()).to.equal(deployer.address);
      expect(await marketplace.savingCore()).to.equal(await savingCore.getAddress());
      expect(await marketplace.paymentToken()).to.equal(await mockUSDC.getAddress());
      expect(await marketplace.currentTermsHash()).to.equal(termsHash);
      expect(await marketplace.listedCount()).to.equal(0n);
    });

    it("rejects invalid constructor parameters", async function () {
      const { mockUSDC, savingCore, marketplace } = await deployMarketplaceFixture();
      const DepositMarketplace = await ethers.getContractFactory("DepositMarketplace");

      await expectCustomError(
        DepositMarketplace.deploy(ethers.ZeroAddress, await mockUSDC.getAddress(), termsHash),
        marketplace.interface,
        "InvalidAddress",
      );
      await expectCustomError(
        DepositMarketplace.deploy(await savingCore.getAddress(), ethers.ZeroAddress, termsHash),
        marketplace.interface,
        "InvalidAddress",
      );
      await expectCustomError(
        DepositMarketplace.deploy(await savingCore.getAddress(), await mockUSDC.getAddress(), ethers.ZeroHash),
        marketplace.interface,
        "InvalidTerms",
      );
    });

    it("lets the owner update terms and rejects unauthorized updates", async function () {
      const { other, marketplace } = await deployMarketplaceFixture();

      await marketplace.setTermsHash(otherTermsHash);
      expect(await marketplace.currentTermsHash()).to.equal(otherTermsHash);

      await expectCustomError(marketplace.setTermsHash.staticCall(ethers.ZeroHash), marketplace.interface, "InvalidTerms");
      await expectCustomError(
        marketplace.connect(other).setTermsHash.staticCall(termsHash),
        marketplace.interface,
        "OwnableUnauthorizedAccount",
      );
    });
  });

  describe("Listings", function () {
    it("lists an eligible active deposit and transfers the NFT into escrow", async function () {
      const { seller, savingCore, marketplace, marketplaceAddress, openDeposit, listDeposit } = await deployMarketplaceFixture();
      const depositId = await openDeposit();

      await listDeposit(depositId);

      const listing = await marketplace.listings(depositId);
      expect(listing.seller).to.equal(seller.address);
      expect(listing.price).to.equal(salePrice);
      expect(await marketplace.listedCount()).to.equal(1n);
      expect(await marketplace.listedDepositIds(0)).to.equal(depositId);
      expect(await savingCore.ownerOf(depositId)).to.equal(marketplaceAddress);
    });

    it("prevents the seller from withdrawing while the NFT is escrowed", async function () {
      const { seller, savingCore, marketplaceAddress, openDeposit, listDeposit } = await deployMarketplaceFixture();
      const depositId = await openDeposit();
      await listDeposit(depositId);

      expect(await savingCore.ownerOf(depositId)).to.equal(marketplaceAddress);
      await expectCustomError(savingCore.connect(seller).earlyWithdraw.staticCall(depositId), savingCore.interface, "NotDepositOwner");
    });

    it("rejects invalid listing attempts", async function () {
      const { seller, buyer, savingCore, marketplace, marketplaceAddress, openDeposit, listDeposit } = await deployMarketplaceFixture();
      const depositId = await openDeposit();

      await savingCore.connect(seller).approve(marketplaceAddress, depositId);
      await expectCustomError(marketplace.connect(seller).listDeposit.staticCall(depositId, 0, termsHash), marketplace.interface, "InvalidPrice");
      await expectCustomError(
        marketplace.connect(seller).listDeposit.staticCall(depositId, (1n << 96n), termsHash),
        marketplace.interface,
        "InvalidPrice",
      );
      await expectCustomError(
        marketplace.connect(seller).listDeposit.staticCall(depositId, salePrice, otherTermsHash),
        marketplace.interface,
        "InvalidTerms",
      );
      await expectCustomError(
        marketplace.connect(buyer).listDeposit.staticCall(depositId, salePrice, termsHash),
        marketplace.interface,
        "NotDepositOwner",
      );
      await expectCustomError(
        marketplace.connect(seller).listDeposit.staticCall(99, salePrice, termsHash),
        savingCore.interface,
        "ERC721NonexistentToken",
      );

      await listDeposit(depositId);
      await expectCustomError(
        marketplace.connect(seller).listDeposit.staticCall(depositId, salePrice, termsHash),
        marketplace.interface,
        "AlreadyListed",
      );
    });

    it("rejects inactive deposits", async function () {
      const { seller, savingCore, marketplace, marketplaceAddress, openDeposit } = await deployMarketplaceFixture();
      const depositId = await openDeposit();
      await savingCore.connect(seller).earlyWithdraw(depositId);

      await expectCustomError(
        marketplace.connect(seller).listDeposit.staticCall(depositId, salePrice, termsHash),
        savingCore.interface,
        "ERC721NonexistentToken",
      );

      const renewedDepositId = await openDeposit();
      await savingCore.connect(seller).approve(marketplaceAddress, renewedDepositId);
      await time.increase(Number(tenorSeconds));
      await savingCore.connect(seller).renewDeposit(renewedDepositId, 0);

      await expectCustomError(
        marketplace.connect(seller).listDeposit.staticCall(renewedDepositId, salePrice, termsHash),
        marketplace.interface,
        "DepositNotActive",
      );
    });
  });

  describe("Restricted Window", function () {
    it("calculates the no-listing window floor, percentage, and cap", async function () {
      const { marketplace, savingCore, openDeposit } = await deployMarketplaceFixture();
      await savingCore.createPlan(30, aprBps, minDeposit, maxDeposit, penaltyBps, true);
      await savingCore.createPlan(365, aprBps, minDeposit, maxDeposit, penaltyBps, true);
      await savingCore.createPlan(1_000, aprBps, minDeposit, maxDeposit, penaltyBps, true);

      const defaultDepositId = await openDeposit(0n);
      const shortDepositId = await openDeposit(1n);
      const yearDepositId = await openDeposit(2n);
      const longDepositId = await openDeposit(3n);

      expect(await marketplace.noListingDays(defaultDepositId)).to.equal(10n);
      expect(await marketplace.noListingDays(shortDepositId)).to.equal(10n);
      expect(await marketplace.noListingDays(yearDepositId)).to.equal(18n);
      expect(await marketplace.noListingDays(longDepositId)).to.equal(30n);
    });

    it("blocks listing at exactly the restricted window boundary", async function () {
      const { seller, savingCore, marketplace, marketplaceAddress, openDeposit } = await deployMarketplaceFixture();
      const depositId = await openDeposit();
      const deposit = await savingCore.deposits(depositId);

      await time.increaseTo(Number(deposit.maturityAt - 10n * day));
      await savingCore.connect(seller).approve(marketplaceAddress, depositId);

      await expectCustomError(
        marketplace.connect(seller).listDeposit.staticCall(depositId, salePrice, termsHash),
        marketplace.interface,
        "RestrictedWindow",
      );
      expect(await marketplace.isListable(depositId)).to.equal(false);
    });
  });

  describe("Purchases", function () {
    it("lets a buyer purchase and later withdraw the deposit at maturity", async function () {
      const { seller, buyer, mockUSDC, savingCore, marketplace, openDeposit, listDeposit } = await deployMarketplaceFixture();
      const depositId = await openDeposit();
      await listDeposit(depositId);

      const sellerBefore = await mockUSDC.balanceOf(seller.address);
      const buyerBefore = await mockUSDC.balanceOf(buyer.address);

      await mockUSDC.connect(buyer).approve(await marketplace.getAddress(), salePrice);
      await marketplace.connect(buyer).buyDeposit(depositId);

      expect(await mockUSDC.balanceOf(seller.address)).to.equal(sellerBefore + salePrice);
      expect(await mockUSDC.balanceOf(buyer.address)).to.equal(buyerBefore - salePrice);
      expect(await savingCore.ownerOf(depositId)).to.equal(buyer.address);
      expect(await marketplace.listedCount()).to.equal(0n);
      await expectCustomError(savingCore.connect(seller).withdrawAtMaturity.staticCall(depositId), savingCore.interface, "NotDepositOwner");

      await time.increase(Number(tenorSeconds));
      await savingCore.connect(buyer).withdrawAtMaturity(depositId);
      expect((await savingCore.deposits(depositId)).status).to.equal(2n);
    });

    it("rejects invalid purchases and self-buy", async function () {
      const { seller, buyer, mockUSDC, savingCore, marketplace, openDeposit, listDeposit } = await deployMarketplaceFixture();
      const depositId = await openDeposit();
      await listDeposit(depositId);

      await expectCustomError(marketplace.connect(buyer).buyDeposit.staticCall(99), marketplace.interface, "ListingNotFound");
      await expectCustomError(marketplace.connect(seller).buyDeposit.staticCall(depositId), marketplace.interface, "SelfBuyNotAllowed");

      const deposit = await savingCore.deposits(depositId);
      await time.increaseTo(Number(deposit.maturityAt - 10n * day));
      await mockUSDC.connect(buyer).approve(await marketplace.getAddress(), salePrice);

      await expectCustomError(marketplace.connect(buyer).buyDeposit.staticCall(depositId), marketplace.interface, "RestrictedWindow");
    });
  });

  describe("Cancellation and Cleanup", function () {
    it("lets the seller cancel and returns the NFT", async function () {
      const { seller, buyer, savingCore, marketplace, openDeposit, listDeposit } = await deployMarketplaceFixture();
      const depositId = await openDeposit();
      await listDeposit(depositId);

      await expectCustomError(marketplace.connect(buyer).cancelListing.staticCall(depositId), marketplace.interface, "NotSeller");
      await marketplace.connect(seller).cancelListing(depositId);

      expect(await savingCore.ownerOf(depositId)).to.equal(seller.address);
      expect(await marketplace.listedCount()).to.equal(0n);
      await expectCustomError(marketplace.connect(seller).cancelListing.staticCall(depositId), marketplace.interface, "ListingNotFound");
    });

    it("cleans expired listings and returns NFTs to sellers", async function () {
      const { seller, savingCore, marketplace, openDeposit, listDeposit } = await deployMarketplaceFixture();
      const firstDepositId = await openDeposit();
      const secondDepositId = await openDeposit();
      await listDeposit(firstDepositId);
      await listDeposit(secondDepositId);

      const firstDeposit = await savingCore.deposits(firstDepositId);
      await time.increaseTo(Number(firstDeposit.maturityAt - 10n * day));

      await expectCustomError(marketplace.cleanExpiredListings.staticCall(0), marketplace.interface, "InvalidMaxListings");
      expect(await marketplace.cleanExpiredListings.staticCall(1)).to.equal(1n);
      await marketplace.cleanExpiredListings(1);

      expect(await savingCore.ownerOf(firstDepositId)).to.equal(seller.address);
      expect(await marketplace.listedCount()).to.equal(1n);

      await marketplace.cleanExpiredListings(10);
      expect(await savingCore.ownerOf(secondDepositId)).to.equal(seller.address);
      expect(await marketplace.listedCount()).to.equal(0n);
      expect(await marketplace.cleanExpiredListings.staticCall(10)).to.equal(0n);
    });

    it("skips valid listings during cleanup and advances the cursor", async function () {
      const { seller, savingCore, marketplace, marketplaceAddress, openDeposit, listDeposit } = await deployMarketplaceFixture();
      const depositId = await openDeposit();
      await listDeposit(depositId);

      expect(await marketplace.cleanExpiredListings.staticCall(1)).to.equal(0n);
      await marketplace.cleanExpiredListings(1);

      expect(await marketplace.cleanupCursor()).to.equal(1n);
      expect(await marketplace.listedCount()).to.equal(1n);
      expect(await savingCore.ownerOf(depositId)).to.equal(marketplaceAddress);

      await marketplace.cleanExpiredListings(1);
      expect(await marketplace.cleanupCursor()).to.equal(1n);

      await marketplace.connect(seller).cancelListing(depositId);
      expect(await savingCore.ownerOf(depositId)).to.equal(seller.address);
    });

    it("cleans exact stale listing ids and skips valid listings", async function () {
      const { seller, savingCore, marketplace, marketplaceAddress, openDeposit, listDeposit } = await deployMarketplaceFixture();
      const staleDepositId = await openDeposit();
      await savingCore.createPlan(1_000, aprBps, minDeposit, maxDeposit, penaltyBps, true);
      const validDepositId = await openDeposit(1n);
      await listDeposit(staleDepositId);
      await listDeposit(validDepositId);

      expect(await marketplace.isListingStale(staleDepositId)).to.equal(false);
      expect(await marketplace.isListingStale(validDepositId)).to.equal(false);

      const staleDeposit = await savingCore.deposits(staleDepositId);
      await time.increaseTo(Number(staleDeposit.maturityAt - 10n * day));

      expect(await marketplace.isListingStale(staleDepositId)).to.equal(true);
      expect(await marketplace.isListingStale(validDepositId)).to.equal(false);
      expect(await marketplace.cleanListings.staticCall([staleDepositId, validDepositId])).to.equal(1n);

      await marketplace.cleanListings([staleDepositId, validDepositId]);

      expect(await savingCore.ownerOf(staleDepositId)).to.equal(seller.address);
      expect(await savingCore.ownerOf(validDepositId)).to.equal(marketplaceAddress);
      expect(await marketplace.listedCount()).to.equal(1n);
      expect(await marketplace.isListingStale(staleDepositId)).to.equal(false);
      expect(await savingCore.balanceOf(marketplaceAddress)).to.equal(1n);
    });

    it("targeted cleanup skips unlisted and still-valid ids without moving the cursor", async function () {
      const { seller, savingCore, marketplace, marketplaceAddress, openDeposit, listDeposit } = await deployMarketplaceFixture();
      const listedDepositId = await openDeposit();
      const unlistedDepositId = await openDeposit();
      await listDeposit(listedDepositId);

      expect(await marketplace.cleanListings.staticCall([listedDepositId, unlistedDepositId, 999n])).to.equal(0n);
      await marketplace.cleanListings([listedDepositId, unlistedDepositId, 999n]);

      expect(await marketplace.cleanupCursor()).to.equal(0n);
      expect(await marketplace.listedCount()).to.equal(1n);
      expect(await savingCore.ownerOf(listedDepositId)).to.equal(marketplaceAddress);
      expect(await savingCore.ownerOf(unlistedDepositId)).to.equal(seller.address);
    });
  });

  describe("ERC721 Receiver Guard", function () {
    it("rejects direct safe transfers into the marketplace", async function () {
      const { seller, savingCore, marketplaceAddress, openDeposit } = await deployMarketplaceFixture();
      const depositId = await openDeposit();

      await savingCore.connect(seller).approve(marketplaceAddress, depositId);
      await expectCustomError(
        savingCore.connect(seller)["safeTransferFrom(address,address,uint256)"].staticCall(seller.address, marketplaceAddress, depositId),
        savingCore.interface,
        "UnauthorizedTransfer",
      );
    });

    it("rejects raw transferFrom into the marketplace", async function () {
      const { seller, savingCore, marketplace, marketplaceAddress, openDeposit } = await deployMarketplaceFixture();
      const depositId = await openDeposit();

      await expectCustomError(
        savingCore.connect(seller).transferFrom.staticCall(seller.address, marketplaceAddress, depositId),
        savingCore.interface,
        "UnauthorizedTransfer",
      );
      expect(await savingCore.ownerOf(depositId)).to.equal(seller.address);
      expect(await marketplace.listedCount()).to.equal(0n);
    });

    it("recovers an unlisted escrowed NFT and rejects invalid recovery attempts", async function () {
      const { seller, buyer, savingCore, marketplace, marketplaceAddress, openDeposit, listDeposit } = await deployMarketplaceFixture();
      const depositId = await openDeposit();

      await savingCore.connect(seller).approve(marketplaceAddress, depositId);
      await impersonateAccount(marketplaceAddress);
      await setBalance(marketplaceAddress, 10n ** 18n);
      const marketplaceSigner = await ethers.getSigner(marketplaceAddress);
      await savingCore.connect(marketplaceSigner).transferFrom(seller.address, marketplaceAddress, depositId);

      await expectCustomError(
        marketplace.connect(buyer).recoverUnlistedDeposit.staticCall(depositId, seller.address),
        marketplace.interface,
        "OwnableUnauthorizedAccount",
      );
      await expectCustomError(
        marketplace.recoverUnlistedDeposit.staticCall(depositId, ethers.ZeroAddress),
        marketplace.interface,
        "InvalidAddress",
      );

      await marketplace.recoverUnlistedDeposit(depositId, seller.address);
      expect(await savingCore.ownerOf(depositId)).to.equal(seller.address);

      await listDeposit(depositId);
      await expectCustomError(
        marketplace.recoverUnlistedDeposit.staticCall(depositId, seller.address),
        marketplace.interface,
        "AlreadyListed",
      );
    });

    it("rejects recovery when the marketplace does not hold the NFT", async function () {
      const { seller, marketplace, openDeposit } = await deployMarketplaceFixture();
      const depositId = await openDeposit();

      await expectCustomError(
        marketplace.recoverUnlistedDeposit.staticCall(depositId, seller.address),
        marketplace.interface,
        "NotEscrowed",
      );
    });

    it("rejects ERC721 receiver calls from non-SavingCore senders", async function () {
      const { seller, marketplace } = await deployMarketplaceFixture();

      await expectCustomError(
        marketplace.onERC721Received.staticCall(seller.address, seller.address, 0, "0x"),
        marketplace.interface,
        "InvalidNFT",
      );
    });

    it("rejects auto-renewal minting into marketplace escrow if cleanup fails", async function () {
      const { seller, bot, savingCore, marketplace, marketplaceAddress, openDeposit, listDeposit } = await deployMarketplaceFixture();
      const depositId = await openDeposit();
      await listDeposit(depositId);

      await time.increase(Number(tenorSeconds + autoRenewGracePeriod));
      await expectCustomError(savingCore.connect(bot).autoRenewDeposit.staticCall(depositId), marketplace.interface, "RenewalMintRejected");

      expect((await savingCore.deposits(depositId)).status).to.equal(1n);
      expect(await savingCore.ownerOf(depositId)).to.equal(marketplaceAddress);

      await marketplace.cleanExpiredListings(1);
      expect(await savingCore.ownerOf(depositId)).to.equal(seller.address);
    });
  });

  describe("Pausable", function () {
    it("blocks listing and buying while paused but still allows cancellation and cleanup", async function () {
      const { seller, buyer, savingCore, marketplace, marketplaceAddress, openDeposit, listDeposit } = await deployMarketplaceFixture();
      const depositId = await openDeposit();

      await marketplace.pause();
      await savingCore.connect(seller).approve(marketplaceAddress, depositId);
      await expectCustomError(
        marketplace.connect(seller).listDeposit.staticCall(depositId, salePrice, termsHash),
        marketplace.interface,
        "EnforcedPause",
      );

      await marketplace.unpause();
      await listDeposit(depositId);
      await marketplace.pause();

      await expectCustomError(marketplace.connect(buyer).buyDeposit.staticCall(depositId), marketplace.interface, "EnforcedPause");
      await marketplace.connect(seller).cancelListing(depositId);
      expect(await savingCore.ownerOf(depositId)).to.equal(seller.address);
    });

    it("restricts pause controls to the owner", async function () {
      const { seller, marketplace } = await deployMarketplaceFixture();

      await expectCustomError(marketplace.connect(seller).pause.staticCall(), marketplace.interface, "OwnableUnauthorizedAccount");
      await expectCustomError(marketplace.connect(seller).unpause.staticCall(), marketplace.interface, "OwnableUnauthorizedAccount");
    });
  });
});
