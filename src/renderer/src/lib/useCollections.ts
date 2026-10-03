import { useCallback, useEffect, useRef, useState } from 'react'
import type { Collection } from '../../../shared/types'

export interface CollectionsState {
  collections: Collection[]
  loaded: boolean
  create: (name: string, gameIds?: string[]) => Promise<string>
  rename: (id: string, name: string) => Promise<void>
  remove: (id: string) => Promise<void>
  setExpanded: (id: string, expanded: boolean) => Promise<void>
  toggleGame: (id: string, gameId: string) => Promise<void>
  removeGame: (id: string, gameId: string) => Promise<void>
}

function newId(): string {
  return crypto.randomUUID()
}

export function useCollections(onError: (message: string) => void): CollectionsState {
  const [collections, setCollections] = useState<Collection[]>([])
  const [loaded, setLoaded] = useState(false)
  const latest = useRef<Collection[]>([])
  const saving = useRef<Promise<unknown>>(Promise.resolve())

  useEffect(() => {
    let active = true
    window.portal
      .getCollections()
      .then((loaded) => {
        if (!active) return
        latest.current = loaded
        setCollections(loaded)
        setLoaded(true)
      })
      .catch(() => setLoaded(true))
    return () => {
      active = false
    }
  }, [])

  const update = useCallback(
    (change: (current: Collection[]) => Collection[]): Promise<void> => {
      const next = change(latest.current)
      latest.current = next
      setCollections(next)
      const save = saving.current
        .catch(() => undefined)
        .then(() => window.portal.saveCollections(next))
        .catch(() => onError('Could not save your collections.'))
      saving.current = save
      return save.then(() => undefined)
    },
    [onError]
  )

  const create = useCallback(
    async (name: string, gameIds: string[] = []) => {
      const id = newId()
      await update((current) => [...current, { id, name: name.trim(), gameIds, expanded: true }])
      return id
    },
    [update]
  )

  const map = (id: string, change: (collection: Collection) => Collection) => (current: Collection[]) =>
    current.map((collection) => (collection.id === id ? change(collection) : collection))

  return {
    collections,
    loaded,
    create,
    rename: useCallback((id, name) => update(map(id, (collection) => ({ ...collection, name: name.trim() }))), [update]),
    remove: useCallback((id) => update((current) => current.filter((collection) => collection.id !== id)), [update]),
    setExpanded: useCallback((id, expanded) => update(map(id, (collection) => ({ ...collection, expanded }))), [update]),
    toggleGame: useCallback(
      (id, gameId) =>
        update(
          map(id, (collection) => ({
            ...collection,
            gameIds: collection.gameIds.includes(gameId)
              ? collection.gameIds.filter((candidate) => candidate !== gameId)
              : [...collection.gameIds, gameId]
          }))
        ),
      [update]
    ),
    removeGame: useCallback(
      (id, gameId) =>
        update(map(id, (collection) => ({ ...collection, gameIds: collection.gameIds.filter((candidate) => candidate !== gameId) }))),
      [update]
    )
  }
}
