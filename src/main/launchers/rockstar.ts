import { join } from 'path'
import type { GameAction } from '../../shared/types'
import { pathExists } from '../fsutil'
import { registryValue } from '../registry'
import type { LauncherGame, LauncherIntegration } from './types'
import { launchDetached, unsupported } from './util'

const ROOT_KEY = 'HKLM\\SOFTWARE\\WOW6432Node\\Rockstar Games'

const TITLES: Array<{ key: string; titleId: string; name: string }> = [
  { key: 'Grand Theft Auto V', titleId: 'gta5', name: 'Grand Theft Auto V Legacy' },
  { key: 'GTA V Enhanced', titleId: 'gta5_gen9', name: 'Grand Theft Auto V Enhanced' },
  { key: 'Red Dead Redemption 2', titleId: 'rdr2', name: 'Red Dead Redemption 2' },
  { key: 'Red Dead Redemption', titleId: 'rdr', name: 'Red Dead Redemption' },
  { key: 'L.A. Noire', titleId: 'lanoire', name: 'L.A. Noire' },
  { key: 'L.A. Noire: The VR Case Files', titleId: 'lanoirevr', name: 'L.A. Noire: The VR Case Files' },
  { key: 'Max Payne 3', titleId: 'mp3', name: 'Max Payne 3' },
  { key: 'Grand Theft Auto IV', titleId: 'gta4', name: 'Grand Theft Auto IV' },
  { key: 'Grand Theft Auto: San Andreas', titleId: 'gtasa', name: 'Grand Theft Auto: San Andreas' },
  { key: 'Grand Theft Auto III', titleId: 'gta3', name: 'Grand Theft Auto III' },
  { key: 'Grand Theft Auto: Vice City', titleId: 'gtavc', name: 'Grand Theft Auto: Vice City' },
  { key: 'Grand Theft Auto III - Definitive Edition', titleId: 'gta3unreal', name: 'Grand Theft Auto III – The Definitive Edition' },
  { key: 'Grand Theft Auto Vice City - Definitive Edition', titleId: 'gtavcunreal', name: 'Grand Theft Auto: Vice City – The Definitive Edition' },
  { key: 'Grand Theft Auto San Andreas - Definitive Edition', titleId: 'gtasaunreal', name: 'Grand Theft Auto: San Andreas – The Definitive Edition' },
  { key: 'Bully Scholarship Edition', titleId: 'bully', name: 'Bully: Scholarship Edition' }
]

async function launcherDir(): Promise<string | null> {
  const dir = await registryValue(`${ROOT_KEY}\\Launcher`, 'InstallFolder')
  return dir && (await pathExists(join(dir, 'Launcher.exe'))) ? dir : null
}

export const rockstar: LauncherIntegration = {
  id: 'rockstar',

  async detect() {
    return (await launcherDir()) !== null
  },

  async games() {
    const games: LauncherGame[] = []
    for (const title of TITLES) {
      const folder = await registryValue(`${ROOT_KEY}\\${title.key}`, 'InstallFolder')
      if (!folder || !(await pathExists(folder))) continue
      games.push({ appId: title.titleId, name: title.name, installed: true, installPath: folder })
    }
    return games
  },

  async open() {
    const dir = await launcherDir()
    if (!dir) throw new Error('The Rockstar Games Launcher is not installed.')
    launchDetached(join(dir, 'Launcher.exe'), [], dir)
  },

  async run(game: LauncherGame, action: GameAction) {
    const dir = await launcherDir()
    if (!dir) throw new Error('The Rockstar Games Launcher is not installed.')
    switch (action) {
      case 'play':
        return launchDetached(join(dir, 'Launcher.exe'), [`-launchTitle=${game.appId}`], dir)
      case 'uninstall':
        return launchDetached(join(dir, 'uninstall.exe'), [`-uninstall=${game.appId}`], dir)
      case 'downloads':
        return launchDetached(join(dir, 'Launcher.exe'), [], dir)
      default:
        return unsupported()
    }
  }
}
