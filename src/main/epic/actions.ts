import { shell } from 'electron'
import type { Game, GameAction } from '../../shared/types'
import type { EpicRecord } from './api'

function appUri(game: Game, ids: EpicRecord | null, query: string): string {
  const target = ids
    ? `${encodeURIComponent(ids.namespace)}%3A${encodeURIComponent(ids.catalogItemId)}%3A${encodeURIComponent(game.appId)}`
    : encodeURIComponent(game.appId)
  return `com.epicgames.launcher://apps/${target}?${query}`
}

export async function runEpicAction(game: Game, action: GameAction, ids: EpicRecord | null): Promise<void> {
  try {
    switch (action) {
      case 'play':
        return await shell.openExternal(appUri(game, ids, 'action=launch&silent=true'))
      case 'install':
        return await shell.openExternal(appUri(game, ids, 'action=install'))
      case 'downloads':
        return await shell.openExternal('com.epicgames.launcher://')
      default:
        throw new Error('The Epic Games Launcher does not support that from Portal.')
    }
  } catch (error) {
    if (error instanceof Error && /not support/.test(error.message)) throw error
    throw new Error('Could not open the Epic Games Launcher. Make sure it is installed.')
  }
}
