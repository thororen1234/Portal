import { readdir, readFile } from 'fs/promises'
import { join } from 'path'
import { pathExists } from '../fsutil'
import { registryValue } from '../registry'

const INSTALL_ROOTS = ['Program Files\\EA Games', 'EA Games']
const DRIVES = 'CDEFGHIJKLMNOPQRSTUVWXYZ'.split('')

export interface EaInstalledGame {
  contentIds: string[]
  title: string
  installPath: string
}

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .trim()
}

export async function eaAppInstalled(): Promise<boolean> {
  if (process.platform !== 'win32') return false
  const client = await registryValue('HKLM\\SOFTWARE\\Electronic Arts\\EA Desktop', 'ClientPath')
  return Boolean(client && (await pathExists(client)))
}

async function readInstallerData(installPath: string): Promise<EaInstalledGame | null> {
  try {
    const xml = await readFile(join(installPath, '__Installer', 'installerdata.xml'), 'utf8')
    const contentIds = [...xml.matchAll(/<contentID>\s*([^<]+?)\s*<\/contentID>/gi)].map((match) => decodeXml(match[1]))
    if (contentIds.length === 0) return null
    const titles = [...xml.matchAll(/<gameTitle(?:\s+locale="([^"]*)")?\s*>([^<]+)<\/gameTitle>/gi)]
    const title =
      titles.find((match) => /^en[_-]US$/i.test(match[1] ?? ''))?.[2] ?? titles[0]?.[2] ?? installPath.split(/[\\/]/).pop()!
    return { contentIds, title: decodeXml(title), installPath }
  } catch {
    return null
  }
}

export async function readInstalledEaGames(): Promise<EaInstalledGame[]> {
  if (process.platform !== 'win32') return []
  const roots: string[] = []
  for (const drive of DRIVES) {
    if (!(await pathExists(`${drive}:\\`))) continue
    for (const root of INSTALL_ROOTS) {
      const path = `${drive}:\\${root}`
      if (await pathExists(path)) roots.push(path)
    }
  }

  const games: EaInstalledGame[] = []
  for (const root of roots) {
    let folders: string[]
    try {
      folders = await readdir(root)
    } catch {
      continue
    }
    for (const folder of folders) {
      const game = await readInstallerData(join(root, folder))
      if (game) games.push(game)
    }
  }
  return games
}
