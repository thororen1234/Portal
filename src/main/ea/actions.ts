import { shell } from 'electron'
import type { Game, GameAction } from '../../shared/types'

export async function runEaAction(game: Game, action: GameAction): Promise<void> {
  if (action !== 'play' && action !== 'install') throw new Error('The EA app does not support that from Portal.')
  try {
    await shell.openExternal(`origin2://game/launch?offerIds=${encodeURIComponent(game.appId)}&autoDownload=1`)
  } catch {
    throw new Error('Could not open the EA app. Make sure it is installed.')
  }
}
