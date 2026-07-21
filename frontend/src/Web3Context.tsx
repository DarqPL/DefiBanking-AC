import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { ethers } from 'ethers'
import MockUSDCAbi from './abi/MockUSDC.json'
import DepositMarketplaceAbi from './abi/DepositMarketplace.json'
import SavingCoreAbi from './abi/SavingCore.json'
import VaultManagerAbi from './abi/VaultManager.json'
import { CONTRACT_ADDRESSES } from './config'
import { Web3Context, type Contracts } from './Web3ContextObject'

const SEPOLIA_CHAIN_ID = 11_155_111n
const SEPOLIA_CHAIN_ID_HEX = '0xaa36a7'

type EthereumProvider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>
  on?: (event: 'accountsChanged' | 'chainChanged', handler: (...args: unknown[]) => void) => void
  removeListener?: (event: 'accountsChanged' | 'chainChanged', handler: (...args: unknown[]) => void) => void
}

declare global {
  interface Window {
    ethereum?: EthereumProvider
  }
}

function getEthereumProvider() {
  if (typeof window === 'undefined') return undefined
  return window.ethereum
}

function createBrowserProvider() {
  const ethereum = getEthereumProvider()
  return ethereum ? new ethers.BrowserProvider(ethereum) : null
}

export function Web3Provider({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<string | null>(null)
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(() => createBrowserProvider())
  const [signer, setSigner] = useState<ethers.JsonRpcSigner | null>(null)
  const [isWrongNetwork, setIsWrongNetwork] = useState(false)
  const isMetaMaskAvailable = Boolean(getEthereumProvider())

  const refreshNetwork = useCallback(async (nextProvider: ethers.BrowserProvider) => {
    const network = await nextProvider.getNetwork()
    setIsWrongNetwork(network.chainId !== SEPOLIA_CHAIN_ID)
  }, [])

  const refreshAccount = useCallback(async (nextProvider: ethers.BrowserProvider, selectedAccount?: string | null) => {
    const normalizedAccount = selectedAccount ? ethers.getAddress(selectedAccount) : null
    setAccount(normalizedAccount)
    setSigner(normalizedAccount ? await nextProvider.getSigner(normalizedAccount) : null)
  }, [])

  const connectWallet = useCallback(async () => {
    const ethereum = getEthereumProvider()
    if (!ethereum) {
      setAccount(null)
      setSigner(null)
      return
    }

    const nextProvider = new ethers.BrowserProvider(ethereum)
    setProvider(nextProvider)
    await refreshNetwork(nextProvider)

    const accounts = (await ethereum.request({ method: 'eth_requestAccounts' })) as string[]
    await refreshAccount(nextProvider, accounts[0] ?? null)
  }, [refreshAccount, refreshNetwork])

  const disconnectWallet = useCallback(() => {
    setAccount(null)
    setSigner(null)
    setProvider(null)
  }, [])

  const switchNetwork = useCallback(async () => {
    const ethereum = getEthereumProvider()
    if (!ethereum) return

    try {
      await ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: SEPOLIA_CHAIN_ID_HEX }],
      })
    } catch (error) {
      if ((error as { code?: number }).code !== 4902) {
        throw error
      }

      await ethereum.request({
        method: 'wallet_addEthereumChain',
        params: [
          {
            chainId: SEPOLIA_CHAIN_ID_HEX,
            chainName: 'Sepolia',
            nativeCurrency: {
              name: 'Sepolia ETH',
              symbol: 'ETH',
              decimals: 18,
            },
            rpcUrls: ['https://ethereum-sepolia-rpc.publicnode.com'],
            blockExplorerUrls: ['https://sepolia.etherscan.io'],
          },
        ],
      })
    }
  }, [])

  useEffect(() => {
    const ethereum = getEthereumProvider()
    if (!ethereum) return undefined

    const nextProvider = provider ?? new ethers.BrowserProvider(ethereum)
    queueMicrotask(() => void refreshNetwork(nextProvider))

    ethereum
      .request({ method: 'eth_accounts' })
      .then((accounts) => refreshAccount(nextProvider, ((accounts as string[])[0] ?? null)))
      .catch(() => {
        setAccount(null)
        setSigner(null)
      })

    const handleAccountsChanged = (...args: unknown[]) => {
      const accounts = args[0] as string[]
      void refreshAccount(nextProvider, accounts[0] ?? null)
    }

    const handleChainChanged = () => {
      window.location.reload()
    }

    ethereum.on?.('accountsChanged', handleAccountsChanged)
    ethereum.on?.('chainChanged', handleChainChanged)

    return () => {
      ethereum.removeListener?.('accountsChanged', handleAccountsChanged)
      ethereum.removeListener?.('chainChanged', handleChainChanged)
    }
  }, [provider, refreshAccount, refreshNetwork])

  const contracts = useMemo<Contracts>(() => {
    const runner = signer ?? provider
    if (!runner) {
      return { mockUSDC: null, vaultManager: null, savingCore: null, depositMarketplace: null }
    }

    return {
      mockUSDC: new ethers.Contract(CONTRACT_ADDRESSES.MockUSDC, MockUSDCAbi, runner),
      vaultManager: new ethers.Contract(CONTRACT_ADDRESSES.VaultManager, VaultManagerAbi, runner),
      savingCore: new ethers.Contract(CONTRACT_ADDRESSES.SavingCore, SavingCoreAbi, runner),
      depositMarketplace: new ethers.Contract(CONTRACT_ADDRESSES.DepositMarketplace, DepositMarketplaceAbi, runner),
    }
  }, [provider, signer])

  const value = useMemo(
    () => ({ account, provider, signer, contracts, isMetaMaskAvailable, isWrongNetwork, connectWallet, disconnectWallet, switchNetwork }),
    [account, provider, signer, contracts, isMetaMaskAvailable, isWrongNetwork, connectWallet, disconnectWallet, switchNetwork],
  )

  return <Web3Context value={value}>{children}</Web3Context>
}
