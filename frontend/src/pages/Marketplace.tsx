import { useCallback, useEffect, useRef, useState } from "react";
import { ethers } from "ethers";
import { CONTRACT_ADDRESSES, DEPLOYMENT_BLOCKS } from "../config";
import { useWeb3 } from "../useWeb3";
import { parseTransactionError } from "../utils/parseTransactionError";
import { ConfirmationDialog } from "../components/ConfirmationDialog";
import { ToastStack, type ToastItem } from "../components/ToastStack";

type DepositInfo = {
  id: bigint;
  planId: bigint;
  principal: bigint;
  startAt: bigint;
  maturityAt: bigint;
  aprBpsAtOpen: bigint;
  penaltyBpsAtOpen: bigint;
  status: bigint;
  owner: string | null;
};

type MarketplaceListing = {
  depositId: bigint;
  seller: string;
  price: bigint;
  deposit: DepositInfo;
};

type ConfirmationState = {
  title: string;
  description: string;
  confirmLabel?: string;
  tone?: "default" | "danger";
  details?: { label: string; value: string }[];
};

const CHUNK_SIZE = 10_000;
const LISTINGS_PAGE_SIZE = 12;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

function formatUsdc(value: bigint) {
  return `${ethers.formatUnits(value, 6)} USDC`;
}

function formatApr(aprBps: bigint) {
  return `${Number(aprBps) / 100}%`;
}

function formatDate(timestamp: bigint) {
  return new Date(Number(timestamp) * 1000).toLocaleString();
}

function formatAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function formatRemaining(now: bigint, maturityAt: bigint) {
  if (now >= maturityAt) return "Matured";

  const remainingSeconds = maturityAt - now;
  const days = remainingSeconds / 86_400n;
  const hours = (remainingSeconds % 86_400n) / 3_600n;

  return `${days.toString()}d ${hours.toString()}h remaining`;
}

function calculateInterest(deposit: DepositInfo) {
  const tenorSeconds = deposit.maturityAt - deposit.startAt;
  return (deposit.principal * deposit.aprBpsAtOpen * tenorSeconds) / (365n * 24n * 60n * 60n * 10_000n);
}

function normalizeDeposit(id: bigint, deposit: unknown): DepositInfo {
  const values = deposit as {
    planId: bigint;
    principal: bigint;
    startAt: bigint;
    maturityAt: bigint;
    aprBpsAtOpen: bigint;
    penaltyBpsAtOpen: bigint;
    status: bigint;
  };

  return {
    id,
    planId: values.planId,
    principal: values.principal,
    startAt: values.startAt,
    maturityAt: values.maturityAt,
    aprBpsAtOpen: values.aprBpsAtOpen,
    penaltyBpsAtOpen: values.penaltyBpsAtOpen,
    status: values.status,
    owner: null,
  };
}

function normalizeListing(depositId: bigint, listing: unknown, deposit: DepositInfo): MarketplaceListing {
  const values = listing as { seller: string; price: bigint };

  return {
    depositId,
    seller: ethers.getAddress(values.seller),
    price: values.price,
    deposit,
  };
}

function isSameAddress(left: string | null | undefined, right: string | null | undefined) {
  return Boolean(left && right && left.toLowerCase() === right.toLowerCase());
}

async function queryFilterInChunks(
  contract: ethers.Contract,
  filter: ethers.DeferredTopicFilter,
  provider: ethers.BrowserProvider,
  startBlock: number,
) {
  const latestBlockNumber = await provider.getBlockNumber();
  const events = [];

  for (let fromBlock = startBlock; fromBlock <= latestBlockNumber; fromBlock += CHUNK_SIZE) {
    const toBlock = Math.min(fromBlock + CHUNK_SIZE - 1, latestBlockNumber);
    const chunk = await contract.queryFilter(filter, fromBlock, toBlock);
    events.push(...chunk);
  }

  return events;
}

function ListingCard({
  listing,
  now,
  account,
  isBusy,
  onBuy,
  onCancel,
}: {
  listing: MarketplaceListing;
  now: bigint;
  account: string | null;
  isBusy: boolean;
  onBuy?: (depositId: bigint) => void;
  onCancel?: (depositId: bigint) => void;
}) {
  const isSeller = isSameAddress(account, listing.seller);
  const interest = calculateInterest(listing.deposit);

  return (
    <article className="deposit-card">
      <div className="card-heading-row">
        <h3>Deposit #{listing.depositId.toString()}</h3>
        <span className="pill">{formatUsdc(listing.price)}</span>
      </div>
      <dl className="meta-list">
        <div>
          <dt>Seller</dt>
          <dd>{formatAddress(listing.seller)}</dd>
        </div>
        <div>
          <dt>Principal</dt>
          <dd>{formatUsdc(listing.deposit.principal)}</dd>
        </div>
        <div>
          <dt>APR Snapshot</dt>
          <dd>{formatApr(listing.deposit.aprBpsAtOpen)}</dd>
        </div>
        <div>
          <dt>Estimated Interest</dt>
          <dd>{formatUsdc(interest)}</dd>
        </div>
        <div>
          <dt>Maturity</dt>
          <dd>{formatDate(listing.deposit.maturityAt)}</dd>
        </div>
        <div>
          <dt>Time Left</dt>
          <dd>{formatRemaining(now, listing.deposit.maturityAt)}</dd>
        </div>
      </dl>
      <div className="action-row">
        {onCancel ? (
          <button className="secondary-button" type="button" onClick={() => onCancel(listing.depositId)} disabled={isBusy}>
            Cancel Listing
          </button>
        ) : (
          <button className="primary-button" type="button" onClick={() => onBuy?.(listing.depositId)} disabled={isBusy || !account || isSeller}>
            {isSeller ? "Your Listing" : "Buy Deposit"}
          </button>
        )}
      </div>
    </article>
  );
}

function ListableDepositCard({
  deposit,
  price,
  acceptedTerms,
  currentTermsHash,
  isBusy,
  onPriceChange,
  onAcceptedTermsChange,
  onList,
}: {
  deposit: DepositInfo;
  price: string;
  acceptedTerms: boolean;
  currentTermsHash: string;
  isBusy: boolean;
  onPriceChange: (depositId: string, price: string) => void;
  onAcceptedTermsChange: (depositId: string, accepted: boolean) => void;
  onList: (depositId: bigint) => void;
}) {
  return (
    <article className="deposit-card">
      <div className="card-heading-row">
        <h3>Deposit #{deposit.id.toString()}</h3>
        <span className="pill">Listable</span>
      </div>
      <dl className="meta-list">
        <div>
          <dt>Principal</dt>
          <dd>{formatUsdc(deposit.principal)}</dd>
        </div>
        <div>
          <dt>APR Snapshot</dt>
          <dd>{formatApr(deposit.aprBpsAtOpen)}</dd>
        </div>
        <div>
          <dt>Maturity</dt>
          <dd>{formatDate(deposit.maturityAt)}</dd>
        </div>
        <div>
          <dt>Accepted Terms Hash</dt>
          <dd className="address-text">{currentTermsHash}</dd>
        </div>
      </dl>
      <div className="price-form">
        <label className="form-row">
          Sale price (USDC)
          <input
            inputMode="decimal"
            min="0"
            placeholder="1000.00"
            type="number"
            value={price}
            onChange={(event) => onPriceChange(deposit.id.toString(), event.target.value)}
            disabled={isBusy}
          />
        </label>
        <label className="checkbox-row terms-checkbox">
          <input
            type="checkbox"
            checked={acceptedTerms}
            onChange={(event) => onAcceptedTermsChange(deposit.id.toString(), event.target.checked)}
            disabled={isBusy}
          />
          <span>I have read and accept Marketplace Terms v1.</span>
        </label>
        <button className="primary-button" type="button" onClick={() => onList(deposit.id)} disabled={isBusy || !price || !acceptedTerms}>
          List Deposit NFT
        </button>
      </div>
    </article>
  );
}

function TermsPanel({ currentTermsHash }: { currentTermsHash: string }) {
  return (
    <section className="section-panel">
      <div className="section-header">
        <p className="eyebrow">Terms v1</p>
        <h2>Marketplace Terms v1</h2>
      </div>
      <div className="terms-box">
        <p className="address-text">Current terms hash: {currentTermsHash || "Loading..."}</p>
        <p>
          By listing a deposit NFT, the seller confirms that the NFT represents an active SavingCore deposit position and agrees to transfer
          that NFT into DepositMarketplace escrow.
        </p>
        <p>
          While the NFT is held in escrow, the seller will not control the deposit NFT and cannot withdraw, renew, early-withdraw, transfer,
          or otherwise exercise deposit-owner rights unless the listing is cancelled or cleaned up and the NFT is returned.
        </p>
        <p>
          If a buyer purchases the listing, the buyer receives the deposit NFT and becomes the holder of all future rights attached to that
          deposit position, including eligible maturity withdrawal, renewal, early-withdrawal, or future marketplace-listing rights under the SavingCore
          contract.
        </p>
        <p>
          Direct wallet-to-wallet NFT transfers outside this marketplace are rejected by SavingCore and do not change deposit ownership.
        </p>
        <p>
          NFT name, image, description, and attributes are informational metadata only. Deposit rights, principal, APR, maturity, and ownership
          are determined by SavingCore contract state.
        </p>
        <p>
          The seller receives the listed USDC sale price when a purchase transaction succeeds. The protocol does not guarantee that the sale
          price equals the deposit principal, accrued interest, fair market value, or expected maturity value.
        </p>
        <p>
          Listings may be cancelled by the seller before purchase. Listings that enter the no-listing window or otherwise become invalid may
          be cleaned up by anyone, returning the NFT to the seller.
        </p>
        <p>
          All listing, purchase, cancellation, cleanup, ownership, withdrawal, renewal, and transfer outcomes are determined by the deployed
          smart contracts. This interface is informational and does not override on-chain contract behavior.
        </p>
      </div>
    </section>
  );
}

function PaginationControls({
  currentPage,
  totalPages,
  totalListings,
  isBusy,
  onPageChange,
}: {
  currentPage: number;
  totalPages: number;
  totalListings: number;
  isBusy: boolean;
  onPageChange: (page: number) => void;
}) {
  if (totalListings === 0) return null;

  return (
    <div className="pagination-row">
      <button
        className="secondary-button compact-button"
        type="button"
        onClick={() => onPageChange(currentPage - 1)}
        disabled={isBusy || currentPage === 0}
      >
        Previous
      </button>
      <span>
        Page {currentPage + 1} of {totalPages} · {totalListings} listings
      </span>
      <button
        className="secondary-button compact-button"
        type="button"
        onClick={() => onPageChange(currentPage + 1)}
        disabled={isBusy || currentPage >= totalPages - 1}
      >
        Next
      </button>
    </div>
  );
}

export default function Marketplace() {
  const { account, provider, contracts } = useWeb3();
  const { mockUSDC, savingCore, depositMarketplace } = contracts;
  const [listings, setListings] = useState<MarketplaceListing[]>([]);
  const [myListings, setMyListings] = useState<MarketplaceListing[]>([]);
  const [listingPage, setListingPage] = useState(0);
  const [totalListingCount, setTotalListingCount] = useState(0);
  const [listableDeposits, setListableDeposits] = useState<DepositInfo[]>([]);
  const [currentTermsHash, setCurrentTermsHash] = useState("");
  const [pricesByDeposit, setPricesByDeposit] = useState<Record<string, string>>({});
  const [acceptedTermsByDeposit, setAcceptedTermsByDeposit] = useState<Record<string, boolean>>({});
  const [now, setNow] = useState(0n);
  const [isLoading, setIsLoading] = useState(false);
  const [txStatus, setTxStatus] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [confirmation, setConfirmation] = useState<ConfirmationState | null>(null);
  const [dismissedToastIds, setDismissedToastIds] = useState<Set<string>>(() => new Set());
  const confirmedActionRef = useRef<() => void>(() => undefined);

  const isBusy = isLoading || txStatus.length > 0;
  const publicListings = listings.filter((listing) => !isSameAddress(listing.seller, account));
  const totalListingPages = Math.max(1, Math.ceil(totalListingCount / LISTINGS_PAGE_SIZE));
  const parseError = useCallback((error: unknown) => {
    return parseTransactionError(error, savingCore, null, mockUSDC, depositMarketplace);
  }, [depositMarketplace, mockUSDC, savingCore]);

  const requestConfirmation = useCallback((nextConfirmation: ConfirmationState, action: () => void) => {
    confirmedActionRef.current = action;
    setConfirmation(nextConfirmation);
  }, []);

  const cancelConfirmation = useCallback(() => {
    setConfirmation(null);
    confirmedActionRef.current = () => undefined;
  }, []);

  const confirmRequestedAction = useCallback(() => {
    const action = confirmedActionRef.current;
    setConfirmation(null);
    confirmedActionRef.current = () => undefined;
    action();
  }, []);

  const visibleToastItems: ToastItem[] = [
    ...(txStatus ? [{ id: `status:${txStatus}`, message: txStatus, tone: "status" as const }] : []),
    ...(successMessage ? [{ id: `success:${successMessage}`, message: successMessage, tone: "success" as const }] : []),
    ...(errorMessage ? [{ id: `error:${errorMessage}`, message: errorMessage, tone: "error" as const }] : []),
  ].filter((item) => !dismissedToastIds.has(item.id));

  const dismissToast = useCallback((id: string) => {
    setDismissedToastIds((current) => new Set(current).add(id));
  }, []);

  const refreshMarketplace = useCallback(async () => {
    if (!savingCore || !depositMarketplace) return;

    setIsLoading(true);
    setErrorMessage("");

    try {
      const [termsHash, listedCount, latestBlock] = await Promise.all([
        depositMarketplace.currentTermsHash() as Promise<string>,
        depositMarketplace.listedCount() as Promise<bigint>,
        provider?.getBlock("latest"),
      ]);

      setCurrentTermsHash(termsHash);
      if (latestBlock) setNow(BigInt(latestBlock.timestamp));

      const totalCount = Number(listedCount);
      const maxPage = Math.max(0, Math.ceil(totalCount / LISTINGS_PAGE_SIZE) - 1);
      const pageForFetch = Math.min(listingPage, maxPage);
      if (pageForFetch !== listingPage) setListingPage(pageForFetch);
      setTotalListingCount(totalCount);

      const startIndex = totalCount - 1 - pageForFetch * LISTINGS_PAGE_SIZE;
      const endIndex = Math.max(-1, startIndex - LISTINGS_PAGE_SIZE);

      const listingIndexes = Array.from({ length: Math.max(0, startIndex - endIndex) }, (_, offset) => startIndex - offset);
      const fetchedListings = await Promise.all(
        listingIndexes.map(async (index) => {
          const depositId = (await depositMarketplace.listedDepositIds(index)) as bigint;
          const [listing, rawDeposit] = await Promise.all([
            depositMarketplace.listings(depositId),
            savingCore.deposits(depositId),
          ]);
          const deposit = normalizeDeposit(depositId, rawDeposit);
          return normalizeListing(depositId, listing, deposit);
        })
      );
      setListings(fetchedListings);

      if (!account || !provider) {
        setListableDeposits([]);
        setMyListings([]);
        return;
      }

      const [openedEvents, transferInEvents, sellerListingEvents] = await Promise.all([
        queryFilterInChunks(savingCore, savingCore.filters.DepositOpened(null, account), provider, DEPLOYMENT_BLOCKS.SavingCore),
        queryFilterInChunks(savingCore, savingCore.filters.Transfer(null, account, null), provider, DEPLOYMENT_BLOCKS.SavingCore),
        queryFilterInChunks(depositMarketplace, depositMarketplace.filters.Listed(null, account), provider, DEPLOYMENT_BLOCKS.DepositMarketplace),
      ]);

      const sellerListingIds = new Set<string>();
      for (const event of sellerListingEvents) {
        if (!("args" in event) || !event.args) continue;
        const depositId = (event.args as { depositId?: bigint }).depositId;
        if (depositId !== undefined) sellerListingIds.add(depositId.toString());
      }

      const fetchedMyListings = (await Promise.all([...sellerListingIds].map(async (depositId) => {
        const listing = await depositMarketplace.listings(depositId);
        const values = listing as { seller: string; price: bigint };
        if (isSameAddress(values.seller, ZERO_ADDRESS)) return null;

        const normalizedDepositId = BigInt(depositId);
        const deposit = normalizeDeposit(normalizedDepositId, await savingCore.deposits(normalizedDepositId));
        return normalizeListing(normalizedDepositId, listing, deposit);
      }))).filter((listing): listing is MarketplaceListing => listing !== null);
      setMyListings(fetchedMyListings.sort((left, right) => Number(right.depositId - left.depositId)));

      const candidateIds = new Set<string>();
      for (const event of [...openedEvents, ...transferInEvents]) {
        if (!("args" in event) || !event.args) continue;
        const args = event.args as { depositId?: bigint; tokenId?: bigint };
        const depositId = args.depositId ?? args.tokenId;
        if (depositId !== undefined) candidateIds.add(depositId.toString());
      }

      const fetchedListableDeposits = (await Promise.all([...candidateIds].map(async (depositId) => {
        const deposit = normalizeDeposit(BigInt(depositId), await savingCore.deposits(depositId));
        if (deposit.status !== 1n) return null;

        try {
          deposit.owner = ethers.getAddress((await savingCore.ownerOf(deposit.id)) as string);
        } catch {
          deposit.owner = null;
        }

        if (!isSameAddress(deposit.owner, account)) return null;
        if (!((await depositMarketplace.isListable(deposit.id)) as boolean)) return null;

        return deposit;
      }))).filter((deposit): deposit is DepositInfo => deposit !== null);

      setListableDeposits(fetchedListableDeposits.sort((left, right) => Number(right.id - left.id)));
    } catch (error) {
      setErrorMessage(parseError(error));
    } finally {
      setIsLoading(false);
    }
  }, [account, depositMarketplace, listingPage, parseError, provider, savingCore]);

  const runTransaction = useCallback(async (
    label: string,
    action: () => Promise<ethers.TransactionResponse>,
    success: string,
  ) => {
    setTxStatus(label);
    setErrorMessage("");
    setSuccessMessage("");
    setDismissedToastIds(new Set());

    try {
      const tx = await action();
      setTxStatus("Waiting for confirmation...");
      await tx.wait();
      setSuccessMessage(success);
      await refreshMarketplace();
    } catch (error) {
      setErrorMessage(parseError(error));
    } finally {
      setTxStatus("");
    }
  }, [parseError, refreshMarketplace]);

  async function handleBuy(depositId: bigint) {
    if (!account || !mockUSDC || !depositMarketplace) return;

    const listing = listings.find((item) => item.depositId === depositId);
    if (!listing) return;

    setTxStatus("Checking USDC allowance...");
    setErrorMessage("");
    setSuccessMessage("");
    setDismissedToastIds(new Set());

    try {
      const allowance = (await mockUSDC.allowance(account, CONTRACT_ADDRESSES.DepositMarketplace)) as bigint;
      if (allowance < listing.price) {
        setTxStatus("Approving USDC...");
        const approvalTx = await mockUSDC.approve(CONTRACT_ADDRESSES.DepositMarketplace, listing.price);
        await approvalTx.wait();
      }

      setTxStatus("Buying deposit NFT...");
      const buyTx = await depositMarketplace.buyDeposit(depositId);
      await buyTx.wait();
      setSuccessMessage("Deposit NFT purchased.");
      await refreshMarketplace();
    } catch (error) {
      setErrorMessage(parseError(error));
    } finally {
      setTxStatus("");
    }
  }

  async function handleList(depositId: bigint) {
    if (!account || !savingCore || !depositMarketplace || !currentTermsHash) return;

    const priceInput = pricesByDeposit[depositId.toString()];
    const acceptedTerms = acceptedTermsByDeposit[depositId.toString()];
    if (!priceInput || !acceptedTerms) return;

    const price = ethers.parseUnits(priceInput, 6);

    setTxStatus("Checking NFT approval...");
    setErrorMessage("");
    setSuccessMessage("");
    setDismissedToastIds(new Set());

    try {
      const [approvedAddress, isApprovedForAll] = await Promise.all([
        savingCore.getApproved(depositId) as Promise<string>,
        savingCore.isApprovedForAll(account, CONTRACT_ADDRESSES.DepositMarketplace) as Promise<boolean>,
      ]);

      if (!isApprovedForAll && !isSameAddress(approvedAddress, CONTRACT_ADDRESSES.DepositMarketplace)) {
        setTxStatus("Approving deposit NFT...");
        const approvalTx = await savingCore.approve(CONTRACT_ADDRESSES.DepositMarketplace, depositId);
        await approvalTx.wait();
      }

      setTxStatus("Listing deposit NFT...");
      const listTx = await depositMarketplace.listDeposit(depositId, price, currentTermsHash);
      await listTx.wait();

      setPricesByDeposit((current) => ({ ...current, [depositId.toString()]: "" }));
      setAcceptedTermsByDeposit((current) => ({ ...current, [depositId.toString()]: false }));
      setSuccessMessage("Deposit NFT listed.");
      await refreshMarketplace();
    } catch (error) {
      setErrorMessage(parseError(error));
    } finally {
      setTxStatus("");
    }
  }

  function handleCancel(depositId: bigint) {
    if (!depositMarketplace) return;

    void runTransaction(
      "Cancelling listing...",
      () => depositMarketplace.cancelListing(depositId) as Promise<ethers.TransactionResponse>,
      "Listing cancelled."
    );
  }

  useEffect(() => {
    queueMicrotask(() => void refreshMarketplace());
  }, [refreshMarketplace]);

  return (
    <div className="dashboard-grid">
      <section className="page-card dashboard-hero">
        <p className="eyebrow">Defi Banking Marketplace</p>
        <h1>Trade active savings certificates safely</h1>
        <p>List eligible deposit certificates into escrow or buy active positions with future withdrawal and renewal rights.</p>
      </section>

      {!account && <p className="status-message">Connect your wallet to list or purchase deposit NFTs.</p>}
      {isLoading && <p className="status-message">Loading marketplace data...</p>}

      <section className="section-panel">
        <div className="section-header">
          <p className="eyebrow">Active Listings</p>
          <div className="section-title-row">
            <h2>Available deposit NFTs</h2>
            <PaginationControls
              currentPage={listingPage}
              totalPages={totalListingPages}
              totalListings={totalListingCount}
              isBusy={isBusy}
              onPageChange={setListingPage}
            />
          </div>
        </div>
        <div className="card-grid">
          {publicListings.length === 0 ? (
            <p>No public listings are available.</p>
          ) : (
            publicListings.map((listing) => (
              <ListingCard
                key={listing.depositId.toString()}
                listing={listing}
                now={now}
                account={account}
                isBusy={isBusy}
                onBuy={(nextDepositId) => {
                  const selectedListing = listings.find((item) => item.depositId === nextDepositId);
                  requestConfirmation(
                    {
                      title: "Buy this savings certificate?",
                      description: "You will approve MockUSDC if needed, then receive the escrowed deposit NFT and future deposit-owner rights.",
                      confirmLabel: "Buy Certificate",
                      details: selectedListing
                        ? [
                            { label: "Deposit", value: `#${selectedListing.depositId.toString()}` },
                            { label: "Price", value: formatUsdc(selectedListing.price) },
                            { label: "Principal", value: formatUsdc(selectedListing.deposit.principal) },
                          ]
                        : undefined,
                    },
                    () => void handleBuy(nextDepositId)
                  );
                }}
              />
            ))
          )}
        </div>
      </section>

      <section className="section-panel">
        <div className="section-header">
          <p className="eyebrow">My Listable Deposit NFTs</p>
          <h2>Create a listing</h2>
        </div>
        <div className="card-grid">
          {listableDeposits.length === 0 ? (
            <p>No eligible deposit NFTs found for this wallet.</p>
          ) : (
            listableDeposits.map((deposit) => (
              <ListableDepositCard
                key={deposit.id.toString()}
                deposit={deposit}
                price={pricesByDeposit[deposit.id.toString()] ?? ""}
                acceptedTerms={acceptedTermsByDeposit[deposit.id.toString()] ?? false}
                currentTermsHash={currentTermsHash}
                isBusy={isBusy}
                onPriceChange={(nextDepositId, price) => setPricesByDeposit((current) => ({ ...current, [nextDepositId]: price }))}
                onAcceptedTermsChange={(nextDepositId, accepted) =>
                  setAcceptedTermsByDeposit((current) => ({ ...current, [nextDepositId]: accepted }))
                }
                onList={(nextDepositId) => {
                  const deposit = listableDeposits.find((item) => item.id === nextDepositId);
                  const price = pricesByDeposit[nextDepositId.toString()] ?? "";
                  requestConfirmation(
                    {
                      title: "List this certificate?",
                      description: "The marketplace will hold your deposit NFT in escrow. You cannot withdraw or renew it while it is listed.",
                      confirmLabel: "List Certificate",
                      details: deposit
                        ? [
                            { label: "Deposit", value: `#${deposit.id.toString()}` },
                            { label: "Principal", value: formatUsdc(deposit.principal) },
                            { label: "Sale price", value: `${price} USDC` },
                          ]
                        : undefined,
                    },
                    () => void handleList(nextDepositId)
                  );
                }}
              />
            ))
          )}
        </div>
      </section>

      <section className="section-panel">
        <div className="section-header">
          <p className="eyebrow">My Listings</p>
          <h2>Escrowed deposit NFTs</h2>
        </div>
        <div className="card-grid">
          {myListings.length === 0 ? (
            <p>You have no active marketplace listings.</p>
          ) : (
            myListings.map((listing) => (
              <ListingCard
                key={listing.depositId.toString()}
                listing={listing}
                now={now}
                account={account}
                isBusy={isBusy}
                onCancel={(nextDepositId) => {
                  const selectedListing = myListings.find((item) => item.depositId === nextDepositId);
                  requestConfirmation(
                    {
                      title: "Cancel this listing?",
                      description: "The marketplace will return the escrowed savings certificate to your wallet.",
                      confirmLabel: "Cancel Listing",
                      details: selectedListing
                        ? [
                            { label: "Deposit", value: `#${selectedListing.depositId.toString()}` },
                            { label: "Listed price", value: formatUsdc(selectedListing.price) },
                          ]
                        : undefined,
                    },
                    () => handleCancel(nextDepositId)
                  );
                }}
              />
            ))
          )}
        </div>
      </section>

      <TermsPanel currentTermsHash={currentTermsHash} />

      <ConfirmationDialog
        open={confirmation !== null}
        title={confirmation?.title ?? "Review action"}
        description={confirmation?.description}
        confirmLabel={confirmation?.confirmLabel}
        tone={confirmation?.tone}
        onCancel={cancelConfirmation}
        onConfirm={confirmRequestedAction}
      >
        {confirmation?.details && (
          <dl>
            {confirmation.details.map((detail) => (
              <div key={detail.label}>
                <dt>{detail.label}</dt>
                <dd>{detail.value}</dd>
              </div>
            ))}
          </dl>
        )}
      </ConfirmationDialog>
      <ToastStack items={visibleToastItems} onDismiss={dismissToast} />
    </div>
  );
}
