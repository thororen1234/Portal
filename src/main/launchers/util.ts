import { execFile, spawn } from 'child_process'
import { DatabaseSync } from 'node:sqlite'
import { promisify } from 'util'
import { shell } from 'electron'
import { pathExists } from '../fsutil'
import { readRegistry } from '../registry'

const execFileAsync = promisify(execFile)

const UNINSTALL_KEYS = [
  'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall'
]

export interface UninstallEntry {
  key: string
  name: string
  displayName: string
  publisher: string
  installLocation: string
  uninstallString: string
  displayIcon: string
}

let uninstallCache: { at: number; entries: Promise<UninstallEntry[]> } | null = null

export function uninstallEntries(): Promise<UninstallEntry[]> {

  if (uninstallCache && Date.now() - uninstallCache.at < 5 * 60_000) return uninstallCache.entries
  const entries = (async () => {
    const results: UninstallEntry[] = []
    for (const root of UNINSTALL_KEYS) {
      for (const [key, values] of await readRegistry(root, true)) {
        if (!values.DisplayName) continue
        results.push({
          key,
          name: key.split('\\').pop() ?? key,
          displayName: values.DisplayName,
          publisher: values.Publisher ?? '',
          installLocation: (values.InstallLocation ?? '').replace(/^"|"$/g, ''),
          uninstallString: values.UninstallString ?? '',
          displayIcon: (values.DisplayIcon ?? '').replace(/^"|"$/g, '').replace(/,-?\d+$/, '')
        })
      }
    }
    return results
  })()
  uninstallCache = { at: Date.now(), entries }
  return entries
}

export function withDatabase<T>(path: string, read: (db: DatabaseSync) => T): T {
  const db = new DatabaseSync(path, { readOnly: true })
  try {
    return read(db)
  } finally {
    db.close()
  }
}

export async function readDatabase<T>(path: string, read: (db: DatabaseSync) => T): Promise<T | null> {
  if (!(await pathExists(path))) return null
  try {
    return withDatabase(path, read)
  } catch (error) {
    console.error(`Could not read ${path}:`, error)
    return null
  }
}

export async function openUri(uri: string): Promise<void> {
  await shell.openExternal(uri)
}

export function launchDetached(command: string, args: string[] = [], cwd?: string): void {
  spawn(command, args, { cwd, detached: true, stdio: 'ignore', windowsHide: false }).unref()
}

export function splitCommandLine(command: string): [string, string[]] {
  const parts = [...command.matchAll(/"([^"]*)"|(\S+)/g)].map((match) => match[1] ?? match[2])
  return [parts[0] ?? '', parts.slice(1)]
}

export function runCommandLine(command: string, cwd?: string): void {
  const [program, args] = splitCommandLine(command)
  if (!program) throw new Error('This game has no uninstall command.')
  launchDetached(program, args, cwd)
}

export async function runPowerShell(script: string): Promise<string> {
  const { stdout } = await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
    { windowsHide: true, maxBuffer: 16 * 1024 * 1024 }
  )
  return stdout
}

export async function firstExisting(paths: Array<string | null | undefined>): Promise<string | null> {
  for (const path of paths) if (path && (await pathExists(path))) return path
  return null
}

export function unsupported(): never {
  throw new Error('That action is not available for this launcher.')
}
