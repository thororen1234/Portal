import { shell } from 'electron'
import type { Game, GameAction } from '../../shared/types'

export async function runSteamAction(game: Game, action: GameAction): Promise<void> {
  const appId = Number(game.appId)
  if (!Number.isInteger(appId) || appId <= 0) throw new Error('Invalid Steam app id.')

  switch (action) {
    case 'play':
      return shell.openExternal(`steam://rungameid/${appId}`)
    case 'install':
      return shell.openExternal(`steam://install/${appId}`)
    case 'uninstall':
      return shell.openExternal(`steam://uninstall/${appId}`)
    case 'downloads':
      return shell.openExternal('steam://open/downloads')
    case 'store':
      return shell.openExternal(`https://store.steampowered.com/app/${appId}`)
    default:
      throw new Error('Steam does not support that action.')
  }
}
