import { join } from 'path'
import { net } from 'electron'
import type { GameOverview } from '../shared/types'
import { DiskCache } from './diskCache'
import type { SteamGameInfo } from './steam/gameInfo'

const MATCH_TTL_MS = 30 * 24 * 60 * 60 * 1000

interface StoreSearchResponse {
  items?: Array<{ type?: string; id?: number; name?: string }>
}

function normalize(name: string): string {
  return name
    .toLowerCase()
    .replace(/[™®©]/g, '')
    .replace(/\s+(?:[-–]\s+)?(amazon (prime|luna)|epic games store)$/, '')
    .replace(/\b(the )?(game of the year|goty|definitive|complete|deluxe|standard|ultimate|enhanced|remastered)( edition)?$/, '')
    .replace(/[^a-z0-9]+/g, '')
}

export class MetadataSources {
  private readonly steamMatches: DiskCache<number | null>

  constructor(
    dir: string,
    private readonly steam: SteamGameInfo
  ) {
    this.steamMatches = new DiskCache(join(dir, 'steam-matches'), MATCH_TTL_MS)
  }

  async complete(name: string, base: GameOverview | null): Promise<GameOverview | null> {
    if (base?.description && base.developers.length > 0 && base.genres.length > 0) return base
    const match = await this.steamMatches.get(normalize(name), () => this.findSteamApp(name))
    const steam = match.data ? await this.steam.overview(match.data) : null
    if (!steam) return base
    if (!base) return steam
    return {
      shortDescription: base.shortDescription ?? steam.shortDescription,
      description: base.description ?? steam.description,
      developers: base.developers.length > 0 ? base.developers : steam.developers,
      publishers: base.publishers.length > 0 ? base.publishers : steam.publishers,
      releaseDate: base.releaseDate ?? steam.releaseDate,
      genres: base.genres.length > 0 ? base.genres : steam.genres,
      website: base.website ?? steam.website
    }
  }

  private async findSteamApp(name: string): Promise<number | null> {
    const wanted = normalize(name)
    if (!wanted) return null
    const response = await net.fetch(
      `https://store.steampowered.com/api/storesearch/?${new URLSearchParams({ term: name, l: 'english', cc: 'US' })}`
    )
    if (!response.ok) throw new Error(`The Steam store search failed (${response.status}).`)
    const body = (await response.json()) as StoreSearchResponse
    const exact = (body.items ?? []).find((item) => item.type === 'app' && item.id && item.name && normalize(item.name) === wanted)
    return exact?.id ?? null
  }
}
