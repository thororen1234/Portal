import { join } from 'path'
import type { ArtKind, Game, GameAction, GameInfo, LauncherStatus } from '../../shared/types'
import { DiskCache } from '../diskCache'
import { errorMessage } from '../fsutil'
import type { SnapshotOptions } from '../steam/library'
import type { LauncherGame, LauncherIntegration } from './types'

const SNAPSHOT_TTL_MS = 60 * 1000

const FIRST_LOAD_WAIT_MS = 1500
const ENRICH_TTL_MS = 14 * 24 * 60 * 60 * 1000

type Enrichment = Pick<LauncherGame, 'art' | 'overview'> | null

export class LocalLibrary {
  private games: LauncherGame[] = []
  private readonly byId = new Map<string, LauncherGame>()
  private status: LauncherStatus = {
    launcherInstalled: false,
    account: null,
    librarySource: 'none',
    libraryFetchedAt: null,
    error: null
  }
  private loadedAt = 0
  private pending: Promise<boolean> | null = null
  private signature = ''
  private readonly enrichments: DiskCache<Enrichment>

  constructor(
    private readonly integration: LauncherIntegration,
    cacheDir: string,
    private readonly onChange: () => void
  ) {
    const version = integration.enrichVersion ? `-v${integration.enrichVersion}` : ''
    this.enrichments = new DiskCache(join(cacheDir, `${integration.id}${version}`), ENRICH_TTL_MS)
  }

  get id(): LauncherIntegration['id'] {
    return this.integration.id
  }

  async snapshot(options: SnapshotOptions = {}): Promise<{ status: LauncherStatus; games: Game[] }> {
    if (!this.pending && (options.refreshOwned || Date.now() - this.loadedAt > SNAPSHOT_TTL_MS)) {
      await this.refresh(this.loadedAt === 0 || options.refreshOwned === true)
    }
    return { status: this.status, games: this.games.map((game) => this.toGame(game)) }
  }

  find(appId: string): LauncherGame | null {
    return this.byId.get(appId) ?? null
  }

  async art(appId: string, kind: ArtKind): Promise<string | null> {
    const game = this.byId.get(appId)
    if (!game) return null
    const direct = game.art?.[kind]
    if (direct) return direct
    return (await this.enrichment(game))?.art?.[kind] ?? null
  }

  async info(appId: string): Promise<GameInfo> {
    const game = this.byId.get(appId)
    if (!game) return { overview: null, achievements: null, error: null }
    const overview = game.overview?.description
      ? game.overview
      : ((await this.enrichment(game))?.overview ?? game.overview ?? null)
    const achievements =
      game.achievements && game.achievements.total > 0
        ? { unlocked: game.achievements.unlocked, total: game.achievements.total, detailed: false, items: [] }
        : null
    return { overview, achievements, error: null }
  }

  achievementTotals(): Array<{ unlocked: number; total: number }> {
    return this.games.flatMap((game) => (game.achievements && game.achievements.total > 0 ? [game.achievements] : []))
  }

  async run(appId: string, action: GameAction): Promise<void> {
    const game = this.byId.get(appId)
    if (!game) throw new Error('That game is no longer in your library.')
    await this.integration.run(game, action)
  }

  open(): Promise<void> {
    return this.integration.open()
  }

  async forgetAccount(): Promise<void> { }

  dispose(): void { }

  private async enrichment(game: LauncherGame): Promise<Enrichment> {
    if (!this.integration.enrich) return null
    const result = await this.enrichments.get(game.appId, () => this.integration.enrich!(game))
    return result.data
  }

  private async refresh(wait: boolean): Promise<void> {
    let returned = false
    const pending = this.load().finally(() => (this.pending = null))
    this.pending = pending
    void pending.then((changed) => {
      if (changed && returned) this.onChange()
    })
    if (wait) await Promise.race([pending, new Promise((resolve) => setTimeout(resolve, FIRST_LOAD_WAIT_MS))])
    returned = true
  }

  private async load(): Promise<boolean> {
    const before = this.signature
    try {
      const [launcherInstalled, games] = await Promise.all([this.integration.detect(), this.integration.games()])
      this.signature = JSON.stringify(
        games.map((game) => [game.appId, game.name, game.installed, game.updateAvailable, game.installPath, game.playtimeMinutes, game.lastPlayed])
      )
      this.games = games
      this.byId.clear()
      for (const game of games) this.byId.set(game.appId, game)
      this.status = {
        launcherInstalled,
        account: null,
        librarySource: games.length > 0 ? 'live' : 'none',
        libraryFetchedAt: Date.now(),
        error: null
      }
    } catch (error) {
      console.error(`Could not read the ${this.integration.id} library:`, error)
      this.status = { ...this.status, error: errorMessage(error) }
    }
    this.loadedAt = Date.now()
    return this.signature !== before
  }

  private toGame(game: LauncherGame): Game {
    return {
      id: `${this.integration.id}:${game.appId}`,
      launcher: this.integration.id,
      appId: game.appId,
      name: game.name,
      state: game.installed ? (game.updateAvailable ? 'update-required' : 'installed') : 'not-installed',
      source: 'owned',
      sharedBy: [],
      progress: null,
      sizeOnDisk: game.sizeOnDisk ?? null,
      installPath: game.installed ? game.installPath : null,
      playtimeMinutes: game.playtimeMinutes ?? null,
      lastPlayed: game.lastPlayed ?? null
    }
  }
}
