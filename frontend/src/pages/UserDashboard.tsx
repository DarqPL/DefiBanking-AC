import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ethers } from "ethers";
import { CONTRACT_ADDRESSES, DEPLOYMENT_BLOCKS } from "../config";
import { useWeb3 } from "../useWeb3";
import { parseTransactionError } from "../utils/parseTransactionError";
import { ConfirmationDialog } from "../components/ConfirmationDialog";
import { StatusBadge } from "../components/StatusBadge";
import { TransactionFeedback } from "../components/TransactionFeedback";
import { ToastStack, type ToastItem } from "../components/ToastStack";
import { UiStatePanel } from "../components/UiStatePanel";
import {
  calculateInterest,
  formatAddress,
  formatApr,
  formatDate,
  formatDepositLimit,
  formatDuration,
  formatRemainingTime,
  formatUsdc,
  getProgressPercent,
  isSameAddress,
  statusToneForLabel,
} from "../lib/format";

type SavingPlan = {
  id: bigint;
  minDeposit: bigint;
  maxDeposit: bigint;
  tenorSeconds: bigint;
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

type ConfirmationState = {
  title: string;
  description: string;
  confirmLabel?: string;
  tone?: "default" | "danger";
  details?: { label: string; value: string }[];
};

const DEPOSIT_STATUS: Record<string, string> = {
  "0": "None",
  "1": "Active",
  "2": "Withdrawn",
  "3": "Early Withdrawn",
  "4": "Manual Renewed",
  "5": "Auto Renewed",
};

const CHUNK_SIZE = 10_000;
const FAUCET_AMOUNT = ethers.parseUnits("1000", 6);

function isAmountInPlanRange(plan: SavingPlan | undefined, amount: bigint) {
  if (!plan) return false;
  return (plan.minDeposit === 0n || amount >= plan.minDeposit) && (plan.maxDeposit === 0n || amount <= plan.maxDeposit);
}

function normalizePlan(id: bigint, plan: unknown): SavingPlan {
  const values = plan as {
    minDeposit: bigint;
    maxDeposit: bigint;
    tenorSeconds: bigint;
    aprBps: bigint;
    earlyWithdrawPenaltyBps: bigint;
    enabled: boolean;
  };

  return {
    id,
    minDeposit: values.minDeposit,
    maxDeposit: values.maxDeposit,
    tenorSeconds: values.tenorSeconds,
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

function PlanCard({
  plan,
  isSelected,
  onSelect,
}: {
  plan: SavingPlan;
  isSelected: boolean;
  onSelect: (planId: bigint) => void;
}) {
  return (
    <article className={`plan-card${isSelected ? " plan-card-selected" : ""}`}>
      <div className="card-heading-row">
        <h3>Savings Plan #{plan.id.toString()}</h3>
        {isSelected ? <StatusBadge tone="success">Selected</StatusBadge> : <StatusBadge tone="info">Available</StatusBadge>}
      </div>
      <p className="plan-rate">
        {formatApr(plan.aprBps)} <span>APR</span>
      </p>
      <p className="plan-tenor">{formatDuration(plan.tenorSeconds)} fixed term</p>
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
      <button className={isSelected ? "secondary-button" : "primary-button"} type="button" onClick={() => onSelect(plan.id)}>
        {isSelected ? "Selected Plan" : "Select Plan"}
      </button>
    </article>
  );
}

function OpenDepositForm({
  plans,
  selectedPlanId,
  amount,
  isBusy,
  disabledReason,
  onPlanChange,
  onAmountChange,
  onSubmit,
}: {
  plans: SavingPlan[];
  selectedPlanId: string;
  amount: string;
  isBusy: boolean;
  disabledReason: string | null;
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
                {formatDuration(plan.tenorSeconds)} - {formatApr(plan.aprBps)} APR
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
        <button className="primary-button" type="button" onClick={onSubmit} disabled={Boolean(disabledReason)}>
          Open Deposit
        </button>
        {disabledReason && <p className="helper-text">{disabledReason}</p>}
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
  onEmergencyWithdraw,
  onRenew,
  onWithdrawInterestAndRenew,
  onClaimInterest,
  canManage = true,
  isEmergencyMode = false,
}: {
  deposit: DepositInfo;
  plans: SavingPlan[];
  now: bigint;
  isBusy: boolean;
  renewPlanId: string;
  onRenewPlanChange: (depositId: string, planId: string) => void;
  onEarlyWithdraw: (depositId: bigint) => void;
  onWithdraw: (depositId: bigint) => void;
  onEmergencyWithdraw: (depositId: bigint) => void;
  onRenew: (depositId: bigint) => void;
  onWithdrawInterestAndRenew: (depositId: bigint) => void;
  onClaimInterest: (depositId: bigint) => void;
  canManage?: boolean;
  isEmergencyMode?: boolean;
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
  const statusLabel = isActive && isMatured ? "Matured" : DEPOSIT_STATUS[deposit.status.toString()] ?? "Unknown";
  const progress = getProgressPercent(deposit.startAt, deposit.maturityAt, now);

  return (
    <article className="deposit-card">
      <div className="card-heading-row">
        <h3>Deposit #{deposit.id.toString()}</h3>
        <StatusBadge tone={statusToneForLabel(statusLabel)}>{statusLabel}</StatusBadge>
      </div>
      <div className="deposit-progress" aria-label={`Deposit maturity progress ${progress}%`}>
        <div className="deposit-progress-track">
          <div className="deposit-progress-fill" style={{ width: `${progress}%` }} />
        </div>
        <div className="deposit-progress-label">
          <span>{progress}% complete</span>
          <span>{formatRemainingTime(now, deposit.maturityAt)}</span>
        </div>
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

      {canManage && isActive && isEmergencyMode && (
        <div className="action-group">
          <p className="action-group-title">Emergency mode</p>
          <p className="deferred-warning">
            Emergency mode is active. You can recover your principal now, but this action pays no interest and charges no early-withdrawal penalty.
          </p>
          <button
            className="primary-button"
            type="button"
            onClick={() => onEmergencyWithdraw(deposit.id)}
            disabled={isBusy}
          >
            Emergency Withdraw Principal
          </button>
        </div>
      )}

      {canManage && isActive && !isEmergencyMode && (
        <div className="action-group">
          {!isMatured ? (
            <>
              <p className="action-group-title">Early exit</p>
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
              <p className="action-group-title">Maturity actions</p>
              {!deposit.canPayInterest && maturityInterest > 0n && (
                <p className="deferred-warning">
                  Vault liquidity is not enough to pay your interest right now. If you withdraw, you will receive your
                  principal now and your {formatUsdc(maturityInterest)} interest will be recorded as a later claim.
                </p>
              )}
              <button className="primary-button" type="button" onClick={() => onWithdraw(deposit.id)} disabled={isBusy}>
                {deposit.canPayInterest ? "Withdraw Principal + Interest" : "Withdraw Principal Only"}
              </button>
              <p className="action-group-title">Renewal options</p>
              <select
                value={renewPlanId}
                onChange={(event) => onRenewPlanChange(deposit.id.toString(), event.target.value)}
                disabled={isBusy || plans.length === 0}
              >
                {plans.map((plan) => (
                  <option key={plan.id.toString()} value={plan.id.toString()}>
                    Renew: {formatDuration(plan.tenorSeconds)}
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
  const [mockUsdcBalance, setMockUsdcBalance] = useState<bigint>(0n);
  const [now, setNow] = useState<bigint>(0n);
  const [savingCorePaused, setSavingCorePaused] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [txStatus, setTxStatus] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [alertMessage, setAlertMessage] = useState("");
  const [confirmation, setConfirmation] = useState<ConfirmationState | null>(null);
  const [dismissedToastIds, setDismissedToastIds] = useState<Set<string>>(() => new Set());
  const confirmedActionRef = useRef<() => void>(() => undefined);

  const activePlans = useMemo(() => plans.filter((plan) => plan.enabled), [plans]);
  const selectedPlan = useMemo(
    () => activePlans.find((plan) => plan.id.toString() === selectedPlanId),
    [activePlans, selectedPlanId]
  );
  const deferredInterestDeposits = useMemo(
    () => historyDeposits.filter((deposit) => deposit.unpaidInterest > 0n && isSameAddress(deposit.interestClaimant, account)),
    [account, historyDeposits]
  );
  const isTxBusy = txStatus.length > 0;
  const portfolioSummary = useMemo(() => {
    const totalPrincipal = activeDeposits.reduce((total, deposit) => total + deposit.principal, 0n);
    const estimatedInterest = activeDeposits.reduce((total, deposit) => total + calculateInterest(deposit), 0n);
    const deferredInterest = deferredInterestDeposits.reduce((total, deposit) => total + deposit.unpaidInterest, 0n);
    const nextMaturity = activeDeposits.reduce<bigint | null>((current, deposit) => {
      if (current === null || deposit.maturityAt < current) return deposit.maturityAt;
      return current;
    }, null);

    return { totalPrincipal, estimatedInterest, deferredInterest, nextMaturity };
  }, [activeDeposits, deferredInterestDeposits]);
  const openDepositDisabledReason = useMemo(() => {
    if (!account) return "Connect your wallet first."
    if (savingCorePaused) return "SavingCore is paused; normal deposits are disabled."
    if (activePlans.length === 0) return "No enabled saving plans are available."
    if (!depositAmountInput) return "Enter a MockUSDC amount to open a certificate."
    if (isTxBusy) return "Wait for the current transaction to finish."
    return null
  }, [account, activePlans.length, depositAmountInput, isTxBusy, savingCorePaused]);
  const toastItems = useMemo<ToastItem[]>(() => {
    const items: ToastItem[] = [];
    if (txStatus) items.push({ id: `status:${txStatus}`, message: txStatus, tone: "status" });
    if (alertMessage) items.push({ id: `success:${alertMessage}`, message: alertMessage, tone: "success" });
    if (errorMessage) items.push({ id: `error:${errorMessage}`, message: errorMessage, tone: "error" });
    return items.filter((item) => !dismissedToastIds.has(item.id));
  }, [alertMessage, dismissedToastIds, errorMessage, txStatus]);

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

  const dismissToast = useCallback((id: string) => {
    setDismissedToastIds((current) => new Set(current).add(id));
  }, []);

  const parseError = useCallback((error: unknown) => {
    return parseTransactionError(error, savingCore, vaultManager, mockUSDC);
  }, [mockUSDC, savingCore, vaultManager]);

  const refreshDashboard = useCallback(async () => {
    if (!savingCore) return;

    setIsLoading(true);
    setErrorMessage("");

    try {
      const [nextPlanId, paused] = await Promise.all([
        savingCore.nextPlanId() as Promise<bigint>,
        savingCore.paused() as Promise<boolean>,
      ]);
      setSavingCorePaused(paused);

      const fetchedPlans = (await Promise.all(
        Array.from({ length: Number(nextPlanId) }, async (_, planIndex) => {
          const planId = BigInt(planIndex);
          return normalizePlan(planId, await savingCore.savingPlans(planId));
        })
      )).filter((plan) => plan.enabled);

      setPlans(fetchedPlans);
      setSelectedPlanId((current) => current || fetchedPlans[0]?.id.toString() || "");

      const latestBlock = await provider?.getBlock("latest");
      if (latestBlock) {
        setNow(BigInt(latestBlock.timestamp));
      }

      if (!account) {
        setMockUsdcBalance(0n);
        setActiveDeposits([]);
        setHistoryDeposits([]);
        return;
      }

      if (!provider) {
        setActiveDeposits([]);
        setHistoryDeposits([]);
        return;
      }

      if (mockUSDC) {
        setMockUsdcBalance((await mockUSDC.balanceOf(account)) as bigint);
      }

      const [openedEvents, transferInEvents, transferOutEvents, interestDeferredEvents, interestClaimedEvents] = await Promise.all([
        queryFilterInChunks(savingCore, savingCore.filters.DepositOpened(null, account), provider),
        queryFilterInChunks(savingCore, savingCore.filters.Transfer(null, account, null), provider),
        queryFilterInChunks(savingCore, savingCore.filters.Transfer(account, null, null), provider),
        queryFilterInChunks(savingCore, savingCore.filters.InterestDeferred(null, account), provider),
        queryFilterInChunks(savingCore, savingCore.filters.InterestClaimed(null, account), provider),
      ]);

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
  }, [account, mockUSDC, parseError, provider, savingCore, vaultManager]);

  const runTransaction = useCallback(async (
    label: string,
    action: () => Promise<ethers.TransactionResponse>,
    successMessage = "Transaction confirmed."
  ) => {
    setErrorMessage("");
    setAlertMessage("");
    setDismissedToastIds(new Set());
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
    setDismissedToastIds(new Set());
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
    setDismissedToastIds(new Set());
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

  function handleMintMockUsdc() {
    if (!account || !mockUSDC) return;

    void runTransaction(
      "Minting test MockUSDC...",
      () => mockUSDC.mint(account, FAUCET_AMOUNT) as Promise<ethers.TransactionResponse>,
      "1,000 test MockUSDC minted to your wallet."
    );
  }

  function handleRenewPlanChange(depositId: string, planId: string) {
    setRenewPlanByDeposit((current) => ({ ...current, [depositId]: planId }));
  }

  function handleRenew(depositId: bigint) {
    if (!savingCore) return;

    const fallbackPlanId = activePlans[0]?.id.toString();
    const selectedRenewPlanId = renewPlanByDeposit[depositId.toString()] ?? fallbackPlanId;
    if (!selectedRenewPlanId) return;
    const deposit = activeDeposits.find((item) => item.id === depositId);
    const renewPlan = activePlans.find((plan) => plan.id.toString() === selectedRenewPlanId);

    requestConfirmation(
      {
        title: "Compound renew this certificate?",
        description: "Earned interest will be paid from the vault into SavingCore and added to your new principal.",
        confirmLabel: "Renew Deposit",
        details: [
          { label: "Deposit", value: `#${depositId.toString()}` },
          { label: "New plan", value: renewPlan ? `#${renewPlan.id.toString()} · ${formatDuration(renewPlan.tenorSeconds)}` : `#${selectedRenewPlanId}` },
          ...(deposit ? [{ label: "Estimated new principal", value: formatUsdc(deposit.principal + calculateInterest(deposit)) }] : []),
        ],
      },
      () =>
        void runTransaction(
          "Renewing...",
          () => savingCore.renewDeposit(depositId, BigInt(selectedRenewPlanId)) as Promise<ethers.TransactionResponse>,
          "Deposit renewed successfully."
        )
    );
  }

  function handleWithdrawInterestAndRenew(depositId: bigint) {
    if (!savingCore) return;

    const fallbackPlanId = activePlans[0]?.id.toString();
    const selectedRenewPlanId = renewPlanByDeposit[depositId.toString()] ?? fallbackPlanId;
    if (!selectedRenewPlanId) return;
    const deposit = activeDeposits.find((item) => item.id === depositId);
    const renewPlan = activePlans.find((plan) => plan.id.toString() === selectedRenewPlanId);

    requestConfirmation(
      {
        title: "Withdraw interest and continue principal?",
        description: "Your earned interest is paid to your wallet, while the original principal opens a new certificate.",
        confirmLabel: "Continue",
        details: [
          { label: "Deposit", value: `#${depositId.toString()}` },
          { label: "New plan", value: renewPlan ? `#${renewPlan.id.toString()} · ${formatDuration(renewPlan.tenorSeconds)}` : `#${selectedRenewPlanId}` },
          ...(deposit
            ? [
                { label: "Interest payout", value: formatUsdc(calculateInterest(deposit)) },
                { label: "Renewed principal", value: formatUsdc(deposit.principal) },
              ]
            : []),
        ],
      },
      () =>
        void runTransaction(
          "Withdrawing interest and renewing principal...",
          () => savingCore.withdrawInterestAndRenewPrincipal(depositId, BigInt(selectedRenewPlanId)) as Promise<ethers.TransactionResponse>,
          "Interest withdrawn and principal renewed successfully."
        )
    );
  }

  function handleClaimInterest(depositId: bigint) {
    if (!savingCore) return;
    const deposit = deferredInterestDeposits.find((item) => item.id === depositId) ?? historyDeposits.find((item) => item.id === depositId);

    requestConfirmation(
      {
        title: "Claim deferred interest?",
        description: "This checks vault liquidity on-chain and pays the unpaid interest for this closed certificate if available.",
        confirmLabel: "Claim Interest",
        details: deposit
          ? [
              { label: "Deposit", value: `#${deposit.id.toString()}` },
              { label: "Claim amount", value: formatUsdc(deposit.unpaidInterest) },
            ]
          : undefined,
      },
      () =>
        void runTransaction(
          "Claiming deferred interest...",
          () => savingCore.claimInterest(depositId) as Promise<ethers.TransactionResponse>,
          "Deferred interest claimed successfully."
        )
    );
  }

  function handleEmergencyWithdrawPrincipal(depositId: bigint) {
    if (!savingCore) return;
    const deposit = activeDeposits.find((item) => item.id === depositId);

    requestConfirmation(
      {
        title: "Emergency withdraw principal?",
        description: "This is only for paused emergency mode. It returns principal, closes the certificate, and pays no interest or penalty.",
        confirmLabel: "Withdraw Principal",
        tone: "danger",
        details: deposit
          ? [
              { label: "Deposit", value: `#${deposit.id.toString()}` },
              { label: "Principal", value: formatUsdc(deposit.principal) },
            ]
          : undefined,
      },
      () =>
        void runTransaction(
          "Emergency withdrawing principal...",
          () => savingCore.emergencyWithdrawPrincipal(depositId) as Promise<ethers.TransactionResponse>,
          "Emergency principal withdrawal confirmed. Interest was not paid for this emergency exit."
        )
    );
  }

  useEffect(() => {
    queueMicrotask(() => void refreshDashboard());
  }, [refreshDashboard]);

  return (
    <div className="dashboard-grid">
      <section className="page-card dashboard-hero">
        <p className="eyebrow">Defi Banking</p>
        <h1>Savings certificates for your Sepolia demo wallet</h1>
        <p>Open fixed-term MockUSDC savings, receive an on-chain deposit certificate, and manage withdrawals, renewals, and marketplace-ready positions.</p>
      </section>

      <TransactionFeedback status={txStatus} success={alertMessage} error={errorMessage} />

      {!account && (
        <UiStatePanel
          kind="info"
          title="Connect your wallet"
          message="Connect MetaMask on Sepolia to mint test MockUSDC, open savings certificates, and view your positions."
        />
      )}
      {isLoading && <UiStatePanel kind="loading" title="Loading contract data" message="Reading plans, balances, and deposit certificates from Sepolia." />}
      {savingCorePaused && account && (
        <p className="deferred-warning">
          SavingCore is paused. Normal deposit, withdrawal, and renewal actions are disabled. Active NFT owners can use emergency principal withdrawal.
        </p>
      )}

      <section className="section-panel">
        <div className="section-header">
          <p className="eyebrow">Wallet Overview</p>
          <h2>Your demo banking wallet</h2>
          <p>Use freely mintable MockUSDC on Sepolia to test the complete savings lifecycle.</p>
        </div>
        <div className="wallet-overview-grid">
          <dl className="metric-card">
            <dt>Connected Wallet</dt>
            <dd title={account ?? undefined}>{formatAddress(account)}</dd>
          </dl>
          <dl className="metric-card">
            <dt>MockUSDC Balance</dt>
            <dd>{formatUsdc(mockUsdcBalance)}</dd>
          </dl>
          <div className="metric-card">
            <p>Network</p>
            <StatusBadge tone={account ? "success" : "warning"}>{account ? "Sepolia Ready" : "Wallet Required"}</StatusBadge>
          </div>
          <div className="metric-card">
            <p>Faucet</p>
            <button className="primary-button compact-button" type="button" onClick={handleMintMockUsdc} disabled={!account || isTxBusy || !mockUSDC}>
              Mint 1,000 MockUSDC
            </button>
            {!account && <p className="helper-text">Connect wallet first.</p>}
          </div>
        </div>
      </section>

      <section className="section-panel">
        <div className="section-header">
          <p className="eyebrow">Portfolio</p>
          <h2>Savings summary</h2>
        </div>
        <div className="portfolio-summary-grid">
          <dl className="metric-card">
            <dt>Active Principal</dt>
            <dd>{formatUsdc(portfolioSummary.totalPrincipal)}</dd>
          </dl>
          <dl className="metric-card">
            <dt>Estimated Interest</dt>
            <dd>{formatUsdc(portfolioSummary.estimatedInterest)}</dd>
          </dl>
          <dl className="metric-card">
            <dt>Certificates</dt>
            <dd>{activeDeposits.length.toString()}</dd>
          </dl>
          <dl className="metric-card">
            <dt>Next Maturity</dt>
            <dd>{portfolioSummary.nextMaturity ? formatDate(portfolioSummary.nextMaturity) : "No active certificates"}</dd>
          </dl>
          <dl className="metric-card">
            <dt>Deferred Interest</dt>
            <dd>{formatUsdc(portfolioSummary.deferredInterest)}</dd>
          </dl>
        </div>
      </section>

      <section className="section-panel">
        <div className="section-header">
          <p className="eyebrow">Available Plans</p>
          <h2>Choose a term</h2>
        </div>
        <div className="card-grid">
          {activePlans.length === 0 ? (
            <UiStatePanel kind="empty" title="No enabled plans" message="An admin must enable a savings plan before users can open certificates." />
          ) : (
            activePlans.map((plan) => (
              <PlanCard
                key={plan.id.toString()}
                plan={plan}
                isSelected={plan.id.toString() === selectedPlanId}
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
        isBusy={isTxBusy || !account || savingCorePaused}
        disabledReason={openDepositDisabledReason}
        onPlanChange={setSelectedPlanId}
        onAmountChange={setDepositAmountInput}
        onSubmit={() => {
          if (!selectedPlan || !depositAmountInput) return;
          requestConfirmation(
            {
              title: "Open savings certificate?",
              description: "Your wallet will approve MockUSDC if needed, then open a fixed-term deposit certificate.",
              confirmLabel: "Open Deposit",
              details: [
                { label: "Plan", value: `#${selectedPlan.id.toString()} · ${formatDuration(selectedPlan.tenorSeconds)}` },
                { label: "APR", value: formatApr(selectedPlan.aprBps) },
                { label: "Amount", value: `${depositAmountInput} USDC` },
              ],
            },
            () => void handleOpenDeposit()
          );
        }}
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
            <UiStatePanel
              kind="empty"
              title="No active certificates"
              message={account ? "Choose a plan and open your first fixed-term MockUSDC savings certificate." : "Connect your wallet to load active savings certificates."}
            />
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
                onEarlyWithdraw={(depositId) => {
                  const deposit = activeDeposits.find((item) => item.id === depositId);
                  requestConfirmation(
                    {
                      title: "Withdraw early?",
                      description: "Early withdrawal closes this certificate, pays no interest, and charges the configured penalty.",
                      confirmLabel: "Withdraw Early",
                      tone: "danger",
                      details: deposit
                        ? [
                            { label: "Deposit", value: `#${deposit.id.toString()}` },
                            { label: "Principal", value: formatUsdc(deposit.principal) },
                            { label: "Penalty", value: formatApr(deposit.penaltyBpsAtOpen) },
                          ]
                        : undefined,
                    },
                    () =>
                      void runTransaction(
                        "Withdrawing early...",
                        () => savingCore?.earlyWithdraw(depositId) as Promise<ethers.TransactionResponse>
                      )
                  );
                }}
                onWithdraw={(depositId) => {
                  const deposit = activeDeposits.find((item) => item.id === depositId);
                  requestConfirmation(
                    {
                      title: "Withdraw matured savings?",
                      description: "You will receive principal now. If the vault cannot pay interest, unpaid interest is recorded as a later claim.",
                      confirmLabel: "Withdraw",
                      details: deposit
                        ? [
                            { label: "Deposit", value: `#${deposit.id.toString()}` },
                            { label: "Principal", value: formatUsdc(deposit.principal) },
                            { label: "Estimated interest", value: formatUsdc(calculateInterest(deposit)) },
                          ]
                        : undefined,
                    },
                    () => void handleMaturityWithdraw(depositId)
                  );
                }}
                onEmergencyWithdraw={handleEmergencyWithdrawPrincipal}
                onRenew={handleRenew}
                onWithdrawInterestAndRenew={handleWithdrawInterestAndRenew}
                onClaimInterest={handleClaimInterest}
                isEmergencyMode={savingCorePaused}
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
                onEmergencyWithdraw={() => undefined}
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
              <UiStatePanel
                kind="empty"
                title="No certificate history"
                message="Closed, renewed, transferred, and marketplace-escrowed certificates will appear here after activity."
              />
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
                  onEmergencyWithdraw={() => undefined}
                  onRenew={() => undefined}
                  onWithdrawInterestAndRenew={() => undefined}
                  onClaimInterest={handleClaimInterest}
                  canManage={false}
                  isEmergencyMode={savingCorePaused}
                />
              ))
            )}
          </div>
        </section>
      )}

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
      <ToastStack items={toastItems} onDismiss={dismissToast} />
    </div>
  );
}
