import { randomUUID } from 'crypto'
import { session } from 'electron'
import type { LinkedAccount, LinkedLauncherId } from '../shared/types'
import type { SettingsStore } from './settings'

export function loginPartition(settings: SettingsStore, launcher: LinkedLauncherId, reuseAccountId?: string): {
  partition: string
  reused: boolean
} {
  const existing = reuseAccountId ? settings.linkedPartition(launcher, reuseAccountId) : null
  return existing ? { partition: existing, reused: true } : { partition: `persist:${launcher}-${randomUUID()}`, reused: false }
}

export async function clearLoginSession(partition: string | null | undefined): Promise<void> {
  if (partition) await session.fromPartition(partition).clearStorageData().catch(() => undefined)
}

export async function saveSignedInAccount(
  settings: SettingsStore,
  launcher: LinkedLauncherId,
  account: LinkedAccount,
  token: string | null,
  partition: string
): Promise<void> {
  const previous = settings.linkedPartition(launcher, account.accountId)
  const displaced = settings.linkedPartitionOwners(launcher, partition).filter((id) => id !== account.accountId)
  await settings.saveLinkedAccount(launcher, account, token, partition)
  for (const accountId of displaced) {
    await settings.setLinkedPartition(launcher, accountId, launcher === 'ea' ? `persist:ea-${randomUUID()}` : null)
  }
  if (previous && previous !== partition) await clearLoginSession(previous)
}
