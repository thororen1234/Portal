import { shell } from 'electron'
import type { Game, GameAction } from '../../shared/types'

export async function runUbisoftAction(game: Game, action: GameAction): Promise<void> {
  if (!/^\d+$/.test(game.appId)) throw new Error('Invalid Ubisoft product id.')
  const uri = {
    play: `uplay://launch/${game.appId}/0`,
    install: `uplay://install/${game.appId}`,
    uninstall: `uplay://uninstall/${game.appId}`,
    downloads: 'uplay://'
  }[action as 'play' | 'install' | 'uninstall' | 'downloads']
  if (!uri) throw new Error('Ubisoft Connect does not support that from Portal.')
  try {
    await shell.openExternal(uri)
  } catch {
    throw new Error('Could not open Ubisoft Connect. Make sure it is installed.')
  }
}
