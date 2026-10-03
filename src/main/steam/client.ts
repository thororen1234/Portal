import { execFile, spawn } from 'child_process'
import { copyFile, readFile, writeFile } from 'fs/promises'
import { homedir } from 'os'
import { join } from 'path'
import { promisify } from 'util'
import { shell } from 'electron'
import type { SteamAccount, SteamClientSwitch } from '../../shared/types'
import { pathExists } from '../fsutil'
import { detectSteamUser, steamIdFromAccountId } from './steam'

const execFileAsync = promisify(execFile)

const SHUTDOWN_TIMEOUT_MS = 30_000
const POLL_MS = 500

const USER_BLOCK = /("(\d{17})"\s*\{)([^{}]*)(\})/g

async function registryActiveUser(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      'reg',
      ['query', 'HKCU\\Software\\Valve\\Steam\\ActiveProcess', '/v', 'ActiveUser'],
      { windowsHide: true }
    )
    const match = /ActiveUser\s+REG_DWORD\s+0x([0-9a-f]+)/i.exec(stdout)
    const accountId = match ? parseInt(match[1], 16) : 0
    return accountId > 0 ? steamIdFromAccountId(accountId) : null
  } catch {
    return null
  }
}

export async function clientSteamId(steamPath: string): Promise<string | null> {
  if (process.platform === 'win32') {
    const active = await registryActiveUser()
    if (active) return active
  }
  return (await detectSteamUser(steamPath))?.steamId ?? null
}

async function isSteamRunning(): Promise<boolean> {
  try {
    if (process.platform === 'win32') {
      const { stdout } = await execFileAsync('tasklist', ['/FI', 'IMAGENAME eq steam.exe', '/FO', 'CSV', '/NH'], {
        windowsHide: true
      })
      return /"steam\.exe"/i.test(stdout)
    }
    await execFileAsync('pgrep', ['-x', process.platform === 'darwin' ? 'steam_osx' : 'steam'])
    return true
  } catch {
    return false
  }
}

async function waitForSteamToClose(): Promise<void> {
  const deadline = Date.now() + SHUTDOWN_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (!(await isSteamRunning())) return
    await new Promise((resolve) => setTimeout(resolve, POLL_MS))
  }
  throw new Error('Steam did not close in time, so the switch was cancelled. Close any running games and try again.')
}

function startSteam(steamPath: string): void {
  const [command, args] =
    process.platform === 'win32'
      ? [join(steamPath, 'steam.exe'), []]
      : process.platform === 'darwin'
        ? ['open', ['-a', 'Steam']]
        : ['steam', []]
  spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: false }).unref()
}

function setField(body: string, key: string, value: string, addIfMissing: boolean): string {
  const pattern = new RegExp(`("${key}"\\s+")[^"]*(")`, 'i')
  if (pattern.test(body)) return body.replace(pattern, `$1${value}$2`)
  if (!addIfMissing) return body
  return `${body.replace(/\s*$/, '')}\n\t\t"${key}"\t\t"${value}"\n\t`
}

function fieldValue(body: string, key: string): string | null {
  return new RegExp(`"${key}"\\s+"([^"]*)"`, 'i').exec(body)?.[1] ?? null
}

interface LoginUsersEdit {
  text: string
  accountName: string | null
  remembered: boolean
}

function editLoginUsers(source: string, steamId: string): LoginUsersEdit {
  let accountName: string | null = null
  let remembered = false
  const text = source.replace(USER_BLOCK, (_match, open: string, id: string, body: string, close: string) => {
    const isTarget = id === steamId
    if (isTarget) {
      accountName = fieldValue(body, 'AccountName')
      remembered = fieldValue(body, 'RememberPassword') === '1'
    }
    let next = setField(body, 'AutoLogin', isTarget ? '1' : '0', isTarget)
    next = setField(next, 'MostRecent', isTarget ? '1' : '0', false)
    if (isTarget) next = setField(next, 'AllowAutoLogin', '1', false)
    return `${open}${next}${close}`
  })
  return { text, accountName, remembered }
}

async function setAutoLoginUser(accountName: string): Promise<void> {
  if (process.platform === 'win32') {
    await execFileAsync(
      'reg',
      ['add', 'HKCU\\Software\\Valve\\Steam', '/v', 'AutoLoginUser', '/t', 'REG_SZ', '/d', accountName, '/f'],
      { windowsHide: true }
    )
    return
  }
  const registryPath =
    process.platform === 'darwin'
      ? join(homedir(), 'Library', 'Application Support', 'Steam', 'registry.vdf')
      : join(homedir(), '.steam', 'registry.vdf')
  if (!(await pathExists(registryPath))) return
  const source = await readFile(registryPath, 'utf8')
  const escaped = accountName.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  await writeFile(registryPath, source.replace(/("AutoLoginUser"\s+")[^"]*(")/i, `$1${escaped}$2`))
}

export async function switchSteamClient(steamPath: string, account: SteamAccount): Promise<SteamClientSwitch> {
  const running = await isSteamRunning()
  if (running && (await clientSteamId(steamPath)) === account.steamId) return 'already-active'

  if (running) {
    await shell.openExternal('steam://exit')
    await waitForSteamToClose()
  }

  const loginUsersPath = join(steamPath, 'config', 'loginusers.vdf')
  let remembered = false
  let accountName = account.accountName
  if (await pathExists(loginUsersPath)) {
    const backupPath = `${loginUsersPath}.portal-backup`
    if (!(await pathExists(backupPath))) await copyFile(loginUsersPath, backupPath)
    const edit = editLoginUsers(await readFile(loginUsersPath, 'utf8'), account.steamId)
    await writeFile(loginUsersPath, edit.text)
    remembered = edit.remembered
    accountName = edit.accountName || accountName
  }
  if (accountName) await setAutoLoginUser(accountName)

  if (running) startSteam(steamPath)
  return remembered ? 'switched' : 'needs-login'
}
