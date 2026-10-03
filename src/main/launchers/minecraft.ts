import { readdir, readFile, stat } from 'fs/promises'
import { join } from 'path'
import { net } from 'electron'
import type { GameAction } from '../../shared/types'
import { pathExists } from '../fsutil'
import type { LauncherGame, LauncherIntegration } from './types'
import { firstExisting, launchDetached, unsupported } from './util'

const MINECRAFT_DIR = join(process.env.APPDATA ?? '', '.minecraft')
const VERSIONS_DIR = join(MINECRAFT_DIR, 'versions')
const PATCH_NOTES_URL = 'https://launchercontent.mojang.com/v2/javaPatchNotes.json'
const WIKI_API = 'https://minecraft.wiki/api.php'
const ART_WIDTH = 960

const KEY_ART: Array<{ version: string; update: string; file: string }> = [
  { version: '1.6', update: 'Horse Update', file: 'Horse Update Wallpaper.jpg' },
  { version: '1.9', update: 'Combat Update', file: 'Combat Update.png' },
  { version: '1.11', update: 'Exploration Update', file: 'ExplorationUpdateFull.jpg' },
  { version: '1.12', update: 'World of Color Update', file: 'World of Color Update.png' },
  { version: '1.13', update: 'Update Aquatic', file: 'Update Aquatic.png' },
  { version: '1.14', update: 'Village & Pillage', file: 'Village & Pillage banner.png' },
  { version: '1.15', update: 'Buzzy Bees', file: 'Buzzy Bees.png' },
  { version: '1.16', update: 'Nether Update', file: 'NetherUpdateArtwork.png' },
  { version: '1.17', update: 'Caves & Cliffs Part I', file: 'Caves & Cliffs cover art.png' },
  { version: '1.18', update: 'Caves & Cliffs Part II', file: 'Caves & Cliffs Part II.png' },
  { version: '1.19', update: 'The Wild Update', file: 'Wild key art.png' },
  { version: '1.20', update: 'Trails & Tales', file: 'Trails & Tales key art.png' },
  { version: '1.21', update: 'Tricky Trials', file: 'Tricky Trials Key Art.png' },
  { version: '1.21.2', update: 'Bundles of Bravery', file: 'Bundles of Bravery Key Art.png' },
  { version: '1.21.4', update: 'The Garden Awakens', file: 'The Garden Awakens Key Art.png' },
  { version: '1.21.5', update: 'Spring to Life', file: 'Spring to Life Key Art.jpg' },
  { version: '1.21.6', update: 'Chase the Skies', file: 'Chase the Skies Key Art.jpg' },
  { version: '1.21.9', update: 'The Copper Age', file: 'The Copper Age Key Art.png' },
  { version: '1.21.11', update: 'Mounts of Mayhem', file: 'Mounts of Mayhem Key Art.png' },
  { version: '26.1', update: 'Tiny Takeover', file: 'Tiny Takeover Key Art.png' },
  { version: '26.2', update: 'Chaos Cubed', file: 'Chaos Cubed Key Art.png' },
  { version: '26.3', update: 'Wilderness Bound', file: 'Wilderness Bound Key Art.png' }
]

const CLASSIC_ART = 'MC key art.png'

const STORE_LAUNCHER = 'shell:AppsFolder\\Microsoft.4297127D64EC6_8wekyb3d8bbwe!Minecraft'
const LEGACY_LAUNCHERS = [
  'C:\\Program Files (x86)\\Minecraft Launcher\\MinecraftLauncher.exe',
  'C:\\Program Files\\Minecraft Launcher\\MinecraftLauncher.exe'
]

interface VersionJson {
  id?: string
  type?: string
  inheritsFrom?: string
}

interface PatchNote {
  type?: string
  version?: string
  title?: string
  shortText?: string
  date?: string
  image?: { url?: string }
}

interface InstalledVersion {
  id: string
  base: string
  modded: boolean
}

function versionLine(version: string): string | null {
  const match = /^(\d+)\.(\d+)/.exec(version)
  return match ? `${match[1]}.${match[2]}` : null
}

function compareVersions(a: string, b: string): number {
  const left = a.split('.').map(Number)
  const right = b.split('.').map(Number)
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0)
    if (difference !== 0) return difference
  }
  return 0
}

function modLabel(id: string): string | null {
  if (/forge/i.test(id)) return 'Forge'
  if (/neoforge/i.test(id)) return 'NeoForge'
  if (/fabric/i.test(id)) return 'Fabric'
  if (/quilt/i.test(id)) return 'Quilt'
  if (/optifine/i.test(id)) return 'OptiFine'
  return null
}

async function installedVersions(): Promise<InstalledVersion[]> {
  let folders: string[]
  try {
    folders = await readdir(VERSIONS_DIR)
  } catch {
    return []
  }
  const versions: InstalledVersion[] = []
  for (const id of folders) {
    let info: VersionJson
    try {
      info = JSON.parse(await readFile(join(VERSIONS_DIR, id, `${id}.json`), 'utf8')) as VersionJson
    } catch {
      continue
    }
    if (info.type !== 'release') continue
    const base = info.inheritsFrom ?? id
    const jar = join(VERSIONS_DIR, base, `${base}.jar`)
    if (!/^\d+\.\d+(\.\d+)?$/.test(base) || !(await pathExists(jar))) continue
    versions.push({ id, base, modded: id !== base })
  }
  return versions
}

async function lastUsed(): Promise<Map<string, number>> {
  const times = new Map<string, number>()
  try {
    const profiles = JSON.parse(await readFile(join(MINECRAFT_DIR, 'launcher_profiles.json'), 'utf8')) as {
      profiles?: Record<string, { lastVersionId?: string; lastUsed?: string }>
    }
    for (const profile of Object.values(profiles.profiles ?? {})) {
      const used = profile.lastUsed ? Date.parse(profile.lastUsed) : NaN
      if (!profile.lastVersionId || !Number.isFinite(used) || used <= 0) continue
      times.set(profile.lastVersionId, Math.max(times.get(profile.lastVersionId) ?? 0, Math.floor(used / 1000)))
    }
  } catch {
  }
  return times
}

function keyArtFor(line: string, latest: string): { update: string | null; file: string } {
  const candidates = KEY_ART.filter(
    (entry) => versionLine(entry.version) === line && compareVersions(entry.version, latest) <= 0
  ).sort((a, b) => compareVersions(b.version, a.version))
  const match =
    candidates[0] ??
    KEY_ART.filter((entry) => compareVersions(entry.version, latest) <= 0).sort((a, b) => compareVersions(b.version, a.version))[0]
  return match ? { update: match.update, file: match.file } : { update: null, file: CLASSIC_ART }
}

async function wikiImageUrls(files: string[]): Promise<Map<string, string>> {
  const urls = new Map<string, string>()
  const params = new URLSearchParams({
    action: 'query',
    titles: files.map((file) => `File:${file}`).join('|'),
    prop: 'imageinfo',
    iiprop: 'url',
    iiurlwidth: String(ART_WIDTH),
    format: 'json',
    origin: '*'
  })
  const response = await net.fetch(`${WIKI_API}?${params}`)
  if (!response.ok) throw new Error(`minecraft.wiki could not be reached (${response.status}).`)
  const body = (await response.json()) as {
    query?: {
      normalized?: Array<{ from: string; to: string }>
      pages?: Record<string, { title?: string; imageinfo?: Array<{ url?: string; thumburl?: string }> }>
    }
  }
  const byTitle = new Map<string, string>()
  for (const page of Object.values(body.query?.pages ?? {})) {
    const info = page.imageinfo?.[0]
    if (page.title && info) byTitle.set(page.title, info.thumburl ?? info.url ?? '')
  }
  const normalized = new Map((body.query?.normalized ?? []).map((entry) => [entry.from, entry.to]))
  for (const file of files) {
    const title = normalized.get(`File:${file}`) ?? `File:${file}`
    const url = byTitle.get(title)
    if (url) urls.set(file, url)
  }
  return urls
}

let patchNotes: { fetchedAt: number; entries: Promise<PatchNote[]> } | null = null

function releaseNotes(): Promise<PatchNote[]> {
  if (patchNotes && Date.now() - patchNotes.fetchedAt < 24 * 60 * 60 * 1000) return patchNotes.entries
  const entries = (async () => {
    const response = await net.fetch(PATCH_NOTES_URL)
    if (!response.ok) throw new Error(`Mojang's release notes could not be loaded (${response.status}).`)
    const body = (await response.json()) as { entries?: PatchNote[] }
    return (body.entries ?? []).filter((entry) => entry.type === 'release' && entry.version)
  })()
  patchNotes = { fetchedAt: Date.now(), entries }
  entries.catch(() => (patchNotes = null))
  return entries
}

async function launcherAvailable(): Promise<string | null> {
  const legacy = await firstExisting(LEGACY_LAUNCHERS)
  if (legacy) return legacy
  try {
    await stat(MINECRAFT_DIR)
    return STORE_LAUNCHER
  } catch {
    return null
  }
}

async function openLauncher(): Promise<void> {
  const launcher = await launcherAvailable()
  if (!launcher) throw new Error('The Minecraft Launcher is not installed.')
  if (launcher === STORE_LAUNCHER) launchDetached('explorer.exe', [STORE_LAUNCHER])
  else launchDetached(launcher)
}

export const minecraft: LauncherIntegration = {
  id: 'minecraft',
  enrichVersion: 6,

  async detect() {
    return (await launcherAvailable()) !== null
  },

  async games() {
    const [versions, used] = await Promise.all([installedVersions(), lastUsed()])
    const lines = new Map<string, InstalledVersion[]>()
    for (const version of versions) {
      const line = versionLine(version.base)
      if (line) lines.set(line, [...(lines.get(line) ?? []), version])
    }
    return [...lines.entries()]
      .sort(([a], [b]) => compareVersions(b, a))
      .map(([line, members]): LauncherGame => {
        const plain = [...new Set(members.map((member) => member.base))].sort(compareVersions)
        const mods = [...new Set(members.flatMap((member) => (member.modded ? [modLabel(member.id) ?? 'Modded'] : [])))]
        const played = Math.max(0, ...members.map((member) => used.get(member.id) ?? 0))
        const latestInstalled = plain[plain.length - 1] ?? line
        return {
          appId: line,
          name: `Minecraft ${line}`,
          installed: true,
          updateAvailable: false,
          installPath: MINECRAFT_DIR,
          lastPlayed: played || null,
          overview: {
            shortDescription: `Installed: ${plain.join(', ')}${mods.length > 0 ? ` · ${mods.join(', ')}` : ''}`,
            description: null,
            developers: ['Mojang Studios'],
            publishers: ['Mojang Studios'],
            releaseDate: null,
            genres: ['Sandbox', 'Survival'],
            website: 'https://www.minecraft.net/'
          },
          extra: { latest: latestInstalled }
        }
      })
  },

  async enrich(game: LauncherGame) {
    const latest = game.extra?.latest ?? game.appId
    const art = keyArtFor(game.appId, latest)
    const [urls, notes] = await Promise.all([
      wikiImageUrls([art.file]),
      releaseNotes().catch(() => [] as PatchNote[])
    ])
    const note =
      notes.find((entry) => entry.version === latest) ??
      notes.find((entry) => entry.version?.startsWith(`${latest}.`)) ??
      notes.find((entry) => entry.version === game.appId) ??
      notes.find((entry) => entry.version?.startsWith(`${game.appId}.`))
    const installed = game.overview?.shortDescription ?? null
    const image = urls.get(art.file) ?? note?.image?.url
    return {
      art: image ? { cover: image, icon: image, header: image, hero: image } : undefined,
      overview: {
        shortDescription: art.update && installed ? `${art.update} · ${installed}` : (installed ?? art.update),
        description: note?.shortText ?? null,
        developers: ['Mojang Studios'],
        publishers: ['Mojang Studios'],
        releaseDate: note?.date ? new Date(note.date).toLocaleDateString('en-US', { dateStyle: 'medium' }) : null,
        genres: ['Sandbox', 'Survival'],
        website: 'https://www.minecraft.net/'
      }
    }
  },

  open: openLauncher,

  async run(_game: LauncherGame, action: GameAction) {
    switch (action) {
      case 'play':
      case 'downloads':
        return openLauncher()
      default:
        return unsupported()
    }
  }
}
