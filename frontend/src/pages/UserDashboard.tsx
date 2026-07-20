import { useEffect, useMemo, useState } from "react";
import { ethers } from "ethers";
import { CONTRACT_ADDRESSES } from "../config";
import { useWeb3 } from "../Web3Context";
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
};

const DEPOSIT_STATUS: Record<string, string> = {
  "0": "None",
  "1": "Active",
  "2": "Withdrawn",
  "3": "Early Withdrawn",
  "4": "Manual Renewed",
  "5": "Auto Renewed",
};

const DEPLOYMENT_BLOCK = 11_313_284;
const CHUNK_SIZE = 10_000;

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
  };
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
}) {
  const isActive = deposit.status === 1n;
  const isMatured = now >= deposit.maturityAt;
  const earlyPenalty = (deposit.principal * deposit.penaltyBpsAtOpen) / 10_000n;
  const earlyReceiveAmount = deposit.principal - earlyPenalty;

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
          <dt>Maturity</dt>
          <dd>{formatDate(deposit.maturityAt)}</dd>
        </div>
        <div>
          <dt>Penalty Snapshot</dt>
          <dd>{formatApr(deposit.penaltyBpsAtOpen)}</dd>
        </div>
      </dl>

      {isActive && (
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
              <button className="primary-button" type="button" onClick={() => onWithdraw(deposit.id)} disabled={isBusy}>
                Withdraw
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
                disabled={isBusy || plans.length === 0}
              >
                Renew
              </button>
            </>
          )}
        </div>
      )}
    </article>
  );
}

export default function UserDashboard() {
  const { account, provider, contracts } = useWeb3();
  const { mockUSDC, savingCore } = contracts;
  const [plans, setPlans] = useState<SavingPlan[]>([]);
  const [deposits, setDeposits] = useState<DepositInfo[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState("");
  const [depositAmountInput, setDepositAmountInput] = useState("");
  const [renewPlanByDeposit, setRenewPlanByDeposit] = useState<Record<string, string>>({});
  const [now, setNow] = useState<bigint>(BigInt(Math.floor(Date.now() / 1000)));
  const [isLoading, setIsLoading] = useState(false);
  const [txStatus, setTxStatus] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const activePlans = useMemo(() => plans.filter((plan) => plan.enabled), [plans]);
  const isTxBusy = txStatus.length > 0;

  function parseError(error: unknown) {
    return parseTransactionError(error, savingCore, null, mockUSDC);
  }

  async function refreshDashboard() {
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
      setNow(BigInt(latestBlock?.timestamp ?? Math.floor(Date.now() / 1000)));

      if (!account) {
        setDeposits([]);
        return;
      }

      if (!provider) {
        setDeposits([]);
        return;
      }

      const filter = savingCore.filters.DepositOpened(null, account);
      const latestBlockNumber = await provider.getBlockNumber();
      const events = [];

      for (let fromBlock = DEPLOYMENT_BLOCK; fromBlock <= latestBlockNumber; fromBlock += CHUNK_SIZE) {
        const toBlock = Math.min(fromBlock + CHUNK_SIZE - 1, latestBlockNumber);
        const chunk = await savingCore.queryFilter(filter, fromBlock, toBlock);
        events.push(...chunk);
      }

      const fetchedDeposits = await Promise.all(
        events.map(async (event) => {
          if (!("args" in event) || !event.args) return null;
          const depositId = (event.args as { depositId: bigint }).depositId;
          return normalizeDeposit(depositId, await savingCore.deposits(depositId));
        })
      );

      setDeposits(fetchedDeposits.filter((deposit): deposit is DepositInfo => Boolean(deposit)));
    } catch (error) {
      setErrorMessage(parseError(error));
    } finally {
      setIsLoading(false);
    }
  }

  async function runTransaction(label: string, action: () => Promise<ethers.TransactionResponse>) {
    setErrorMessage("");
    setTxStatus(label);

    try {
      const tx = await action();
      setTxStatus("Waiting for confirmation...");
      await tx.wait();
      await refreshDashboard();
    } catch (error) {
      setErrorMessage(parseError(error));
    } finally {
      setTxStatus("");
    }
  }

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
      () => savingCore.renewDeposit(depositId, BigInt(selectedRenewPlanId)) as Promise<ethers.TransactionResponse>
    );
  }

  useEffect(() => {
    void refreshDashboard();
  }, [account, provider, savingCore]);

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
          <p className="eyebrow">My Deposits</p>
          <h2>Position history</h2>
        </div>
        <div className="card-grid">
          {deposits.length === 0 ? (
            <p>No deposits found for this wallet.</p>
          ) : (
            deposits.map((deposit) => (
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
                onWithdraw={(depositId) =>
                  void runTransaction(
                    "Withdrawing at maturity...",
                    () => savingCore?.withdrawAtMaturity(depositId) as Promise<ethers.TransactionResponse>
                  )
                }
                onRenew={handleRenew}
              />
            ))
          )}
        </div>
      </section>
    </div>
  );
}
