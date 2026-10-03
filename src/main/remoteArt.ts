import { mkdir, readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import { net } from 'electron'
import type { ArtKind } from '../shared/types'

const MISS_TTL_MS = 10 * 60 * 1000

function safeName(id: string): string {
  return id.replace(/[^A-Za-z0-9._-]/g, '_')
}

export function looksLikeImage(data: Buffer): boolean {
  if (data.length < 12) return false
  if (data[0] === 0xff && data[1] === 0xd8) return true
  if (data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return true
  return data.subarray(0, 4).toString('ascii') === 'RIFF' && data.subarray(8, 12).toString('ascii') === 'WEBP'
}

export class RemoteArt {
  private readonly loads = new Map<string, Promise<Buffer | null>>()
  private readonly misses = new Map<string, number>()

  constructor(
    private readonly cacheDir: string,
    private readonly resolveUrl: (id: string, kind: ArtKind) => string | null | Promise<string | null>
  ) { }

  load(id: string, kind: ArtKind): Promise<Buffer | null> {
    const key = `${id}/${kind}`
    let load = this.loads.get(key)
    if (!load) {
      load = this.resolve(id, kind, key).finally(() => this.loads.delete(key))
      this.loads.set(key, load)
    }
    return load
  }

  private async resolve(id: string, kind: ArtKind, key: string): Promise<Buffer | null> {
    const source = await this.resolveUrl(id, kind)
    if (source && !/^https?:\/\//i.test(source)) return readFile(source).catch(() => null)

    const dir = join(this.cacheDir, safeName(id))
    const path = join(dir, `${kind}.img`)
    const sourcePath = join(dir, `${kind}.src`)
    const cachedSource = await readFile(sourcePath, 'utf8').catch(() => null)
    if (!source || cachedSource === null || cachedSource === source) {
      try {
        return await readFile(path)
      } catch {
      }
    }
    const missedAt = this.misses.get(key)
    if (missedAt && Date.now() - missedAt < MISS_TTL_MS) return null

    const image = source ? await this.download(source) : null
    if (!image) {
      this.misses.set(key, Date.now())
      return null
    }
    try {
      await mkdir(dir, { recursive: true })
      await writeFile(path, image)
      if (source) await writeFile(sourcePath, source)
    } catch {
      return image
    }
    return image
  }

  private async download(url: string): Promise<Buffer | null> {
    try {
      const response = await net.fetch(url)
      if (!response.ok) return null
      const data = Buffer.from(await response.arrayBuffer())
      return looksLikeImage(data) ? data : null
    } catch {
      return null
    }
  }
}
