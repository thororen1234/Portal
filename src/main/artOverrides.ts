import { mkdir, readdir, readFile, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import type { ArtKind, LauncherId } from '../shared/types'

function safeName(id: string): string {
  return id.replace(/[^A-Za-z0-9._-]/g, '_')
}

export class ArtStore {
  constructor(private readonly dir: string) { }

  async read(launcher: LauncherId, appId: string, kind: ArtKind): Promise<Buffer | null> {
    return readFile(join(this.folder(launcher, appId), `${kind}.img`)).catch(() => null)
  }

  async save(launcher: LauncherId, appId: string, kind: ArtKind, image: Buffer): Promise<void> {
    const folder = this.folder(launcher, appId)
    try {
      await mkdir(folder, { recursive: true })
      await writeFile(join(folder, 'id.txt'), appId)
      await writeFile(join(folder, `${kind}.img`), image)
    } catch {
      throw new Error('Could not save the artwork.')
    }
  }

  async clear(launcher: LauncherId, appId: string): Promise<void> {
    await rm(this.folder(launcher, appId), { recursive: true, force: true })
  }

  async list(): Promise<string[]> {
    const ids: string[] = []
    let launchers: string[]
    try {
      launchers = await readdir(this.dir)
    } catch {
      return ids
    }
    for (const launcher of launchers) {
      let games: string[]
      try {
        games = await readdir(join(this.dir, launcher))
      } catch {
        continue
      }
      for (const game of games) {
        const appId = await readFile(join(this.dir, launcher, game, 'id.txt'), 'utf8').catch(() => null)
        if (appId) ids.push(`${launcher}:${appId}`)
      }
    }
    return ids
  }

  private folder(launcher: LauncherId, appId: string): string {
    return join(this.dir, launcher, safeName(appId))
  }
}
