import { createHash } from 'crypto'
import { mkdir, readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import { net } from 'electron'
import { looksLikeImage } from './remoteArt'

const MISS_TTL_MS = 10 * 60 * 1000

export class AvatarCache {
  private readonly loads = new Map<string, Promise<Buffer | null>>()
  private readonly misses = new Map<string, number>()

  constructor(private readonly cacheDir: string) {}

  load(url: string): Promise<Buffer | null> {
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      return Promise.resolve(null)
    }
    if (parsed.protocol !== 'https:') return Promise.resolve(null)

    let load = this.loads.get(url)
    if (!load) {
      load = this.resolve(url).finally(() => this.loads.delete(url))
      this.loads.set(url, load)
    }
    return load
  }

  private async resolve(url: string): Promise<Buffer | null> {
    const path = join(this.cacheDir, `${createHash('sha1').update(url).digest('hex')}.img`)
    try {
      return await readFile(path)
    } catch {
      const missedAt = this.misses.get(url)
      if (missedAt && Date.now() - missedAt < MISS_TTL_MS) return null
    }

    try {
      const response = await net.fetch(url)
      const image = response.ok ? Buffer.from(await response.arrayBuffer()) : null
      if (!image || !looksLikeImage(image)) {
        this.misses.set(url, Date.now())
        return null
      }
      await mkdir(this.cacheDir, { recursive: true })
      await writeFile(path, image).catch(() => undefined)
      return image
    } catch {
      this.misses.set(url, Date.now())
      return null
    }
  }
}
