import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ethers } from "ethers";
import { Link } from "react-router-dom";
import { CONTRACT_ADDRESSES, DEPLOYMENT_BLOCKS } from "../config";
import { useWeb3 } from "../useWeb3";
import { parseTransactionError } from "../utils/parseTransactionError";
import { ConfirmationDialog } from "../components/ConfirmationDialog";
import { StatusBadge } from "../components/StatusBadge";
import { UiStatePanel } from "../components/UiStatePanel";
import { ToastStack, type ToastItem } from "../components/ToastStack";
import {
  formatBps,
  formatDate,
  formatDepositLimit,
  formatDuration,
  formatUsdc,
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

type DurationUnit = "minutes" | "hours" | "days";

type CreatePlanForm = {
  tenorValue: string;
  tenorUnit: DurationUnit;
  aprPercent: string;
  minDeposit: string;
  maxDeposit: string;
  penaltyPercent: string;
  enabled: boolean;
};

type AdminDepositInfo = {
  id: bigint;
  planId: bigint;
  principal: bigint;
  startAt: bigint;
  maturityAt: bigint;
  aprBpsAtOpen: bigint;
  penaltyBpsAtOpen: bigint;
  status: bigint;
  owner: string | null;
  unpaidInterest: bigint;
  interestClaimant: string | null;
};

type DepositFilter = "all" | "active" | "withdrawn" | "early" | "manual" | "auto" | "deferred" | "escrowed";

type AuditFilter = "all" | "plans" | "vault" | "admin" | "marketplace";

type AuditLogEntry = {
  id: string;
  category: Exclude<AuditFilter, "all">;
  contractName: string;
  action: string;
  summary: string;
  blockNumber: number;
  transactionHash: string;
  logIndex: number;
  actor: string | null;
};

type ConfirmationState = {
  title: string;
  description: string;
  confirmLabel?: string;
  tone?: "default" | "danger";
  details?: { label: string; value: string }[];
};

const defaultCreatePlanForm: CreatePlanForm = {
  tenorValue: "180",
  tenorUnit: "days",
  aprPercent: "2.25",
  minDeposit: "1",
  maxDeposit: "10000",
  penaltyPercent: "6.5",
  enabled: true,
};

const ADMIN_PAGE_SIZE = 5;
const CHUNK_SIZE = 10_000;

const DEPOSIT_STATUS_LABELS: Record<string, string> = {
  "0": "None",
  "1": "Active",
  "2": "Withdrawn",
  "3": "Early Withdrawn",
  "4": "Manual Renewed",
  "5": "Auto Renewed",
};

const DEPOSIT_FILTER_LABELS: Record<DepositFilter, string> = {
  all: "All deposits",
  active: "Active",
  withdrawn: "Withdrawn",
  early: "Early Withdrawn",
  manual: "Manual Renewed",
  auto: "Auto Renewed",
  deferred: "Deferred Interest",
  escrowed: "Marketplace Escrowed",
};

const AUDIT_FILTER_LABELS: Record<AuditFilter, string> = {
  all: "All logs",
  plans: "Plans",
  vault: "Vault",
  admin: "Admin / Pause",
  marketplace: "Marketplace",
};

function parseUsdc(value: string) {
  return ethers.parseUnits(value || "0", 6);
}

function percentToBps(value: string) {
  return Math.round(Number(value || "0") * 100);
}

function durationToSeconds(value: string, unit: DurationUnit) {
  const amount = BigInt(value || "0");
  if (unit === "minutes") return amount * 60n;
  if (unit === "hours") return amount * 60n * 60n;
  return amount * 24n * 60n * 60n;
}

function formatAddress(address: string | null) {
  if (!address) return "Closed / burned";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function paginate<T>(items: T[], page: number) {
  const totalPages = Math.max(1, Math.ceil(items.length / ADMIN_PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  return {
    safePage,
    totalPages,
    pageItems: items.slice(safePage * ADMIN_PAGE_SIZE, safePage * ADMIN_PAGE_SIZE + ADMIN_PAGE_SIZE),
  };
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

export default function AdminDashboard() {
  const { account, provider, contracts } = useWeb3();
  const { mockUSDC, savingCore, vaultManager, depositMarketplace } = contracts;
  const [plans, setPlans] = useState<SavingPlan[]>([]);
  const [adminDeposits, setAdminDeposits] = useState<AdminDepositInfo[]>([]);
  const [depositFilter, setDepositFilter] = useState<DepositFilter>("all");
  const [depositPage, setDepositPage] = useState(0);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [auditFilter, setAuditFilter] = useState<AuditFilter>("all");
  const [auditPage, setAuditPage] = useState(0);
  const [principalLocked, setPrincipalLocked] = useState<bigint>(0n);
  const [vaultBalance, setVaultBalance] = useState<bigint>(0n);
  const [reservedInterest, setReservedInterest] = useState<bigint>(0n);
  const [withdrawableVaultBalance, setWithdrawableVaultBalance] = useState<bigint>(0n);
  const [feeReceiver, setFeeReceiver] = useState("");
  const [newFeeReceiver, setNewFeeReceiver] = useState("");
  const [feeReceiverBalance, setFeeReceiverBalance] = useState<bigint>(0n);
  const [savingCorePaused, setSavingCorePaused] = useState(false);
  const [vaultManagerPaused, setVaultManagerPaused] = useState(false);
  const [autoRenewGracePeriod, setAutoRenewGracePeriod] = useState<bigint>(0n);
  const [graceValue, setGraceValue] = useState("3");
  const [graceUnit, setGraceUnit] = useState<DurationUnit>("days");
  const [fundAmount, setFundAmount] = useState("");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [createPlanForm, setCreatePlanForm] = useState<CreatePlanForm>(defaultCreatePlanForm);
  const [aprEditsByPlan, setAprEditsByPlan] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [adminRole, setAdminRole] = useState<"owner" | "admin" | "unauthorized" | null>(null);
  const [txStatus, setTxStatus] = useState("");
  const [alertMessage, setAlertMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [confirmation, setConfirmation] = useState<ConfirmationState | null>(null);
  const [dismissedToastIds, setDismissedToastIds] = useState<Set<string>>(() => new Set());
  const confirmedActionRef = useRef<() => void>(() => undefined);

  const isBusy = isLoading || txStatus.length > 0 || !account;
  const filteredDeposits = useMemo(() => {
    return adminDeposits.filter((deposit) => {
      if (depositFilter === "all") return true;
      if (depositFilter === "active") return deposit.status === 1n;
      if (depositFilter === "withdrawn") return deposit.status === 2n;
      if (depositFilter === "early") return deposit.status === 3n;
      if (depositFilter === "manual") return deposit.status === 4n;
      if (depositFilter === "auto") return deposit.status === 5n;
      if (depositFilter === "deferred") return deposit.unpaidInterest > 0n;
      if (depositFilter === "escrowed")
        return deposit.status === 1n && isSameAddress(deposit.owner, CONTRACT_ADDRESSES.DepositMarketplace);
      return true;
    });
  }, [adminDeposits, depositFilter]);
  const depositPagination = paginate(filteredDeposits, depositPage);
  const filteredAuditLogs = useMemo(() => {
    return auditFilter === "all" ? auditLogs : auditLogs.filter((log) => log.category === auditFilter);
  }, [auditFilter, auditLogs]);
  const auditPagination = paginate(filteredAuditLogs, auditPage);
  const hasVaultShortfall = reservedInterest > vaultBalance;
  const vaultPaymentStatusLabel =
    reservedInterest === 0n ? "No Interest Due" : hasVaultShortfall ? "Not Enough To Pay" : "Enough To Pay";
  const feeReceiverDisabledReason = !newFeeReceiver
    ? "Enter a new fee receiver address."
    : !ethers.isAddress(newFeeReceiver)
    ? "Enter a valid Ethereum address."
    : feeReceiver && isSameAddress(newFeeReceiver, feeReceiver)
    ? "This is already the active fee receiver."
    : isBusy
    ? "Wait for the current admin action to finish."
    : null;
  const toastItems: ToastItem[] = [
    ...(txStatus ? [{ id: `status:${txStatus}`, message: txStatus, tone: "status" as const }] : []),
    ...(alertMessage ? [{ id: `success:${alertMessage}`, message: alertMessage, tone: "success" as const }] : []),
    ...(errorMessage ? [{ id: `error:${errorMessage}`, message: errorMessage, tone: "error" as const }] : []),
  ].filter((item) => !dismissedToastIds.has(item.id));

  const parseError = useCallback(
    (error: unknown) => {
      return parseTransactionError(error, savingCore, vaultManager, mockUSDC);
    },
    [mockUSDC, savingCore, vaultManager]
  );

  const refreshAuditLogs = useCallback(async () => {
    if (!provider) return;

    const nextAuditLogs: AuditLogEntry[] = [];

    const appendAuditLogs = async (
      contract: ethers.Contract | null,
      contractName: string,
      startBlock: number,
      events: {
        name: string;
        category: AuditLogEntry["category"];
        action: string;
        summarize: (args: ethers.Result | null) => string;
      }[]
    ) => {
      if (!contract) return;

      const logsByType = await Promise.all(
        events.map(async (eventConfig) => {
          const filterFactory = (
            contract.filters as unknown as Record<string, (() => ethers.DeferredTopicFilter) | undefined>
          )[eventConfig.name];
          if (!filterFactory) return [];

          const eventsForType = await queryFilterInChunks(contract, filterFactory(), provider, startBlock);
          return eventsForType.map((event) => ({ event, eventConfig }));
        })
      );

      for (const { event, eventConfig } of logsByType.flat()) {
        nextAuditLogs.push({
          id: `${event.transactionHash}:${event.index}`,
          category: eventConfig.category,
          contractName,
          action: eventConfig.action,
          summary: eventConfig.summarize(readEventArgs(event)),
          blockNumber: event.blockNumber,
          transactionHash: event.transactionHash,
          logIndex: event.index,
          actor: null,
        });
      }
    };

    try {
      await Promise.all([
        appendAuditLogs(savingCore, "SavingCore", DEPLOYMENT_BLOCKS.SavingCore, [
          {
            name: "PlanCreated",
            category: "plans",
            action: "Plan created",
            summarize: (args) => `Plan #${args?.[0]?.toString() ?? "?"} created`,
          },
          {
            name: "PlanUpdated",
            category: "plans",
            action: "Plan updated",
            summarize: (args) => `Plan #${args?.[0]?.toString() ?? "?"} APR/status updated`,
          },
          {
            name: "Paused",
            category: "admin",
            action: "SavingCore paused",
            summarize: () => "SavingCore emergency pause enabled",
          },
          {
            name: "Unpaused",
            category: "admin",
            action: "SavingCore unpaused",
            summarize: () => "SavingCore emergency pause disabled",
          },
          {
            name: "AdminUpdated",
            category: "admin",
            action: "Admin updated",
            summarize: (args) =>
              `Admin ${formatAddress(String(args?.[0] ?? ""))} -> ${formatAddress(String(args?.[1] ?? ""))}`,
          },
          {
            name: "DepositMarketplaceUpdated",
            category: "marketplace",
            action: "Marketplace updated",
            summarize: () => "Authorized deposit marketplace changed",
          },
          {
            name: "DepositMarketplaceLocked",
            category: "marketplace",
            action: "Marketplace locked",
            summarize: () => "Authorized deposit marketplace permanently locked",
          },
          {
            name: "MetadataImageURIUpdated",
            category: "admin",
            action: "Metadata image updated",
            summarize: () => "Deposit certificate metadata image URI updated",
          },
          {
            name: "MetadataPermanentlyLocked",
            category: "admin",
            action: "Metadata locked",
            summarize: () => "Deposit certificate metadata permanently locked",
          },
          {
            name: "AutoRenewGracePeriodUpdated",
            category: "admin",
            action: "Auto-renew grace updated",
            summarize: (args) =>
              `Grace ${formatDuration((args?.[0] as bigint | undefined) ?? 0n)} -> ${formatDuration(
                (args?.[1] as bigint | undefined) ?? 0n
              )}`,
          },
        ]),
        appendAuditLogs(vaultManager, "VaultManager", DEPLOYMENT_BLOCKS.VaultManager, [
          {
            name: "FeeReceiverUpdated",
            category: "vault",
            action: "Fee receiver updated",
            summarize: () => "Early-withdrawal fee receiver changed",
          },
          {
            name: "VaultFunded",
            category: "vault",
            action: "Vault funded",
            summarize: (args) => `${formatUsdc(args?.[1] as bigint)} added to interest vault`,
          },
          {
            name: "VaultWithdrawn",
            category: "vault",
            action: "Vault withdrawn",
            summarize: (args) => `${formatUsdc(args?.[1] as bigint)} withdrawn from interest vault`,
          },
          {
            name: "SavingCoreUpdated",
            category: "admin",
            action: "SavingCore updated",
            summarize: () => "Authorized SavingCore changed",
          },
          {
            name: "AdminUpdated",
            category: "admin",
            action: "Admin updated",
            summarize: (args) =>
              `Admin ${formatAddress(String(args?.[0] ?? ""))} -> ${formatAddress(String(args?.[1] ?? ""))}`,
          },
          {
            name: "SavingCoreLocked",
            category: "admin",
            action: "SavingCore locked",
            summarize: () => "Authorized SavingCore permanently locked",
          },
          {
            name: "Paused",
            category: "admin",
            action: "VaultManager paused",
            summarize: () => "VaultManager pause enabled",
          },
          {
            name: "Unpaused",
            category: "admin",
            action: "VaultManager unpaused",
            summarize: () => "VaultManager pause disabled",
          },
        ]),
        appendAuditLogs(depositMarketplace, "DepositMarketplace", DEPLOYMENT_BLOCKS.DepositMarketplace, [
          {
            name: "TermsHashUpdated",
            category: "marketplace",
            action: "Terms updated",
            summarize: () => "Marketplace terms hash changed",
          },
          {
            name: "UnlistedDepositRecovered",
            category: "marketplace",
            action: "Deposit recovered",
            summarize: (args) => `Deposit #${args?.[0]?.toString() ?? "?"} recovered from marketplace`,
          },
          {
            name: "AdminUpdated",
            category: "admin",
            action: "Admin updated",
            summarize: (args) =>
              `Admin ${formatAddress(String(args?.[0] ?? ""))} -> ${formatAddress(String(args?.[1] ?? ""))}`,
          },
          {
            name: "Paused",
            category: "admin",
            action: "Marketplace paused",
            summarize: () => "Marketplace pause enabled",
          },
          {
            name: "Unpaused",
            category: "admin",
            action: "Marketplace unpaused",
            summarize: () => "Marketplace pause disabled",
          },
        ]),
      ]);

      setAuditLogs(
        nextAuditLogs.sort((left, right) => right.blockNumber - left.blockNumber || right.logIndex - left.logIndex)
      );
    } catch (error) {
      setErrorMessage(parseError(error));
    }
  }, [depositMarketplace, parseError, provider, savingCore, vaultManager]);

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

  const refreshAdminData = useCallback(async () => {
    if (!mockUSDC || !savingCore || !vaultManager) return;

    setIsLoading(true);
    setErrorMessage("");

    try {
      const [
        vaultFund,
        withdrawableVault,
        reserve,
        principal,
        receiver,
        corePaused,
        vaultPaused,
        gracePeriod,
        nextPlanId,
      ] = await Promise.all([
        mockUSDC.balanceOf(CONTRACT_ADDRESSES.VaultManager) as Promise<bigint>,
        vaultManager.withdrawableVaultBalance() as Promise<bigint>,
        vaultManager.reservedInterest() as Promise<bigint>,
        mockUSDC.balanceOf(CONTRACT_ADDRESSES.SavingCore) as Promise<bigint>,
        vaultManager.feeReceiver() as Promise<string>,
        savingCore.paused() as Promise<boolean>,
        vaultManager.paused() as Promise<boolean>,
        savingCore.autoRenewGracePeriod() as Promise<bigint>,
        savingCore.nextPlanId() as Promise<bigint>,
      ]);
      const receiverBalance = (await mockUSDC.balanceOf(receiver)) as bigint;

      const fetchedPlans = await Promise.all(
        Array.from({ length: Number(nextPlanId) }, async (_, planIndex) => {
          const planId = BigInt(planIndex);
          return normalizePlan(planId, await savingCore.savingPlans(planId));
        })
      );

      const nextDepositId = (await savingCore.nextDepositId()) as bigint;
      const fetchedDeposits = await Promise.all(
        Array.from({ length: Number(nextDepositId) }, async (_, depositIndex) => {
          const depositId = BigInt(depositIndex);
          const deposit = normalizeDeposit(depositId, await savingCore.deposits(depositId));

          const [ownerResult, interestResult] = await Promise.allSettled([
            savingCore.ownerOf(depositId) as Promise<string>,
            Promise.all([
              savingCore.unpaidInterest(depositId) as Promise<bigint>,
              savingCore.interestClaimant(depositId) as Promise<string>,
            ]),
          ]);

          deposit.owner = ownerResult.status === "fulfilled" ? ethers.getAddress(ownerResult.value) : null;

          if (interestResult.status === "fulfilled") {
            const [unpaidInterest, claimant] = interestResult.value;
            deposit.unpaidInterest = unpaidInterest;
            deposit.interestClaimant = claimant === ethers.ZeroAddress ? null : ethers.getAddress(claimant);
          }

          return deposit;
        })
      );

      setVaultBalance(vaultFund);
      setPrincipalLocked(principal);
      setReservedInterest(reserve);
      setWithdrawableVaultBalance(withdrawableVault);
      setFeeReceiver(receiver);
      setFeeReceiverBalance(receiverBalance);
      setSavingCorePaused(corePaused);
      setVaultManagerPaused(vaultPaused);
      setAutoRenewGracePeriod(gracePeriod);
      setPlans(fetchedPlans);
      setAdminDeposits(fetchedDeposits.sort((left, right) => Number(right.id - left.id)));
    } catch (error) {
      setErrorMessage(parseError(error));
    } finally {
      setIsLoading(false);
    }
  }, [mockUSDC, parseError, savingCore, vaultManager]);

  const runTransaction = useCallback(
    async (
      label: string,
      action: () => Promise<ethers.TransactionResponse>,
      successMessage = "Transaction confirmed."
    ) => {
      setTxStatus(label);
      setErrorMessage("");
      setAlertMessage("");
      setDismissedToastIds(new Set());

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
    },
    [parseError, refreshAdminData]
  );

  async function handleFundVault() {
    if (!mockUSDC || !vaultManager || !fundAmount) return;

    const amount = parseUsdc(fundAmount);
    setTxStatus("Approving vault funding...");
    setErrorMessage("");
    setAlertMessage("");
    setDismissedToastIds(new Set());

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

  function handleUpdateFeeReceiver() {
    if (!vaultManager || feeReceiverDisabledReason || !ethers.isAddress(newFeeReceiver)) return;

    const nextReceiver = ethers.getAddress(newFeeReceiver);
    requestConfirmation(
      {
        title: "Update fee receiver?",
        description:
          "Future early-withdrawal penalties will be sent to this address. Existing deposits are not otherwise changed.",
        confirmLabel: "Update Receiver",
        details: [
          { label: "Current receiver", value: feeReceiver || "Not loaded" },
          { label: "New receiver", value: nextReceiver },
        ],
      },
      () =>
        void runTransaction(
          "Updating fee receiver...",
          () => vaultManager.setFeeReceiver(nextReceiver) as Promise<ethers.TransactionResponse>,
          "Fee receiver updated."
        ).then(() => setNewFeeReceiver(""))
    );
  }

  function handleCreatePlan() {
    if (!savingCore) return;

    const tenorSeconds = durationToSeconds(createPlanForm.tenorValue, createPlanForm.tenorUnit);
    const aprBps = percentToBps(createPlanForm.aprPercent);
    const minDeposit = parseUsdc(createPlanForm.minDeposit);
    const maxDeposit = parseUsdc(createPlanForm.maxDeposit);
    const penaltyBps = percentToBps(createPlanForm.penaltyPercent);

    void runTransaction(
      "Creating plan...",
      () =>
        savingCore.createPlan(
          tenorSeconds,
          aprBps,
          minDeposit,
          maxDeposit,
          penaltyBps,
          createPlanForm.enabled
        ) as Promise<ethers.TransactionResponse>,
      "Plan created."
    );
  }

  function handleUpdateAutoRenewGrace() {
    if (!savingCore || !graceValue) return;

    const nextGrace = durationToSeconds(graceValue, graceUnit);
    requestConfirmation(
      {
        title: "Update auto-renew grace?",
        description:
          "This controls how long after maturity permissionless auto-renewal must wait. Use 15 minutes for demos or 3 days for the assignment default.",
        confirmLabel: "Update Grace",
        details: [
          { label: "Current grace", value: formatDuration(autoRenewGracePeriod) },
          { label: "New grace", value: formatDuration(nextGrace) },
        ],
      },
      () =>
        void runTransaction(
          "Updating auto-renew grace...",
          () => savingCore.setAutoRenewGracePeriod(nextGrace) as Promise<ethers.TransactionResponse>,
          "Auto-renew grace updated."
        )
    );
  }

  function handleUpdateApr(plan: SavingPlan, nextApr: string) {
    if (!savingCore) return;
    if (!nextApr) return;

    requestConfirmation(
      {
        title: "Update plan APR?",
        description:
          "This affects new deposits and future manual renewals only. Existing deposit snapshots do not change.",
        confirmLabel: "Update APR",
        details: [
          { label: "Plan", value: `#${plan.id.toString()}` },
          { label: "Current APR", value: formatBps(plan.aprBps) },
          { label: "New APR", value: `${nextApr}%` },
        ],
      },
      () =>
        void runTransaction(
          "Updating APR...",
          () => savingCore.updatePlan(plan.id, percentToBps(nextApr)) as Promise<ethers.TransactionResponse>,
          "APR updated."
        ).then(() => setAprEditsByPlan((current) => ({ ...current, [plan.id.toString()]: "" })))
    );
  }

  function handleTogglePlan(plan: SavingPlan) {
    if (!savingCore) return;

    requestConfirmation(
      {
        title: plan.enabled ? "Disable this saving plan?" : "Enable this saving plan?",
        description: plan.enabled
          ? "New deposits and renewals into this plan will be blocked. Existing active deposits can still be withdrawn normally."
          : "Users will be able to open new deposits into this plan again.",
        confirmLabel: plan.enabled ? "Disable Plan" : "Enable Plan",
        tone: plan.enabled ? "danger" : "default",
        details: [
          { label: "Plan", value: `#${plan.id.toString()}` },
          { label: "Tenor", value: formatDuration(plan.tenorSeconds) },
          { label: "APR", value: formatBps(plan.aprBps) },
        ],
      },
      () =>
        void runTransaction(
          plan.enabled ? "Disabling plan..." : "Enabling plan...",
          () =>
            (plan.enabled
              ? savingCore.disablePlan(plan.id)
              : savingCore.enablePlan(plan.id)) as Promise<ethers.TransactionResponse>,
          plan.enabled ? "Plan disabled." : "Plan enabled."
        )
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
        setAdminRole("unauthorized");
        return;
      }

      setIsAdmin(null);
      setErrorMessage("");

      try {
        const [owner, configuredAdmin] = await Promise.all([
          savingCore.owner() as Promise<string>,
          savingCore.admin() as Promise<string>,
        ]);
        if (!isMounted) return;

        const normalizedAccount = account.toLowerCase();
        const isOwner = owner.toLowerCase() === normalizedAccount;
        const isConfiguredAdmin = configuredAdmin.toLowerCase() === normalizedAccount;

        setIsAdmin(isOwner || isConfiguredAdmin);
        setAdminRole(isOwner ? "owner" : isConfiguredAdmin ? "admin" : "unauthorized");
      } catch (error) {
        if (!isMounted) return;

        setIsAdmin(false);
        setAdminRole("unauthorized");
        setErrorMessage(parseError(error));
      }
    }

    void checkAdminAccess();

    return () => {
      isMounted = false;
    };
  }, [account, parseError, savingCore]);

  useEffect(() => {
    if (!isAdmin) return;

    queueMicrotask(() => void refreshAdminData());
    const auditRefreshTimer = window.setTimeout(() => void refreshAuditLogs(), 500);

    return () => window.clearTimeout(auditRefreshTimer);
  }, [isAdmin, refreshAdminData, refreshAuditLogs]);

  if (isAdmin === null) {
    return (
      <div className="dashboard-grid">
        <section className="page-card dashboard-hero">
          <p className="eyebrow">Admin Dashboard</p>
          <h1>Checking permissions...</h1>
          <p>Verifying whether the connected wallet is the owner or configured admin.</p>
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
          <p style={{ paddingBottom: "20px" }}>Access Denied: You not have permission to access this area.</p>
          <Link className="primary-button" to="/">
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
        <p className="eyebrow">Defi Banking Admin</p>
        <h1>Banking control center</h1>
        <p>
          Create savings plans, protect vault liquidity, monitor reserves, and manage emergency controls from one admin
          workspace.
        </p>
      </section>

      {!account && (
        <p className="status-message">Connect the owner or admin wallet to perform administrative actions.</p>
      )}
      {adminRole && adminRole !== "unauthorized" && (
        <p className="status-message">
          Connected role: {adminRole === "owner" ? "Deployer owner" : "Operational admin"}
        </p>
      )}
      {isLoading && (
        <UiStatePanel
          kind="loading"
          title="Loading admin data"
          message="Refreshing plans, vault balances, and deposits from Sepolia."
        />
      )}

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
            <p className="eyebrow">Reserved Interest</p>
            <h3>{formatUsdc(reservedInterest)}</h3>
          </article>
          <article className="plan-card">
            <p className="eyebrow">Withdrawable Vault</p>
            <h3>{formatUsdc(withdrawableVaultBalance)}</h3>
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
            <StatusBadge tone={savingCorePaused ? "warning" : "success"}>
              {savingCorePaused ? "Paused" : "Active"}
            </StatusBadge>
          </article>
          <article className="plan-card">
            <p className="eyebrow">VaultManager</p>
            <h3>{vaultManagerPaused ? "Paused" : "Active"}</h3>
            <StatusBadge tone={vaultManagerPaused ? "warning" : "success"}>
              {vaultManagerPaused ? "Paused" : "Active"}
            </StatusBadge>
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

        <div className="inline-form-grid admin-controls">
          <label className="form-row">
            Auto-Renew Grace
            <input
              inputMode="numeric"
              min="1"
              type="number"
              value={graceValue}
              onChange={(event) => setGraceValue(event.target.value)}
              disabled={isBusy}
            />
          </label>
          <label className="form-row">
            Grace Unit
            <select
              value={graceUnit}
              onChange={(event) => setGraceUnit(event.target.value as DurationUnit)}
              disabled={isBusy}
            >
              <option value="minutes">Minutes</option>
              <option value="hours">Hours</option>
              <option value="days">Days</option>
            </select>
          </label>
          <button
            className="secondary-button"
            type="button"
            onClick={handleUpdateAutoRenewGrace}
            disabled={isBusy || !graceValue}
          >
            Update Grace
          </button>
          <p className="helper-text">Current grace: {formatDuration(autoRenewGracePeriod)}.</p>
        </div>

        <div className="inline-form-grid admin-controls">
          <label className="form-row">
            New Fee Receiver
            <input
              placeholder="0x..."
              value={newFeeReceiver}
              onChange={(event) => setNewFeeReceiver(event.target.value)}
              disabled={isBusy}
            />
          </label>
          <button
            className="secondary-button"
            type="button"
            onClick={handleUpdateFeeReceiver}
            disabled={Boolean(feeReceiverDisabledReason)}
          >
            Update Fee Receiver
          </button>
          {feeReceiverDisabledReason && <p className="helper-text">{feeReceiverDisabledReason}</p>}
        </div>
      </section>

      <section className="section-panel">
        <div className="section-header">
          <p className="eyebrow">Create Plan</p>
          <h2>Configure a new term</h2>
        </div>
        <div className="inline-form-grid">
          <label className="form-row">
            Tenor
            <input
              min="1"
              type="number"
              value={createPlanForm.tenorValue}
              onChange={(event) => updateCreatePlanField("tenorValue", event.target.value)}
              disabled={isBusy}
            />
          </label>
          <label className="form-row">
            Tenor Unit
            <select
              value={createPlanForm.tenorUnit}
              onChange={(event) => updateCreatePlanField("tenorUnit", event.target.value as DurationUnit)}
              disabled={isBusy}
            >
              <option value="minutes">Minutes</option>
              <option value="hours">Hours</option>
              <option value="days">Days</option>
            </select>
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
          <p className="table-scroll-hint">Scroll sideways to review all plan controls on smaller screens.</p>
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
                    <td>{formatDuration(plan.tenorSeconds)}</td>
                    <td>{formatBps(plan.aprBps)}</td>
                    <td>{formatDepositLimit(plan.minDeposit, "minimum")}</td>
                    <td>{formatDepositLimit(plan.maxDeposit, "maximum")}</td>
                    <td>{formatBps(plan.earlyWithdrawPenaltyBps)}</td>
                    <td>
                      <StatusBadge tone={plan.enabled ? "success" : "danger"}>
                        {plan.enabled ? "Enabled" : "Disabled"}
                      </StatusBadge>
                    </td>
                    <td>
                      <div className="table-actions">
                        <input
                          aria-label={`New APR for plan ${plan.id.toString()}`}
                          inputMode="decimal"
                          min="0"
                          step="0.01"
                          type="number"
                          placeholder={String(Number(plan.aprBps) / 100)}
                          value={aprEditsByPlan[plan.id.toString()] ?? ""}
                          onChange={(event) =>
                            setAprEditsByPlan((current) => ({ ...current, [plan.id.toString()]: event.target.value }))
                          }
                          disabled={isBusy}
                        />
                        <button
                          className="secondary-button"
                          type="button"
                          onClick={() => handleUpdateApr(plan, aprEditsByPlan[plan.id.toString()] ?? "")}
                          disabled={isBusy || !(aprEditsByPlan[plan.id.toString()] ?? "")}
                        >
                          Save APR
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

      <section className="section-panel">
        <div className="section-header">
          <p className="eyebrow">Interest Vault</p>
          <h2>Vault payment summary</h2>
          <p>
            Simple view of how much interest the vault needs to pay, how much USDC can be withdrawn, and whether the
            vault is funded enough.
          </p>
        </div>
        <div className="admin-summary-grid">
          <article className="plan-card">
            <p className="eyebrow">Interest To Pay</p>
            <h3>{formatUsdc(reservedInterest)}</h3>
            <p>Total interest currently reserved for user withdrawals and renewals.</p>
          </article>
          <article className="plan-card">
            <p className="eyebrow">Can Withdraw</p>
            <h3>{formatUsdc(withdrawableVaultBalance)}</h3>
            <p>USDC the admin can withdraw without using reserved interest.</p>
          </article>
          <article className="plan-card">
            <p className="eyebrow">Vault Status</p>
            <h3>{vaultPaymentStatusLabel}</h3>
            <StatusBadge tone={hasVaultShortfall ? "danger" : "success"}>{vaultPaymentStatusLabel}</StatusBadge>
            <p>Vault balance: {formatUsdc(vaultBalance)}</p>
          </article>
        </div>
      </section>

      <section className="section-panel">
        <div className="section-header">
          <p className="eyebrow">Deposit Explorer</p>
          <div className="section-title-row">
            <div>
              <h2>All deposit certificates</h2>
              <p>
                Review every deposit, including active certificates, closed positions, marketplace escrow, and deferred
                interest claims.
              </p>
            </div>
            <label className="form-row compact-filter">
              Show
              <select
                value={depositFilter}
                onChange={(event) => {
                  setDepositFilter(event.target.value as DepositFilter);
                  setDepositPage(0);
                }}
              >
                {Object.entries(DEPOSIT_FILTER_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        <div className="admin-table-wrap">
          <p className="table-scroll-hint">Scroll sideways to inspect every deposit field on smaller screens.</p>
          <table className="admin-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Status</th>
                <th>Owner</th>
                <th>Plan</th>
                <th>Principal</th>
                <th>APR</th>
                <th>Penalty</th>
                <th>Maturity</th>
                <th>Unpaid Interest</th>
              </tr>
            </thead>
            <tbody>
              {depositPagination.pageItems.length === 0 ? (
                <tr>
                  <td colSpan={9}>No deposits match this filter.</td>
                </tr>
              ) : (
                depositPagination.pageItems.map((deposit) => (
                  <tr key={deposit.id.toString()}>
                    <td>{deposit.id.toString()}</td>
                    <td>
                      <StatusBadge
                        tone={statusToneForLabel(DEPOSIT_STATUS_LABELS[deposit.status.toString()] ?? "Unknown")}
                      >
                        {DEPOSIT_STATUS_LABELS[deposit.status.toString()] ?? "Unknown"}
                      </StatusBadge>
                    </td>
                    <td className="address-text" title={deposit.owner ?? undefined}>
                      {formatAddress(deposit.owner)}
                    </td>
                    <td>{deposit.planId.toString()}</td>
                    <td>{formatUsdc(deposit.principal)}</td>
                    <td>{formatBps(deposit.aprBpsAtOpen)}</td>
                    <td>{formatBps(deposit.penaltyBpsAtOpen)}</td>
                    <td>{formatDate(deposit.maturityAt)}</td>
                    <td>
                      {deposit.unpaidInterest > 0n ? (
                        <span title={deposit.interestClaimant ?? undefined}>{formatUsdc(deposit.unpaidInterest)}</span>
                      ) : (
                        "None"
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="pagination-row admin-pagination-row">
          <button
            className="secondary-button compact-button"
            type="button"
            disabled={depositPagination.safePage === 0}
            onClick={() => setDepositPage((page) => Math.max(0, page - 1))}
          >
            Previous
          </button>
          <span>
            Page {depositPagination.safePage + 1} of {depositPagination.totalPages} · {filteredDeposits.length} deposits
          </span>
          <button
            className="secondary-button compact-button"
            type="button"
            disabled={depositPagination.safePage >= depositPagination.totalPages - 1}
            onClick={() => setDepositPage((page) => page + 1)}
          >
            Next
          </button>
        </div>
      </section>

      <section className="section-panel">
        <div className="section-header">
          <p className="eyebrow">Admin Audit Logs</p>
          <div className="section-title-row">
            <div>
              <h2>Owner and admin activity</h2>
              <p>
                Event-based audit trail for operational actions. Sender is read from each transaction when available.
              </p>
            </div>
            <label className="form-row compact-filter">
              Show
              <select
                value={auditFilter}
                onChange={(event) => {
                  setAuditFilter(event.target.value as AuditFilter);
                  setAuditPage(0);
                }}
              >
                {Object.entries(AUDIT_FILTER_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        <div className="admin-table-wrap">
          <p className="table-scroll-hint">
            Scroll sideways to review sender and transaction details on smaller screens.
          </p>
          <table className="admin-table">
            <thead>
              <tr>
                <th>Block</th>
                <th>Category</th>
                <th>Contract</th>
                <th>Action</th>
                <th>Summary</th>
                <th>Sender</th>
                <th>Tx</th>
              </tr>
            </thead>
            <tbody>
              {auditPagination.pageItems.length === 0 ? (
                <tr>
                  <td colSpan={7}>No audit logs match this filter.</td>
                </tr>
              ) : (
                auditPagination.pageItems.map((log) => (
                  <tr key={log.id}>
                    <td>{log.blockNumber}</td>
                    <td>
                      <StatusBadge tone={statusToneForLabel(AUDIT_FILTER_LABELS[log.category])}>
                        {AUDIT_FILTER_LABELS[log.category]}
                      </StatusBadge>
                    </td>
                    <td>{log.contractName}</td>
                    <td>{log.action}</td>
                    <td>{log.summary}</td>
                    <td className="address-text" title={log.actor ?? undefined}>
                      {formatAddress(log.actor)}
                    </td>
                    <td>
                      <a
                        href={`https://sepolia.etherscan.io/tx/${log.transactionHash}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        View
                      </a>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="pagination-row admin-pagination-row">
          <button
            className="secondary-button compact-button"
            type="button"
            disabled={auditPagination.safePage === 0}
            onClick={() => setAuditPage((page) => Math.max(0, page - 1))}
          >
            Previous
          </button>
          <span>
            Page {auditPagination.safePage + 1} of {auditPagination.totalPages} · {filteredAuditLogs.length} logs
          </span>
          <button
            className="secondary-button compact-button"
            type="button"
            disabled={auditPagination.safePage >= auditPagination.totalPages - 1}
            onClick={() => setAuditPage((page) => page + 1)}
          >
            Next
          </button>
        </div>
      </section>

      <ConfirmationDialog
        open={confirmation !== null}
        title={confirmation?.title ?? "Review admin action"}
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

function normalizeDeposit(id: bigint, deposit: unknown): AdminDepositInfo {
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
  };
}

async function queryFilterInChunks(
  contract: ethers.Contract,
  filter: ethers.DeferredTopicFilter,
  provider: ethers.BrowserProvider,
  startBlock: number
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

function readEventArgs(event: ethers.EventLog | ethers.Log) {
  return "args" in event ? event.args : null;
}
