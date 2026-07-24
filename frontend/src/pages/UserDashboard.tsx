import { useCallback, useEffect, useMemo, useState } from "react";
import { ethers } from "ethers";
import { CONTRACT_ADDRESSES, DEPLOYMENT_BLOCKS } from "../config";
import { useWeb3 } from "../useWeb3";
import { parseTransactionError } from "../utils/parseTransactionError";

type SavingPlan = {
  id: bigint;
  minDeposit: bigint;
  maxDeposit: bigint;
  tenorDays: bigint;
  aprBps: bigint;
  earlyWithdrawPenaltyBps: bigint;
  enabled: boolean;
};

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
  historyNote?: string;
  unpaidInterest: bigint;
  interestClaimant: string | null;
  canPayInterest: boolean;
};

const DEPOSIT_STATUS: Record<string, string> = {
  "0": "None",
  "1": "Active",
  "2": "Withdrawn",
  "3": "Early Withdrawn",
  "4": "Manual Renewed",
  "5": "Auto Renewed",
};

const CHUNK_SIZE = 2_000;

function formatUsdc(value: bigint) {
  return `${ethers.formatUnits(value, 6)} USDC`;
}

function formatDepositLimit(value: bigint, label: "minimum" | "maximum") {
  return value === 0n ? `No ${label}` : formatUsdc(value);
}

function formatApr(aprBps: bigint) {
  return `${Number(aprBps) / 100}%`;
}

function formatDate(timestamp: bigint) {
  return new Date(Number(timestamp) * 1000).toLocaleString();
}

function calculateInterest(deposit: DepositInfo) {
  const tenorSeconds = deposit.maturityAt - deposit.startAt;
  return (deposit.principal * deposit.aprBpsAtOpen * tenorSeconds) / (365n * 24n * 60n * 60n * 10_000n);
}

function isAmountInPlanRange(plan: SavingPlan | undefined, amount: bigint) {
  if (!plan) return false;
  return (plan.minDeposit === 0n || amount >= plan.minDeposit) && (plan.maxDeposit === 0n || amount <= plan.maxDeposit);
}

function normalizePlan(id: bigint, plan: unknown): SavingPlan {
  const values = plan as {
    minDeposit: bigint;
    maxDeposit: bigint;
    tenorDays: bigint;
    aprBps: bigint;
    earlyWithdrawPenaltyBps: bigint;
    enabled: boolean;
  };

  return {
    id,
    minDeposit: values.minDeposit,
    maxDeposit: values.maxDeposit,
    tenorDays: values.tenorDays,
    aprBps: values.aprBps,
    earlyWithdrawPenaltyBps: values.earlyWithdrawPenaltyBps,
    enabled: values.enabled,
  };
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
    unpaidInterest: 0n,
    interestClaimant: null,
    canPayInterest: true,
  };
}

function isSameAddress(left: string | null | undefined, right: string | null | undefined) {
  return Boolean(left && right && left.toLowerCase() === right.toLowerCase());
}

function parsedEventNames(receipt: ethers.TransactionReceipt, contractInterface: ethers.Interface) {
  return receipt.logs
    .map((log) => {
      try {
        return contractInterface.parseLog(log)?.name;
      } catch {
        return undefined;
      }
    })
    .filter((name): name is string => name !== undefined);
}

async function queryFilterInChunks(
  contract: ethers.Contract,
  filter: ethers.DeferredTopicFilter,
  provider: ethers.BrowserProvider,
) {
  const latestBlockNumber = await provider.getBlockNumber();
  const events = [];

  for (let fromBlock = DEPLOYMENT_BLOCKS.SavingCore; fromBlock <= latestBlockNumber; fromBlock += CHUNK_SIZE) {
    const toBlock = Math.min(fromBlock + CHUNK_SIZE - 1, latestBlockNumber);
    const chunk = await contract.queryFilter(filter, fromBlock, toBlock);
    events.push(...chunk);
  }

  return events;
}

function PlanCard({ plan, onSelect }: { plan: SavingPlan; onSelect: (planId: bigint) => void }) {
  return (
    <article className="plan-card">
      <div className="card-heading-row">
        <h3>{plan.tenorDays.toString()} Days</h3>
        <span className="pill">APR {formatApr(plan.aprBps)}</span>
      </div>
      <dl className="meta-list">
        <div>
          <dt>Deposit Range</dt>
          <dd>
            {formatDepositLimit(plan.minDeposit, "minimum")} - {formatDepositLimit(plan.maxDeposit, "maximum")}
          </dd>
        </div>
        <div>
          <dt>Early Penalty</dt>
          <dd>{formatApr(plan.earlyWithdrawPenaltyBps)}</dd>
        </div>
      </dl>
      <button className="primary-button" type="button" onClick={() => onSelect(plan.id)}>
        Select Plan
      </button>
    </article>
  );
}

function OpenDepositForm({
  plans,
  selectedPlanId,
  amount,
  isBusy,
  onPlanChange,
  onAmountChange,
  onSubmit,
}: {
  plans: SavingPlan[];
  selectedPlanId: string;
  amount: string;
  isBusy: boolean;
  onPlanChange: (planId: string) => void;
  onAmountChange: (amount: string) => void;
  onSubmit: () => void;
}) {
  return (
    <section className="section-panel">
      <div className="section-header">
        <p className="eyebrow">Open Deposit</p>
        <h2>Start a new term</h2>
      </div>
      <div className="form-grid">
        <label className="form-row">
          Plan
          <select value={selectedPlanId} onChange={(event) => onPlanChange(event.target.value)} disabled={isBusy}>
            {plans.map((plan) => (
              <option key={plan.id.toString()} value={plan.id.toString()}>
                {plan.tenorDays.toString()} days - {formatApr(plan.aprBps)} APR
              </option>
            ))}
          </select>
        </label>
        <label className="form-row">
          Amount (USDC)
          <input
            inputMode="decimal"
            min="0"
            placeholder="1000.00"
            type="number"
            value={amount}
            onChange={(event) => onAmountChange(event.target.value)}
            disabled={isBusy}
          />
        </label>
        <button className="primary-button" type="button" onClick={onSubmit} disabled={isBusy || plans.length === 0}>
          Open Deposit
        </button>
      </div>
    </section>
  );
}

function DepositCard({
  deposit,
  plans,
  now,
  isBusy,
  renewPlanId,
  onRenewPlanChange,
  onEarlyWithdraw,
  onWithdraw,
  onRenew,
  onWithdrawInterestAndRenew,
  onClaimInterest,
  canManage = true,
}: {
  deposit: DepositInfo;
  plans: SavingPlan[];
  now: bigint;
  isBusy: boolean;
  renewPlanId: string;
  onRenewPlanChange: (depositId: string, planId: string) => void;
  onEarlyWithdraw: (depositId: bigint) => void;
  onWithdraw: (depositId: bigint) => void;
  onRenew: (depositId: bigint) => void;
  onWithdrawInterestAndRenew: (depositId: bigint) => void;
  onClaimInterest: (depositId: bigint) => void;
  canManage?: boolean;
}) {
  const isActive = deposit.status === 1n;
  const isMatured = now >= deposit.maturityAt;
  const maturityInterest = calculateInterest(deposit);
  const earlyPenalty = (deposit.principal * deposit.penaltyBpsAtOpen) / 10_000n;
  const earlyReceiveAmount = deposit.principal - earlyPenalty;
  const selectedRenewPlan = plans.find((plan) => plan.id.toString() === renewPlanId);
  const compoundedPrincipal = deposit.principal + maturityInterest;
  const canCompoundRenew = deposit.canPayInterest && isAmountInPlanRange(selectedRenewPlan, compoundedPrincipal);
  const canInterestOnlyRenew = deposit.canPayInterest && isAmountInPlanRange(selectedRenewPlan, deposit.principal);

  return (
    <article className="deposit-card">
      <div className="card-heading-row">
        <h3>Deposit #{deposit.id.toString()}</h3>
        <span className="pill">{DEPOSIT_STATUS[deposit.status.toString()] ?? "Unknown"}</span>
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
          <dt>Estimated Interest</dt>
          <dd>{formatUsdc(maturityInterest)}</dd>
        </div>
        <div>
          <dt>Maturity</dt>
          <dd>{formatDate(deposit.maturityAt)}</dd>
        </div>
        <div>
          <dt>Penalty Snapshot</dt>
          <dd>{formatApr(deposit.penaltyBpsAtOpen)}</dd>
        </div>
        {deposit.historyNote && (
          <div>
            <dt>History</dt>
            <dd>{deposit.historyNote}</dd>
          </div>
        )}
      </dl>

      {canManage && isActive && (
        <div className="action-row">
          {!isMatured ? (
            <>
              <p className="early-warning">
                Warning: Early withdrawal incurs a {formatApr(deposit.penaltyBpsAtOpen)} penalty. You will lose{" "}
                {formatUsdc(earlyPenalty)} and receive {formatUsdc(earlyReceiveAmount)}.
              </p>
              <button
                className="secondary-button danger-button"
                type="button"
                onClick={() => onEarlyWithdraw(deposit.id)}
                disabled={isBusy}
              >
                Early Withdraw
              </button>
            </>
          ) : (
            <>
              {!deposit.canPayInterest && maturityInterest > 0n && (
                <p className="deferred-warning">
                  Vault liquidity is not enough to pay your interest right now. If you withdraw, you will receive your
                  principal now and your {formatUsdc(maturityInterest)} interest will be recorded as a later claim.
                </p>
              )}
              <button className="primary-button" type="button" onClick={() => onWithdraw(deposit.id)} disabled={isBusy}>
                {deposit.canPayInterest ? "Withdraw Principal + Interest" : "Withdraw Principal Only"}
              </button>
              <select
                value={renewPlanId}
                onChange={(event) => onRenewPlanChange(deposit.id.toString(), event.target.value)}
                disabled={isBusy || plans.length === 0}
              >
                {plans.map((plan) => (
                  <option key={plan.id.toString()} value={plan.id.toString()}>
                    Renew: {plan.tenorDays.toString()} days
                  </option>
                ))}
              </select>
              <button
                className="secondary-button"
                type="button"
                onClick={() => onRenew(deposit.id)}
                disabled={isBusy || plans.length === 0 || !canCompoundRenew}
              >
                Compound Renew
              </button>
              <button
                className="secondary-button"
                type="button"
                onClick={() => onWithdrawInterestAndRenew(deposit.id)}
                disabled={isBusy || plans.length === 0 || !canInterestOnlyRenew}
              >
                Withdraw Interest & Continue Principal
              </button>
              {!deposit.canPayInterest && maturityInterest > 0n && (
                <p className="helper-text">Renewal is unavailable because interest must be paid before it can be compounded.</p>
              )}
              {deposit.canPayInterest && selectedRenewPlan && !isAmountInPlanRange(selectedRenewPlan, compoundedPrincipal) && (
                <p className="helper-text">
                  Compound renewal is unavailable because {formatUsdc(compoundedPrincipal)} exceeds the selected plan range.
                  You may withdraw interest and continue with {formatUsdc(deposit.principal)} if that principal fits the plan.
                </p>
              )}
              {deposit.canPayInterest && selectedRenewPlan && !isAmountInPlanRange(selectedRenewPlan, deposit.principal) && (
                <p className="helper-text">Interest-only renewal is unavailable because the principal is outside the selected plan range.</p>
              )}
            </>
          )}
        </div>
      )}

      {canManage && deposit.unpaidInterest > 0n && (
        <div className="claim-panel">
          <p className="eyebrow">Deferred Interest Claim</p>
          <p>
            Principal was already withdrawn. Unpaid interest: <strong>{formatUsdc(deposit.unpaidInterest)}</strong>.
          </p>
          <button
            className="primary-button"
            type="button"
            onClick={() => onClaimInterest(deposit.id)}
            disabled={isBusy || !deposit.canPayInterest}
          >
            Claim Interest
          </button>
          {!deposit.canPayInterest && <p className="helper-text">Waiting for vault funding. This claim checks liquidity again on-chain.</p>}
        </div>
      )}
    </article>
  );
}

export default function UserDashboard() {
  const { account, provider, contracts } = useWeb3();
  const { mockUSDC, savingCore, vaultManager } = contracts;
  const [plans, setPlans] = useState<SavingPlan[]>([]);
  const [activeDeposits, setActiveDeposits] = useState<DepositInfo[]>([]);
  const [historyDeposits, setHistoryDeposits] = useState<DepositInfo[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [selectedPlanId, setSelectedPlanId] = useState("");
  const [depositAmountInput, setDepositAmountInput] = useState("");
  const [renewPlanByDeposit, setRenewPlanByDeposit] = useState<Record<string, string>>({});
  const [now, setNow] = useState<bigint>(0n);
  const [isLoading, setIsLoading] = useState(false);
  const [txStatus, setTxStatus] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [alertMessage, setAlertMessage] = useState("");

  const activePlans = useMemo(() => plans.filter((plan) => plan.enabled), [plans]);
  const deferredInterestDeposits = useMemo(
    () => historyDeposits.filter((deposit) => deposit.unpaidInterest > 0n && isSameAddress(deposit.interestClaimant, account)),
    [account, historyDeposits]
  );
  const isTxBusy = txStatus.length > 0;

  const parseError = useCallback((error: unknown) => {
    return parseTransactionError(error, savingCore, vaultManager, mockUSDC);
  }, [mockUSDC, savingCore, vaultManager]);

  const refreshDashboard = useCallback(async () => {
    if (!savingCore) return;

    setIsLoading(true);
    setErrorMessage("");

    try {
      const nextPlanId = (await savingCore.nextPlanId()) as bigint;
      const fetchedPlans: SavingPlan[] = [];

      for (let planId = 0n; planId < nextPlanId; planId += 1n) {
        const plan = normalizePlan(planId, await savingCore.savingPlans(planId));
        if (plan.enabled) fetchedPlans.push(plan);
      }

      setPlans(fetchedPlans);
      setSelectedPlanId((current) => current || fetchedPlans[0]?.id.toString() || "");

      const latestBlock = await provider?.getBlock("latest");
      if (latestBlock) {
        setNow(BigInt(latestBlock.timestamp));
      }

      if (!account) {
        setActiveDeposits([]);
        setHistoryDeposits([]);
        return;
      }

      if (!provider) {
        setActiveDeposits([]);
        setHistoryDeposits([]);
        return;
      }

      const openedEvents = await queryFilterInChunks(savingCore, savingCore.filters.DepositOpened(null, account), provider);
      const transferInEvents = await queryFilterInChunks(savingCore, savingCore.filters.Transfer(null, account, null), provider);
      const transferOutEvents = await queryFilterInChunks(savingCore, savingCore.filters.Transfer(account, null, null), provider);
      const interestDeferredEvents = await queryFilterInChunks(savingCore, savingCore.filters.InterestDeferred(null, account), provider);
      const interestClaimedEvents = await queryFilterInChunks(savingCore, savingCore.filters.InterestClaimed(null, account), provider);

      const candidateIds = new Set<string>();

      for (const event of [...openedEvents, ...transferInEvents, ...transferOutEvents, ...interestDeferredEvents, ...interestClaimedEvents]) {
        if (!("args" in event) || !event.args) continue;
        const args = event.args as { depositId?: bigint; tokenId?: bigint };
        const depositId = args.depositId ?? args.tokenId;
        if (depositId !== undefined) candidateIds.add(depositId.toString());
      }

      const fetchedDeposits = await Promise.all(
        [...candidateIds].map(async (depositId) => {
          const deposit = normalizeDeposit(BigInt(depositId), await savingCore.deposits(depositId));

          try {
            deposit.owner = ethers.getAddress((await savingCore.ownerOf(deposit.id)) as string);
          } catch {
            deposit.owner = null;
          }

          const [unpaidInterest, claimant] = await Promise.all([
            savingCore.unpaidInterest(deposit.id) as Promise<bigint>,
            savingCore.interestClaimant(deposit.id) as Promise<string>,
          ]);
          deposit.unpaidInterest = unpaidInterest;
          deposit.interestClaimant = claimant === ethers.ZeroAddress ? null : ethers.getAddress(claimant);

          if (deposit.status === 1n) {
            const preview = await savingCore.previewMaturitySettlement(deposit.id) as { canPayInterest: boolean };
            deposit.canPayInterest = preview.canPayInterest;
          } else if (deposit.unpaidInterest > 0n && vaultManager) {
            deposit.canPayInterest = await vaultManager.canPayInterest(deposit.unpaidInterest) as boolean;
          }

          return deposit;
        })
      );

      const nextActiveDeposits: DepositInfo[] = [];
      const nextHistoryDeposits: DepositInfo[] = [];

      for (const deposit of fetchedDeposits) {
        if (deposit.status === 1n && isSameAddress(deposit.owner, account)) {
          nextActiveDeposits.push(deposit);
          continue;
        }

        if (deposit.status === 1n && isSameAddress(deposit.owner, CONTRACT_ADDRESSES.DepositMarketplace)) {
          deposit.historyNote = "Listed in marketplace escrow";
        } else if (deposit.status === 1n && deposit.owner) {
          deposit.historyNote = "Transferred or sold to another wallet";
        } else if (deposit.unpaidInterest > 0n && isSameAddress(deposit.interestClaimant, account)) {
          deposit.historyNote = "Principal withdrawn; interest claim pending";
        } else {
          deposit.historyNote = DEPOSIT_STATUS[deposit.status.toString()] ?? "Inactive";
        }

        nextHistoryDeposits.push(deposit);
      }

      setActiveDeposits(nextActiveDeposits.sort((left, right) => Number(right.id - left.id)));
      setHistoryDeposits(nextHistoryDeposits.sort((left, right) => Number(right.id - left.id)));
    } catch (error) {
      setErrorMessage(parseError(error));
    } finally {
      setIsLoading(false);
    }
  }, [account, parseError, provider, savingCore, vaultManager]);

  const runTransaction = useCallback(async (
    label: string,
    action: () => Promise<ethers.TransactionResponse>,
    successMessage = "Transaction confirmed."
  ) => {
    setErrorMessage("");
    setAlertMessage("");
    setTxStatus(label);

    try {
      const tx = await action();
      setTxStatus("Waiting for confirmation...");
      await tx.wait();
      setAlertMessage(successMessage);
      await refreshDashboard();
    } catch (error) {
      setErrorMessage(parseError(error));
    } finally {
      setTxStatus("");
    }
  }, [parseError, refreshDashboard]);

  const handleMaturityWithdraw = useCallback(async (depositId: bigint) => {
    if (!savingCore) return;

    setErrorMessage("");
    setAlertMessage("");
    setTxStatus("Withdrawing at maturity...");

    try {
      const tx = await savingCore.withdrawAtMaturity(depositId) as ethers.TransactionResponse;
      setTxStatus("Waiting for confirmation...");
      const receipt = await tx.wait();
      const eventNames = receipt ? parsedEventNames(receipt, savingCore.interface) : [];

      setAlertMessage(
        eventNames.includes("InterestDeferred")
          ? "Principal withdrawn. The vault did not have enough funds to pay your interest, so your unpaid interest was recorded and can be claimed later."
          : "Principal and interest withdrawn successfully."
      );
      await refreshDashboard();
    } catch (error) {
      setErrorMessage(parseError(error));
    } finally {
      setTxStatus("");
    }
  }, [parseError, refreshDashboard, savingCore]);

  async function handleOpenDeposit() {
    if (!account || !mockUSDC || !savingCore || !selectedPlanId || !depositAmountInput) return;

    const parsedAmount = ethers.parseUnits(depositAmountInput, 6);
    const savingCoreAddress = CONTRACT_ADDRESSES.SavingCore;

    setErrorMessage("");
    setTxStatus("Checking allowance...");

    try {
      const currentAllowance = (await mockUSDC.allowance(account, savingCoreAddress)) as bigint;

      if (currentAllowance < parsedAmount) {
        setTxStatus("Approving...");
        const approvalTx = await mockUSDC.approve(savingCoreAddress, parsedAmount);
        await approvalTx.wait();

        const newAllowance = (await mockUSDC.allowance(account, savingCoreAddress)) as bigint;
        if (newAllowance < parsedAmount) {
          throw new Error("Insufficient allowance approved. Please approve the full amount to proceed.");
        }
      }

      setTxStatus("Depositing...");
      const depositTx = await savingCore.openDeposit(BigInt(selectedPlanId), parsedAmount);
      await depositTx.wait();

      setDepositAmountInput("");
      setAlertMessage("Deposit opened successfully.");
      await refreshDashboard();
    } catch (error) {
      setErrorMessage(parseError(error));
    } finally {
      setTxStatus("");
    }
  }

  function handleRenewPlanChange(depositId: string, planId: string) {
    setRenewPlanByDeposit((current) => ({ ...current, [depositId]: planId }));
  }

  function handleRenew(depositId: bigint) {
    if (!savingCore) return;

    const fallbackPlanId = activePlans[0]?.id.toString();
    const selectedRenewPlanId = renewPlanByDeposit[depositId.toString()] ?? fallbackPlanId;
    if (!selectedRenewPlanId) return;

    void runTransaction(
      "Renewing...",
      () => savingCore.renewDeposit(depositId, BigInt(selectedRenewPlanId)) as Promise<ethers.TransactionResponse>,
      "Deposit renewed successfully."
    );
  }

  function handleWithdrawInterestAndRenew(depositId: bigint) {
    if (!savingCore) return;

    const fallbackPlanId = activePlans[0]?.id.toString();
    const selectedRenewPlanId = renewPlanByDeposit[depositId.toString()] ?? fallbackPlanId;
    if (!selectedRenewPlanId) return;

    void runTransaction(
      "Withdrawing interest and renewing principal...",
      () => savingCore.withdrawInterestAndRenewPrincipal(depositId, BigInt(selectedRenewPlanId)) as Promise<ethers.TransactionResponse>,
      "Interest withdrawn and principal renewed successfully."
    );
  }

  function handleClaimInterest(depositId: bigint) {
    if (!savingCore) return;

    void runTransaction(
      "Claiming deferred interest...",
      () => savingCore.claimInterest(depositId) as Promise<ethers.TransactionResponse>,
      "Deferred interest claimed successfully."
    );
  }

  useEffect(() => {
    queueMicrotask(() => void refreshDashboard());
  }, [refreshDashboard]);

  return (
    <div className="dashboard-grid">
      <section className="page-card dashboard-hero">
        <p className="eyebrow">User Dashboard</p>
        <h1>Term Deposit Portal</h1>
        <p>Open fixed-term USDC deposits, monitor live status, and manage maturity actions from one place.</p>
      </section>

      {!account && (
        <p className="status-message">Connect your wallet to open deposits and view your deposit history.</p>
      )}
      {isLoading && <p className="status-message">Loading contract data...</p>}
      {txStatus && <p className="status-message">{txStatus}</p>}
      {alertMessage && <p className="success-message">{alertMessage}</p>}
      {errorMessage && <p className="error-message">{errorMessage}</p>}

      <section className="section-panel">
        <div className="section-header">
          <p className="eyebrow">Available Plans</p>
          <h2>Choose a term</h2>
        </div>
        <div className="card-grid">
          {activePlans.length === 0 ? (
            <p>No enabled plans found.</p>
          ) : (
            activePlans.map((plan) => (
              <PlanCard
                key={plan.id.toString()}
                plan={plan}
                onSelect={(planId) => setSelectedPlanId(planId.toString())}
              />
            ))
          )}
        </div>
      </section>

      <OpenDepositForm
        plans={activePlans}
        selectedPlanId={selectedPlanId}
        amount={depositAmountInput}
        isBusy={isTxBusy || !account}
        onPlanChange={setSelectedPlanId}
        onAmountChange={setDepositAmountInput}
        onSubmit={() => void handleOpenDeposit()}
      />

      <section className="section-panel">
        <div className="section-header">
          <p className="eyebrow">My Active Deposit NFTs</p>
          <div className="section-title-row">
            <h2>Current positions</h2>
            <button className="secondary-button compact-button" type="button" onClick={() => setShowHistory((current) => !current)}>
              {showHistory ? "Hide History" : "View History"}
            </button>
          </div>
        </div>
        <div className="card-grid">
          {activeDeposits.length === 0 ? (
            <p>No active deposit NFTs found for this wallet.</p>
          ) : (
            activeDeposits.map((deposit) => (
              <DepositCard
                key={deposit.id.toString()}
                deposit={deposit}
                plans={activePlans}
                now={now}
                isBusy={isTxBusy}
                renewPlanId={renewPlanByDeposit[deposit.id.toString()] ?? activePlans[0]?.id.toString() ?? ""}
                onRenewPlanChange={handleRenewPlanChange}
                onEarlyWithdraw={(depositId) =>
                  void runTransaction(
                    "Withdrawing early...",
                    () => savingCore?.earlyWithdraw(depositId) as Promise<ethers.TransactionResponse>
                  )
                }
                onWithdraw={(depositId) => void handleMaturityWithdraw(depositId)}
                onRenew={handleRenew}
                onWithdrawInterestAndRenew={handleWithdrawInterestAndRenew}
                onClaimInterest={handleClaimInterest}
              />
            ))
          )}
        </div>
      </section>

      {deferredInterestDeposits.length > 0 && (
        <section className="section-panel">
          <div className="section-header">
            <p className="eyebrow">Deferred Interest Claims</p>
            <h2>Claim unpaid interest per deposit</h2>
            <p>
              Each claim is independent. If the vault can only pay one claim, choose which deposit to claim first.
            </p>
          </div>
          <div className="card-grid">
            {deferredInterestDeposits.map((deposit) => (
              <DepositCard
                key={`claim-${deposit.id.toString()}`}
                deposit={deposit}
                plans={activePlans}
                now={now}
                isBusy={isTxBusy}
                renewPlanId={renewPlanByDeposit[deposit.id.toString()] ?? activePlans[0]?.id.toString() ?? ""}
                onRenewPlanChange={handleRenewPlanChange}
                onEarlyWithdraw={() => undefined}
                onWithdraw={() => undefined}
                onRenew={() => undefined}
                onWithdrawInterestAndRenew={() => undefined}
                onClaimInterest={handleClaimInterest}
              />
            ))}
          </div>
        </section>
      )}

      {showHistory && (
        <section className="section-panel">
          <div className="section-header">
            <p className="eyebrow">History</p>
            <h2>Inactive and transferred NFTs</h2>
          </div>
          <div className="card-grid">
            {historyDeposits.length === 0 ? (
              <p>No history found for this wallet.</p>
            ) : (
              historyDeposits.map((deposit) => (
                <DepositCard
                  key={deposit.id.toString()}
                  deposit={deposit}
                  plans={activePlans}
                  now={now}
                  isBusy={isTxBusy}
                  renewPlanId={renewPlanByDeposit[deposit.id.toString()] ?? activePlans[0]?.id.toString() ?? ""}
                  onRenewPlanChange={handleRenewPlanChange}
                  onEarlyWithdraw={() => undefined}
                  onWithdraw={() => undefined}
                  onRenew={() => undefined}
                  onWithdrawInterestAndRenew={() => undefined}
                  onClaimInterest={handleClaimInterest}
                  canManage={false}
                />
              ))
            )}
          </div>
        </section>
      )}
    </div>
  );
}
