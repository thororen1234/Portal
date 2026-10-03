import { mkdir, readFile, unlink, writeFile } from 'fs/promises'
import { join } from 'path'
import { net } from 'electron'
import type { ArtKind } from '../../shared/types'

const FILE_NAMES: Record<ArtKind, string> = {
  cover: 'library_600x900.jpg',
  header: 'header.jpg',
  hero: 'library_hero.jpg',
  logo: 'logo.png',
  icon: 'icon.png'
}

const STORE_ASSET_KEYS: Record<ArtKind, string> = {
  cover: 'library_capsule',
  header: 'header',
  hero: 'library_hero',
  logo: 'logo',
  icon: 'icon'
}

const ASSET_BASE = 'https://shared.steamstatic.com/store_item_assets/'
const MISS_TTL_MS = 10 * 60 * 1000
const BATCH_SIZE = 50
const BATCH_DELAY_MS = 30

interface StoreAssets {
  format: string
  files: Record<string, string>
}

interface StoreItemsResponse {
  response?: {
    store_items?: Array<{ appid?: number; id?: number; assets?: Record<string, unknown> }>
  }
}

export function isArtKind(value: string): value is ArtKind {
  return value in FILE_NAMES
}

export class ArtService {
  private readonly loads = new Map<string, Promise<Buffer | null>>()
  private readonly misses = new Map<string, number>()
  private readonly assetInfo = new Map<number, Promise<StoreAssets | null>>()
  private pending = new Map<number, (assets: StoreAssets | null) => void>()
  private flushTimer: NodeJS.Timeout | null = null

  constructor(
    private readonly cacheDir: string,
    private readonly steamPath: () => string | null,
    private readonly saveSteamGridDbCover: (appId: number) => Promise<void>,
    private readonly removeSteamGridDbCover: (appId: number) => Promise<void>
  ) { }

  load(appId: number, kind: ArtKind): Promise<Buffer | null> {
    const key = `${appId}/${kind}`
    let load = this.loads.get(key)
    if (!load) {
      load = this.resolve(appId, kind, key).finally(() => this.loads.delete(key))
      this.loads.set(key, load)
    }
    return load
  }

  async saveOverride(appId: number, kind: ArtKind, image: Buffer): Promise<void> {
    try {
      const dir = join(this.cacheDir, String(appId))
      await mkdir(dir, { recursive: true })
      await writeFile(join(dir, `steamgriddb-${kind}.img`), image)
    } catch {
      throw new Error('Could not save the artwork.')
    }
    await this.saveSteamGridDbCover(appId)
  }

  async removeOverrides(appId: number): Promise<void> {
    for (const kind of Object.keys(FILE_NAMES)) {
      try {
        await unlink(join(this.cacheDir, String(appId), `steamgriddb-${kind}.img`))
      } catch (error) {
        if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') {
          throw new Error('Could not remove the custom artwork.')
        }
      }
    }
    await this.removeSteamGridDbCover(appId)
  }

  private async resolve(appId: number, kind: ArtKind, key: string): Promise<Buffer | null> {
    const file = FILE_NAMES[kind]
    const steamPath = this.steamPath()
    const steamCache = steamPath ? join(steamPath, 'appcache', 'librarycache') : null
    const cachedPath = join(this.cacheDir, String(appId), file)

    try {
      return await readFile(join(this.cacheDir, String(appId), `steamgriddb-${kind}.img`))
    } catch {
    }

    const localPaths = [
      steamCache && join(steamCache, String(appId), file),
      steamCache && join(steamCache, `${appId}_${file}`),
      cachedPath
    ]

    for (const path of localPaths) {
      if (!path) continue
      try {
        return await readFile(path)
      } catch {
        continue
      }
    }

    const missedAt = this.misses.get(key)
    if (missedAt && Date.now() - missedAt < MISS_TTL_MS) return null

    const image = await this.downloadSteam(appId, kind)
    if (!image) {
      this.misses.set(key, Date.now())
      return null
    }
    try {
      await mkdir(join(this.cacheDir, String(appId)), { recursive: true })
      await writeFile(cachedPath, image)
    } catch {
      return image
    }
    return image
  }

  private async downloadSteam(appId: number, kind: ArtKind): Promise<Buffer | null> {
    const urls: string[] = []
    const assets = await this.storeAssets(appId)
    const assetFile = assets?.files[STORE_ASSET_KEYS[kind]]
    if (assets && assetFile) urls.push(ASSET_BASE + assets.format.replace('${FILENAME}', assetFile))
    urls.push(`${ASSET_BASE}steam/apps/${appId}/${FILE_NAMES[kind]}`)

    for (const url of new Set(urls)) {
      try {
        const response = await net.fetch(url)
        if (response.ok && response.headers.get('content-type')?.startsWith('image/')) {
          return Buffer.from(await response.arrayBuffer())
        }
      } catch {
        continue
      }
    }
    return null
  }

  private storeAssets(appId: number): Promise<StoreAssets | null> {
    let info = this.assetInfo.get(appId)
    if (!info) {
      info = new Promise((resolve) => {
        this.pending.set(appId, resolve)
        if (this.pending.size >= BATCH_SIZE) void this.flush()
        else this.flushTimer ??= setTimeout(() => void this.flush(), BATCH_DELAY_MS)
      })
      this.assetInfo.set(appId, info)
    }
    return info
  }

  private async flush(): Promise<void> {
    if (this.flushTimer) clearTimeout(this.flushTimer)
    this.flushTimer = null
    const batch = this.pending
    this.pending = new Map()
    if (batch.size === 0) return

    const input = {
      ids: [...batch.keys()].map((appid) => ({ appid })),
      context: { language: 'english', country_code: 'US' },
      data_request: { include_assets: true }
    }
    const results = new Map<number, StoreAssets>()
    try {
      const response = await net.fetch(
        `https://api.steampowered.com/IStoreBrowseService/GetStoreItems/v1/?input_json=${encodeURIComponent(JSON.stringify(input))}`
      )
      if (!response.ok) throw new Error(`Store lookup failed (${response.status})`)
      const body = (await response.json()) as StoreItemsResponse
      for (const item of body.response?.store_items ?? []) {
        const appId = item.appid ?? item.id
        const format = item.assets?.asset_url_format
        if (!appId || typeof format !== 'string' || !item.assets) continue
        const files = Object.fromEntries(
          Object.entries(item.assets).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
        )
        results.set(appId, { format, files })
      }
    } catch {
      const failed = [...batch.keys()]
      setTimeout(() => {
        for (const appId of failed) this.assetInfo.delete(appId)
      }, MISS_TTL_MS).unref()
    }
    for (const [appId, resolve] of batch) resolve(results.get(appId) ?? null)
  }
}
