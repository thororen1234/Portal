import { net } from 'electron'
import type { GameSource } from '../../shared/types'

const API_BASE = 'https://api.steampowered.com'

export class SteamApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
  }
}

export interface RemoteGame {
  appId: number
  name: string
  source: GameSource
  ownerSteamIds: string[]
  playtimeMinutes: number
  lastPlayed: number | null
}

export interface Profile {
  personaName: string
  avatarUrl: string | null
}

interface OwnedGamesResponse {
  response?: {
    game_count?: number
    games?: Array<{ appid: number; name?: string; playtime_forever?: number; rtime_last_played?: number }>
  }
}

interface FamilyGroupResponse {
  response?: {
    family_groupid?: string | number
    is_not_member_of_any_group?: boolean
  }
}

interface SharedLibraryResponse {
  response?: {
    apps?: Array<{ appid: number; name?: string; owner_steamids?: string[]; rt_last_played?: number }>
  }
}

async function get<T>(path: string, params: Record<string, string>): Promise<T> {
  let response: Response
  try {
    response = await net.fetch(`${API_BASE}/${path}?${new URLSearchParams(params)}`)
  } catch {
    throw new SteamApiError('Could not reach Steam. Showing your last known library.', 0)
  }
  if (!response.ok) throw new SteamApiError(`Steam's API returned an error (${response.status}).`, response.status)
  return (await response.json()) as T
}

export async function fetchOwnedGames(accessToken: string, steamId: string): Promise<RemoteGame[]> {
  const body = await get<OwnedGamesResponse>('IPlayerService/GetOwnedGames/v1/', {
    access_token: accessToken,
    steamid: steamId,
    include_appinfo: '1',
    include_played_free_games: '1'
  })
  if (body.response?.game_count === undefined) {
    throw new Error('Steam returned no games for this account.')
  }
  return (body.response.games ?? []).map((game) => ({
    appId: game.appid,
    name: game.name || `App ${game.appid}`,
    source: 'owned',
    ownerSteamIds: [steamId],
    playtimeMinutes: game.playtime_forever ?? 0,
    lastPlayed: game.rtime_last_played || null
  }))
}

export async function fetchFamilyGames(accessToken: string, steamId: string): Promise<RemoteGame[]> {
  const group = await get<FamilyGroupResponse>('IFamilyGroupsService/GetFamilyGroupForUser/v1/', {
    access_token: accessToken,
    steamid: steamId
  })
  const groupId = group.response?.family_groupid
  if (!groupId || group.response?.is_not_member_of_any_group) return []

  const shared = await get<SharedLibraryResponse>('IFamilyGroupsService/GetSharedLibraryApps/v1/', {
    access_token: accessToken,
    steamid: steamId,
    family_groupid: String(groupId),
    include_own: 'true',
    include_excluded: 'false',
    include_free: 'false',
    include_non_games: 'false',
    language: 'english'
  })
  return (shared.response?.apps ?? [])
    .filter((app) => !(app.owner_steamids ?? []).includes(steamId))
    .map((app) => ({
      appId: app.appid,
      name: app.name || `App ${app.appid}`,
      source: 'family',
      ownerSteamIds: app.owner_steamids ?? [],
      playtimeMinutes: 0,
      lastPlayed: app.rt_last_played || null
    }))
}

const PROFILE_CONCURRENCY = 4

function xmlField(xml: string, tag: string): string | null {
  const match = new RegExp(String.raw`<${tag}>\s*(?:<!\[CDATA\[([\s\S]*?)\]\]>|([^<]*))\s*</${tag}>`).exec(xml)
  const value = (match?.[1] ?? match?.[2] ?? '').trim()
  return value || null
}

async function fetchProfile(steamId: string): Promise<Profile | null> {
  try {
    const response = await net.fetch(`https://steamcommunity.com/profiles/${steamId}?xml=1`)
    if (!response.ok) return null
    const xml = await response.text()
    const personaName = xmlField(xml, 'steamID')
    if (!personaName) return null
    return { personaName, avatarUrl: xmlField(xml, 'avatarFull') ?? xmlField(xml, 'avatarMedium') }
  } catch {
    return null
  }
}

export async function fetchProfiles(steamIds: string[]): Promise<Map<string, Profile>> {
  const profiles = new Map<string, Profile>()
  const queue = [...new Set(steamIds)]
  const worker = async (): Promise<void> => {
    for (let steamId = queue.shift(); steamId; steamId = queue.shift()) {
      const profile = await fetchProfile(steamId)
      if (profile) profiles.set(steamId, profile)
    }
  }
  await Promise.all(Array.from({ length: Math.min(PROFILE_CONCURRENCY, queue.length) }, worker))
  return profiles
}
