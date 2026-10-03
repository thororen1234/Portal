import { join } from 'path'
import type { GameAction, GameOverview } from '../../shared/types'
import { pathExists } from '../fsutil'
import type { LauncherGame, LauncherIntegration } from './types'
import { launchDetached, openUri, readDatabase, unsupported } from './util'

const ROOT = join(process.env.LOCALAPPDATA ?? '', 'Amazon Games')
const SQL_DIR = join(ROOT, 'Data', 'Games', 'Sql')
const CLIENT = join(ROOT, 'App', 'Amazon Games.exe')
const REMOVER = join(ROOT, 'App', 'Amazon Games Services', 'Fuel', 'helpers', 'Amazon Game Remover.exe')

interface ProductDetails {
  ProductTitle?: string
  ProductDescription?: string
  ProductIconUrl?: string
  ProductLogoUrl?: string
  Background?: string
  Background2?: string
  ProductPublisher?: string
  Developers?: string[]
  Genres?: string[]
  ReleaseDate?: string
  OfficialWebsite?: string
}

async function productDetails(): Promise<Map<string, ProductDetails>> {
  const rows = await readDatabase(join(SQL_DIR, 'ProductDetails.sqlite'), (db) =>
    db.prepare("SELECT key, value FROM game_product_info WHERE context = 'en-US' OR context LIKE 'en%'").all()
  )
  const details = new Map<string, ProductDetails>()
  for (const row of (rows ?? []) as Array<{ key: string; value: Uint8Array | string }>) {
    try {
      const text = typeof row.value === 'string' ? row.value : Buffer.from(row.value).toString('utf8')
      details.set(row.key, JSON.parse(text) as ProductDetails)
    } catch {
      continue
    }
  }
  return details
}

function overview(details: ProductDetails | undefined): GameOverview | undefined {
  if (!details) return undefined
  const released = details.ReleaseDate ? new Date(details.ReleaseDate) : null
  return {
    shortDescription: null,
    description: details.ProductDescription ?? null,
    developers: details.Developers ?? [],
    publishers: details.ProductPublisher ? [details.ProductPublisher] : [],
    releaseDate:
      released && !Number.isNaN(released.getTime())
        ? released.toLocaleDateString('en-US', { dateStyle: 'medium' })
        : null,
    genres: details.Genres ?? [],
    website: details.OfficialWebsite ?? null
  }
}

export const amazon: LauncherIntegration = {
  id: 'amazon',

  async detect() {
    return pathExists(CLIENT)
  },

  async games() {
    const [rows, details] = await Promise.all([
      readDatabase(join(SQL_DIR, 'GameInstallInfo.sqlite'), (db) =>
        db.prepare('SELECT Id, InstallDirectory, Installed, ProductTitle FROM DbSet').all()
      ),
      productDetails()
    ])
    const games: LauncherGame[] = []
    for (const row of (rows ?? []) as Array<{ Id: string; InstallDirectory: string | null; Installed: number; ProductTitle: string | null }>) {
      const info = details.get(row.Id)
      const installed = row.Installed === 1 && Boolean(row.InstallDirectory) && (await pathExists(row.InstallDirectory!))
      games.push({
        appId: row.Id,
        name: row.ProductTitle || info?.ProductTitle || row.Id,
        installed,
        installPath: row.InstallDirectory,
        art: info
          ? {
            cover: info.ProductIconUrl,
            header: info.Background,
            hero: info.Background2 ?? info.Background,
            logo: info.ProductLogoUrl
          }
          : undefined,
        overview: overview(info)
      })
    }
    return games
  },

  async open() {
    if (!(await pathExists(CLIENT))) throw new Error('Amazon Games is not installed.')
    launchDetached(CLIENT)
  },

  async run(game: LauncherGame, action: GameAction) {
    switch (action) {
      case 'play':
        return openUri(`amazon-games://play/${game.appId}`)
      case 'install':
        return openUri(`amazon-games://install/${game.appId}`)
      case 'uninstall':
        if (await pathExists(REMOVER)) return launchDetached(REMOVER, ['-m', 'Game', '-p', game.appId])
        return openUri('amazon-games://library')
      case 'downloads':
        return openUri('amazon-games://library')
      default:
        return unsupported()
    }
  }
}
