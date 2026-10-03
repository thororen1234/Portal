const DAY_MS = 86_400_000

export function formatPlaytime(minutes: number | null): string {
  if (!minutes) return 'None yet'
  if (minutes < 60) return `${minutes} min`
  const hours = minutes / 60
  return `${hours < 10 ? hours.toFixed(1) : Math.round(hours).toLocaleString()} hrs`
}

export function formatLastPlayed(seconds: number | null): string {
  if (!seconds) return 'Never'
  const date = new Date(seconds * 1000)
  const startOfToday = new Date().setHours(0, 0, 0, 0)
  const days = Math.ceil((startOfToday - date.getTime()) / DAY_MS)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days} days ago`
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

export function formatBytes(bytes: number | null): string {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value.toFixed(value < 10 && unit > 0 ? 1 : 0)} ${units[unit]}`
}

export function formatPercent(progress: number): string {
  return `${Math.floor(progress * 100)}%`
}

export function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '')
}
