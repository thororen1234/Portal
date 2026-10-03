import { join } from 'path'
import type { GameAction, GameOverview } from '../../shared/types'
import { pathExists } from '../fsutil'
import { readRegistry, registryValue } from '../registry'
import type { LauncherGame, LauncherIntegration } from './types'
import { launchDetached, openUri, readDatabase, runCommandLine, unsupported } from './util'

const GAMES_KEY = 'HKLM\\SOFTWARE\\WOW6432Node\\GOG.com\\Games'
const CLIENT_KEY = 'HKLM\\SOFTWARE\\WOW6432Node\\GOG.com\\GalaxyClient\\paths'
const GALAXY_DB = join(process.env.ProgramData ?? 'C:\\ProgramData', 'GOG.com', 'Galaxy', 'storage', 'galaxy-2.0.db')

interface Installed {
  id: string
  name: string
  path: string
  exe: string | null
  uninstall: string | null
}

interface LibraryRow {
  releaseKey: string
  type: string
  value: string
}

function parse<T>(value: string | undefined): T | null {
  if (!value) return null
  try {
    return JSON.parse(value) as T
  } catch {
    return null
  }
}

                                                                                             
const STORE_VARIANT = /\s+(?:[-–]\s+)?Amazon (Prime|Luna)$/i

function titleKey(title: string): string {
  return title.replace(STORE_VARIANT, '').replace(/[™®©]/g, '').trim().toLowerCase()
}

                                                                                                       
function mergeStoreVariants(games: LauncherGame[]): LauncherGame[] {
  const groups = new Map<string, LauncherGame[]>()
  for (const game of games) {
    const key = titleKey(game.name)
    groups.set(key, [...(groups.get(key) ?? []), game])
  }
  const merged: LauncherGame[] = []
  for (const group of groups.values()) {
    const variants = group.filter((game) => STORE_VARIANT.test(game.name))
    const originals = group.filter((game) => !STORE_VARIANT.test(game.name))
    if (variants.length === 0) {
      merged.push(...group)
      continue
    }
    const donor = originals.find((game) => game.art?.cover) ?? variants.find((game) => game.art?.cover) ?? originals[0]
    const keep = [...originals]
    for (const variant of variants) {
                                                                                           
      if (originals.length > 0 && !(variant.installed && !originals.some((game) => game.installed))) continue
      keep.push({
        ...variant,
        name: variant.name.replace(STORE_VARIANT, ''),
        art: variant.art?.cover ? variant.art : (donor?.art ?? variant.art),
        overview: variant.overview ?? donor?.overview
      })
      if (variant.installed) {
        for (const original of originals) if (!original.installed) keep.splice(keep.indexOf(original), 1)
      }
    }
    merged.push(...keep)
  }
  return merged
}

async function galaxyClient(): Promise<string | null> {
  const dir = await registryValue(CLIENT_KEY, 'client')
  const exe = dir ? join(dir, 'GalaxyClient.exe') : null
  return exe && (await pathExists(exe)) ? exe : null
}

async function installedGames(): Promise<Map<string, Installed>> {
  const games = new Map<string, Installed>()
  for (const [key, values] of await readRegistry(GAMES_KEY, true)) {
                                                                  
    const value = (name: string): string | undefined =>
      Object.entries(values).find(([candidate]) => candidate.toLowerCase() === name.toLowerCase())?.[1]
    const id = value('gameID') || key.split('\\').pop()
    const path = value('path')
    if (!id || !/^\d+$/.test(id) || !path || !(await pathExists(path))) continue
    games.set(id, {
      id,
      name: value('gameName') || id,
      path,
      exe: value('exe') || null,
      uninstall: value('uninstallCommand') || null
    })
  }
  return games
}

                                                                                             
async function galaxyLibrary(): Promise<LauncherGame[]> {
  const rows = await readDatabase(GALAXY_DB, (db) => {
    const pieces = db
      .prepare(
        `SELECT gp.releaseKey AS releaseKey, t.type AS type, gp.value AS value
         FROM GamePieces gp
         JOIN GamePieceTypes t ON t.id = gp.gamePieceTypeId
         LEFT JOIN ReleaseProperties rp ON rp.releaseKey = gp.releaseKey
         WHERE gp.releaseKey IN (SELECT DISTINCT releaseKey FROM LibraryReleases WHERE releaseKey LIKE 'gog\\_%' ESCAPE '\\')
           AND COALESCE(rp.isDlc, 0) = 0
           AND t.type IN ('title', 'originalTitle', 'originalImages', 'summary', 'meta', 'originalMeta', 'myAchievementsCount')`
      )
      .all() as unknown as LibraryRow[]
    const times = db
      .prepare(`SELECT releaseKey, SUM(minutesInGame) AS minutes FROM GameTimes WHERE releaseKey LIKE 'gog\\_%' ESCAPE '\\' GROUP BY releaseKey`)
      .all() as unknown as Array<{ releaseKey: string; minutes: number }>
    const played = db
      .prepare(
        `SELECT gameReleaseKey AS releaseKey, MAX(lastPlayedDate) AS lastPlayed FROM LastPlayedDates
         WHERE gameReleaseKey LIKE 'gog\\_%' ESCAPE '\\' GROUP BY gameReleaseKey`
      )
      .all() as unknown as Array<{ releaseKey: string; lastPlayed: string }>
    return { pieces, times, played }
  })
  if (!rows) return []

  const byKey = new Map<string, Record<string, string>>()
  for (const row of rows.pieces) {
    const entry = byKey.get(row.releaseKey) ?? {}
    entry[row.type] = row.value
    byKey.set(row.releaseKey, entry)
  }
  const minutes = new Map(rows.times.map((row) => [row.releaseKey, Number(row.minutes) || 0]))
  const lastPlayed = new Map(rows.played.map((row) => [row.releaseKey, Date.parse(`${row.lastPlayed.replace(' ', 'T')}Z`)]))

  const games: LauncherGame[] = []
  for (const [releaseKey, pieces] of byKey) {
    const id = releaseKey.slice('gog_'.length)
    const title = parse<{ title?: string }>(pieces.title)?.title ?? parse<{ title?: string }>(pieces.originalTitle)?.title
    if (!title) continue
    const images = parse<Record<string, string>>(pieces.originalImages) ?? {}
    const meta = parse<{ developers?: string[]; publishers?: string[]; genres?: string[]; releaseDate?: number }>(
      pieces.meta ?? pieces.originalMeta
    )
    const summary = parse<{ summary?: string }>(pieces.summary)?.summary ?? null
    const achievements = parse<{ all?: number; unlocked?: number }>(pieces.myAchievementsCount)
    const overview: GameOverview = {
      shortDescription: null,
      description: summary,
      developers: meta?.developers ?? [],
      publishers: meta?.publishers ?? [],
      releaseDate: meta?.releaseDate
        ? new Date(meta.releaseDate * 1000).toLocaleDateString('en-US', { dateStyle: 'medium' })
        : null,
      genres: meta?.genres ?? [],
      website: null
    }
    const played = lastPlayed.get(releaseKey)
    games.push({
      appId: id,
      name: title,
      installed: false,
      installPath: null,
      playtimeMinutes: minutes.get(releaseKey) || null,
      lastPlayed: played && Number.isFinite(played) ? Math.floor(played / 1000) : null,
      art: {
        cover: images.verticalCover,
        hero: images.background,
        header: images.background,
        logo: images.logo,
        icon: images.squareIcon
      },
      overview,
      achievements: achievements?.all ? { unlocked: achievements.unlocked ?? 0, total: achievements.all } : undefined
    })
  }
  return games
}

export const gog: LauncherIntegration = {
  id: 'gog',

  async detect() {
    return (await galaxyClient()) !== null || (await installedGames()).size > 0
  },

  async games() {
    const [owned, installed] = await Promise.all([galaxyLibrary(), installedGames()])
    const games = new Map(owned.map((game) => [game.appId, game]))
    for (const local of installed.values()) {
      const existing = games.get(local.id)
      games.set(local.id, {
        ...(existing ?? { appId: local.id, name: local.name }),
        installed: true,
        installPath: local.path,
        extra: { ...(local.exe ? { exe: local.exe } : {}), ...(local.uninstall ? { uninstall: local.uninstall } : {}) }
      })
    }
    return mergeStoreVariants([...games.values()])
  },

  async open() {
    const client = await galaxyClient()
    if (!client) throw new Error('GOG Galaxy is not installed.')
    launchDetached(client)
  },

  async run(game: LauncherGame, action: GameAction) {
    switch (action) {
      case 'play':
        if (game.extra?.exe) return launchDetached(game.extra.exe, [], game.installPath ?? undefined)
        const client = await galaxyClient()
        if (client && game.installPath) return launchDetached(client, ['/command=runGame', `/gameId=${game.appId}`, `/path=${game.installPath}`])
        throw new Error('Could not find how to start this GOG game.')
      case 'install':
      case 'downloads':
        return openUri(`goggalaxy://launchCommand?gameId=${game.appId}&command=runGame`)
      case 'uninstall':
        if (game.extra?.uninstall) return runCommandLine(game.extra.uninstall, game.installPath ?? undefined)
        return openUri(`goggalaxy://openGameView/${game.appId}`)
      default:
        return unsupported()
    }
  }
}
