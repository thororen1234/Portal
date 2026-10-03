import { readdir, readFile } from 'fs/promises'
import { homedir } from 'os'
import { join } from 'path'
import { pathExists } from '../fsutil'

export interface EpicInstalledGame {
  appName: string
  displayName: string
  namespace: string
  catalogItemId: string
  installLocation: string
  installSize: number
  incomplete: boolean
}

interface EpicManifest {
  AppName?: string
  DisplayName?: string
  CatalogNamespace?: string
  CatalogItemId?: string
  MainGameAppName?: string
  InstallLocation?: string
  InstallSize?: number
  AppCategories?: string[]
  bIsIncompleteInstall?: boolean
}

export function epicDataDir(): string | null {
  switch (process.platform) {
    case 'win32':
      return join(process.env.ProgramData ?? 'C:\\ProgramData', 'Epic', 'EpicGamesLauncher', 'Data')
    case 'darwin':
      return join(homedir(), 'Library', 'Application Support', 'Epic', 'EpicGamesLauncher', 'Data')
    default:
      return null
  }
}

export async function epicManifestsDir(): Promise<string | null> {
  const dataDir = epicDataDir()
  return dataDir && (await pathExists(dataDir)) ? join(dataDir, 'Manifests') : null
}

function isMainGame(manifest: EpicManifest): boolean {
  const appName = manifest.AppName
  if (!appName || !manifest.AppCategories?.includes('games')) return false
  return !manifest.MainGameAppName || manifest.MainGameAppName === appName
}

async function readManifests(dir: string): Promise<EpicManifest[]> {
  let files: string[]
  try {
    files = (await readdir(dir)).filter((file) => file.toLowerCase().endsWith('.item'))
  } catch {
    return []
  }
  const manifests = await Promise.all(
    files.map(async (file) => {
      try {
        return JSON.parse(await readFile(join(dir, file), 'utf8')) as EpicManifest
      } catch {
        return null
      }
    })
  )
  return manifests.filter((manifest): manifest is EpicManifest => manifest !== null)
}

export async function readInstalledEpicGames(manifestsDir: string): Promise<EpicInstalledGame[]> {
  const [installed, pending] = await Promise.all([
    readManifests(manifestsDir),
    readManifests(join(manifestsDir, 'Pending'))
  ])
  const games = new Map<string, EpicInstalledGame>()
  for (const [manifest, isPending] of [
    ...installed.map((manifest) => [manifest, false] as const),
    ...pending.map((manifest) => [manifest, true] as const)
  ]) {
    if (!isMainGame(manifest) || games.has(manifest.AppName!)) continue
    games.set(manifest.AppName!, {
      appName: manifest.AppName!,
      displayName: manifest.DisplayName || manifest.AppName!,
      namespace: manifest.CatalogNamespace ?? '',
      catalogItemId: manifest.CatalogItemId ?? '',
      installLocation: manifest.InstallLocation ?? '',
      installSize: manifest.InstallSize ?? 0,
      incomplete: isPending || manifest.bIsIncompleteInstall === true
    })
  }
  return [...games.values()]
}
