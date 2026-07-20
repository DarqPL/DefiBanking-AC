import { useEffect, useState } from "react";
import { ethers } from "ethers";
import { Link } from "react-router-dom";
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

type CreatePlanForm = {
  tenorDays: string;
  aprPercent: string;
  minDeposit: string;
  maxDeposit: string;
  penaltyPercent: string;
  enabled: boolean;
};

const defaultCreatePlanForm: CreatePlanForm = {
  tenorDays: "180",
  aprPercent: "2.25",
  minDeposit: "1",
  maxDeposit: "10000",
  penaltyPercent: "6.5",
  enabled: true,
};

function formatUsdc(value: bigint) {
  return `${ethers.formatUnits(value, 6)} USDC`;
}

function formatDepositLimit(value: bigint, label: "minimum" | "maximum") {
  return value === 0n ? `No ${label}` : formatUsdc(value);
}

function parseUsdc(value: string) {
  return ethers.parseUnits(value || "0", 6);
}

function percentToBps(value: string) {
  return Math.round(Number(value || "0") * 100);
}

function formatBps(value: bigint) {
  return `${Number(value) / 100}%`;
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

export default function AdminDashboard() {
  const { account, contracts } = useWeb3();
  const { mockUSDC, savingCore, vaultManager } = contracts;
  const [plans, setPlans] = useState<SavingPlan[]>([]);
  const [principalLocked, setPrincipalLocked] = useState<bigint>(0n);
  const [vaultBalance, setVaultBalance] = useState<bigint>(0n);
  const [feeReceiver, setFeeReceiver] = useState("");
  const [feeReceiverBalance, setFeeReceiverBalance] = useState<bigint>(0n);
  const [savingCorePaused, setSavingCorePaused] = useState(false);
  const [vaultManagerPaused, setVaultManagerPaused] = useState(false);
  const [fundAmount, setFundAmount] = useState("");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [createPlanForm, setCreatePlanForm] = useState<CreatePlanForm>(defaultCreatePlanForm);
  const [isLoading, setIsLoading] = useState(false);
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [txStatus, setTxStatus] = useState("");
  const [alertMessage, setAlertMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const isBusy = isLoading || txStatus.length > 0 || !account;

  function parseError(error: unknown) {
    return parseTransactionError(error, savingCore, vaultManager, mockUSDC);
  }

  async function refreshAdminData() {
    if (!mockUSDC || !savingCore || !vaultManager) return;

    setIsLoading(true);
    setErrorMessage("");

    try {
      const [vaultFund, principal, receiver, corePaused, vaultPaused, nextPlanId] = await Promise.all([
        mockUSDC.balanceOf(CONTRACT_ADDRESSES.VaultManager) as Promise<bigint>,
        mockUSDC.balanceOf(CONTRACT_ADDRESSES.SavingCore) as Promise<bigint>,
        vaultManager.feeReceiver() as Promise<string>,
        savingCore.paused() as Promise<boolean>,
        vaultManager.paused() as Promise<boolean>,
        savingCore.nextPlanId() as Promise<bigint>,
      ]);
      const receiverBalance = (await mockUSDC.balanceOf(receiver)) as bigint;

      const fetchedPlans: SavingPlan[] = [];
      for (let planId = 0n; planId < nextPlanId; planId += 1n) {
        fetchedPlans.push(normalizePlan(planId, await savingCore.savingPlans(planId)));
      }

      setVaultBalance(vaultFund);
      setPrincipalLocked(principal);
      setFeeReceiver(receiver);
      setFeeReceiverBalance(receiverBalance);
      setSavingCorePaused(corePaused);
      setVaultManagerPaused(vaultPaused);
      setPlans(fetchedPlans);
    } catch (error) {
      setErrorMessage(parseError(error));
    } finally {
      setIsLoading(false);
    }
  }

  async function runTransaction(
    label: string,
    action: () => Promise<ethers.TransactionResponse>,
    successMessage = "Transaction confirmed."
  ) {
    setTxStatus(label);
    setErrorMessage("");
    setAlertMessage("");

    try {
      const tx = await action();
      setTxStatus("Waiting for confirmation...");
      await tx.wait();
      setAlertMessage(successMessage);
      await refreshAdminData();
    } catch (error) {
      setErrorMessage(parseError(error));
    } finally {
      setTxStatus("");
    }
  }

  async function handleFundVault() {
    if (!mockUSDC || !vaultManager || !fundAmount) return;

    const amount = parseUsdc(fundAmount);
    setTxStatus("Approving vault funding...");
    setErrorMessage("");
    setAlertMessage("");

    try {
      const approvalTx = await mockUSDC.approve(CONTRACT_ADDRESSES.VaultManager, amount);
      await approvalTx.wait();

      setTxStatus("Funding vault...");
      const fundTx = await vaultManager.fundVault(amount);
      await fundTx.wait();

      setFundAmount("");
      setAlertMessage("Vault funded successfully.");
      await refreshAdminData();
    } catch (error) {
      setErrorMessage(parseError(error));
    } finally {
      setTxStatus("");
    }
  }

  function handleWithdrawVault() {
    if (!vaultManager || !withdrawAmount) return;
    void runTransaction(
      "Withdrawing vault liquidity...",
      () => vaultManager.withdrawVault(parseUsdc(withdrawAmount)) as Promise<ethers.TransactionResponse>,
      "Vault withdrawal confirmed."
    ).then(() => setWithdrawAmount(""));
  }

  function handlePauseSavingCore() {
    if (!savingCore) return;
    void runTransaction(
      savingCorePaused ? "Unpausing SavingCore..." : "Pausing SavingCore...",
      () => (savingCorePaused ? savingCore.unpause() : savingCore.pause()) as Promise<ethers.TransactionResponse>,
      savingCorePaused ? "SavingCore unpaused." : "SavingCore paused."
    );
  }

  function handlePauseVaultManager() {
    if (!vaultManager) return;
    void runTransaction(
      vaultManagerPaused ? "Unpausing VaultManager..." : "Pausing VaultManager...",
      () => (vaultManagerPaused ? vaultManager.unpause() : vaultManager.pause()) as Promise<ethers.TransactionResponse>,
      vaultManagerPaused ? "VaultManager unpaused." : "VaultManager paused."
    );
  }

  function handleCreatePlan() {
    if (!savingCore) return;

    const tenorDays = BigInt(createPlanForm.tenorDays || "0");
    const aprBps = percentToBps(createPlanForm.aprPercent);
    const minDeposit = parseUsdc(createPlanForm.minDeposit);
    const maxDeposit = parseUsdc(createPlanForm.maxDeposit);
    const penaltyBps = percentToBps(createPlanForm.penaltyPercent);

    void runTransaction(
      "Creating plan...",
      () =>
        savingCore.createPlan(
          tenorDays,
          aprBps,
          minDeposit,
          maxDeposit,
          penaltyBps,
          createPlanForm.enabled
        ) as Promise<ethers.TransactionResponse>,
      "Plan created."
    );
  }

  function handleUpdateApr(plan: SavingPlan) {
    if (!savingCore) return;

    const nextApr = window.prompt("New APR percentage", String(Number(plan.aprBps) / 100));
    if (!nextApr) return;

    void runTransaction(
      "Updating APR...",
      () => savingCore.updatePlan(plan.id, percentToBps(nextApr)) as Promise<ethers.TransactionResponse>,
      "APR updated."
    );
  }

  function handleTogglePlan(plan: SavingPlan) {
    if (!savingCore) return;

    void runTransaction(
      plan.enabled ? "Disabling plan..." : "Enabling plan...",
      () =>
        (plan.enabled
          ? savingCore.disablePlan(plan.id)
          : savingCore.enablePlan(plan.id)) as Promise<ethers.TransactionResponse>,
      plan.enabled ? "Plan disabled." : "Plan enabled."
    );
  }

  function updateCreatePlanField<K extends keyof CreatePlanForm>(key: K, value: CreatePlanForm[K]) {
    setCreatePlanForm((current) => ({ ...current, [key]: value }));
  }

  useEffect(() => {
    let isMounted = true;

    async function checkAdminAccess() {
      if (!account || !savingCore) {
        setIsAdmin(false);
        return;
      }

      setIsAdmin(null);
      setErrorMessage("");

      try {
        const owner = (await savingCore.owner()) as string;
        if (!isMounted) return;

        setIsAdmin(owner.toLowerCase() === account.toLowerCase());
      } catch (error) {
        if (!isMounted) return;

        setIsAdmin(false);
        setErrorMessage(parseError(error));
      }
    }

    void checkAdminAccess();

    return () => {
      isMounted = false;
    };
  }, [account, savingCore]);

  useEffect(() => {
    if (isAdmin) void refreshAdminData();
  }, [isAdmin, account, mockUSDC, savingCore, vaultManager]);

  if (isAdmin === null) {
    return (
      <div className="dashboard-grid">
        <section className="page-card dashboard-hero">
          <p className="eyebrow">Admin Dashboard</p>
          <h1>Checking permissions...</h1>
          <p>Verifying whether the connected wallet owns this contract.</p>
        </section>
      </div>
    );
  }

  if (isAdmin === false) {
    return (
      <div className="dashboard-grid">
        <section className="page-card dashboard-hero">
          <p className="eyebrow">Admin Dashboard</p>
          <h1>Access Denied</h1>
          <p style={{paddingBottom:"20px"}}>Access Denied: You not have permission to access this area.</p>
          <Link className="primary-button" to="/" >
            Return to User Dashboard
          </Link>
        </section>
        {errorMessage && <p className="error-message">{errorMessage}</p>}
      </div>
    );
  }

  return (
    <div className="dashboard-grid">
      <section className="page-card dashboard-hero">
        <p className="eyebrow">Admin Dashboard</p>
        <h1>Protocol Controls</h1>
        <p>Create plans, fund vault liquidity, pause contracts, and monitor protocol state from here.</p>
      </section>

      {!account && <p className="status-message">Connect the owner wallet to perform administrative actions.</p>}
      {isLoading && <p className="status-message">Loading admin data...</p>}
      {txStatus && <p className="status-message">{txStatus}</p>}
      {alertMessage && <p className="success-message">{alertMessage}</p>}
      {errorMessage && <p className="error-message">{errorMessage}</p>}

      <section className="section-panel">
        <div className="section-header">
          <p className="eyebrow">System Balances</p>
          <h2>Protocol accounting overview</h2>
        </div>

        <div className="admin-summary-grid">
          <article className="plan-card">
            <p className="eyebrow">Total Principal Locked</p>
            <h3>{formatUsdc(principalLocked)}</h3>
          </article>
          <article className="plan-card">
            <p className="eyebrow">Vault Interest Fund</p>
            <h3>{formatUsdc(vaultBalance)}</h3>
          </article>
          <article className="plan-card">
            <p className="eyebrow">Fee Receiver</p>
            <h3 className="address-text">{feeReceiver || "Not loaded"}</h3>
            <p>{formatUsdc(feeReceiverBalance)}</p>
          </article>
        </div>
      </section>

      <section className="section-panel">
        <div className="section-header">
          <p className="eyebrow">Vault & Emergency</p>
          <h2>Liquidity and circuit breakers</h2>
        </div>

        <div className="admin-summary-grid">
          <article className="plan-card">
            <p className="eyebrow">SavingCore</p>
            <h3>{savingCorePaused ? "Paused" : "Active"}</h3>
          </article>
          <article className="plan-card">
            <p className="eyebrow">VaultManager</p>
            <h3>{vaultManagerPaused ? "Paused" : "Active"}</h3>
          </article>
        </div>

        <div className="inline-form-grid admin-controls">
          <label className="form-row">
            Fund Vault (USDC)
            <input
              inputMode="decimal"
              min="0"
              type="number"
              value={fundAmount}
              onChange={(event) => setFundAmount(event.target.value)}
              disabled={isBusy}
            />
          </label>
          <button
            className="primary-button"
            type="button"
            onClick={() => void handleFundVault()}
            disabled={isBusy || !fundAmount}
          >
            Fund Vault
          </button>
          <label className="form-row">
            Withdraw Vault (USDC)
            <input
              inputMode="decimal"
              min="0"
              type="number"
              value={withdrawAmount}
              onChange={(event) => setWithdrawAmount(event.target.value)}
              disabled={isBusy}
            />
          </label>
          <button
            className="secondary-button"
            type="button"
            onClick={handleWithdrawVault}
            disabled={isBusy || !withdrawAmount}
          >
            Withdraw Vault
          </button>
        </div>

        <div className="action-row emergency-row">
          <button className="secondary-button" type="button" onClick={handlePauseSavingCore} disabled={isBusy}>
            {savingCorePaused ? "Unpause SavingCore" : "Pause SavingCore"}
          </button>
          <button className="secondary-button" type="button" onClick={handlePauseVaultManager} disabled={isBusy}>
            {vaultManagerPaused ? "Unpause VaultManager" : "Pause VaultManager"}
          </button>
        </div>
      </section>

      <section className="section-panel">
        <div className="section-header">
          <p className="eyebrow">Create Plan</p>
          <h2>Configure a new term</h2>
        </div>
        <div className="inline-form-grid">
          <label className="form-row">
            Tenor Days
            <input
              min="1"
              type="number"
              value={createPlanForm.tenorDays}
              onChange={(event) => updateCreatePlanField("tenorDays", event.target.value)}
              disabled={isBusy}
            />
          </label>
          <label className="form-row">
            APR (%)
            <input
              inputMode="decimal"
              min="0"
              step="0.01"
              type="number"
              value={createPlanForm.aprPercent}
              onChange={(event) => updateCreatePlanField("aprPercent", event.target.value)}
              disabled={isBusy}
            />
          </label>
          <label className="form-row">
            Min Deposit (USDC)
            <input
              inputMode="decimal"
              min="0"
              type="number"
              value={createPlanForm.minDeposit}
              onChange={(event) => updateCreatePlanField("minDeposit", event.target.value)}
              disabled={isBusy}
            />
          </label>
          <label className="form-row">
            Max Deposit (USDC)
            <input
              inputMode="decimal"
              min="0"
              type="number"
              value={createPlanForm.maxDeposit}
              onChange={(event) => updateCreatePlanField("maxDeposit", event.target.value)}
              disabled={isBusy}
            />
          </label>
          <label className="form-row">
            Penalty (%)
            <input
              inputMode="decimal"
              min="0"
              step="0.01"
              type="number"
              value={createPlanForm.penaltyPercent}
              onChange={(event) => updateCreatePlanField("penaltyPercent", event.target.value)}
              disabled={isBusy}
            />
          </label>
          <label className="form-row checkbox-row">
            <input
              checked={createPlanForm.enabled}
              type="checkbox"
              onChange={(event) => updateCreatePlanField("enabled", event.target.checked)}
              disabled={isBusy}
            />
            Enabled
          </label>
          <button className="primary-button" type="button" onClick={handleCreatePlan} disabled={isBusy}>
            Create Plan
          </button>
        </div>
      </section>

      <section className="section-panel">
        <div className="section-header">
          <p className="eyebrow">Plan Management</p>
          <h2>All saving plans</h2>
        </div>
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Tenor</th>
                <th>APR</th>
                <th>Min</th>
                <th>Max</th>
                <th>Penalty</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {plans.length === 0 ? (
                <tr>
                  <td colSpan={8}>No plans found.</td>
                </tr>
              ) : (
                plans.map((plan) => (
                  <tr key={plan.id.toString()}>
                    <td>{plan.id.toString()}</td>
                    <td>{plan.tenorDays.toString()} days</td>
                    <td>{formatBps(plan.aprBps)}</td>
                    <td>{formatDepositLimit(plan.minDeposit, "minimum")}</td>
                    <td>{formatDepositLimit(plan.maxDeposit, "maximum")}</td>
                    <td>{formatBps(plan.earlyWithdrawPenaltyBps)}</td>
                    <td>{plan.enabled ? "Enabled" : "Disabled"}</td>
                    <td>
                      <div className="table-actions">
                        <button
                          className="secondary-button"
                          type="button"
                          onClick={() => handleUpdateApr(plan)}
                          disabled={isBusy}
                        >
                          Edit APR
                        </button>
                        <button
                          className="secondary-button"
                          type="button"
                          onClick={() => handleTogglePlan(plan)}
                          disabled={isBusy}
                        >
                          {plan.enabled ? "Disable" : "Enable"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
