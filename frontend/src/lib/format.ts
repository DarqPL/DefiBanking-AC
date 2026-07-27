import { ethers } from 'ethers'

export type InterestBearingDeposit = {
  principal: bigint
  startAt: bigint
  maturityAt: bigint
  aprBpsAtOpen: bigint
}

export function formatUsdc(value: bigint) {
  return `${ethers.formatUnits(value, 6)} USDC`
}

export function formatDepositLimit(value: bigint, label: 'minimum' | 'maximum') {
  return value === 0n ? `No ${label}` : formatUsdc(value)
}

export function formatApr(aprBps: bigint) {
  return `${Number(aprBps) / 100}%`
}

export function formatBps(value: bigint) {
  return formatApr(value)
}

export function formatDuration(seconds: bigint) {
  const day = 86_400n
  const hour = 3_600n
  const minute = 60n

  if (seconds !== 0n && seconds % day === 0n) {
    const days = seconds / day
    return `${days.toString()} ${days === 1n ? 'day' : 'days'}`
  }

  if (seconds !== 0n && seconds % hour === 0n) {
    const hours = seconds / hour
    return `${hours.toString()} ${hours === 1n ? 'hour' : 'hours'}`
  }

  if (seconds !== 0n && seconds % minute === 0n) {
    const minutes = seconds / minute
    return `${minutes.toString()} ${minutes === 1n ? 'minute' : 'minutes'}`
  }

  return `${seconds.toString()} ${seconds === 1n ? 'second' : 'seconds'}`
}

export function formatDate(timestamp: bigint) {
  return new Date(Number(timestamp) * 1000).toLocaleString()
}

export function formatAddress(address: string | null | undefined) {
  if (!address) return 'Not connected'
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

export function isSameAddress(left: string | null | undefined, right: string | null | undefined) {
  return Boolean(left && right && left.toLowerCase() === right.toLowerCase())
}

export function calculateInterest(deposit: InterestBearingDeposit) {
  const tenorSeconds = deposit.maturityAt - deposit.startAt
  return (deposit.principal * deposit.aprBpsAtOpen * tenorSeconds) / (365n * 24n * 60n * 60n * 10_000n)
}

export function formatRemainingTime(now: bigint, target: bigint) {
  if (now >= target) return 'Ready now'

  const remainingSeconds = target - now
  const days = remainingSeconds / 86_400n
  const hours = remainingSeconds / 3_600n
  const minutes = (remainingSeconds % 3_600n) / 60n
  const seconds = remainingSeconds % 60n

  if (days > 0n) return `${days.toString()} ${days === 1n ? 'day' : 'days'} remaining`
  if (hours > 0n) return `${hours.toString()}h ${minutes.toString()}m ${seconds.toString()}s remaining`
  if (minutes > 0n) return `${minutes.toString()}m ${seconds.toString()}s remaining`
  return `${seconds.toString()}s remaining`
}

export function getProgressPercent(startAt: bigint, maturityAt: bigint, now: bigint) {
  if (maturityAt <= startAt) return 100
  if (now <= startAt) return 0
  if (now >= maturityAt) return 100

  return Number(((now - startAt) * 10_000n) / (maturityAt - startAt)) / 100
}

export function statusToneForLabel(label: string) {
  const normalized = label.toLowerCase()

  if (normalized.includes('active') || normalized.includes('enabled') || normalized.includes('ready')) return 'success' as const
  if (normalized.includes('paused') || normalized.includes('deferred') || normalized.includes('escrow')) return 'warning' as const
  if (normalized.includes('disabled') || normalized.includes('early') || normalized.includes('error') || normalized.includes('risk')) return 'danger' as const
  if (normalized.includes('matured') || normalized.includes('listed') || normalized.includes('renewed')) return 'info' as const

  return 'neutral' as const
}
