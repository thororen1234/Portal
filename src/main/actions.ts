import { shell } from 'electron'
import type { GameAction } from '../shared/types'
import { runEaAction } from './ea/actions'
import { runEpicAction } from './epic/actions'
import type { EpicLibrary } from './epic/library'
import type { Library, LocalProviders } from './library'
import { runSteamAction } from './steam/actions'
import { runUbisoftAction } from './ubisoft/actions'

const ACTIONS = new Set<GameAction>(['play', 'install', 'uninstall', 'downloads', 'store', 'folder'])

export async function runGameAction(
  gameId: unknown,
  action: unknown,
  library: Library,
  epic: EpicLibrary,
  local: LocalProviders
): Promise<void> {
  if (typeof gameId !== 'string' || typeof action !== 'string' || !ACTIONS.has(action as GameAction)) {
    throw new Error('Unknown action.')
  }
  const game = library.findGame(gameId)
  if (!game) throw new Error('That game is no longer in your library.')
  const gameAction = action as GameAction

  if (gameAction === 'folder') {
    if (!game.installPath) throw new Error('This game is not installed.')
    const failure = await shell.openPath(game.installPath)
    if (failure) throw new Error(failure)
    return
  }

  switch (game.launcher) {
    case 'steam':
      return runSteamAction(game, gameAction)
    case 'epic':
      return runEpicAction(game, gameAction, epic.catalogIds(game.appId))
    case 'ubisoft':
      return runUbisoftAction(game, gameAction)
    case 'ea':
      return runEaAction(game, gameAction)
    default:
      return local[game.launcher].run(game.appId, gameAction)
  }
}
