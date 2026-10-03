import { watch, type FSWatcher } from 'fs'
import { stat } from 'fs/promises'
import { join } from 'path'
import { app } from 'electron'
import type { Game, LibrarySource, SteamAccount, SteamStatus } from '../../shared/types'
import { inBackoff, isFresh, nextFailure, type FetchFailure } from '../fetchPolicy'
import { errorMessage, readJson, writeJson } from '../fsutil'
import type { SettingsStore } from '../settings'
import { fetchFamilyGames, fetchOwnedGames, fetchProfiles, SteamApiError, type RemoteGame } from './api'
import type { SteamAuth } from './auth'
import { clientSteamId } from './client'
import {
  localConfigPath,
  locateSteam,
  readInstalledApps,
  readLibraryFolders,
  readLocalPlaytime,
  type InstalledApp,
  type LocalPlaytime
} from './steam'

const UNKNOWN_OWNER = 'a family member'

interface RemoteLibrary {
  fetchedAt: number
  games: RemoteGame[]
  ownerNames: Record<string, string>
}

type RemoteCache = Record<string, RemoteLibrary>

interface RemoteResult {
  library: RemoteLibrary | null
  source: LibrarySource
  error: string | null
}

export interface SnapshotOptions {
  refreshOwned?: boolean
}

export interface SteamSnapshot {
  status: SteamStatus
  games: Game[]
}

export interface SteamLibraryEvents {
  onChange: () => void
  onAccountsChanged: () => void
}

function toGame(appId: number, fields: Omit<Game, 'id' | 'launcher' | 'appId'>): Game {
  return { id: `steam:${appId}`, launcher: 'steam', appId: String(appId), ...fields }
}

function latest(...values: Array<number | null | undefined>): number | null {
  const max = Math.max(0, ...values.map((value) => value ?? 0))
  return max > 0 ? max : null
}

function mergeGames(
  remote: RemoteLibrary | null,
  installed: InstalledApp[],
  playtime: Map<number, LocalPlaytime>
): Game[] {
  const games = new Map<number, Game>()

  for (const game of remote?.games ?? []) {
    games.set(game.appId, toGame(game.appId, {
      name: game.name,
      state: 'not-installed',
      source: game.source,
      sharedBy:
        game.source === 'family'
          ? game.ownerSteamIds.map((steamId) => remote?.ownerNames[steamId] || UNKNOWN_OWNER)
          : [],
      progress: null,
      sizeOnDisk: null,
      installPath: null,
      playtimeMinutes: game.playtimeMinutes || null,
      lastPlayed: game.lastPlayed
    }))
  }

  for (const installedApp of installed) {
    const existing = games.get(installedApp.appId)
    games.set(installedApp.appId, toGame(installedApp.appId, {
      name: existing?.name || installedApp.name,
      state: installedApp.state,
      source: existing?.source ?? 'owned',
      sharedBy: existing?.sharedBy ?? [],
      progress: installedApp.progress,
      sizeOnDisk: installedApp.sizeOnDisk || null,
      installPath: installedApp.installPath,
      playtimeMinutes: existing?.playtimeMinutes ?? null,
      lastPlayed: latest(existing?.lastPlayed, installedApp.lastPlayed)
    }))
  }

  for (const [appId, local] of playtime) {
    const game = games.get(appId)
    if (!game) continue
    const best = Math.max(game.playtimeMinutes ?? 0, local.playtimeMinutes)
    if (best > 0) game.playtimeMinutes = best
    game.lastPlayed = latest(game.lastPlayed, local.lastPlayed)
  }

  return [...games.values()]
}

export class SteamLibrary {
  private located: { override: string; path: string | null } | null = null
  private playtimeCache: { path: string; mtimeMs: number; data: Map<number, LocalPlaytime> } | null = null
  private remoteCache: RemoteCache | null = null
  private readonly remoteRequests = new Map<string, Promise<RemoteLibrary>>()
  private readonly remoteFailures = new Map<string, FetchFailure>()
  private readonly remoteCacheFile = join(app.getPath('userData'), 'steam-library.json')
  private readonly watchers = new Map<string, FSWatcher>()
  private readonly profileChecks = new Set<string>()

  constructor(
    private readonly settings: SettingsStore,
    private readonly auth: SteamAuth,
    private readonly events: SteamLibraryEvents
  ) { }

  get knownSteamPath(): string | null {
    return this.located?.path ?? null
  }

  async steamPath(): Promise<string | null> {
    const override = this.settings.steamPathOverride
    if (!this.located || this.located.override !== override || !this.located.path) {
      this.located = { override, path: await locateSteam(override) }
    }
    return this.located.path
  }

  async snapshot(options: SnapshotOptions = {}): Promise<SteamSnapshot> {
    const steamPath = await this.steamPath()
    const libraries = steamPath ? await readLibraryFolders(steamPath) : []
    if (this.located && libraries[0]) this.located.path = libraries[0]
    this.watchLibraries(libraries)

    const account = this.settings.activeAccount
    if (account && !account.avatarUrl) void this.refreshProfile(account.steamId)
    const clientId = steamPath ? await clientSteamId(steamPath) : null
    const playtimeSteamId = account?.steamId ?? clientId
    const [installed, playtime, remote] = await Promise.all([
      readInstalledApps(libraries),
      steamPath && playtimeSteamId
        ? this.localPlaytime(steamPath, playtimeSteamId)
        : new Map<number, LocalPlaytime>(),
      this.remoteLibrary(account, options.refreshOwned === true)
    ])

    return {
      status: {
        steamPath: this.knownSteamPath ?? steamPath,
        account: this.settings.activeAccount,
        clientSteamId: clientId,
        librarySource: remote.source,
        libraryFetchedAt: remote.library?.fetchedAt ?? null,
        error: remote.error
      },
      games: mergeGames(remote.library, installed, playtime)
    }
  }

  async forgetAccount(steamId: string): Promise<void> {
    const cache = await this.loadRemoteCache()
    delete cache[steamId]
    this.remoteFailures.delete(steamId)
    await writeJson(this.remoteCacheFile, cache).catch((error) => console.error('Could not update library cache:', error))
  }

  private async refreshProfile(steamId: string): Promise<void> {
    if (this.profileChecks.has(steamId)) return
    this.profileChecks.add(steamId)
    const profile = (await fetchProfiles([steamId])).get(steamId)
    if (profile?.personaName && (await this.settings.updateProfile(steamId, profile))) this.events.onAccountsChanged()
  }

  dispose(): void {
    for (const watcher of this.watchers.values()) watcher.close()
    this.watchers.clear()
  }

  private watchLibraries(libraries: string[]): void {
    const wanted = new Set(libraries.map((library) => join(library, 'steamapps')))
    for (const [dir, watcher] of this.watchers) {
      if (!wanted.has(dir)) {
        watcher.close()
        this.watchers.delete(dir)
      }
    }
    for (const dir of wanted) {
      if (this.watchers.has(dir)) continue
      try {
        const watcher = watch(dir, (_event, filename) => {
          if (!filename || /^(appmanifest_|libraryfolders)/i.test(filename)) this.events.onChange()
        })
        watcher.on('error', () => {
          watcher.close()
          this.watchers.delete(dir)
        })
        this.watchers.set(dir, watcher)
      } catch {
        continue
      }
    }
  }

  private async localPlaytime(steamPath: string, steamId: string): Promise<Map<number, LocalPlaytime>> {
    const path = localConfigPath(steamPath, steamId)
    try {
      const { mtimeMs } = await stat(path)
      if (this.playtimeCache?.path === path && this.playtimeCache.mtimeMs === mtimeMs) return this.playtimeCache.data
      const data = await readLocalPlaytime(path)
      this.playtimeCache = { path, mtimeMs, data }
      return data
    } catch {
      return new Map()
    }
  }

  private async loadRemoteCache(): Promise<RemoteCache> {
    this.remoteCache ??= (await readJson<RemoteCache>(this.remoteCacheFile)) ?? {}
    return this.remoteCache
  }

  private fetchRemote(account: SteamAccount): Promise<RemoteLibrary> {
    let request = this.remoteRequests.get(account.steamId)
    if (!request) {
      request = this.downloadRemote(account).finally(() => this.remoteRequests.delete(account.steamId))
      this.remoteRequests.set(account.steamId, request)
    }
    return request
  }

  private async withToken<T>(steamId: string, call: (token: string) => Promise<T>): Promise<T> {
    try {
      return await call(await this.auth.accessToken(steamId))
    } catch (error) {
      if (!(error instanceof SteamApiError) || error.status !== 401 || !this.auth.rejectToken(steamId)) throw error
      return call(await this.auth.accessToken(steamId))
    }
  }

  private async downloadRemote(account: SteamAccount): Promise<RemoteLibrary> {
    const { steamId } = account
    const [owned, family] = await Promise.all([
      this.withToken(steamId, (token) => fetchOwnedGames(token, steamId)),
      this.withToken(steamId, (token) => fetchFamilyGames(token, steamId)).catch((error) => {
        console.error('Could not load the family library:', error)
        return null
      })
    ])

    const previous = (await this.loadRemoteCache())[steamId]
    const ownerIds = [...new Set((family ?? []).flatMap((game) => game.ownerSteamIds))].filter(
      (id) => !previous?.ownerNames[id]
    )
    const checkSelf = !this.profileChecks.has(steamId)
    this.profileChecks.add(steamId)
    const profiles = await fetchProfiles(checkSelf ? [steamId, ...ownerIds] : ownerIds)
    const self = profiles.get(steamId)
    if (
      self?.personaName &&
      (await this.settings.updateProfile(steamId, { personaName: self.personaName, avatarUrl: self.avatarUrl }))
    ) {
      this.events.onAccountsChanged()
    }

    const ownerNames: Record<string, string> = { ...previous?.ownerNames }
    for (const [id, profile] of profiles) if (profile.personaName) ownerNames[id] = profile.personaName

    const familyGames = family ?? previous?.games.filter((game) => game.source === 'family') ?? []
    return { fetchedAt: Date.now(), games: [...owned, ...familyGames], ownerNames }
  }

  private async remoteLibrary(account: SteamAccount | null, force: boolean): Promise<RemoteResult> {
    if (!account) return { library: null, source: 'none', error: null }
    const { steamId } = account
    const cache = await this.loadRemoteCache()
    const cached = cache[steamId] ?? null
    const fromCache = (error: string | null, source: LibrarySource = 'cache'): RemoteResult => ({
      library: cached,
      source: cached ? source : 'none',
      error
    })

    if (isFresh(cached?.fetchedAt, force)) return fromCache(null, 'live')
    const failure = this.remoteFailures.get(steamId)
    if (inBackoff(failure, force)) return fromCache(failure!.message)

    try {
      const library = await this.fetchRemote(account)
      cache[steamId] = library
      this.remoteFailures.delete(steamId)
      await writeJson(this.remoteCacheFile, cache).catch((error) => console.error('Could not save library cache:', error))
      return { library, source: 'live', error: null }
    } catch (error) {
      const message = errorMessage(error)
      this.remoteFailures.set(steamId, nextFailure(failure, message))
      return fromCache(message)
    }
  }
}
