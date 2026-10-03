import { mkdir } from 'fs/promises'
import { join } from 'path'
import { errorMessage, readJson, writeJson } from './fsutil'

const FAILURE_BACKOFF_MS = 10 * 60 * 1000

interface Entry<T> {
  fetchedAt: number
  data: T
}

export interface CachedResult<T> {
  data: T | null
  fetchedAt: number | null
  error: string | null
}

function safeKey(key: string): string {
  return key.replace(/[^A-Za-z0-9._-]/g, '_')
}

export class DiskCache<T> {
  private readonly memory = new Map<string, Entry<T>>()
  private readonly loads = new Map<string, Promise<CachedResult<T>>>()
  private readonly failures = new Map<string, { at: number; message: string }>()

  constructor(
    private readonly dir: string,
    private readonly ttlMs: number
  ) { }

  async peek(key: string): Promise<Entry<T> | null> {
    const cached = this.memory.get(key)
    if (cached) return cached
    const stored = await readJson<Entry<T>>(join(this.dir, `${safeKey(key)}.json`))
    if (stored && typeof stored.fetchedAt === 'number') {
      this.memory.set(key, stored)
      return stored
    }
    return null
  }

  get(key: string, load: () => Promise<T>, options: { maxAgeMs?: number } = {}): Promise<CachedResult<T>> {
    let pending = this.loads.get(key)
    if (!pending) {
      pending = this.resolve(key, load, options.maxAgeMs ?? this.ttlMs).finally(() => this.loads.delete(key))
      this.loads.set(key, pending)
    }
    return pending
  }

  private async resolve(key: string, load: () => Promise<T>, maxAgeMs: number): Promise<CachedResult<T>> {
    const cached = await this.peek(key)
    if (cached && Date.now() - cached.fetchedAt < maxAgeMs) return { data: cached.data, fetchedAt: cached.fetchedAt, error: null }

    const failure = this.failures.get(key)
    if (failure && Date.now() - failure.at < FAILURE_BACKOFF_MS) {
      return { data: cached?.data ?? null, fetchedAt: cached?.fetchedAt ?? null, error: failure.message }
    }

    try {
      const entry: Entry<T> = { fetchedAt: Date.now(), data: await load() }
      this.memory.set(key, entry)
      this.failures.delete(key)
      await mkdir(this.dir, { recursive: true })
      await writeJson(join(this.dir, `${safeKey(key)}.json`), entry).catch((error) =>
        console.error(`Could not cache ${key}:`, error)
      )
      return { data: entry.data, fetchedAt: entry.fetchedAt, error: null }
    } catch (error) {
      const message = errorMessage(error)
      this.failures.set(key, { at: Date.now(), message })
      return { data: cached?.data ?? null, fetchedAt: cached?.fetchedAt ?? null, error: message }
    }
  }
}
