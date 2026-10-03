import { rename } from 'fs/promises'
import { join } from 'path'
import { app, safeStorage } from 'electron'
import type {
  AccountsView,
  Collection,
  LinkedAccount,
  LinkedAccounts,
  LinkedLauncherId,
  ProfileUpdate,
  SettingsUpdate,
  SteamAccount
} from '../shared/types'
import { pathExists, readJson, writeJson } from './fsutil'

interface StoredToken {
  refreshToken?: string
  refreshTokenEncrypted?: string
}

interface StoredAccount extends SteamAccount, StoredToken {
  accessToken?: string
  accessTokenEncrypted?: string
}

interface StoredLinkedAccount extends LinkedAccount, StoredToken {
  partition?: string
  accessToken?: string
  accessTokenEncrypted?: string
  accessTokenExpiresAt?: number
}

export interface CachedAccessToken {
  token: string
  expiresAt: number
}

interface StoredLinked {
  accounts: StoredLinkedAccount[]
  activeId: string | null
}

type StoredLinkedMap = Record<LinkedLauncherId, StoredLinked>

interface StoredSettings {
  steamPathOverride: string
  useGameLogos?: boolean
  profileName?: string
  profileAvatar?: string
  collections?: Collection[]
  steamGridDbApiKey?: string
  steamGridDbApiKeyEncrypted?: string
  steamWebApiKey?: string
  steamWebApiKeyEncrypted?: string
  steamGridDbCoverOverrides?: string[]
  accounts: StoredAccount[]
  activeSteamId: string | null
  linked: StoredLinkedMap
}

const LINKED_LAUNCHERS: LinkedLauncherId[] = ['epic', 'ubisoft', 'ea']

function emptyLinked(): StoredLinkedMap {
  return {
    epic: { accounts: [], activeId: null },
    ubisoft: { accounts: [], activeId: null },
    ea: { accounts: [], activeId: null }
  }
}

function isStoredLinked(value: unknown): value is StoredLinkedAccount {
  return Boolean(value && typeof value === 'object' && typeof (value as LinkedAccount).accountId === 'string')
}

function readLinked(value: unknown): StoredLinked {
  if (isStoredLinked(value)) return { accounts: [value], activeId: value.accountId }
  const stored = value as Partial<StoredLinked> | null | undefined
  const accounts = Array.isArray(stored?.accounts) ? stored.accounts.filter(isStoredLinked) : []
  const activeId = typeof stored?.activeId === 'string' ? stored.activeId : (accounts[0]?.accountId ?? null)
  return { accounts, activeId }
}

function publicLinked({ accountId, displayName, avatarUrl }: StoredLinkedAccount): LinkedAccount {
  return { accountId, displayName, avatarUrl: avatarUrl ?? null }
}

function encrypt(value: string): StoredToken {
  if (safeStorage.isEncryptionAvailable()) {
    return { refreshTokenEncrypted: safeStorage.encryptString(value).toString('base64') }
  }
  return { refreshToken: value }
}

function decrypt(account: StoredToken): string | null {
  if (account.refreshTokenEncrypted) {
    try {
      return safeStorage.decryptString(Buffer.from(account.refreshTokenEncrypted, 'base64'))
    } catch {
      return null
    }
  }
  return account.refreshToken || null
}

function publicAccount({ steamId, accountName, personaName, avatarUrl }: StoredAccount): SteamAccount {
  return { steamId, accountName, personaName, avatarUrl }
}

export class SettingsStore {
  private data: StoredSettings = { steamPathOverride: '', accounts: [], activeSteamId: null, linked: emptyLinked() }
  private readonly file = join(app.getPath('userData'), 'settings.json')

  async load(): Promise<void> {
    const stored = await readJson<Partial<StoredSettings> & { epic?: unknown }>(this.file)
    if (!stored) {

      if (await pathExists(this.file)) {
        const backup = join(app.getPath('userData'), `settings.corrupt-${Date.now()}.json`)
        await rename(this.file, backup).catch(() => undefined)
        console.error(`settings.json could not be read; moved it to ${backup}.`)
      }
      return
    }
    const linked = emptyLinked()
    for (const launcher of LINKED_LAUNCHERS) linked[launcher] = readLinked(stored.linked?.[launcher])
    if (linked.epic.accounts.length === 0 && isStoredLinked(stored.epic)) linked.epic = readLinked(stored.epic)
    this.data = {
      steamPathOverride: typeof stored.steamPathOverride === 'string' ? stored.steamPathOverride : '',
      useGameLogos: stored.useGameLogos === true,
      profileName: typeof stored.profileName === 'string' ? stored.profileName : undefined,
      collections: Array.isArray(stored.collections) ? parseCollections(stored.collections) : [],
      profileAvatar: typeof stored.profileAvatar === 'string' ? stored.profileAvatar : undefined,
      steamGridDbApiKey: typeof stored.steamGridDbApiKey === 'string' ? stored.steamGridDbApiKey : undefined,
      steamGridDbApiKeyEncrypted:
        typeof stored.steamGridDbApiKeyEncrypted === 'string' ? stored.steamGridDbApiKeyEncrypted : undefined,
      steamWebApiKey: typeof stored.steamWebApiKey === 'string' ? stored.steamWebApiKey : undefined,
      steamWebApiKeyEncrypted: typeof stored.steamWebApiKeyEncrypted === 'string' ? stored.steamWebApiKeyEncrypted : undefined,
      steamGridDbCoverOverrides: Array.isArray(stored.steamGridDbCoverOverrides)
        ? stored.steamGridDbCoverOverrides.filter((appId): appId is string => typeof appId === 'string' && /^\d+$/.test(appId))
        : [],
      accounts: Array.isArray(stored.accounts) ? stored.accounts : [],
      activeSteamId: typeof stored.activeSteamId === 'string' ? stored.activeSteamId : null,
      linked
    }
  }

  get steamPathOverride(): string {
    return this.data.steamPathOverride
  }

  get collections(): Collection[] {
    return structuredClone(this.data.collections ?? [])
  }

  async saveCollections(collections: Collection[]): Promise<void> {
    this.data.collections = collections
    await this.save()
  }

  get profileName(): string | null {
    return this.data.profileName || null
  }

  get profileAvatar(): string | null {
    return this.data.profileAvatar || null
  }

  async updateCustomProfile(update: ProfileUpdate): Promise<void> {
    if (update.name !== undefined) {
      if (update.name) this.data.profileName = update.name
      else delete this.data.profileName
    }
    if (update.avatarDataUrl !== undefined) {
      if (update.avatarDataUrl) this.data.profileAvatar = update.avatarDataUrl
      else delete this.data.profileAvatar
    }
    await this.save()
  }

  get useGameLogos(): boolean {
    return this.data.useGameLogos === true
  }

  get steamGridDbApiKey(): string | null {
    return decrypt({
      refreshToken: this.data.steamGridDbApiKey,
      refreshTokenEncrypted: this.data.steamGridDbApiKeyEncrypted
    })
  }

  get steamWebApiKey(): string | null {
    return decrypt({ refreshToken: this.data.steamWebApiKey, refreshTokenEncrypted: this.data.steamWebApiKeyEncrypted })
  }

  get steamGridDbCoverOverrides(): string[] {
    return [...(this.data.steamGridDbCoverOverrides ?? [])]
  }

  async saveSteamGridDbCover(appId: number): Promise<void> {
    const id = String(appId)
    const overrides = this.data.steamGridDbCoverOverrides ?? []
    if (overrides.includes(id)) return
    this.data.steamGridDbCoverOverrides = [...overrides, id]
    await this.save()
  }

  async removeSteamGridDbCover(appId: number): Promise<void> {
    const id = String(appId)
    const overrides = this.data.steamGridDbCoverOverrides ?? []
    if (!overrides.includes(id)) return
    this.data.steamGridDbCoverOverrides = overrides.filter((override) => override !== id)
    await this.save()
  }

  get accounts(): AccountsView {
    return {
      steam: {
        accounts: this.data.accounts.map(publicAccount),
        activeId: this.activeAccount?.steamId ?? null
      },
      linked: {
        epic: this.linkedAccounts('epic'),
        ubisoft: this.linkedAccounts('ubisoft'),
        ea: this.linkedAccounts('ea')
      }
    }
  }

  get activeAccount(): SteamAccount | null {
    const active =
      this.data.accounts.find((account) => account.steamId === this.data.activeSteamId) ?? this.data.accounts[0]
    return active ? publicAccount(active) : null
  }

  account(steamId: string): SteamAccount | null {
    const account = this.data.accounts.find((candidate) => candidate.steamId === steamId)
    return account ? publicAccount(account) : null
  }

  refreshToken(steamId: string): string | null {
    const account = this.data.accounts.find((candidate) => candidate.steamId === steamId)
    return account ? decrypt(account) : null
  }

  storedAccessToken(steamId: string): string | null {
    const account = this.data.accounts.find((candidate) => candidate.steamId === steamId)
    if (!account) return null
    return decrypt({ refreshToken: account.accessToken, refreshTokenEncrypted: account.accessTokenEncrypted })
  }

  async saveAccessToken(steamId: string, token: string | null): Promise<void> {
    const account = this.data.accounts.find((candidate) => candidate.steamId === steamId)
    if (!account) return
    delete account.accessToken
    delete account.accessTokenEncrypted
    if (token) {
      const { refreshToken, refreshTokenEncrypted } = encrypt(token)
      if (refreshToken) account.accessToken = refreshToken
      if (refreshTokenEncrypted) account.accessTokenEncrypted = refreshTokenEncrypted
    }
    await this.save()
  }

  async saveAccount(account: SteamAccount, refreshToken: string): Promise<void> {
    const stored: StoredAccount = { ...account, ...encrypt(refreshToken) }
    const index = this.data.accounts.findIndex((candidate) => candidate.steamId === account.steamId)
    if (index >= 0) this.data.accounts[index] = stored
    else this.data.accounts.push(stored)
    this.data.activeSteamId = account.steamId
    await this.save()
  }

  async updateRefreshToken(steamId: string, refreshToken: string): Promise<void> {
    const account = this.data.accounts.find((candidate) => candidate.steamId === steamId)
    if (!account) return
    delete account.refreshToken
    delete account.refreshTokenEncrypted
    Object.assign(account, encrypt(refreshToken))
    await this.save()
  }

  async updateProfile(steamId: string, profile: Pick<SteamAccount, 'personaName' | 'avatarUrl'>): Promise<boolean> {
    const account = this.data.accounts.find((candidate) => candidate.steamId === steamId)
    if (!account || (account.personaName === profile.personaName && account.avatarUrl === profile.avatarUrl)) {
      return false
    }
    Object.assign(account, profile)
    await this.save()
    return true
  }

  async setActive(steamId: string): Promise<void> {
    if (!this.data.accounts.some((account) => account.steamId === steamId)) throw new Error('Unknown account.')
    this.data.activeSteamId = steamId
    await this.save()
  }

  async removeAccount(steamId: string): Promise<void> {
    this.data.accounts = this.data.accounts.filter((account) => account.steamId !== steamId)
    if (this.data.activeSteamId === steamId) this.data.activeSteamId = this.data.accounts[0]?.steamId ?? null
    await this.save()
  }

  linkedAccounts(launcher: LinkedLauncherId): LinkedAccounts {
    const active = this.activeLinked(launcher)
    return { accounts: this.data.linked[launcher].accounts.map(publicLinked), activeId: active?.accountId ?? null }
  }

  linkedAccount(launcher: LinkedLauncherId, accountId?: string): LinkedAccount | null {
    const stored = accountId ? this.findLinked(launcher, accountId) : this.activeLinked(launcher)
    return stored ? publicLinked(stored) : null
  }

  linkedToken(launcher: LinkedLauncherId, accountId: string): string | null {
    const stored = this.findLinked(launcher, accountId)
    return stored ? decrypt(stored) : null
  }

  storedLinkedAccessToken(launcher: LinkedLauncherId, accountId: string): CachedAccessToken | null {
    const stored = this.findLinked(launcher, accountId)
    if (!stored?.accessTokenExpiresAt) return null
    const token = decrypt({ refreshToken: stored.accessToken, refreshTokenEncrypted: stored.accessTokenEncrypted })
    return token ? { token, expiresAt: stored.accessTokenExpiresAt } : null
  }

  async saveLinkedAccessToken(launcher: LinkedLauncherId, accountId: string, token: CachedAccessToken | null): Promise<void> {
    const stored = this.findLinked(launcher, accountId)
    if (!stored) return
    delete stored.accessToken
    delete stored.accessTokenEncrypted
    delete stored.accessTokenExpiresAt
    if (token) {
      const { refreshToken, refreshTokenEncrypted } = encrypt(token.token)
      if (refreshToken) stored.accessToken = refreshToken
      if (refreshTokenEncrypted) stored.accessTokenEncrypted = refreshTokenEncrypted
      stored.accessTokenExpiresAt = token.expiresAt
    }
    await this.save()
  }

  linkedPartition(launcher: LinkedLauncherId, accountId: string): string | null {
    return this.findLinked(launcher, accountId)?.partition ?? null
  }

  async saveLinkedAccount(
    launcher: LinkedLauncherId,
    account: LinkedAccount,
    token: string | null,
    partition?: string
  ): Promise<void> {
    const group = this.data.linked[launcher]
    const stored: StoredLinkedAccount = {
      accountId: account.accountId,
      displayName: account.displayName,
      avatarUrl: account.avatarUrl,
      ...(partition ? { partition } : {}),
      ...(token ? encrypt(token) : {})
    }
    const index = group.accounts.findIndex((candidate) => candidate.accountId === account.accountId)
    if (index >= 0) group.accounts[index] = stored
    else group.accounts.push(stored)
    group.activeId = account.accountId
    await this.save()
  }

  linkedPartitionOwners(launcher: LinkedLauncherId, partition: string): string[] {
    return this.data.linked[launcher].accounts
      .filter((account) => account.partition === partition)
      .map((account) => account.accountId)
  }

  async setLinkedPartition(launcher: LinkedLauncherId, accountId: string, partition: string | null): Promise<void> {
    const stored = this.findLinked(launcher, accountId)
    if (!stored) return
    if (partition) stored.partition = partition
    else delete stored.partition
    await this.save()
  }

  async updateLinkedToken(launcher: LinkedLauncherId, accountId: string, token: string): Promise<void> {
    const stored = this.findLinked(launcher, accountId)
    if (!stored) return
    delete stored.refreshToken
    delete stored.refreshTokenEncrypted
    Object.assign(stored, encrypt(token))
    await this.save()
  }

  async setActiveLinked(launcher: LinkedLauncherId, accountId: string): Promise<void> {
    if (!this.findLinked(launcher, accountId)) throw new Error('That account is not signed in to Portal.')
    this.data.linked[launcher].activeId = accountId
    await this.save()
  }

  async removeLinkedAccount(launcher: LinkedLauncherId, accountId: string): Promise<void> {
    const group = this.data.linked[launcher]
    group.accounts = group.accounts.filter((account) => account.accountId !== accountId)
    if (group.activeId === accountId) group.activeId = group.accounts[0]?.accountId ?? null
    await this.save()
  }

  private findLinked(launcher: LinkedLauncherId, accountId: string): StoredLinkedAccount | null {
    return this.data.linked[launcher].accounts.find((account) => account.accountId === accountId) ?? null
  }

  private activeLinked(launcher: LinkedLauncherId): StoredLinkedAccount | null {
    const group = this.data.linked[launcher]
    return group.accounts.find((account) => account.accountId === group.activeId) ?? group.accounts[0] ?? null
  }

  async update(update: SettingsUpdate): Promise<void> {
    if (update.steamPathOverride !== undefined) this.data.steamPathOverride = update.steamPathOverride
    if (update.useGameLogos !== undefined) this.data.useGameLogos = update.useGameLogos
    if (update.steamGridDbApiKey !== undefined) {
      delete this.data.steamGridDbApiKey
      delete this.data.steamGridDbApiKeyEncrypted
      const encrypted = encrypt(update.steamGridDbApiKey)
      this.data.steamGridDbApiKey = encrypted.refreshToken
      this.data.steamGridDbApiKeyEncrypted = encrypted.refreshTokenEncrypted
    }
    if (update.steamWebApiKey !== undefined) {
      delete this.data.steamWebApiKey
      delete this.data.steamWebApiKeyEncrypted
      if (update.steamWebApiKey) {
        const encrypted = encrypt(update.steamWebApiKey)
        this.data.steamWebApiKey = encrypted.refreshToken
        this.data.steamWebApiKeyEncrypted = encrypted.refreshTokenEncrypted
      }
    }
    await this.save()
  }

  private save(): Promise<void> {
    return writeJson(this.file, this.data)
  }
}

export function parseSettingsUpdate(input: unknown): SettingsUpdate {
  if (!input || typeof input !== 'object') throw new Error('Invalid settings.')
  const { steamPathOverride, steamGridDbApiKey, steamWebApiKey, useGameLogos } = input as Record<string, unknown>
  const update: SettingsUpdate = {}

  if (steamPathOverride !== undefined) {
    if (typeof steamPathOverride !== 'string') throw new Error('Invalid Steam folder.')
    update.steamPathOverride = steamPathOverride.trim()
  }

  if (steamGridDbApiKey !== undefined) {
    if (typeof steamGridDbApiKey !== 'string' || steamGridDbApiKey.trim().length === 0 || steamGridDbApiKey.length > 500) {
      throw new Error('Invalid SteamGridDB API key.')
    }
    update.steamGridDbApiKey = steamGridDbApiKey.trim()
  }

  if (steamWebApiKey !== undefined) {
    if (typeof steamWebApiKey !== 'string' || !/^[0-9A-Fa-f]{32}$|^$/.test(steamWebApiKey.trim())) {
      throw new Error('A Steam Web API key is 32 letters and numbers (0-9, A-F).')
    }
    update.steamWebApiKey = steamWebApiKey.trim()
  }

  if (useGameLogos !== undefined) {
    if (typeof useGameLogos !== 'boolean') throw new Error('Invalid game-logo setting.')
    update.useGameLogos = useGameLogos
  }

  return update
}

const MAX_AVATAR_LENGTH = 1_500_000

export function parseCollections(input: unknown): Collection[] {
  if (!Array.isArray(input)) throw new Error('Invalid collections.')
  const seen = new Set<string>()
  return input.slice(0, 500).flatMap((value) => {
    if (!value || typeof value !== 'object') return []
    const { id, name, gameIds, expanded } = value as Record<string, unknown>
    if (typeof id !== 'string' || !/^[A-Za-z0-9-]{1,64}$/.test(id) || seen.has(id)) return []
    if (typeof name !== 'string' || !name.trim()) return []
    seen.add(id)
    const games = Array.isArray(gameIds)
      ? [...new Set(gameIds.filter((gameId): gameId is string => typeof gameId === 'string' && gameId.length <= 300))]
      : []
    return [{ id, name: name.trim().slice(0, 60), gameIds: games.slice(0, 20000), expanded: expanded !== false }]
  })
}

export function parseProfileUpdate(input: unknown): ProfileUpdate {
  if (!input || typeof input !== 'object') throw new Error('Invalid profile.')
  const { name, avatarDataUrl } = input as Record<string, unknown>
  const update: ProfileUpdate = {}
  if (name !== undefined) {
    if (name !== null && (typeof name !== 'string' || name.trim().length > 40)) {
      throw new Error('Profile names can be up to 40 characters.')
    }
    update.name = typeof name === 'string' && name.trim() ? name.trim() : null
  }
  if (avatarDataUrl !== undefined) {
    if (
      avatarDataUrl !== null &&
      (typeof avatarDataUrl !== 'string' ||
        avatarDataUrl.length > MAX_AVATAR_LENGTH ||
        !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(avatarDataUrl))
    ) {
      throw new Error('That picture could not be used. Try a PNG, JPEG or WebP image.')
    }
    update.avatarDataUrl = avatarDataUrl
  }
  return update
}

export function parseLinkedLauncher(input: unknown): LinkedLauncherId {
  if (typeof input !== 'string' || !LINKED_LAUNCHERS.includes(input as LinkedLauncherId)) throw new Error('Unknown launcher.')
  return input as LinkedLauncherId
}

export function parseAccountId(input: unknown): string {
  if (typeof input !== 'string' || input.length === 0 || input.length > 200) throw new Error('Invalid account.')
  return input
}

export function parseSteamId(input: unknown): string {
  if (typeof input !== 'string' || !/^\d{17}$/.test(input)) throw new Error('Invalid SteamID.')
  return input
}
