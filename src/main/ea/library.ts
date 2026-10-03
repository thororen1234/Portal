import { join } from 'path'
import { app } from 'electron'
import type { ArtKind, Game, LauncherStatus } from '../../shared/types'
import { AccountCache } from '../accountCache'
import type { SettingsStore } from '../settings'
import type { SnapshotOptions } from '../steam/library'
import { EaApiError, fetchOwnedEaGames, type EaOwnedGame } from './api'
import type { EaAuth } from './auth'
import { eaAppInstalled, readInstalledEaGames } from './local'

export interface EaSnapshot {
  status: LauncherStatus
  games: Game[]
}

export class EaLibrary {
  private readonly cache = new AccountCache<EaOwnedGame[]>(join(app.getPath('userData'), 'ea-library.json'))
  private readonly art = new Map<string, EaOwnedGame>()

  constructor(
    private readonly settings: SettingsStore,
    private readonly auth: EaAuth
  ) {}

  imageUrl(contentId: string, kind: ArtKind): string | null {
    const game = this.art.get(contentId)
    if (!game) return null
    return kind === 'cover' ? game.packArt : game.keyArt
  }

  async snapshot(options: SnapshotOptions = {}): Promise<EaSnapshot> {
    const [launcherInstalled, installed] = await Promise.all([eaAppInstalled(), readInstalledEaGames()])
    const account = this.settings.linkedAccount('ea')
    const remote = account
      ? await this.cache.get(account.accountId, options.refreshOwned === true, () => this.download(account.accountId))
      : { data: null, source: 'none' as const, fetchedAt: null, error: null }

    const owned = remote.data ?? []
    for (const game of owned) this.art.set(game.contentId, game)

    const games = new Map<string, Game>()
    const base = (contentId: string, name: string): Game => ({
      id: `ea:${contentId}`,
      launcher: 'ea',
      appId: contentId,
      name,
      state: 'not-installed',
      source: 'owned',
      sharedBy: [],
      progress: null,
      sizeOnDisk: null,
      installPath: null,
      playtimeMinutes: null,
      lastPlayed: null
    })

    for (const game of owned) games.set(game.contentId, base(game.contentId, game.title))
    for (const local of installed) {
      const contentId = local.contentIds.find((id) => games.has(id)) ?? local.contentIds[0]
      const existing = games.get(contentId) ?? base(contentId, local.title)
      games.set(contentId, { ...existing, state: 'installed', installPath: local.installPath })
    }

    return {
      status: { launcherInstalled, account, librarySource: remote.source, libraryFetchedAt: remote.fetchedAt, error: remote.error },
      games: [...games.values()]
    }
  }

  async forgetAccount(accountId: string): Promise<void> {
    await this.cache.forget(accountId)
  }

  dispose(): void {
    this.art.clear()
  }

  private async download(accountId: string): Promise<EaOwnedGame[]> {
    try {
      return await fetchOwnedEaGames(await this.auth.accessToken(accountId))
    } catch (error) {
      if (!(error instanceof EaApiError) || error.status !== 401 || !this.auth.rejectToken(accountId)) throw error
      return fetchOwnedEaGames(await this.auth.accessToken(accountId))
    }
  }
}
