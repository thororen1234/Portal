import type { ArtKind, GameAction, GameOverview, LocalLauncherId } from '../../shared/types'

export interface LauncherGame {
  appId: string
  name: string
  installed: boolean
  updateAvailable?: boolean
  installPath: string | null
  sizeOnDisk?: number | null
  playtimeMinutes?: number | null
  lastPlayed?: number | null
  art?: Partial<Record<ArtKind, string>>
  overview?: GameOverview
  achievements?: { unlocked: number; total: number }
  extra?: Record<string, string>
}

export interface LauncherIntegration {
  id: LocalLauncherId
  detect(): Promise<boolean>
  games(): Promise<LauncherGame[]>
  run(game: LauncherGame, action: GameAction): Promise<void>
  open(): Promise<void>
  enrichVersion?: number
  enrich?(game: LauncherGame): Promise<Pick<LauncherGame, 'art' | 'overview'> | null>
}
