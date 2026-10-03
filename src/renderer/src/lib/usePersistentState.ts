import { useCallback, useState } from 'react'

const PREFIX = 'portal:'

function read<T extends string>(key: string, fallback: T, allowed: readonly T[]): T {
  try {
    const stored = window.localStorage.getItem(PREFIX + key)
    return stored !== null && (allowed as readonly string[]).includes(stored) ? (stored as T) : fallback
  } catch {
    return fallback
  }
}

export function usePersistentChoice<T extends string>(
  key: string,
  fallback: T,
  allowed: readonly T[]
): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => read(key, fallback, allowed))
  const update = useCallback(
    (next: T) => {
      setValue(next)
      try {
        window.localStorage.setItem(PREFIX + key, next)
      } catch {

      }
    },
    [key]
  )
  return [value, update]
}
