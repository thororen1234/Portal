import { readFile } from 'fs/promises'
import { join } from 'path'
import type { GameAction } from '../../shared/types'
import { pathExists } from '../fsutil'
import type { LauncherGame, LauncherIntegration } from './types'
import { openUri, unsupported } from './util'

const CONFIG = join(process.env.APPDATA ?? '', 'Humble App', 'config.json')

interface HumbleEntry {
  machineName?: string
  gameName?: string
  status?: string
  filePath?: string
  executablePath?: string
  imagePath?: string
  iconPath?: string
  descriptionText?: string
  developers?: Array<Record<string, string | undefined> | string>
  publishers?: Array<Record<string, string | undefined> | string>
  isAvailable?: boolean
}

function names(list: HumbleEntry['developers'], key: string): string[] {
  return (list ?? []).flatMap((entry) => {
    const value = typeof entry === 'string' ? entry : entry[key]
    return value ? [value] : []
  })
}

                                                                                  
export const humble: LauncherIntegration = {
  id: 'humble',

  async detect() {
    return pathExists(CONFIG)
  },

  async games() {
    let config: Record<string, unknown>
    try {
      config = JSON.parse(await readFile(CONFIG, 'utf8')) as Record<string, unknown>
    } catch {
      return []
    }
                                                                                                 
    const key = Object.keys(config)
      .filter((candidate) => /^game-collection(-\d+)?$/.test(candidate))
      .sort()
      .pop()
    const entries = (key && Array.isArray(config[key]) ? config[key] : []) as HumbleEntry[]
    const games: LauncherGame[] = []
    for (const entry of entries) {
      if (!entry.machineName || !entry.gameName) continue
      const installPath = entry.filePath ?? null
      const installed = (entry.status === 'installed' || entry.status === 'downloaded') && Boolean(installPath && (await pathExists(installPath)))
      games.push({
        appId: entry.machineName,
        name: entry.gameName,
        installed,
        installPath: installed ? installPath : null,
        art: { cover: entry.imagePath, header: entry.imagePath, icon: entry.iconPath },
        overview: entry.descriptionText
          ? {
              shortDescription: null,
              description: entry.descriptionText,
              developers: names(entry.developers, 'developer-name'),
              publishers: names(entry.publishers, 'publisher-name'),
              releaseDate: null,
              genres: [],
              website: null
            }
          : undefined
      })
    }
    return games
  },

  async open() {
    await openUri('humble://')
  },

  async run(game: LauncherGame, action: GameAction) {
    switch (action) {
      case 'play':
        return openUri(`humble://launch/${game.appId}`)
      case 'install':
        return openUri(`humble://install/${game.appId}`)
      case 'uninstall':
        return openUri(`humble://uninstall/${game.appId}`)
      case 'downloads':
        return openUri('humble://')
      default:
        return unsupported()
    }
  }
}
