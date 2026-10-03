import { net } from 'electron'
import type { ArtKind, SteamGridDbAssetType, SteamGridDbCover, SteamGridDbFilters } from '../shared/types'

const API = 'https://www.steamgriddb.com/api/v2'
const LISTING_CACHE_MS = 5 * 60 * 1000
const COVER_QUERY = 'dimensions=600x900,660x930,342x482&types=static'

export const ASSET_KINDS: Record<SteamGridDbAssetType, ArtKind> = {
  grid: 'cover',
  'wide-grid': 'header',
  hero: 'hero',
  logo: 'logo',
  icon: 'icon'
}

export const ASSET_TYPES = Object.keys(ASSET_KINDS) as SteamGridDbAssetType[]

const ROUTES: Record<SteamGridDbAssetType, { route: string; query: string }> = {
  grid: { route: 'grids', query: COVER_QUERY },
  'wide-grid': { route: 'grids', query: 'dimensions=920x430,460x215&types=static' },
  hero: { route: 'heroes', query: 'types=static' },
  logo: { route: 'logos', query: 'types=static' },
  icon: { route: 'icons', query: 'types=static' }
}

interface ApiAsset {
  id?: number | string
  url?: string
  thumb?: string
  width?: number
  height?: number
  style?: string
}

export interface SteamGridDbAsset extends SteamGridDbCover {
  url: string
  thumbnailUrl: string | null
}

export interface SteamGridDbTarget {
  key: string
  steamAppId?: number
  steamGridDbId?: number
  name: string
}

function searchName(name: string): string {
  return name
    .replace(/[™®©]/g, '')
    .replace(/\s+(?:[-–]\s+)?(Amazon (Prime|Luna)|Epic Games Store|Windows( 10)?)( Edition)?$/i, '')
    .replace(/\s*\((PBE|China)\)$/i, '')
    .trim()
}

export class SteamGridDb {
  private readonly gameIds = new Map<string, Promise<number | null>>()
  private readonly listings = new Map<string, { fetchedAt: number; assets: SteamGridDbAsset[] }>()
  private readonly index = new Map<string, Map<string, SteamGridDbAsset>>()

  constructor(private readonly apiKey: () => string | null) { }

  get configured(): boolean {
    return this.apiKey() !== null
  }

  async choices(target: SteamGridDbTarget, type: SteamGridDbAssetType, filters: SteamGridDbFilters = {}): Promise<SteamGridDbCover[]> {
    return (await this.assets(target, type, filters)).map(({ id, width, height, style }) => ({ id, width, height, style }))
  }

  async find(target: SteamGridDbTarget, type: SteamGridDbAssetType, assetId: string): Promise<SteamGridDbAsset | null> {
    const key = `${target.key}:${type}`
    const known = this.index.get(key)?.get(assetId)
    if (known) return known
    await this.assets(target, type)
    return this.index.get(key)?.get(assetId) ?? null
  }

  async preview(target: SteamGridDbTarget, type: SteamGridDbAssetType, assetId: string): Promise<Buffer | null> {
    const asset = await this.find(target, type, assetId)
    if (!asset) return null
    return (asset.thumbnailUrl && (await this.download(asset.thumbnailUrl))) || this.download(asset.url)
  }

  async first(target: SteamGridDbTarget, type: SteamGridDbAssetType): Promise<Buffer | null> {
    for (const asset of await this.assets(target, type)) {
      const image = await this.download(asset.url)
      if (image) return image
    }
    return null
  }

  async download(url: string): Promise<Buffer | null> {
    try {
      const response = await net.fetch(url)
      if (!response.ok || !response.headers.get('content-type')?.startsWith('image/')) return null
      return Buffer.from(await response.arrayBuffer())
    } catch {
      return null
    }
  }

  async assets(target: SteamGridDbTarget, type: SteamGridDbAssetType, filters: SteamGridDbFilters = {}): Promise<SteamGridDbAsset[]> {
    const { route, query: defaults } = ROUTES[type]
    const query = this.query(defaults, filters)
    const cacheKey = `${target.key}:${type}:${query}`
    const cached = this.listings.get(cacheKey)
    if (cached && Date.now() - cached.fetchedAt < LISTING_CACHE_MS) return cached.assets

    const gameId = await this.gameId(target)
    if (!gameId) throw new Error(`SteamGridDB doesn't have “${searchName(target.name)}”.`)
    const body = await this.request<{ success?: boolean; data?: ApiAsset[] }>(`/${route}/game/${gameId}?${query}`, `${type} artwork`)
    const assets = (body.data ?? []).flatMap((asset) =>
      typeof asset.url === 'string'
        ? [{
          id: String(asset.id ?? asset.url),
          url: asset.url,
          thumbnailUrl: typeof asset.thumb === 'string' ? asset.thumb : null,
          width: typeof asset.width === 'number' ? asset.width : null,
          height: typeof asset.height === 'number' ? asset.height : null,
          style: typeof asset.style === 'string' ? asset.style : null
        }]
        : []
    )
    this.listings.set(cacheKey, { fetchedAt: Date.now(), assets })
    const indexKey = `${target.key}:${type}`
    let index = this.index.get(indexKey)
    if (!index) this.index.set(indexKey, (index = new Map()))
    for (const asset of assets) index.set(asset.id, asset)
    return assets
  }

  private gameId(target: SteamGridDbTarget): Promise<number | null> {
    if (target.steamGridDbId) return Promise.resolve(target.steamGridDbId)
    let lookup = this.gameIds.get(target.key)
    if (!lookup) {
      lookup = this.lookupGameId(target)
      lookup.catch(() => this.gameIds.delete(target.key))
      this.gameIds.set(target.key, lookup)
    }
    return lookup
  }

  private async lookupGameId(target: SteamGridDbTarget): Promise<number | null> {
    if (target.steamAppId) {
      const body = await this.request<{ data?: { id?: number } }>(`/games/steam/${target.steamAppId}`, 'this Steam game', true)
      if (body.data?.id) return body.data.id
    }
    const term = searchName(target.name)
    if (!term) return null
    const body = await this.request<{ data?: Array<{ id?: number; name?: string }> }>(
      `/search/autocomplete/${encodeURIComponent(term)}`,
      'this game'
    )
    const results = body.data ?? []
    const exact = results.find((result) => result.name?.toLowerCase() === term.toLowerCase())
    return (exact ?? results[0])?.id ?? null
  }

  private async request<T>(path: string, what: string, allowNotFound = false): Promise<T> {
    const apiKey = this.apiKey()
    if (!apiKey) throw new Error('Add your SteamGridDB API key in Settings first.')
    let response: Response
    try {
      response = await net.fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${apiKey}` } })
    } catch {
      throw new Error('Could not reach SteamGridDB.')
    }
    if (response.status === 401 || response.status === 403) throw new Error('SteamGridDB rejected your API key.')
    if (allowNotFound && response.status === 404) return {} as T
    if (!response.ok) throw new Error(`SteamGridDB could not load ${what} (${response.status}).`)
    return (await response.json()) as T
  }

  private query(defaults: string, filters: SteamGridDbFilters): string {
    const query = new URLSearchParams(defaults)
    for (const key of ['types', 'mimes', 'styles', 'dimensions'] as const) {
      if (filters[key]) query.set(key, filters[key])
    }
    for (const key of ['nsfw', 'humor', 'epilepsy'] as const) {
      if (filters[key] !== undefined) query.set(key, String(filters[key]))
    }
    return query.toString()
  }
}
