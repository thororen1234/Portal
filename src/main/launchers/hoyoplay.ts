import { join } from 'path'
import type { GameAction } from '../../shared/types'
import { pathExists } from '../fsutil'
import { readRegistry } from '../registry'
import type { LauncherGame, LauncherIntegration } from './types'
import { firstExisting, launchDetached, unsupported } from './util'

const ROOTS = ['HKCU\\Software\\Cognosphere\\HYP', 'HKCU\\Software\\miHoYo\\HYP']

const GAMES: Record<string, { name: string; exes: string[] }> = {
  hk4e: { name: 'Genshin Impact', exes: ['GenshinImpact.exe', 'YuanShen.exe'] },
  hkrpg: { name: 'Honkai: Star Rail', exes: ['StarRail.exe'] },
  nap: { name: 'Zenless Zone Zero', exes: ['ZenlessZoneZero.exe'] },
  bh3: { name: 'Honkai Impact 3rd', exes: ['BH3.exe'] }
}

async function hoyoplayClient(): Promise<string | null> {
  for (const root of ROOTS) {
    for (const values of (await readRegistry(root)).values()) {
      const dir = values.InstallPath
      if (dir && (await pathExists(join(dir, 'launcher.exe')))) return join(dir, 'launcher.exe')
    }
  }
  return null
}

export const hoyoplay: LauncherIntegration = {
  id: 'hoyoplay',

  async detect() {
    return (await hoyoplayClient()) !== null
  },

  async games() {
    const games = new Map<string, LauncherGame>()
    for (const root of ROOTS) {
      for (const [key, values] of await readRegistry(root, true)) {
        const path = values.GameInstallPath
        const biz = values.GameBiz || key.split('\\').pop() || ''
        const known = GAMES[biz.split('_')[0]]
        if (!path || !known || games.has(biz)) continue
        const exe = await firstExisting(known.exes.map((name) => join(path, name)))
        if (!exe) continue
        games.set(biz, {
          appId: biz,
          name: biz.endsWith('_cn') ? `${known.name} (China)` : known.name,
          installed: true,
          installPath: path,
          extra: { exe }
        })
      }
    }
    return [...games.values()]
  },

  async open() {
    const client = await hoyoplayClient()
    if (!client) throw new Error('HoYoPlay is not installed.')
    launchDetached(client)
  },

  async run(game: LauncherGame, action: GameAction) {
    switch (action) {
      case 'play':
        if (!game.extra?.exe) throw new Error('Could not find this games executable.')
        return launchDetached(game.extra.exe, [], game.installPath ?? undefined)
      case 'downloads': {
        const client = await hoyoplayClient()
        if (!client) throw new Error('HoYoPlay is not installed.')
        return launchDetached(client)
      }
      default:
        return unsupported()
    }
  }
}
