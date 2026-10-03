import { readdir, readFile, stat } from 'fs/promises'
import { basename, join, normalize } from 'path'
import { parse } from 'yaml'
import type { ArtKind } from '../../shared/types'
import { pathExists } from '../fsutil'
import { readRegistry, registryValue } from '../registry'

const LAUNCHER_KEY = 'HKLM\\SOFTWARE\\WOW6432Node\\Ubisoft\\Launcher'
const INSTALLS_KEYS = [`${LAUNCHER_KEY}\\Installs`, 'HKLM\\SOFTWARE\\Ubisoft\\Launcher\\Installs']
const ASSET_BASE = 'https://ubistatic3-a.akamaihd.net/orbit/uplay_launcher_3_0/assets/'

export interface UbisoftInstalledGame {
  productId: string
  installPath: string
  folderName: string
}

export interface UbisoftCatalogEntry {
  productId: string
  spaceId: string | null
  name: string
  playable: boolean
  images: Partial<Record<ArtKind, string>>
}

interface ProductYaml {
  root?: {
    name?: string
    space_id?: string
    thumb_image?: string
    background_image?: string
    start_game?: unknown
    is_ulc?: boolean
    third_party_platform?: unknown
    addons?: Array<{ id?: number }>
  }
  localizations?: { default?: Record<string, string> }
}

export async function ubisoftLauncherDir(): Promise<string | null> {
  const dir = await registryValue(LAUNCHER_KEY, 'InstallDir')
  return dir && (await pathExists(dir)) ? normalize(dir) : null
}

export async function readInstalledUbisoftGames(): Promise<UbisoftInstalledGame[]> {
  const games = new Map<string, UbisoftInstalledGame>()
  for (const key of INSTALLS_KEYS) {
    for (const [path, values] of await readRegistry(key, true)) {
      const productId = /\\(\d+)$/.exec(path)?.[1]
      const installDir = values.InstallDir?.trim()
      if (!productId || !installDir || games.has(productId)) continue
      const installPath = normalize(installDir.replace(/\//g, '\\')).replace(/\\$/, '')
      if (!(await pathExists(installPath))) continue
      games.set(productId, { productId, installPath, folderName: basename(installPath) })
    }
  }
  return [...games.values()]
}

function varint(buffer: Buffer, cursor: { offset: number }): number {
  let result = 0
  let shift = 0
  let byte: number
  do {
    byte = buffer[cursor.offset++]
    result += (byte & 0x7f) * 2 ** shift
    shift += 7
  } while (byte & 0x80 && cursor.offset < buffer.length)
  return result
}

function protobufFields(buffer: Buffer): Array<[number, number | Buffer]> {
  const cursor = { offset: 0 }
  const fields: Array<[number, number | Buffer]> = []
  while (cursor.offset < buffer.length) {
    const key = varint(buffer, cursor)
    const field = Math.floor(key / 8)
    const wireType = key & 7
    if (wireType === 0) {
      fields.push([field, varint(buffer, cursor)])
    } else if (wireType === 2) {
      const length = varint(buffer, cursor)
      fields.push([field, buffer.subarray(cursor.offset, cursor.offset + length)])
      cursor.offset += length
    } else if (wireType === 5) {
      fields.push([field, buffer.readUInt32LE(cursor.offset)])
      cursor.offset += 4
    } else if (wireType === 1) {
      cursor.offset += 8
    } else {
      throw new Error(`Unsupported protobuf wire type ${wireType}`)
    }
  }
  return fields
}

function cacheDirs(launcherDir: string | null): string[] {
  return [
    launcherDir && join(launcherDir, 'cache'),
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Ubisoft Game Launcher', 'cache')
  ].filter((path): path is string => Boolean(path))
}

async function newestPath(candidates: string[]): Promise<{ path: string; mtimeMs: number } | null> {
  let newest: { path: string; mtimeMs: number } | null = null
  for (const path of candidates) {
    try {
      const { mtimeMs } = await stat(path)
      if (!newest || mtimeMs > newest.mtimeMs) newest = { path, mtimeMs }
    } catch {
      continue
    }
  }
  return newest
}

async function newestCachePath(launcherDir: string | null): Promise<string | null> {
  return (await newestPath(cacheDirs(launcherDir).map((dir) => join(dir, 'configuration', 'configurations'))))?.path ?? null
}

async function ownershipPath(launcherDir: string | null, userId: string | null): Promise<string | null> {
  const candidates: string[] = []
  for (const dir of cacheDirs(launcherDir).map((cache) => join(cache, 'ownership'))) {
    if (userId) {
      candidates.push(join(dir, userId))
      continue
    }
    try {
      for (const file of await readdir(dir)) if (/^[0-9a-f-]{36}$/i.test(file)) candidates.push(join(dir, file))
    } catch {
      continue
    }
  }
  return (await newestPath(candidates))?.path ?? null
}

export async function readUbisoftOwnership(launcherDir: string | null, userId: string | null): Promise<Set<string>> {
  const owned = new Set<string>()
  const path = await ownershipPath(launcherDir, userId)
  if (!path) return owned
  try {
    const records = protobufFields((await readFile(path)).subarray(0x108))
    for (const [field, value] of records) {
      if (field !== 1 || !Buffer.isBuffer(value)) continue
      for (const [inner, id] of protobufFields(value)) {
        if ((inner === 1 || inner === 2) && typeof id === 'number' && id > 0) owned.add(String(id))
      }
    }
  } catch (error) {
    console.error('Could not read the Ubisoft Connect ownership cache:', error)
  }
  return owned
}

export async function readUbisoftCatalog(launcherDir: string | null): Promise<{ path: string | null; mtimeMs: number; entries: Map<string, UbisoftCatalogEntry> }> {
  const entries = new Map<string, UbisoftCatalogEntry>()
  const path = await newestCachePath(launcherDir)
  if (!path) return { path, mtimeMs: 0, entries }

  const { mtimeMs } = await stat(path)
  const records = protobufFields(await readFile(path))
    .filter(([field, value]) => field === 1 && Buffer.isBuffer(value))
    .map(([, value]) => {
      const record: Record<number, number | Buffer> = {}
      for (const [field, inner] of protobufFields(value as Buffer)) record[field] = inner
      return record
    })

  const addonIds = new Set<string>()
  const parsed: Array<{ productId: string; doc: ProductYaml }> = []
  for (const record of records) {
    const yaml = record[3]
    if (typeof record[1] !== 'number' || !Buffer.isBuffer(yaml)) continue
    try {
      const doc = parse(yaml.toString('utf8')) as ProductYaml
      for (const addon of doc?.root?.addons ?? []) if (addon.id) addonIds.add(String(addon.id))
      parsed.push({ productId: String(record[1]), doc })
    } catch {
      continue
    }
  }

  for (const { productId, doc } of parsed) {
    const root = doc?.root
    if (!root) continue
    const localized = doc.localizations?.default ?? {}
    const text = (value?: string): string | undefined => (value && localized[value]) || value
    const asset = (value?: string): string | undefined => {
      const file = text(value)
      return file ? ASSET_BASE + file : undefined
    }
    const name = text(root.name)?.trim()
    if (!name) continue
    const background = asset(root.background_image)
    entries.set(productId, {
      productId,
      spaceId: root.space_id ?? null,
      name,
      playable: Boolean(root.start_game) && !root.is_ulc && !root.third_party_platform && !addonIds.has(productId),
      images: { cover: asset(root.thumb_image), header: background, hero: background }
    })
  }
  return { path, mtimeMs, entries }
}
