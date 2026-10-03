import type { ArtKind, Game, GameAction, LauncherId, LinkedLauncherId, LocalLauncherId, SteamGridDbSearch } from '../../../shared/types'
import { formatPercent } from './format'

export type Filter = 'all' | 'installed' | 'not-installed'
export type LauncherFilter = 'all' | LauncherId
export type Sort = 'recent' | 'name' | 'playtime' | 'size'

export const LAUNCHER_NAMES: Record<LauncherId, string> = {
  steam: 'Steam',
  epic: 'Epic Games',
  ubisoft: 'Ubisoft Connect',
  ea: 'EA app',
  gog: 'GOG Galaxy',
  amazon: 'Amazon Games',
  battlenet: 'Battle.net',
  xbox: 'Xbox',
  riot: 'Riot Games',
  rockstar: 'Rockstar Games',
  hoyoplay: 'HoYoPlay',
  meta: 'Meta Quest',
  itch: 'itch.io',
  humble: 'Humble App',
  legacy: 'Legacy Games',
  googleplay: 'Google Play Games',
  minecraft: 'Minecraft'
}

export const LINKED_LAUNCHERS: LinkedLauncherId[] = ['epic', 'ubisoft', 'ea']

export const LOCAL_LAUNCHERS: LocalLauncherId[] = [
  'gog',
  'amazon',
  'battlenet',
  'xbox',
  'riot',
  'rockstar',
  'hoyoplay',
  'meta',
  'itch',
  'humble',
  'legacy',
  'googleplay',
  'minecraft'
]

export const LAUNCHER_IDS: LauncherId[] = ['steam', ...LINKED_LAUNCHERS, ...LOCAL_LAUNCHERS]

const LAUNCHER_ACTIONS: Record<LauncherId, Set<GameAction>> = {
  steam: new Set(['play', 'install', 'uninstall', 'downloads', 'store', 'folder']),
  epic: new Set(['play', 'install', 'downloads', 'folder']),
  ubisoft: new Set(['play', 'install', 'uninstall', 'downloads', 'folder']),
  ea: new Set(['play', 'install', 'folder']),
  gog: new Set(['play', 'install', 'uninstall', 'downloads', 'folder']),
  amazon: new Set(['play', 'install', 'uninstall', 'downloads', 'folder']),
  battlenet: new Set(['play', 'uninstall', 'downloads', 'folder']),
  xbox: new Set(['play', 'uninstall', 'downloads', 'store']),
  riot: new Set(['play', 'install', 'uninstall', 'downloads', 'folder']),
  rockstar: new Set(['play', 'uninstall', 'downloads', 'folder']),
  hoyoplay: new Set(['play', 'downloads', 'folder']),
  meta: new Set(['play', 'install', 'downloads', 'folder']),
  itch: new Set(['play', 'install', 'uninstall', 'downloads', 'store', 'folder']),
  humble: new Set(['play', 'install', 'uninstall', 'downloads', 'folder']),
  legacy: new Set(['play', 'uninstall', 'folder']),
  googleplay: new Set(['play', 'uninstall']),
  minecraft: new Set(['play', 'downloads', 'folder'])
}

const ID_LABELS: Record<LauncherId, string> = {
  steam: 'App ID',
  epic: 'Epic App ID',
  ubisoft: 'Product ID',
  ea: 'Content ID',
  gog: 'Product ID',
  amazon: 'Product ID',
  battlenet: 'Product code',
  xbox: 'Package family',
  riot: 'Product',
  rockstar: 'Title ID',
  hoyoplay: 'Game ID',
  meta: 'App ID',
  itch: 'Game ID',
  humble: 'Machine name',
  legacy: 'Install ID',
  googleplay: 'Package',
  minecraft: 'Version'
}

export function idLabel(game: Game): string {
  return ID_LABELS[game.launcher]
}

export interface PrimaryAction {
  action: GameAction
  label: string
  variant: 'play' | 'install' | 'neutral'
}

const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true })

export function artUrl(game: Pick<Game, 'launcher' | 'appId'>, kind: ArtKind, revision?: number): string {
  const url = `art://${game.launcher}/${encodeURIComponent(game.appId)}/${kind}`
  return revision === undefined ? url : `${url}?v=${revision}`
}

export function steamGridDbPreviewUrl(gameId: string, type: string, assetId: string, search?: SteamGridDbSearch): string {
  const query = new URLSearchParams()
  if (search?.name) query.set('name', search.name)
  if (search?.gameId) query.set('gameId', String(search.gameId))
  const suffix = query.size > 0 ? `?${query}` : ''
  return `art://sgdb/${encodeURIComponent(gameId)}/${type}/${assetId}${suffix}`
}

export function supports(game: Game, action: GameAction): boolean {
  return LAUNCHER_ACTIONS[game.launcher].has(action)
}

export function isInstalled(game: Game): boolean {
  return game.state !== 'not-installed'
}

export function isPlayable(game: Game): boolean {
  return game.state === 'installed' || game.state === 'update-required'
}

export function primaryAction(game: Game): PrimaryAction {
  if (isPlayable(game)) return { action: 'play', label: 'Play', variant: 'play' }
  if (game.state === 'not-installed') return { action: 'install', label: 'Install', variant: 'install' }
  return {
    action: 'downloads',
    label: game.launcher === 'steam' ? 'View download' : `Open ${LAUNCHER_NAMES[game.launcher]} `,
    variant: 'neutral'
  }
}

export function stateLabel(game: Game): string {
  switch (game.state) {
    case 'installed':
      return 'Installed'
    case 'not-installed':
      return 'Not installed'
    case 'downloading':
      return game.progress !== null ? `Downloading ${formatPercent(game.progress)} ` : 'Downloading'
    case 'paused':
      return game.progress !== null ? `Paused at ${formatPercent(game.progress)} ` : 'Paused'
    case 'queued':
      return 'Queued'
    case 'update-required':
      return 'Update pending'
    case 'uninstalling':
      return 'Uninstalling'
  }
}

export function showsBadge(game: Game): boolean {
  return game.state !== 'installed' && game.state !== 'not-installed'
}

function compare(sort: Sort, a: Game, b: Game): number {
  switch (sort) {
    case 'recent':
      return (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0)
    case 'playtime':
      return (b.playtimeMinutes ?? 0) - (a.playtimeMinutes ?? 0)
    case 'size':
      return (b.sizeOnDisk ?? 0) - (a.sizeOnDisk ?? 0)
    case 'name':
      return 0
  }
}

export function visibleGames(
  games: Game[],
  query: string,
  filter: Filter,
  launcher: LauncherFilter,
  sort: Sort
): Game[] {
  const needle = query.trim().toLocaleLowerCase()
  return games
    .filter((game) => {
      if (launcher !== 'all' && game.launcher !== launcher) return false
      if (filter === 'installed' && !isInstalled(game)) return false
      if (filter === 'not-installed' && isInstalled(game)) return false
      return !needle || game.name.toLocaleLowerCase().includes(needle) || game.appId.toLocaleLowerCase() === needle
    })
    .sort((a, b) => compare(sort, a, b) || collator.compare(a.name, b.name))
}

export function countGames(games: Game[], launcher: LauncherFilter): Record<Filter, number> {
  const scoped = launcher === 'all' ? games : games.filter((game) => game.launcher === launcher)
  const installed = scoped.filter(isInstalled).length
  return { all: scoped.length, installed, 'not-installed': scoped.length - installed }
}
