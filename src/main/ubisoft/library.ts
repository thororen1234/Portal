import { join } from 'path'
import { app } from 'electron'
import type { ArtKind, Game, LauncherStatus } from '../../shared/types'
import { AccountCache } from '../accountCache'
import type { SettingsStore } from '../settings'
import type { SnapshotOptions } from '../steam/library'
import { fetchOwnedUbisoftGames, UbisoftApiError, type UbisoftOwnedGame } from './api'
import type { UbisoftAuth } from './auth'
import {
  readInstalledUbisoftGames,
  readUbisoftCatalog,
  readUbisoftOwnership,
  ubisoftLauncherDir,
  type UbisoftCatalogEntry
} from './local'

export interface UbisoftSnapshot {
  status: LauncherStatus
  games: Game[]
}

export class UbisoftLibrary {
  private readonly cache = new AccountCache<UbisoftOwnedGame[]>(join(app.getPath('userData'), 'ubisoft-library.json'))
  private catalog: { path: string | null; mtimeMs: number; entries: Map<string, UbisoftCatalogEntry> } | null = null

  constructor(
    private readonly settings: SettingsStore,
    private readonly auth: UbisoftAuth
  ) {}

  imageUrl(productId: string, kind: ArtKind): string | null {
    return this.catalog?.entries.get(productId)?.images[kind] ?? null
  }

  async snapshot(options: SnapshotOptions = {}): Promise<UbisoftSnapshot> {
    const launcherDir = process.platform === 'win32' ? await ubisoftLauncherDir() : null
    const [installed, catalog] = await Promise.all([
      launcherDir ? readInstalledUbisoftGames() : Promise.resolve([]),
      this.loadCatalog(launcherDir)
    ])
    const account = this.settings.linkedAccount('ubisoft')
    const localOwned = launcherDir ? await readUbisoftOwnership(launcherDir, account?.accountId ?? null) : new Set<string>()
    const remote = account
      ? await this.cache.get(account.accountId, options.refreshOwned === true, () => this.download(account.accountId))
      : { data: null, source: 'none' as const, fetchedAt: null, error: null }

    const games = new Map<string, Game>()
    const add = (productId: string, fields: Partial<Game>): void => {
      const entry = catalog.get(productId)
      const existing = games.get(productId)
      games.set(productId, {
        id: `ubisoft:${productId}`,
        launcher: 'ubisoft',
        appId: productId,
        name: entry?.name ?? `Ubisoft game ${productId}`,
        state: 'not-installed',
        source: 'owned',
        sharedBy: [],
        progress: null,
        sizeOnDisk: null,
        installPath: null,
        playtimeMinutes: null,
        lastPlayed: null,
        ...existing,
        ...fields
      })
    }

    for (const owned of remote.data ?? []) add(owned.productId, owned.name ? { name: owned.name } : {})
    for (const productId of localOwned) if (catalog.get(productId)?.playable) add(productId, {})
    for (const game of installed) {
      const known = catalog.get(game.productId)?.name ?? games.get(game.productId)?.name
      add(game.productId, { state: 'installed', installPath: game.installPath, ...(known ? {} : { name: game.folderName }) })
    }

    return {
      status: {
        launcherInstalled: launcherDir !== null,
        account,
        librarySource: remote.source,
        libraryFetchedAt: remote.fetchedAt,
        error: remote.error
      },
      games: [...games.values()]
    }
  }

  async forgetAccount(accountId: string): Promise<void> {
    await this.cache.forget(accountId)
  }

  dispose(): void {
    this.catalog = null
  }

  private async download(accountId: string): Promise<UbisoftOwnedGame[]> {
    try {
      return await fetchOwnedUbisoftGames(await this.auth.currentSession(accountId))
    } catch (error) {
      if (!(error instanceof UbisoftApiError) || error.status !== 401 || !this.auth.rejectToken(accountId)) throw error
      return fetchOwnedUbisoftGames(await this.auth.currentSession(accountId))
    }
  }

  private async loadCatalog(launcherDir: string | null): Promise<Map<string, UbisoftCatalogEntry>> {
    try {
      const next = await readUbisoftCatalog(launcherDir)
      if (!this.catalog || this.catalog.path !== next.path || this.catalog.mtimeMs !== next.mtimeMs) this.catalog = next
    } catch (error) {
      console.error('Could not read the Ubisoft Connect catalog cache:', error)
    }
    return this.catalog?.entries ?? new Map()
  }
}
