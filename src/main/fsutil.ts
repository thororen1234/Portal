import { mkdir, open, readFile, rename, stat, unlink } from 'fs/promises'
import { dirname } from 'path'

export async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

export async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T
  } catch {
    return null
  }
}

const writes = new Map<string, Promise<void>>()

export function writeJson(path: string, value: unknown): Promise<void> {
  const data = JSON.stringify(value, null, 2)
  const write = (writes.get(path) ?? Promise.resolve()).catch(() => undefined).then(() => writeAtomic(path, data))
  writes.set(path, write)
  void write
    .finally(() => {
      if (writes.get(path) === write) writes.delete(path)
    })
    .catch(() => undefined)
  return write
}

async function writeAtomic(path: string, data: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temp = `${path}.tmp`
  const handle = await open(temp, 'w')
  try {
    await handle.writeFile(data)
    await handle.sync()
  } finally {
    await handle.close()
  }
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(temp, path)
      return
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (attempt >= 5 || (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES')) {
        await unlink(temp).catch(() => undefined)
        throw error
      }
      await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)))
    }
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
