import { join } from 'path'
import { net } from 'electron'
import type { Achievement, GameAchievements, GameInfo, GameOverview, ProfileAchievements } from '../../shared/types'
import { DiskCache, type CachedResult } from '../diskCache'
import { htmlToText } from '../text'
import { SteamApiError } from './api'
import type { SteamAuth } from './auth'

const API_BASE = 'https://api.steampowered.com'
const ICON_BASE = 'https://cdn.fastly.steamstatic.com/steamcommunity/public/images/apps'
const DAY_MS = 24 * 60 * 60 * 1000
const PROGRESS_BATCH = 100

interface SchemaEntry {
  id: string
  name: string
  description: string | null
  icon: string | null
  iconGray: string | null
  hidden: boolean
  globalPercent: number | null
}

interface Progress {
  appId: number
  unlocked: number
  total: number
  allUnlocked: boolean
}

interface PlayerUnlocks {
  unlocked: number
  total: number
  detailed: boolean

  times: Record<string, number>

  icons: string[]
  names: string[]
}

interface AppDetailsResponse {
  [appId: string]: {
    success?: boolean
    data?: {
      short_description?: string
      about_the_game?: string
      detailed_description?: string
      developers?: string[]
      publishers?: string[]
      release_date?: { date?: string; coming_soon?: boolean }
      genres?: Array<{ description?: string }>
      website?: string | null
    }
  }
}

interface SchemaResponse {
  response?: {
    achievements?: Array<{
      internal_name?: string
      localized_name?: string
      localized_desc?: string
      icon?: string
      icon_gray?: string
      hidden?: boolean
      player_percent_unlocked?: string
    }>
  }
}

interface ProgressResponse {
  response?: {
    achievement_progress?: Array<{ appid?: number; unlocked?: number; total?: number; all_unlocked?: boolean }>
  }
}

interface TopAchievementsResponse {
  response?: {
    games?: Array<{
      appid?: number
      total_achievements?: number
      achievements?: Array<{ name?: string; icon?: string }>
    }>
  }
}

interface PlayerAchievementsResponse {
  playerstats?: {
    success?: boolean
    error?: string
    achievements?: Array<{ apiname?: string; achieved?: number; unlocktime?: number }>
  }
}

async function readJsonResponse<T>(response: Response, what: string): Promise<T> {
  if (!response.ok) throw new SteamApiError(`Steam could not load ${what} (${response.status}).`, response.status)
  return (await response.json()) as T
}

async function getJson<T>(url: string, what: string): Promise<T> {
  let response: Response
  try {
    response = await net.fetch(url)
  } catch {
    throw new SteamApiError(`Could not reach Steam to load ${what}.`, 0)
  }
  return readJsonResponse<T>(response, what)
}

async function postForm<T>(path: string, params: URLSearchParams, what: string): Promise<T> {
  let response: Response
  try {
    response = await net.fetch(`${API_BASE}/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString()
    })
  } catch {
    throw new SteamApiError(`Could not reach Steam to load ${what}.`, 0)
  }
  return readJsonResponse<T>(response, what)
}

function iconUrl(appId: number, icon: string | null): string | null {
  if (!icon) return null
  return /^https:\/\//.test(icon) ? icon : `${ICON_BASE}/${appId}/${icon}`
}

function iconFile(icon: string | undefined): string {
  return (icon ?? '').split('/').pop() ?? ''
}

export class SteamGameInfo {
  private readonly overviews: DiskCache<GameOverview | null>
  private readonly schemas: DiskCache<SchemaEntry[]>
  private readonly unlocks: DiskCache<PlayerUnlocks>
  private readonly progress: DiskCache<Progress[]>

  constructor(
    dir: string,
    private readonly auth: SteamAuth,
    private readonly webApiKey: () => string | null
  ) {
    this.overviews = new DiskCache(join(dir, 'overviews'), 7 * DAY_MS)
    this.schemas = new DiskCache(join(dir, 'achievement-schemas'), 7 * DAY_MS)
    this.unlocks = new DiskCache(join(dir, 'achievements'), 30 * 60 * 1000)
    this.progress = new DiskCache(join(dir, 'achievement-progress'), 6 * 60 * 60 * 1000)
  }

  async info(appId: number, steamId: string | null): Promise<GameInfo> {
    const [overview, achievements] = await Promise.all([
      this.overviews.get(String(appId), () => this.fetchOverview(appId)),
      this.achievements(appId, steamId)
    ])
    return {
      overview: overview.data,
      achievements: achievements.data,
      error: overview.error ?? achievements.error
    }
  }

  async overview(appId: number): Promise<GameOverview | null> {
    return (await this.overviews.get(String(appId), () => this.fetchOverview(appId))).data
  }

  async profileAchievements(steamId: string, appIds: number[]): Promise<CachedResult<ProfileAchievements>> {
    const result = await this.progress.get(steamId, () => this.fetchProgress(steamId, appIds))
    if (!result.data) return { data: null, fetchedAt: result.fetchedAt, error: result.error }
    const withAchievements = result.data.filter((entry) => entry.total > 0)
    return {
      data: {
        unlocked: withAchievements.reduce((sum, entry) => sum + entry.unlocked, 0),
        total: withAchievements.reduce((sum, entry) => sum + entry.total, 0),
        perfectGames: withAchievements.filter((entry) => entry.allUnlocked).length,
        gamesWithAchievements: withAchievements.length
      },
      fetchedAt: result.fetchedAt,
      error: result.error
    }
  }

  private async achievements(appId: number, steamId: string | null): Promise<CachedResult<GameAchievements>> {
    const schema = await this.schemas.get(String(appId), () => this.fetchSchema(appId))
    if (!schema.data || schema.data.length === 0) return { data: null, fetchedAt: schema.fetchedAt, error: schema.error }

    const player = steamId
      ? await this.unlocks.get(`${steamId}-${appId}`, () => this.fetchUnlocks(appId, steamId, schema.data!.length))
      : null
    const unlockedIcons = new Set(player?.data?.icons ?? [])
    const unlockedNames = new Set(player?.data?.names ?? [])

    const items: Achievement[] = schema.data.map((entry) => {
      const time = player?.data?.times[entry.id]
      const unlocked =
        time !== undefined || unlockedIcons.has(iconFile(entry.icon ?? undefined)) || unlockedNames.has(entry.name)
      return {
        id: entry.id,
        name: entry.name,
        description: entry.description,
        iconUrl: iconUrl(appId, entry.icon),
        lockedIconUrl: iconUrl(appId, entry.iconGray),
        hidden: entry.hidden,
        unlocked,
        unlockedAt: time ? time : null,
        globalPercent: entry.globalPercent
      }
    })
    items.sort((a, b) => Number(b.unlocked) - Number(a.unlocked) || (b.unlockedAt ?? 0) - (a.unlockedAt ?? 0))

    return {
      data: {
        unlocked: player?.data ? player.data.unlocked : items.filter((item) => item.unlocked).length,
        total: items.length,
        detailed: player?.data?.detailed ?? false,
        items
      },
      fetchedAt: schema.fetchedAt,
      error: player?.error ?? schema.error
    }
  }

  private async fetchOverview(appId: number): Promise<GameOverview | null> {
    const body = await getJson<AppDetailsResponse>(
      `https://store.steampowered.com/api/appdetails?appids=${appId}&l=english`,
      'the store page'
    )
    const data = body[String(appId)]?.success ? body[String(appId)]?.data : null
    if (!data) return null
    return {
      shortDescription: data.short_description ? htmlToText(data.short_description) : null,
      description: htmlToText(data.about_the_game || data.detailed_description || '') || null,
      developers: data.developers ?? [],
      publishers: data.publishers ?? [],
      releaseDate: data.release_date?.date || null,
      genres: (data.genres ?? []).flatMap((genre) => (genre.description ? [genre.description] : [])),
      website: data.website || null
    }
  }

  private async fetchSchema(appId: number): Promise<SchemaEntry[]> {
    const body = await getJson<SchemaResponse>(
      `${API_BASE}/IPlayerService/GetGameAchievements/v1/?appid=${appId}&language=english`,
      'achievements'
    )
    return (body.response?.achievements ?? []).flatMap((entry) => {
      if (!entry.internal_name) return []
      const percent = Number(entry.player_percent_unlocked)
      return [{
        id: entry.internal_name,
        name: entry.localized_name || entry.internal_name,
        description: entry.localized_desc || null,
        icon: entry.icon || null,
        iconGray: entry.icon_gray || null,
        hidden: entry.hidden === true,
        globalPercent: Number.isFinite(percent) ? percent : null
      }]
    })
  }

  private async withToken<T>(steamId: string, call: (token: string) => Promise<T>): Promise<T> {
    try {
      return await call(await this.auth.accessToken(steamId))
    } catch (error) {
      if (!(error instanceof SteamApiError) || error.status !== 401 || !this.auth.rejectToken(steamId)) throw error
      return call(await this.auth.accessToken(steamId))
    }
  }

  private async fetchUnlocks(appId: number, steamId: string, total: number): Promise<PlayerUnlocks> {
    const apiKey = this.webApiKey()
    if (apiKey) {
      const body = await getJson<PlayerAchievementsResponse>(
        `${API_BASE}/ISteamUserStats/GetPlayerAchievements/v1/?${new URLSearchParams({ key: apiKey, steamid: steamId, appid: String(appId) })}`,
        'your achievements'
      )
      if (!body.playerstats?.success) throw new Error(body.playerstats?.error || 'Steam did not return your achievements.')
      const times: Record<string, number> = {}
      for (const entry of body.playerstats.achievements ?? []) {
        if (entry.apiname && entry.achieved) times[entry.apiname] = (entry.unlocktime ?? 0) * 1000
      }
      return { unlocked: Object.keys(times).length, total, detailed: true, times, icons: [], names: [] }
    }

    const [counts, top] = await Promise.all([
      this.withToken(steamId, (token) => this.requestProgress(token, steamId, [appId])),
      this.withToken(steamId, (token) =>
        getJson<TopAchievementsResponse>(
          `${API_BASE}/IPlayerService/GetTopAchievementsForGames/v1/?${new URLSearchParams({
            access_token: token,
            steamid: steamId,
            language: 'english',
            max_achievements: String(total),
            'appids[0]': String(appId)
          })}`,
          'your achievements'
        )
      ).catch(() => null)
    ])
    const progress = counts.find((entry) => entry.appId === appId)
    const unlockedList = top?.response?.games?.find((game) => game.appid === appId)?.achievements ?? []
    const unlocked = progress?.unlocked ?? unlockedList.length
    return {
      unlocked,
      total: progress?.total ?? total,
      detailed: unlockedList.length >= unlocked,
      times: {},
      icons: unlockedList.map((entry) => iconFile(entry.icon)).filter(Boolean),
      names: unlockedList.flatMap((entry) => (entry.name ? [entry.name] : []))
    }
  }

  private async fetchProgress(steamId: string, appIds: number[]): Promise<Progress[]> {
    const results: Progress[] = []
    for (let index = 0; index < appIds.length; index += PROGRESS_BATCH) {
      const batch = appIds.slice(index, index + PROGRESS_BATCH)
      results.push(...(await this.withToken(steamId, (token) => this.requestProgress(token, steamId, batch))))
    }
    return results
  }

  private async requestProgress(token: string, steamId: string, appIds: number[]): Promise<Progress[]> {
    const params = new URLSearchParams({ access_token: token, steamid: steamId, language: 'english' })
    appIds.forEach((appId, index) => params.set(`appids[${index}]`, String(appId)))
    const body = await postForm<ProgressResponse>('IPlayerService/GetAchievementsProgress/v1/', params, 'achievement progress')
    return (body.response?.achievement_progress ?? []).flatMap((entry) =>
      entry.appid
        ? [{ appId: entry.appid, unlocked: entry.unlocked ?? 0, total: entry.total ?? 0, allUnlocked: entry.all_unlocked === true }]
        : []
    )
  }
}
