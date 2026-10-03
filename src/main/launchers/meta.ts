import { copyFile, mkdir, readdir, readFile, rm } from 'fs/promises'
import { join } from 'path'
import { app } from 'electron'
import type { GameAction } from '../../shared/types'
import { pathExists } from '../fsutil'
import { readRegistry, registryValue } from '../registry'
import type { LauncherGame, LauncherIntegration } from './types'
import { launchDetached, unsupported, withDatabase } from './util'

const LIBRARIES_KEY = 'HKCU\\Software\\Oculus VR, LLC\\Oculus\\Libraries'
const BASE_KEY = 'HKLM\\SOFTWARE\\WOW6432Node\\Oculus VR, LLC\\Oculus'
const SESSIONS = join(process.env.APPDATA ?? '', 'Oculus', 'sessions')

interface Manifest {
  appId?: string
  canonicalName?: string
  packageType?: string
  isCore?: boolean
  launchFile?: string
  launchParameters?: string | null
}

interface AppInfo {
  name: string
  canonicalName: string | null
  description: string | null
}

async function baseDir(): Promise<string | null> {
  const base = await registryValue(BASE_KEY, 'Base')
  return base && (await pathExists(base)) ? base : null
}

async function libraryRoots(): Promise<string[]> {
  const roots: string[] = []
  for (const values of (await readRegistry(LIBRARIES_KEY, true)).values()) {
    const path = values.OriginalPath
    if (path && (await pathExists(path))) roots.push(path)
  }
  return roots
}

function readField(blob: Buffer, field: string): string | null {
  const marker = Buffer.concat([Buffer.from(field, 'latin1'), Buffer.from([1, 1])])
  const at = blob.indexOf(marker)
  if (at < 0 || at + marker.length + 8 > blob.length) return null
  const length = Number(blob.readBigUInt64LE(at + marker.length))
  const start = at + marker.length + 8
  if (length <= 0 || length > 4096 || start + length > blob.length) return null
  return blob.subarray(start, start + length).toString('utf8')
}

async function appInfo(): Promise<Map<string, AppInfo>> {
  const info = new Map<string, AppInfo>()
  let sessions: string[]
  try {
    sessions = await readdir(SESSIONS)
  } catch {
    return info
  }
  const temp = join(app.getPath('temp'), `portal-oculus-${process.pid}`)
  await mkdir(temp, { recursive: true })
  try {
    for (const session of sessions) {
      const source = join(SESSIONS, session, 'data.sqlite')
      if (!(await pathExists(source))) continue
      const copy = join(temp, 'data.sqlite')
      await copyFile(source, copy)
      if (await pathExists(`${source}-wal`)) await copyFile(`${source}-wal`, `${copy}-wal`)
      else await rm(`${copy}-wal`, { force: true })
      try {
        withDatabase(copy, (db) => {
          const rows = db.prepare("SELECT hashkey, value FROM Objects WHERE typename = 'Application'").all() as Array<{
            hashkey: string
            value: Uint8Array
          }>
          for (const row of rows) {
            const blob = Buffer.from(row.value)
            const name = readField(blob, 'display_name')
            if (!name || info.has(row.hashkey)) continue
            info.set(row.hashkey, {
              name,
              canonicalName: readField(blob, 'canonical_name'),
              description: readField(blob, 'display_long_description') ?? readField(blob, 'display_short_description')
            })
          }
        })
      } catch (error) {
        console.error('Could not read the Meta app database:', error)
      }
    }
  } finally {
    await rm(temp, { recursive: true, force: true }).catch(() => undefined)
  }
  return info
}

function isSystemApp(canonicalName: string): boolean {
  return /^oculus-/i.test(canonicalName)
}

function storeAsset(base: string | null, canonicalName: string, file: string): string | undefined {
  return base ? join(base, 'CoreData', 'Software', 'StoreAssets', `${canonicalName}_assets`, file) : undefined
}

export const meta: LauncherIntegration = {
  id: 'meta',

  async detect() {
    return (await baseDir()) !== null
  },

  async games() {
    const [base, roots, info] = await Promise.all([baseDir(), libraryRoots(), appInfo()])
    const games = new Map<string, LauncherGame>()

    for (const root of roots) {
      let files: string[]
      try {
        files = (await readdir(join(root, 'Manifests'))).filter((file) => file.endsWith('.json') && !file.endsWith('_assets.json'))
      } catch {
        continue
      }
      for (const file of files) {
        let manifest: Manifest
        try {
          manifest = JSON.parse(await readFile(join(root, 'Manifests', file), 'utf8')) as Manifest
        } catch {
          continue
        }
        if (!manifest.appId || !manifest.canonicalName || manifest.isCore || manifest.packageType !== 'APP') continue
        if (isSystemApp(manifest.canonicalName)) continue
        const installPath = join(root, 'Software', manifest.canonicalName)
        if (!(await pathExists(installPath))) continue
        const known = info.get(manifest.appId)
        games.set(manifest.appId, {
          appId: manifest.appId,
          name: known?.name ?? manifest.canonicalName,
          installed: true,
          installPath,
          extra: {
            canonicalName: manifest.canonicalName,
            ...(manifest.launchFile ? { exe: join(installPath, manifest.launchFile) } : {}),
            ...(manifest.launchParameters ? { args: manifest.launchParameters } : {})
          }
        })
      }
    }

    for (const [appId, known] of info) {
      if (games.has(appId) || !known.canonicalName || isSystemApp(known.canonicalName)) continue
      games.set(appId, { appId, name: known.name, installed: false, installPath: null, extra: { canonicalName: known.canonicalName } })
    }

    for (const game of games.values()) {
      const canonicalName = game.extra?.canonicalName
      const known = info.get(game.appId)
      if (canonicalName) {
        game.art = {
          cover: storeAsset(base, canonicalName, 'cover_square_image.jpg'),
          header: storeAsset(base, canonicalName, 'cover_landscape_image_large.png'),
          hero: storeAsset(base, canonicalName, 'cover_landscape_image_large.png'),
          logo: storeAsset(base, canonicalName, 'logo_transparent_image.png'),
          icon: storeAsset(base, canonicalName, 'icon_image.jpg')
        }
      }
      if (known?.description) {
        game.overview = {
          shortDescription: null,
          description: known.description,
          developers: [],
          publishers: [],
          releaseDate: null,
          genres: [],
          website: null
        }
      }
    }
    return [...games.values()]
  },

  async open() {
    const base = await baseDir()
    const client = base ? join(base, 'Support', 'oculus-client', 'OculusClient.exe') : null
    if (!client || !(await pathExists(client))) throw new Error('The Meta Quest Link app is not installed.')
    launchDetached(client)
  },

  async run(game: LauncherGame, action: GameAction) {
    switch (action) {
      case 'play':
        if (!game.extra?.exe) throw new Error('Could not find this games executable.')
        return launchDetached(game.extra.exe, game.extra.args ? game.extra.args.split(' ') : [], game.installPath ?? undefined)
      case 'install':
      case 'downloads': {
        const base = await baseDir()
        const client = base ? join(base, 'Support', 'oculus-client', 'OculusClient.exe') : null
        if (!client || !(await pathExists(client))) throw new Error('The Meta Quest Link app is not installed.')
        return launchDetached(client)
      }
      default:
        return unsupported()
    }
  }
}
