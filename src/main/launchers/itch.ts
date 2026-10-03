import { join } from 'path'
import type { GameAction } from '../../shared/types'
import { pathExists } from '../fsutil'
import type { LauncherGame, LauncherIntegration } from './types'
import { openUri, readDatabase, unsupported } from './util'

const BUTLER_DB = join(process.env.APPDATA ?? '', 'itch', 'db', 'butler.db')

interface Row {
  gameId: string
  title: string | null
  shortText: string | null
  coverUrl: string | null
  stillCoverUrl: string | null
  caveId: string | null
  installFolder: string | null
  customFolder: string | null
  locationPath: string | null
  secondsRun: number | null
  lastTouched: string | null
}

                                                                                        
export const itch: LauncherIntegration = {
  id: 'itch',

  async detect() {
    return pathExists(BUTLER_DB)
  },

  async games() {
    const rows = await readDatabase(BUTLER_DB, (db) =>
      db
        .prepare(
          `SELECT CAST(g.id AS TEXT) AS gameId, g.title AS title, g.short_text AS shortText,
                  g.cover_url AS coverUrl, g.still_cover_url AS stillCoverUrl,
                  c.id AS caveId, c.install_folder_name AS installFolder, c.custom_install_folder AS customFolder,
                  l.path AS locationPath, c.seconds_run AS secondsRun, c.last_touched_at AS lastTouched
           FROM games g
           LEFT JOIN caves c ON c.game_id = g.id
           LEFT JOIN install_locations l ON l.id = c.install_location_id
           WHERE (g.id IN (SELECT game_id FROM download_keys) OR c.id IS NOT NULL)
             AND (g.classification IS NULL OR g.classification = 'game')`
        )
        .all()
    )
    const games = new Map<string, LauncherGame>()
    for (const row of (rows ?? []) as unknown as Row[]) {
      const installPath = row.customFolder || (row.locationPath && row.installFolder ? join(row.locationPath, row.installFolder) : null)
      const installed = Boolean(row.caveId && installPath && (await pathExists(installPath)))
      const existing = games.get(row.gameId)
      if (existing?.installed) continue
      const touched = row.lastTouched ? Date.parse(row.lastTouched) : NaN
      games.set(row.gameId, {
        appId: row.gameId,
        name: row.title || `itch.io game ${row.gameId}`,
        installed,
        installPath: installed ? installPath : null,
        playtimeMinutes: row.secondsRun ? Math.round(row.secondsRun / 60) : null,
        lastPlayed: Number.isFinite(touched) ? Math.floor(touched / 1000) : null,
        art: { cover: row.stillCoverUrl || row.coverUrl || undefined, header: row.coverUrl || undefined },
        overview: row.shortText
          ? { shortDescription: null, description: row.shortText, developers: [], publishers: [], releaseDate: null, genres: [], website: null }
          : undefined,
        extra: row.caveId ? { caveId: row.caveId } : {}
      })
    }
    return [...games.values()]
  },

  async open() {
    await openUri('itch://library')
  },

  async run(game: LauncherGame, action: GameAction) {
    switch (action) {
      case 'play':
        if (!game.extra?.caveId) throw new Error('This itch.io game is not installed.')
        return openUri(`itch://games/${game.appId}/caves/${game.extra.caveId}/launch`)
      case 'install':
      case 'uninstall':
      case 'downloads':
        return openUri(`itch://games/${game.appId}`)
      case 'store':
        return openUri(`https://itch.io/c/${game.appId}`)
      default:
        return unsupported()
    }
  }
}
