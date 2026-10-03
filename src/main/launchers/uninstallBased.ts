import type { GameAction } from '../../shared/types'
import { pathExists } from '../fsutil'
import type { LauncherGame, LauncherIntegration } from './types'
import { launchDetached, openUri, runCommandLine, uninstallEntries, unsupported, type UninstallEntry } from './util'

export const legacy: LauncherIntegration = {
  id: 'legacy',

  async detect() {
    return (await uninstallEntries()).some((entry) => /legacy games launcher/i.test(entry.displayName))
  },

  async games() {
    const games: LauncherGame[] = []
    for (const entry of await uninstallEntries()) {
      if (!/^legacy games$/i.test(entry.publisher.trim()) || /launcher/i.test(entry.displayName)) continue
      if (!entry.installLocation || !(await pathExists(entry.installLocation))) continue
      const exe = /\.exe$/i.test(entry.displayIcon) && (await pathExists(entry.displayIcon)) ? entry.displayIcon : null
      games.push({
        appId: entry.name,
        name: entry.displayName,
        installed: true,
        installPath: entry.installLocation,
        extra: { ...(exe ? { exe } : {}), uninstall: entry.uninstallString }
      })
    }
    return games
  },

  async open() {
    const entry = (await uninstallEntries()).find((candidate) => /legacy games launcher/i.test(candidate.displayName))
    const exe = entry && /\.exe$/i.test(entry.displayIcon) && (await pathExists(entry.displayIcon)) ? entry.displayIcon : null
    if (!exe) throw new Error('Could not find the Legacy Games Launcher.')
    launchDetached(exe)
  },

  async run(game: LauncherGame, action: GameAction) {
    switch (action) {
      case 'play':
        if (!game.extra?.exe) throw new Error('Could not find this games executable.')
        return launchDetached(game.extra.exe, [], game.installPath ?? undefined)
      case 'uninstall':
        return runCommandLine(game.extra?.uninstall ?? '', game.installPath ?? undefined)
      default:
        return unsupported()
    }
  }
}

function playGamesId(entry: UninstallEntry): string | null {
  const match = /googleplaygames:\/\/uninstall\/\?([^"\s]+)/i.exec(entry.uninstallString)
  return match ? new URLSearchParams(match[1]).get('id') : null
}

export const googleplay: LauncherIntegration = {
  id: 'googleplay',

  async detect() {
    return (await uninstallEntries()).some((entry) => /^google play games/i.test(entry.displayName))
  },

  async games() {
    const games: LauncherGame[] = []
    for (const entry of await uninstallEntries()) {
      const id = playGamesId(entry)
      if (!id) continue
      games.push({
        appId: id,
        name: entry.displayName,
        installed: true,
        installPath: null,
        art: /\.(ico|png|jpe?g)$/i.test(entry.displayIcon) ? { icon: entry.displayIcon } : undefined
      })
    }
    return games
  },

  async open() {
    await openUri('googleplaygames://')
  },

  async run(game: LauncherGame, action: GameAction) {
    switch (action) {
      case 'play':
        return openUri(`googleplaygames://launch/?id=${encodeURIComponent(game.appId)}&lid=1&pid=1`)
      case 'uninstall':
        return openUri(`googleplaygames://uninstall/?id=${encodeURIComponent(game.appId)}`)
      default:
        return unsupported()
    }
  }
}
