export const REMOTE_TTL_MS = 30 * 60 * 1000
export const REMOTE_RETRY_MS = 60 * 1000
                                                                                                               
export const MIN_FORCED_REFRESH_MS = 2 * 60 * 1000

export interface FetchFailure {
  at: number
  message: string
  attempts: number
}

                                                                                                         
export function isFresh(fetchedAt: number | null | undefined, force: boolean, ttlMs = REMOTE_TTL_MS): boolean {
  if (!fetchedAt) return false
  return Date.now() - fetchedAt < (force ? MIN_FORCED_REFRESH_MS : ttlMs)
}

                                                                                                                            
export function inBackoff(failure: FetchFailure | null | undefined, force: boolean, ttlMs = REMOTE_TTL_MS): boolean {
  if (!failure) return false
  const backoff = force ? REMOTE_RETRY_MS : Math.min(REMOTE_RETRY_MS * 2 ** (failure.attempts - 1), ttlMs)
  return Date.now() - failure.at < backoff
}

export function nextFailure(previous: FetchFailure | null | undefined, message: string): FetchFailure {
  return { at: Date.now(), message, attempts: (previous?.attempts ?? 0) + 1 }
}
