import depositMarketplaceDeployment from '../../deployments/sepolia/DepositMarketplace.json'
import mockUSDCDeployment from '../../deployments/sepolia/MockUSDC.json'
import savingCoreDeployment from '../../deployments/sepolia/SavingCore.json'
import vaultManagerDeployment from '../../deployments/sepolia/VaultManager.json'

function eventScanStartBlock(blockNumber: number) {
  return Math.max(0, blockNumber - 1)
}

export const CONTRACT_ADDRESSES = {
  MockUSDC: mockUSDCDeployment.address,
  VaultManager: vaultManagerDeployment.address,
  SavingCore: savingCoreDeployment.address,
  DepositMarketplace: depositMarketplaceDeployment.address,
}

export const DEPLOYMENT_BLOCKS = {
  MockUSDC: eventScanStartBlock(mockUSDCDeployment.receipt.blockNumber),
  VaultManager: eventScanStartBlock(vaultManagerDeployment.receipt.blockNumber),
  SavingCore: eventScanStartBlock(savingCoreDeployment.receipt.blockNumber),
  DepositMarketplace: eventScanStartBlock(depositMarketplaceDeployment.receipt.blockNumber),
}
