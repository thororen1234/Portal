import { useCallback, useEffect, useState } from 'react'
import type { LibrarySnapshot } from '../../../shared/types'
import { errorMessage } from './format'

export interface LibraryState {
  snapshot: LibrarySnapshot | null
  loading: boolean
  refreshing: boolean
  error: string | null
  refresh: () => Promise<void>
}

export function useLibrary(): LibraryState {
  const [snapshot, setSnapshot] = useState<LibrarySnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    window.portal
      .getLibrary()
      .then((next) => active && setSnapshot(next))
      .catch((reason: unknown) => active && setError(errorMessage(reason)))
      .finally(() => active && setLoading(false))
    const unsubscribe = window.portal.onLibraryChanged((next) => {
      setSnapshot(next)
      setError(null)
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  const refresh = useCallback(async () => {
    setRefreshing(true)
    try {
      setSnapshot(await window.portal.getLibrary({ refreshOwned: true }))
      setError(null)
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setRefreshing(false)
    }
  }, [])

  return { snapshot, loading, refreshing, error, refresh }
}
