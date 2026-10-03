import type { LibrarySource } from '../shared/types'
import { inBackoff, isFresh, nextFailure, REMOTE_TTL_MS, type FetchFailure } from './fetchPolicy'
import { errorMessage, readJson, writeJson } from './fsutil'

interface Entry<T> {
  fetchedAt: number
  data: T
}

export interface CachedResult<T> {
  data: T | null
  source: LibrarySource
  fetchedAt: number | null
  error: string | null
}

export class AccountCache<T> {
  private entries: Record<string, Entry<T>> | null = null
  private readonly requests = new Map<string, Promise<T>>()
  private readonly failures = new Map<string, FetchFailure>()

  constructor(
    private readonly file: string,
    private readonly ttlMs = REMOTE_TTL_MS
  ) {}

  async get(accountId: string, force: boolean, download: () => Promise<T>): Promise<CachedResult<T>> {
    const entries = await this.load()
    const cached = entries[accountId] ?? null
    const fromCache = (error: string | null, source: LibrarySource = 'cache'): CachedResult<T> => ({
      data: cached?.data ?? null,
      source: cached ? source : 'none',
      fetchedAt: cached?.fetchedAt ?? null,
      error
    })

    if (isFresh(cached?.fetchedAt, force, this.ttlMs)) return fromCache(null, 'live')
    const failure = this.failures.get(accountId)
    if (inBackoff(failure, force, this.ttlMs)) return fromCache(failure!.message)

    try {
      let request = this.requests.get(accountId)
      if (!request) {
        request = download().finally(() => this.requests.delete(accountId))
        this.requests.set(accountId, request)
      }
      const data = await request
      const entry = { fetchedAt: Date.now(), data }
      entries[accountId] = entry
      this.failures.delete(accountId)
      await this.save()
      return { data, source: 'live', fetchedAt: entry.fetchedAt, error: null }
    } catch (error) {
      const message = errorMessage(error)
      this.failures.set(accountId, nextFailure(failure, message))
      return fromCache(message)
    }
  }

  async forget(accountId: string): Promise<void> {
    const entries = await this.load()
    delete entries[accountId]
    this.failures.delete(accountId)
    await this.save()
  }

  private async load(): Promise<Record<string, Entry<T>>> {
    this.entries ??= (await readJson<Record<string, Entry<T>>>(this.file)) ?? {}
    return this.entries
  }

  private async save(): Promise<void> {
    if (!this.entries) return
    await writeJson(this.file, this.entries).catch((error) => console.error(`Could not save ${this.file}:`, error))
  }
}
