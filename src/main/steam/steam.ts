import { execFile } from 'child_process'
import { readdir, readFile } from 'fs/promises'
import { homedir } from 'os'
import { join, normalize } from 'path'
import { promisify } from 'util'
import type { InstallState, SteamUser } from '../../shared/types'
import { pathExists } from '../fsutil'
import { child, int, parseVdf, text } from './vdf'

const execFileAsync = promisify(execFile)

const STEAM_ID64_BASE = 76561197960265728n

const HIDDEN_APP_IDS = new Set([228980, 1070560, 1391110, 1628350, 1493710, 2180100, 1826330, 1161040])
const HIDDEN_APP_NAMES = /^(Steamworks Common Redistributables|Steam Linux Runtime|Proton\b)/i

const Flag = {
  UpdateRequired: 2,
  FullyInstalled: 4,
  UpdateRunning: 256,
  UpdatePaused: 512,
  Uninstalling: 2048,
  Validating: 131072,
  AddingFiles: 262144,
  Preallocating: 524288,
  Downloading: 1048576,
  Staging: 2097152,
  Committing: 4194304
} as const

const ACTIVE_FLAGS =
  Flag.UpdateRunning |
  Flag.Validating |
  Flag.AddingFiles |
  Flag.Preallocating |
  Flag.Downloading |
  Flag.Staging |
  Flag.Committing

export interface InstalledApp {
  appId: number
  name: string
  state: InstallState
  progress: number | null
  sizeOnDisk: number
  installPath: string
  lastPlayed: number | null
}

export interface LocalPlaytime {
  playtimeMinutes: number
  lastPlayed: number
}

async function registrySteamPath(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('reg', ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath'], {
      windowsHide: true
    })
    const match = /SteamPath\s+REG_SZ\s+(.+)/.exec(stdout)
    return match ? normalize(match[1].trim()) : null
  } catch {
    return null
  }
}

function defaultSteamPaths(): string[] {
  const home = homedir()
  switch (process.platform) {
    case 'win32':
      return ['C:\\Program Files (x86)\\Steam', 'C:\\Program Files\\Steam']
    case 'darwin':
      return [join(home, 'Library', 'Application Support', 'Steam')]
    default:
      return [
        join(home, '.steam', 'steam'),
        join(home, '.local', 'share', 'Steam'),
        join(home, '.var', 'app', 'com.valvesoftware.Steam', '.local', 'share', 'Steam')
      ]
  }
}

export async function locateSteam(override: string): Promise<string | null> {
  const candidates = [
    override || null,
    process.platform === 'win32' ? await registrySteamPath() : null,
    ...defaultSteamPaths()
  ]
  for (const candidate of candidates) {
    if (candidate && (await pathExists(join(candidate, 'steamapps')))) return normalize(candidate)
  }
  return null
}

function pathKey(path: string): string {
  return process.platform === 'win32' ? path.toLowerCase() : path
}

export async function readLibraryFolders(steamPath: string): Promise<string[]> {
  const folders = new Map<string, string>()
  const add = (path: string): void => {
    const normalized = normalize(path)
    folders.set(pathKey(normalized), normalized)
  }
  add(steamPath)
  try {
    const root = parseVdf(await readFile(join(steamPath, 'steamapps', 'libraryfolders.vdf'), 'utf8'))
    for (const [key, value] of Object.entries(child(root, 'libraryfolders') ?? {})) {
      if (!/^\d+$/.test(key)) continue
      const path = typeof value === 'string' ? value : text(value, 'path')
      if (path) add(path)
    }
  } catch {
    return [...folders.values()]
  }
  return [...folders.values()]
}

function stateFromFlags(flags: number): InstallState {
  if (flags & Flag.Uninstalling) return 'uninstalling'
  if (flags & Flag.UpdatePaused) return 'paused'
  if (flags & ACTIVE_FLAGS) return 'downloading'
  if (flags & Flag.UpdateRequired) return flags & Flag.FullyInstalled ? 'update-required' : 'queued'
  if (flags & Flag.FullyInstalled) return 'installed'
  return 'queued'
}

function isHiddenApp(appId: number, name: string): boolean {
  return HIDDEN_APP_IDS.has(appId) || HIDDEN_APP_NAMES.test(name)
}

async function readManifest(steamapps: string, file: string): Promise<InstalledApp | null> {
  try {
    const state = child(parseVdf(await readFile(join(steamapps, file), 'utf8')), 'appstate')
    const appId = int(state, 'appid')
    if (!state || !Number.isInteger(appId) || appId <= 0) return null
    const name = text(state, 'name') || `App ${appId}`
    if (isHiddenApp(appId, name)) return null

    const installState = stateFromFlags(int(state, 'stateflags'))
    const bytesToDownload = int(state, 'bytestodownload')
    const bytesDownloaded = int(state, 'bytesdownloaded')
    const showsProgress = installState !== 'installed' && installState !== 'uninstalling' && bytesToDownload > 0

    return {
      appId,
      name,
      state: installState,
      progress: showsProgress ? Math.min(1, bytesDownloaded / bytesToDownload) : null,
      sizeOnDisk: int(state, 'sizeondisk'),
      installPath: join(steamapps, 'common', text(state, 'installdir') ?? ''),
      lastPlayed: int(state, 'lastplayed') || null
    }
  } catch {
    return null
  }
}

async function readLibraryApps(libraryPath: string): Promise<InstalledApp[]> {
  const steamapps = join(libraryPath, 'steamapps')
  let files: string[]
  try {
    files = await readdir(steamapps)
  } catch {
    return []
  }
  const manifests = files.filter((file) => /^appmanifest_\d+\.acf$/i.test(file))
  const apps = await Promise.all(manifests.map((file) => readManifest(steamapps, file)))
  return apps.filter((app): app is InstalledApp => app !== null)
}

export async function readInstalledApps(libraries: string[]): Promise<InstalledApp[]> {
  const byLibrary = await Promise.all(libraries.map(readLibraryApps))
  const apps = new Map<number, InstalledApp>()
  for (const app of byLibrary.flat()) {
    if (!apps.has(app.appId)) apps.set(app.appId, app)
  }
  return [...apps.values()]
}

export async function detectSteamUser(steamPath: string): Promise<SteamUser | null> {
  try {
    const root = parseVdf(await readFile(join(steamPath, 'config', 'loginusers.vdf'), 'utf8'))
    let best: { user: SteamUser; mostRecent: boolean; timestamp: number } | null = null
    for (const [steamId, value] of Object.entries(child(root, 'users') ?? {})) {
      if (!/^\d{17}$/.test(steamId) || typeof value === 'string') continue
      const candidate = {
        user: { steamId, accountName: text(value, 'accountname') ?? '', personaName: text(value, 'personaname') ?? '' },
        mostRecent: text(value, 'mostrecent') === '1' || text(value, 'autologin') === '1',
        timestamp: int(value, 'timestamp')
      }
      if (
        !best ||
        (candidate.mostRecent && !best.mostRecent) ||
        (candidate.mostRecent === best.mostRecent && candidate.timestamp > best.timestamp)
      ) {
        best = candidate
      }
    }
    return best?.user ?? null
  } catch {
    return null
  }
}

export function steamIdFromAccountId(accountId: number): string {
  return (BigInt(accountId) + STEAM_ID64_BASE).toString()
}

export function localConfigPath(steamPath: string, steamId: string): string {
  const accountId = (BigInt(steamId) - STEAM_ID64_BASE).toString()
  return join(steamPath, 'userdata', accountId, 'config', 'localconfig.vdf')
}

export async function readLocalPlaytime(path: string): Promise<Map<number, LocalPlaytime>> {
  const root = parseVdf(await readFile(path, 'utf8'))
  const apps = child(root, 'userlocalconfigstore', 'software', 'valve', 'steam', 'apps')
  const result = new Map<number, LocalPlaytime>()
  for (const [id, value] of Object.entries(apps ?? {})) {
    const appId = Number(id)
    if (!Number.isInteger(appId) || appId <= 0 || typeof value === 'string') continue
    result.set(appId, { playtimeMinutes: int(value, 'playtime'), lastPlayed: int(value, 'lastplayed') })
  }
  return result
}
