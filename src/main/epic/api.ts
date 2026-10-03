import { net } from 'electron'
import type { ArtKind } from '../../shared/types'

const LIBRARY_BASE = 'https://library-service.live.use1a.on.epicgames.com/library/api/public'
const CATALOG_BASE = 'https://catalog-public-service-prod06.ol.epicgames.com/catalog/api/shared/namespace'
const CATALOG_BATCH = 50
const CATALOG_CONCURRENCY = 6
export const NON_GAME_NAMESPACES = new Set(['ue', '89efe5924d3d467c839449ab6ab52e7f'])

export class EpicApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
  }
}

export interface EpicRecord {
  appName: string
  namespace: string
  catalogItemId: string
}

export interface CatalogEntry {
  title: string
  isGame: boolean
  desktop?: boolean
  images: Partial<Record<ArtKind, string>>
  fetchedAt: number
}

interface LibraryItemsResponse {
  responseMetadata?: { nextCursor?: string }
  records?: Array<{ appName?: string; namespace?: string; catalogItemId?: string; sandboxType?: string }>
}

interface CatalogItem {
  title?: string
  keyImages?: Array<{ type: string; url: string }>
  categories?: Array<{ path: string }>
  mainGameItem?: unknown
  releaseInfo?: Array<{ appId?: string; platform?: string[] }>
}

const DESKTOP_PLATFORMS = process.platform === 'darwin' ? ['Mac'] : ['Windows', 'Win32']

function hasDesktopRelease(item: CatalogItem, appName: string): boolean {
  const release = item.releaseInfo?.find((info) => info.appId === appName)
  if (!release?.platform?.length) return true
  return release.platform.some((platform) => DESKTOP_PLATFORMS.includes(platform))
}

const IMAGE_PREFERENCES: Record<ArtKind, { types: string[]; resize: string }> = {
  cover: { types: ['DieselGameBoxTall', 'OfferImageTall', 'DieselStoreFrontTall', 'Thumbnail'], resize: 'h=600' },
  header: { types: ['DieselGameBox', 'OfferImageWide', 'DieselStoreFrontWide'], resize: 'w=920' },
  hero: { types: ['DieselGameBox', 'OfferImageWide', 'DieselStoreFrontWide'], resize: 'w=1920' },
  logo: { types: ['Logo'], resize: 'w=670' },
  icon: { types: ['Icon', 'Thumbnail'], resize: 'w=256' }
}

async function get<T>(url: string, token: string): Promise<T> {
  let response: Response
  try {
    response = await net.fetch(url, { headers: { Authorization: `bearer ${token}` } })
  } catch {
    throw new EpicApiError('Could not reach Epic Games. Showing your last known library.', 0)
  }
  if (!response.ok) throw new EpicApiError(`Epic Games returned an error (${response.status}).`, response.status)
  return (await response.json()) as T
}

function pickImages(item: CatalogItem): Partial<Record<ArtKind, string>> {
  const images: Partial<Record<ArtKind, string>> = {}
  for (const [kind, preference] of Object.entries(IMAGE_PREFERENCES) as Array<[ArtKind, (typeof IMAGE_PREFERENCES)[ArtKind]]>) {
    const image = preference.types
      .map((type) => item.keyImages?.find((candidate) => candidate.type === type))
      .find(Boolean)
    if (!image) continue
    const resizable = new URL(image.url).host === 'cdn1.epicgames.com'
    images[kind] = resizable ? `${image.url}${image.url.includes('?') ? '&' : '?'}${preference.resize}&resize=1` : image.url
  }
  return images
}

export async function fetchLibraryRecords(token: string): Promise<EpicRecord[]> {
  const records = new Map<string, EpicRecord>()
  let cursor: string | undefined
  do {
    const params = new URLSearchParams({ includeMetadata: 'true' })
    if (cursor) params.set('cursor', cursor)
    const page = await get<LibraryItemsResponse>(`${LIBRARY_BASE}/items?${params}`, token)
    for (const record of page.records ?? []) {
      if (!record.appName || !record.namespace || !record.catalogItemId || NON_GAME_NAMESPACES.has(record.namespace)) continue
      if (record.sandboxType === 'PRIVATE') continue
      records.set(record.appName, {
        appName: record.appName,
        namespace: record.namespace,
        catalogItemId: record.catalogItemId
      })
    }
    cursor = page.responseMetadata?.nextCursor
  } while (cursor)
  return [...records.values()]
}

export async function fetchPlaytime(token: string, accountId: string): Promise<Record<string, number>> {
  const entries = await get<Array<{ artifactId?: string; totalTime?: number }>>(
    `${LIBRARY_BASE}/playtime/account/${encodeURIComponent(accountId)}/all`,
    token
  )
  const playtime: Record<string, number> = {}
  for (const entry of entries) {
    if (entry.artifactId && entry.totalTime) playtime[entry.artifactId] = Math.round(entry.totalTime / 60)
  }
  return playtime
}

async function fetchCatalogBatch(token: string, namespace: string, ids: string[]): Promise<Record<string, CatalogItem>> {
  const params = new URLSearchParams({
    includeDLCDetails: 'true',
    includeMainGameDetails: 'true',
    country: 'US',
    locale: 'en-US'
  })
  for (const id of ids) params.append('id', id)
  return get<Record<string, CatalogItem>>(`${CATALOG_BASE}/${encodeURIComponent(namespace)}/bulk/items?${params}`, token)
}

export async function fetchCatalog(token: string, records: EpicRecord[]): Promise<Map<string, CatalogEntry>> {
  const byNamespace = new Map<string, EpicRecord[]>()
  for (const record of records) {
    const group = byNamespace.get(record.namespace) ?? []
    group.push(record)
    byNamespace.set(record.namespace, group)
  }

  const batches: Array<{ namespace: string; records: EpicRecord[] }> = []
  for (const [namespace, group] of byNamespace) {
    for (let i = 0; i < group.length; i += CATALOG_BATCH) batches.push({ namespace, records: group.slice(i, i + CATALOG_BATCH) })
  }

  const entries = new Map<string, CatalogEntry>()
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < batches.length) {
      const batch = batches[next++]
      let items: Record<string, CatalogItem>
      try {
        items = await fetchCatalogBatch(token, batch.namespace, batch.records.map((record) => record.catalogItemId))
      } catch {
        continue
      }
      for (const record of batch.records) {
        const item = items[record.catalogItemId]
        if (!item) continue
        const categories = (item.categories ?? []).map((category) => category.path)
        entries.set(record.appName, {
          title: item.title ?? record.appName,
          isGame: !item.mainGameItem && categories.includes('games') && !categories.includes('addons'),
          desktop: hasDesktopRelease(item, record.appName),
          images: pickImages(item),
          fetchedAt: Date.now()
        })
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CATALOG_CONCURRENCY, batches.length) }, worker))
  return entries
}
