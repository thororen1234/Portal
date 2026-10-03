import { readdir, readFile } from 'fs/promises'
import { join } from 'path'
import { parse } from 'yaml'
import type { GameAction } from '../../shared/types'
import { pathExists } from '../fsutil'
import type { LauncherGame, LauncherIntegration } from './types'
import { launchDetached, unsupported } from './util'

const ROOT = join(process.env.ProgramData ?? 'C:\\ProgramData', 'Riot Games')
const METADATA = join(ROOT, 'Metadata')

const NAMES: Record<string, string> = {
  league_of_legends: 'League of Legends',
  valorant: 'VALORANT',
  bacon: 'Legends of Runeterra',
  lion: '2XKO'
}

async function riotClient(): Promise<string | null> {
  try {
    const installs = JSON.parse(await readFile(join(ROOT, 'RiotClientInstalls.json'), 'utf8')) as Record<string, unknown>
    for (const key of ['rc_default', 'rc_live']) {
      const path = installs[key]
      if (typeof path === 'string' && (await pathExists(path))) return path
    }
  } catch {
    return null
  }
  return null
}

export const riot: LauncherIntegration = {
  id: 'riot',

  async detect() {
    return (await riotClient()) !== null
  },

  async games() {
    let folders: string[]
    try {
      folders = await readdir(METADATA)
    } catch {
      return []
    }
    const games: LauncherGame[] = []
    for (const folder of folders) {
      const [product, patchline] = folder.split('.')
      if (!product || !patchline || !(product in NAMES)) continue
      try {
        const settings = parse(await readFile(join(METADATA, folder, `${folder}.product_settings.yaml`), 'utf8')) as {
          product_install_full_path?: string
        }
        const path = settings.product_install_full_path?.replace(/\//g, '\\')
        if (!path || !(await pathExists(path))) continue
        games.push({
          appId: folder,
          name: patchline === 'live' ? NAMES[product] : `${NAMES[product]} (${patchline.toUpperCase()})`,
          installed: true,
          installPath: path,
          extra: { product, patchline }
        })
      } catch {
        continue
      }
    }
    for (const product of Object.keys(NAMES)) {
      if (games.some((game) => game.extra?.product === product)) continue
      games.push({
        appId: `${product}.live`,
        name: NAMES[product],
        installed: false,
        installPath: null,
        extra: { product, patchline: 'live' }
      })
    }
    return games
  },

  async open() {
    const client = await riotClient()
    if (!client) throw new Error('The Riot Client is not installed.')
    launchDetached(client)
  },

  async run(game: LauncherGame, action: GameAction) {
    const client = await riotClient()
    if (!client) throw new Error('The Riot Client is not installed.')
    const { product, patchline } = game.extra ?? {}
    switch (action) {
      case 'play':
      case 'install':
        return launchDetached(client, [`--launch-product=${product}`, `--launch-patchline=${patchline}`])
      case 'uninstall':
        return launchDetached(client, [`--uninstall-product=${product}`, `--uninstall-patchline=${patchline}`])
      case 'downloads':
        return launchDetached(client)
      default:
        return unsupported()
    }
  }
}
