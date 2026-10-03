import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

export type RegistryKeys = Map<string, Record<string, string>>

export async function readRegistry(key: string, recursive = false): Promise<RegistryKeys> {
  const keys: RegistryKeys = new Map()
  if (process.platform !== 'win32') return keys
  let stdout: string
  try {
    ;({ stdout } = await execFileAsync('reg', ['query', key, ...(recursive ? ['/s'] : [])], {
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024
    }))
  } catch {
    return keys
  }

  let current: Record<string, string> | null = null
  for (const line of stdout.split(/\r?\n/)) {
    if (/^HKEY_/i.test(line)) {
      current = {}
      keys.set(line.trim(), current)
      continue
    }
    const match = /^\s{4}(.*?)\s{4}(REG_[A-Z_]+)(?:\s{4}(.*))?$/.exec(line)
    if (match && current) current[match[1] === '(Default)' ? '' : match[1]] = match[3] ?? ''
  }
  return keys
}

export async function registryValue(key: string, name: string): Promise<string | null> {
  const keys = await readRegistry(key)
  for (const values of keys.values()) if (name in values) return values[name]
  return null
}
