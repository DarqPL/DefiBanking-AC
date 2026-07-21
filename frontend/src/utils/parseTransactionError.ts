import type { Contract, Result } from 'ethers'

const ERROR_MESSAGES: Record<string, string> = {
  ERC20InsufficientBalance: 'You do not have enough USDC balance.',
  ERC20InsufficientAllowance: 'Please approve USDC first.',
  MaturityNotReached: 'This deposit has not reached maturity yet.',
  NotMatured: 'This deposit has not reached maturity yet.',
  PlanNotEnabled: 'This saving plan is currently disabled.',
  PlanNotFound: 'This saving plan does not exist.',
  AmountBelowMinimum: 'Deposit amount is below the selected plan minimum.',
  AmountAboveMaximum: 'Deposit amount is above the selected plan maximum.',
  AlreadyMatured: 'This deposit has already matured. Use maturity withdrawal instead.',
  NotDepositOwner: 'Only the deposit NFT owner can perform this action.',
  DepositNotActive: 'This deposit is no longer active.',
  DepositNotFound: 'This deposit does not exist.',
  NewPrincipalOutOfRange: 'Renewed principal is outside the target plan limits.',
  GracePeriodNotEnded: 'Auto-renewal is only available after the 3-day grace period.',
  EnforcedPause: 'This contract is currently paused.',
  ExpectedPause: 'This contract is not paused.',
  OwnableUnauthorizedAccount: 'Connected wallet is not authorized for this admin action.',
  InsufficientVaultBalance: 'The vault does not have enough USDC liquidity.',
  InvalidAddress: 'Invalid address provided.',
  InvalidNFT: 'This is not the official deposit NFT.',
  InvalidPrice: 'Listing price must be greater than zero.',
  InvalidTerms: 'Marketplace terms changed. Refresh and accept the current terms.',
  AlreadyListed: 'This deposit NFT is already listed.',
  ListingNotFound: 'This listing no longer exists.',
  NotSeller: 'Only the listing seller can perform this action.',
  NotEscrowed: 'This deposit NFT is not held in marketplace escrow.',
  RestrictedWindow: 'This deposit is too close to maturity to list.',
  SelfBuyNotAllowed: 'You cannot buy your own listing. Cancel it instead.',
  DirectTransferRejected: 'Use the listing action instead of transferring directly to the marketplace.',
  RenewalMintRejected: 'Marketplace escrow cannot receive renewal mints.',
  ZeroAmount: 'Amount must be greater than zero.',
}

type NestedTransactionError = {
  data?: string | { data?: string; originalError?: { data?: string } }
  error?: { data?: string }
  info?: { error?: { data?: string } }
  shortMessage?: unknown
  message?: unknown
}

function getErrorData(error: unknown) {
  if (!error || typeof error !== 'object') return null

  const transactionError = error as NestedTransactionError

  if (typeof transactionError.data === 'string') return transactionError.data
  if (typeof transactionError.data?.data === 'string') return transactionError.data.data
  if (typeof transactionError.data?.originalError?.data === 'string') return transactionError.data.originalError.data
  if (typeof transactionError.error?.data === 'string') return transactionError.error.data
  if (typeof transactionError.info?.error?.data === 'string') return transactionError.info.error.data

  return null
}

function formatArgs(args: Result) {
  return args.toArray().map((arg) => (typeof arg === 'bigint' ? arg.toString() : String(arg)))
}

function formatParsedError(name: string, args: Result) {
  const mappedMessage = ERROR_MESSAGES[name]
  if (mappedMessage) return mappedMessage

  const formattedArgs = formatArgs(args)
  return formattedArgs.length > 0 ? `${name}: ${formattedArgs.join(', ')}` : name
}

function getFallbackMessage(error: unknown) {
  if (error && typeof error === 'object' && 'shortMessage' in error) {
    return String((error as NestedTransactionError).shortMessage)
  }

  if (error instanceof Error) return error.message

  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as NestedTransactionError).message)
  }

  return 'Transaction failed. Please try again.'
}

export function parseTransactionError(
  error: unknown,
  savingCore: Contract | null,
  vaultManager: Contract | null,
  mockUSDC: Contract | null,
  depositMarketplace: Contract | null = null,
) {
  const data = getErrorData(error)
  if (!data) return getFallbackMessage(error)

  for (const contract of [mockUSDC, savingCore, vaultManager, depositMarketplace]) {
    if (!contract) continue

    try {
      const parsedError = contract.interface.parseError(data)
      if (parsedError) return formatParsedError(parsedError.name, parsedError.args)
    } catch {
      // Keep trying other contract interfaces; not every ABI knows every custom error.
    }
  }

  return getFallbackMessage(error)
}
