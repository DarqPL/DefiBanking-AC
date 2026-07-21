import { createContext } from 'react'
import { ethers } from 'ethers'

export type Contracts = {
  mockUSDC: ethers.Contract | null
  vaultManager: ethers.Contract | null
  savingCore: ethers.Contract | null
  depositMarketplace: ethers.Contract | null
}

export type Web3ContextValue = {
  account: string | null
  provider: ethers.BrowserProvider | null
  signer: ethers.JsonRpcSigner | null
  contracts: Contracts
  isMetaMaskAvailable: boolean
  isWrongNetwork: boolean
  connectWallet: () => Promise<void>
  disconnectWallet: () => void
  switchNetwork: () => Promise<void>
}

export const Web3Context = createContext<Web3ContextValue | undefined>(undefined)
