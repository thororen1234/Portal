import { watch, type FSWatcher } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import type { ArtKind, Game, LauncherStatus, LibrarySource, LinkedAccount } from '../../shared/types'
import { inBackoff, isFresh, nextFailure, type FetchFailure } from '../fetchPolicy'
import { errorMessage, readJson, writeJson } from '../fsutil'
import type { SettingsStore } from '../settings'
import type { SnapshotOptions } from '../steam/library'
import {
  EpicApiError,
  fetchCatalog,
  fetchLibraryRecords,
  fetchPlaytime,
  NON_GAME_NAMESPACES,
  type CatalogEntry,
  type EpicRecord
} from './api'
import type { EpicAuth } from './auth'
import { epicManifestsDir, readInstalledEpicGames, type EpicInstalledGame } from './local'

const CATALOG_TTL_MS = 7 * 24 * 60 * 60 * 1000
const CATALOG_RETRY_MS = 10 * 60 * 1000

interface RemoteLibrary {
  fetchedAt: number
  records: EpicRecord[]
  playtime: Record<string, number>
}

interface EpicCache {
  catalog: Record<string, CatalogEntry>
  libraries: Record<string, RemoteLibrary>
}

export interface EpicSnapshot {
  status: LauncherStatus
  games: Game[]
}

export class EpicLibrary {
  private cache: EpicCache | null = null
  private readonly cacheFile = join(app.getPath('userData'), 'epic-library.json')
  private readonly catalogMisses = new Map<string, number>()
  private readonly remoteRequests = new Map<string, Promise<RemoteLibrary>>()
  private remoteFailure: (FetchFailure & { accountId: string }) | null = null
  private readonly ids = new Map<string, EpicRecord>()
  private watchers: FSWatcher[] = []
  private watchedDir: string | null = null

  constructor(
    private readonly settings: SettingsStore,
    private readonly auth: EpicAuth,
    private readonly onChange: () => void
  ) {}

  catalogIds(appName: string): EpicRecord | null {
    return this.ids.get(appName) ?? null
  }

  imageUrl(appName: string, kind: ArtKind): string | null {
    return this.cache?.catalog[appName]?.images[kind] ?? null
  }

  async snapshot(options: SnapshotOptions = {}): Promise<EpicSnapshot> {
    const manifestsDir = await epicManifestsDir()
    this.watchManifests(manifestsDir)
    const installed = manifestsDir ? await readInstalledEpicGames(manifestsDir) : []
    const account = this.settings.linkedAccount('epic')
    const remote = await this.remoteLibrary(account, options.refreshOwned === true)
    const records = (remote.library?.records ?? []).filter((record) => !NON_GAME_NAMESPACES.has(record.namespace))
    const library = remote.library ? { ...remote.library, records } : null

    for (const game of installed) {
      if (game.namespace && game.catalogItemId) {
        this.ids.set(game.appName, { appName: game.appName, namespace: game.namespace, catalogItemId: game.catalogItemId })
      }
    }
    for (const record of records) this.ids.set(record.appName, record)

    const appNames = new Set([...installed.map((game) => game.appName), ...records.map((record) => record.appName)])
    await this.ensureCatalog([...appNames], account?.accountId ?? null)

    return {
      status: {
        launcherInstalled: manifestsDir !== null,
        account,
        librarySource: remote.source,
        libraryFetchedAt: remote.library?.fetchedAt ?? null,
        error: remote.error
      },
      games: this.buildGames(installed, library)
    }
  }

  async forgetAccount(accountId: string): Promise<void> {
    const cache = await this.loadCache()
    delete cache.libraries[accountId]
    this.remoteFailure = null
    await this.saveCache()
  }

  dispose(): void {
    for (const watcher of this.watchers) watcher.close()
    this.watchers = []
    this.watchedDir = null
  }

  private buildGames(installed: EpicInstalledGame[], remote: RemoteLibrary | null): Game[] {
    const catalog = this.cache?.catalog ?? {}
    const installedByName = new Map(installed.map((game) => [game.appName, game]))
    const games: Game[] = []
    const seen = new Set<string>()

    const add = (appName: string, fallbackName: string): void => {
      if (seen.has(appName)) return
      seen.add(appName)
      const entry = catalog[appName]
      const local = installedByName.get(appName)
      if (!local && (!entry?.isGame || entry.desktop === false)) return
      games.push({
        id: `epic:${appName}`,
        launcher: 'epic',
        appId: appName,
        name: entry?.title || local?.displayName || fallbackName,
        state: local ? (local.incomplete ? 'downloading' : 'installed') : 'not-installed',
        source: 'owned',
        sharedBy: [],
        progress: null,
        sizeOnDisk: local?.installSize || null,
        installPath: local?.installLocation || null,
        playtimeMinutes: remote?.playtime[appName] || null,
        lastPlayed: null
      })
    }

    for (const game of installed) add(game.appName, game.displayName)
    for (const record of remote?.records ?? []) add(record.appName, record.appName)
    return games
  }

  private async ensureCatalog(appNames: string[], accountId: string | null): Promise<void> {
    const cache = await this.loadCache()
    const now = Date.now()
    const missing = appNames
      .filter((appName) => {
        const entry = cache.catalog[appName]
        if (entry && entry.desktop !== undefined && now - entry.fetchedAt < CATALOG_TTL_MS) return false
        const missedAt = this.catalogMisses.get(appName)
        return !missedAt || now - missedAt > CATALOG_RETRY_MS
      })
      .map((appName) => this.ids.get(appName))
      .filter((record): record is EpicRecord => record !== undefined)
    if (missing.length === 0) return

    try {
      const token = accountId
        ? await this.auth.accessToken(accountId).catch(() => this.auth.clientAccessToken())
        : await this.auth.clientAccessToken()
      const entries = await fetchCatalog(token, missing)
      for (const record of missing) {
        const entry = entries.get(record.appName)
        if (entry) cache.catalog[record.appName] = entry
        else this.catalogMisses.set(record.appName, now)
      }
      await this.saveCache()
    } catch (error) {
      for (const record of missing) this.catalogMisses.set(record.appName, now)
      console.error('Could not load Epic catalog details:', error)
    }
  }

  private async remoteLibrary(
    account: LinkedAccount | null,
    force: boolean
  ): Promise<{ library: RemoteLibrary | null; source: LibrarySource; error: string | null }> {
    if (!account) return { library: null, source: 'none', error: null }
    const cache = await this.loadCache()
    const cached = cache.libraries[account.accountId] ?? null
    const fromCache = (error: string | null, source: LibrarySource = 'cache') => ({
      library: cached,
      source: cached ? source : ('none' as LibrarySource),
      error
    })

    if (isFresh(cached?.fetchedAt, force)) return fromCache(null, 'live')
    const failure = this.remoteFailure?.accountId === account.accountId ? this.remoteFailure : null
    if (inBackoff(failure, force)) return fromCache(failure!.message)

    try {
      let request = this.remoteRequests.get(account.accountId)
      if (!request) {
        request = this.downloadRemote(account).finally(() => this.remoteRequests.delete(account.accountId))
        this.remoteRequests.set(account.accountId, request)
      }
      const library = await request
      cache.libraries[account.accountId] = library
      this.remoteFailure = null
      await this.saveCache()
      return { library, source: 'live', error: null }
    } catch (error) {
      const message = errorMessage(error)
      this.remoteFailure = { accountId: account.accountId, ...nextFailure(failure, message) }
      return fromCache(message)
    }
  }

  private async downloadRemote(account: LinkedAccount): Promise<RemoteLibrary> {
    const withToken = async <T>(call: (token: string) => Promise<T>): Promise<T> => {
      try {
        return await call(await this.auth.accessToken(account.accountId))
      } catch (error) {
        if (!(error instanceof EpicApiError) || error.status !== 401 || !this.auth.rejectToken(account.accountId)) throw error
        return call(await this.auth.accessToken(account.accountId))
      }
    }
    const [records, playtime] = await Promise.all([
      withToken(fetchLibraryRecords),
      withToken((token) => fetchPlaytime(token, account.accountId)).catch((error) => {
        console.error('Could not load Epic play time:', error)
        return {}
      })
    ])
    return { fetchedAt: Date.now(), records, playtime }
  }

  private watchManifests(dir: string | null): void {
    if (dir === this.watchedDir) return
    this.dispose()
    this.watchedDir = dir
    if (!dir) return
    for (const target of [dir, join(dir, 'Pending')]) {
      try {
        const watcher = watch(target, () => this.onChange())
        watcher.on('error', () => watcher.close())
        this.watchers.push(watcher)
      } catch {
        continue
      }
    }
  }

  private async loadCache(): Promise<EpicCache> {
    if (!this.cache) {
      const stored = await readJson<Partial<EpicCache>>(this.cacheFile)
      this.cache = { catalog: stored?.catalog ?? {}, libraries: stored?.libraries ?? {} }
    }
    return this.cache
  }

  private async saveCache(): Promise<void> {
    if (!this.cache) return
    await writeJson(this.cacheFile, this.cache).catch((error) => console.error('Could not save Epic library cache:', error))
  }
}
