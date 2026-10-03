import type { Game, LauncherStatus, LibrarySnapshot, LinkedLauncherId, LocalLauncherId, SteamStatus } from '../shared/types'
import type { LocalLibrary } from './launchers/provider'
import { errorMessage } from './fsutil'
import type { SnapshotOptions, SteamLibrary } from './steam/library'

const BUSY_POLL_MS = 3000
const WATCH_DEBOUNCE_MS = 400
const BUSY_STATES = new Set(['downloading', 'queued', 'uninstalling'])

export interface LinkedProvider {
  snapshot(options: SnapshotOptions): Promise<{ status: LauncherStatus; games: Game[] }>
  forgetAccount(accountId: string): Promise<void>
  dispose(): void
}

export type LinkedProviders = Record<LinkedLauncherId, LinkedProvider>
export type LocalProviders = Record<LocalLauncherId, LocalLibrary>

const EMPTY_STEAM: SteamStatus = {
  steamPath: null,
  account: null,
  clientSteamId: null,
  librarySource: 'none',
  libraryFetchedAt: null,
  error: null
}

const EMPTY_LINKED: LauncherStatus = {
  launcherInstalled: false,
  account: null,
  librarySource: 'none',
  libraryFetchedAt: null,
  error: null
}

export class Library {
  private latest: LibrarySnapshot | null = null
  private refreshTimer: NodeJS.Timeout | null = null
  private pollTimer: NodeJS.Timeout | null = null

  constructor(
    private readonly steam: SteamLibrary,
    private readonly linked: LinkedProviders,
    private readonly local: LocalProviders,
    private readonly emit: (snapshot: LibrarySnapshot) => void
  ) {}

  get current(): LibrarySnapshot | null {
    return this.latest
  }

  findGame(id: string): Game | null {
    return this.latest?.games.find((game) => game.id === id) ?? null
  }

  async snapshot(options: SnapshotOptions = {}): Promise<LibrarySnapshot> {
    const linkedIds = Object.keys(this.linked) as LinkedLauncherId[]
    const localIds = Object.keys(this.local) as LocalLauncherId[]
    const localResults = Promise.all(
      localIds.map((id) =>
        this.local[id].snapshot(options).catch((error) => ({
          status: { ...EMPTY_LINKED, error: errorMessage(error) },
          games: [] as Game[]
        }))
      )
    )
    const [steam, ...linked] = await Promise.all([
      this.steam.snapshot(options).catch((error) => ({
        status: { ...EMPTY_STEAM, error: errorMessage(error) },
        games: [] as Game[]
      })),
      ...linkedIds.map((id) =>
        this.linked[id].snapshot(options).catch((error) => ({
          status: { ...EMPTY_LINKED, error: errorMessage(error) },
          games: [] as Game[]
        }))
      )
    ])

    const statuses = Object.fromEntries(linkedIds.map((id, index) => [id, linked[index].status])) as Record<
      LinkedLauncherId,
      LauncherStatus
    >
    const local = await localResults
    const snapshot: LibrarySnapshot = {
      games: [...steam.games, ...linked.flatMap((result) => result.games), ...local.flatMap((result) => result.games)],
      steam: steam.status,
      linked: statuses,
      local: Object.fromEntries(localIds.map((id, index) => [id, local[index].status])) as Record<LocalLauncherId, LauncherStatus>
    }
    this.latest = snapshot
    this.schedulePoll(snapshot)
    return snapshot
  }

  async refresh(options: SnapshotOptions = {}): Promise<void> {
    try {
      this.emit(await this.snapshot(options))
    } catch (error) {
      console.error('Library refresh failed:', error)
    }
  }

  requestRefresh(delay = WATCH_DEBOUNCE_MS): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer)
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null
      void this.refresh()
    }, delay)
  }

  async forgetLinkedAccount(launcher: LinkedLauncherId, accountId: string): Promise<void> {
    await this.linked[launcher].forgetAccount(accountId)
  }

  dispose(): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer)
    if (this.pollTimer) clearTimeout(this.pollTimer)
    this.steam.dispose()
    for (const provider of Object.values(this.linked)) provider.dispose()
    for (const provider of Object.values(this.local)) provider.dispose()
  }

  private schedulePoll(snapshot: LibrarySnapshot): void {
    if (this.pollTimer) clearTimeout(this.pollTimer)
    this.pollTimer = null
    if (snapshot.games.some((game) => BUSY_STATES.has(game.state))) {
      this.pollTimer = setTimeout(() => void this.refresh(), BUSY_POLL_MS)
    }
  }
}
