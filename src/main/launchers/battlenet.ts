import { spawn } from 'child_process'
import { readFile } from 'fs/promises'
import { join } from 'path'
import type { GameAction } from '../../shared/types'
import { pathExists } from '../fsutil'
import { BATTLENET_PRODUCTS, type BattleNetProduct } from './battlenetProducts'
import type { LauncherGame, LauncherIntegration } from './types'
import { firstExisting, openUri, runCommandLine, uninstallEntries, unsupported } from './util'

const CONFIG = join(process.env.APPDATA ?? '', 'Battle.net', 'Battle.net.config')
const UID_PATTERN = /--uid=([^\s"]+)/i

function product(uid: string): BattleNetProduct | undefined {
  return BATTLENET_PRODUCTS.find((candidate) => candidate.uid.toLowerCase() === uid.toLowerCase())
}

                                                                                                 
function startClient(exe: string, args: string): void {
  spawn(exe, args ? [args] : [], { detached: true, stdio: 'ignore', windowsVerbatimArguments: true }).unref()
}

async function client(): Promise<string | null> {
  const entry = (await uninstallEntries()).find((candidate) => /--uid=battle\.net\b/i.test(candidate.uninstallString))
  return firstExisting([
    entry?.installLocation && join(entry.installLocation, 'Battle.net.exe'),
    'C:\\Program Files (x86)\\Battle.net\\Battle.net.exe',
    'C:\\Program Files\\Battle.net\\Battle.net.exe'
  ])
}

async function lastPlayedTimes(): Promise<Record<string, number>> {
  try {
    const config = JSON.parse(await readFile(CONFIG, 'utf8')) as { Games?: Record<string, { LastPlayed?: string }> }
    return Object.fromEntries(
      Object.entries(config.Games ?? {}).flatMap(([uid, game]) => {
        const seconds = Number(game.LastPlayed)
        return Number.isFinite(seconds) && seconds > 0 ? [[uid, seconds]] : []
      })
    )
  } catch {
    return {}
  }
}

                                                                                          
export const battlenet: LauncherIntegration = {
  id: 'battlenet',

  async detect() {
    return (await client()) !== null
  },

  async games() {
    const [entries, played] = await Promise.all([uninstallEntries(), lastPlayedTimes()])
    const games: LauncherGame[] = []
    for (const entry of entries) {
      if (!/Blizzard Uninstaller/i.test(entry.uninstallString)) continue
      const uid = UID_PATTERN.exec(entry.uninstallString)?.[1]
      if (!uid || uid === 'battle.net' || !entry.installLocation || !(await pathExists(entry.installLocation))) continue
      const known = product(uid)
      games.push({
        appId: uid,
        name: entry.displayName,
        installed: true,
        installPath: entry.installLocation,
        lastPlayed: played[uid] ?? null,
        art: known
          ? { cover: known.cover, header: known.background, hero: known.background, logo: known.icon }
          : undefined,
        extra: { uninstall: entry.uninstallString, productId: known?.productId ?? uid.toUpperCase() }
      })
    }
    return games
  },

  async open() {
    const exe = await client()
    if (!exe) throw new Error('Battle.net is not installed.')
    startClient(exe, '')
  },

  async run(game: LauncherGame, action: GameAction) {
    switch (action) {
      case 'play': {
        const exe = await client()
        if (!exe) throw new Error('Battle.net is not installed.')
                                                                                    
        return startClient(exe, `--exec="launch ${game.extra?.productId ?? game.appId.toUpperCase()}"`)
      }
      case 'install': {
        const exe = await client()
        if (!exe) throw new Error('Battle.net is not installed.')
        return startClient(exe, `--game=${game.appId}`)
      }
      case 'uninstall':
        if (!game.extra?.uninstall) throw new Error('Battle.net did not register an uninstaller for this game.')
        return runCommandLine(game.extra.uninstall)
      case 'downloads':
        return openUri('battlenet://')
      default:
        return unsupported()
    }
  }
}
