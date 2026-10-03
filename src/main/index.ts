import { join } from 'path'
import { readFile, stat } from 'fs/promises'
import { app, BrowserWindow, dialog, ipcMain, protocol, session, shell } from 'electron'
import type {
  AccountsView,
  ArtKind,
  Game,
  GameInfo,
  LinkedAccount,
  LauncherId,
  LinkedLauncherId,
  LocalLauncherId,
  ProfileLauncher,
  SettingsView,
  SteamGridDbAssetType,
  SteamGridDbFilters,
  SteamGridDbSearch,
  SwitchResult,
  UserProfile
} from '../shared/types'
import { runGameAction } from './actions'
import { ArtStore } from './artOverrides'
import { AvatarCache } from './avatars'
import { EaAuth } from './ea/auth'
import { EaLibrary } from './ea/library'
import { EpicAuth } from './epic/auth'
import { EpicLibrary } from './epic/library'
import { pathExists } from './fsutil'
import { LOCAL_INTEGRATIONS } from './launchers'
import { LocalLibrary } from './launchers/provider'
import { Library, type LocalProviders } from './library'
import { looksLikeImage, RemoteArt } from './remoteArt'
import { ASSET_KINDS, ASSET_TYPES, SteamGridDb, type SteamGridDbTarget } from './steamGridDb'
import {
  parseAccountId,
  parseCollections,
  parseLinkedLauncher,
  parseProfileUpdate,
  parseSettingsUpdate,
  parseSteamId,
  SettingsStore
} from './settings'
import { ArtService, isArtKind } from './steam/art'
import { SteamAuth } from './steam/auth'
import { switchSteamClient } from './steam/client'
import { SteamGameInfo } from './steam/gameInfo'
import { MetadataSources } from './metadata'
import { SteamLibrary } from './steam/library'
import { UbisoftAuth } from './ubisoft/auth'
import { UbisoftLibrary } from './ubisoft/library'
import { cleanUserAgent } from './userAgent'

app.userAgentFallback = cleanUserAgent(app.userAgentFallback)

protocol.registerSchemesAsPrivileged([
  { scheme: 'art', privileges: { standard: true, secure: true, supportFetchAPI: true } }
])

let mainWindow: BrowserWindow | null = null

function send(channel: string, payload: unknown): void {
  mainWindow?.webContents.send(channel, payload)
}

function sendAccounts(): void {
  send('accounts:changed', settings.accounts)
}

const settings = new SettingsStore()
const auth = new SteamAuth(settings, {
  onSignInEvent: (event) => send('signin:event', event),
  onSignedIn: () => {
    sendAccounts()
    void library.refresh({ refreshOwned: true })
  }
})
const steamLibrary = new SteamLibrary(settings, auth, {
  onChange: () => library.requestRefresh(),
  onAccountsChanged: sendAccounts
})
const epicAuth = new EpicAuth(settings, () => mainWindow)
const epicLibrary = new EpicLibrary(settings, epicAuth, () => library.requestRefresh())
const ubisoftAuth = new UbisoftAuth(settings, () => mainWindow)
const ubisoftLibrary = new UbisoftLibrary(settings, ubisoftAuth)
const eaAuth = new EaAuth(settings, () => mainWindow)
const eaLibrary = new EaLibrary(settings, eaAuth)
const localLibraries = Object.fromEntries(
  Object.entries(LOCAL_INTEGRATIONS).map(([id, integration]) => [
    id,
    new LocalLibrary(integration, join(app.getPath('userData'), 'game-info', 'local'), () => library.requestRefresh())
  ])
) as LocalProviders
const library = new Library(
  steamLibrary,
  { epic: epicLibrary, ubisoft: ubisoftLibrary, ea: eaLibrary },
  localLibraries,
  (snapshot) => send('library:changed', snapshot)
)
const linkedAuth: Record<
  LinkedLauncherId,
  { signIn(reuseAccountId?: string): Promise<LinkedAccount>; signOut(accountId: string): Promise<void> }
> = {
  epic: epicAuth,
  ubisoft: ubisoftAuth,
  ea: eaAuth
}
const artCacheDir = join(app.getPath('userData'), 'art-cache')
const steamArt = new ArtService(
  artCacheDir,
  () => steamLibrary.knownSteamPath,
  (appId) => settings.saveSteamGridDbCover(appId),
  (appId) => settings.removeSteamGridDbCover(appId)
)
const avatars = new AvatarCache(join(artCacheDir, 'avatars'))
const steamGridDb = new SteamGridDb(() => settings.steamGridDbApiKey)

const artOverrides = new ArtStore(join(artCacheDir, 'overrides'))

const artFillIns = new ArtStore(join(artCacheDir, 'sgdb-fill'))
const fillInMisses = new Map<string, number>()
const FILL_IN_RETRY_MS = 60 * 60 * 1000
const FILL_IN_TYPES: Partial<Record<ArtKind, SteamGridDbAssetType>> = { cover: 'grid', hero: 'hero', logo: 'logo' }
const steamGameInfo = new SteamGameInfo(join(app.getPath('userData'), 'game-info', 'steam'), auth, () => settings.steamWebApiKey)
const metadata = new MetadataSources(join(app.getPath('userData'), 'game-info', 'metadata'), steamGameInfo)
const linkedArt: Record<LinkedLauncherId, RemoteArt> = {
  epic: new RemoteArt(join(artCacheDir, 'epic'), (id, kind) => epicLibrary.imageUrl(id, kind)),
  ubisoft: new RemoteArt(join(artCacheDir, 'ubisoft'), (id, kind) => ubisoftLibrary.imageUrl(id, kind)),
  ea: new RemoteArt(join(artCacheDir, 'ea'), (id, kind) => eaLibrary.imageUrl(id, kind))
}
const localArt = Object.fromEntries(
  (Object.keys(localLibraries) as LocalLauncherId[]).map((id) => [
    id,
    new RemoteArt(

      join(artCacheDir, LOCAL_INTEGRATIONS[id].enrichVersion ? `${id}-v${LOCAL_INTEGRATIONS[id].enrichVersion}` : id),
      (appId, kind) => localLibraries[id].art(appId, kind)
    )
  ])
) as Record<LocalLauncherId, RemoteArt>

function isExternalUrl(url: string): boolean {
  try {
    return new URL(url).protocol === 'https:'
  } catch {
    return false
  }
}

function createWindow(): BrowserWindow {
  const isMac = process.platform === 'darwin'
  const window = new BrowserWindow({
    width: 1320,
    height: 840,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: 'Portal',
    backgroundColor: '#000000',
    titleBarStyle: 'hidden',
    ...(isMac
      ? { trafficLightPosition: { x: 16, y: 16 } }
      : { titleBarOverlay: { color: '#000000', symbolColor: '#a6a6a6', height: 48 } }),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  window.once('ready-to-show', () => window.show())
  window.on('focus', () => library.requestRefresh(0))
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null
  })
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternalUrl(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, url) => {
    event.preventDefault()
    if (isExternalUrl(url)) void shell.openExternal(url)
  })

  if (process.env.ELECTRON_RENDERER_URL) void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void window.loadFile(join(__dirname, '../renderer/index.html'))

  return window
}

function imageResponse(image: Buffer): Response {
  const type = image[0] === 0x89 ? 'image/png' : image[0] === 0x52 ? 'image/webp' : 'image/jpeg'
  return new Response(new Uint8Array(image), { headers: { 'content-type': type, 'cache-control': 'max-age=604800' } })
}

async function handleArtRequest(request: Request): Promise<Response> {
  const url = new URL(request.url)
  if (url.host === 'avatar') {
    const avatar = await avatars.load(decodeURIComponent(url.pathname.slice(1)))
    return avatar ? imageResponse(avatar) : new Response(null, { status: 404 })
  }
  const [rawId, kind, assetId] = url.pathname.split('/').filter(Boolean)
  if (!rawId || !kind) return new Response(null, { status: 404 })
  const id = decodeURIComponent(rawId)

  let image: Buffer | null = null
  if (url.host === 'sgdb') {
    const game = library.findGame(id)
    if (game && assetId && (ASSET_TYPES as string[]).includes(kind)) {
      image = await steamGridDb.preview(artTarget(game, steamGridDbSearch(Object.fromEntries(url.searchParams))), kind as SteamGridDbAssetType, decodeURIComponent(assetId))
    }
  } else if (!isArtKind(kind)) {
    return new Response(null, { status: 404 })
  } else if (url.host === 'steam') {
    const appId = Number(id)
    if (Number.isInteger(appId) && appId > 0) image = await steamArt.load(appId, kind)
  } else if (url.host in linkedArt || url.host in localArt) {
    const launcher = url.host as LinkedLauncherId | LocalLauncherId
    image =
      (await artOverrides.read(launcher, id, kind)) ??
      (launcher in linkedArt
        ? await linkedArt[launcher as LinkedLauncherId].load(id, kind)
        : await localArt[launcher as LocalLauncherId].load(id, kind)) ??
      (await fillIn(launcher, id, kind))
  }
  return image ? imageResponse(image) : new Response(null, { status: 404 })
}

async function settingsView(): Promise<SettingsView> {
  return {
    steamPathOverride: settings.steamPathOverride,
    detectedSteamPath: await steamLibrary.steamPath(),
    steamGridDbConfigured: settings.steamGridDbApiKey !== null,
    steamWebApiKeyConfigured: settings.steamWebApiKey !== null,
    useGameLogos: settings.useGameLogos
  }
}

async function switchAccount(steamId: string): Promise<SwitchResult> {
  const account = settings.account(steamId)
  if (!account) throw new Error('That account is not signed in to Portal.')
  await settings.setActive(steamId)
  sendAccounts()
  void library.refresh()

  const steamPath = await steamLibrary.steamPath()
  try {
    const steam = steamPath ? await switchSteamClient(steamPath, account) : 'steam-not-found'
    return { accounts: settings.accounts, steam }
  } finally {
    library.requestRefresh(1500)
  }
}

async function signOut(steamId: string): Promise<void> {
  auth.invalidate(steamId)
  await settings.removeAccount(steamId)
  await steamLibrary.forgetAccount(steamId)
  sendAccounts()
  void library.refresh()
}

async function linkAccount(launcher: LinkedLauncherId, accountId?: string): Promise<AccountsView> {
  await linkedAuth[launcher].signIn(accountId && settings.linkedAccount(launcher, accountId) ? accountId : undefined)
  sendAccounts()
  void library.refresh({ refreshOwned: true })
  return settings.accounts
}

async function switchLinkedAccount(launcher: LinkedLauncherId, accountId: string): Promise<AccountsView> {
  await settings.setActiveLinked(launcher, accountId)
  sendAccounts()
  void library.refresh()
  return settings.accounts
}

async function unlinkAccount(launcher: LinkedLauncherId, accountId: string): Promise<AccountsView> {
  await linkedAuth[launcher].signOut(accountId)
  await library.forgetLinkedAccount(launcher, accountId)
  sendAccounts()
  void library.refresh()
  return settings.accounts
}

async function gameInfo(gameId: unknown): Promise<GameInfo> {
  if (typeof gameId !== 'string') throw new Error('Unknown game.')
  const game = library.findGame(gameId)
  if (!game) throw new Error('Unknown game.')
  if (game.launcher === 'steam') return steamGameInfo.info(Number(game.appId), settings.activeAccount?.steamId ?? null)
  const own =
    game.launcher in localLibraries
      ? await localLibraries[game.launcher as LocalLauncherId].info(game.appId)
      : { overview: null, achievements: null, error: null }
  const overview = await metadata.complete(game.name, own.overview).catch(() => own.overview)
  return { ...own, overview }
}

async function userProfile(): Promise<UserProfile> {
  const snapshot = library.current ?? (await library.snapshot())
  const games = snapshot.games
  const steamAccount = settings.activeAccount
  const launcherIds: LauncherId[] = ['steam', 'epic', 'ubisoft', 'ea', ...(Object.keys(localLibraries) as LocalLauncherId[])]
  const launchers: ProfileLauncher[] = launcherIds.flatMap((launcher) => {
    const owned = games.filter((game) => game.launcher === launcher)
    const account =
      launcher === 'steam'
        ? steamAccount && (steamAccount.personaName || steamAccount.accountName)
        : launcher === 'epic' || launcher === 'ubisoft' || launcher === 'ea'
          ? settings.linkedAccount(launcher)?.displayName
          : null
    const status = launcher in snapshot.local ? snapshot.local[launcher as LocalLauncherId] : null
    if (status && owned.length === 0 && !status.launcherInstalled) return []
    return [{
      launcher,
      account: account || null,
      games: owned.length,
      installed: owned.filter((game) => game.state !== 'not-installed').length
    }]
  })

  let achievements: UserProfile['achievements'] = null
  let achievementsError: string | null = null
  if (steamAccount) {
    const played = games
      .filter((game) => game.launcher === 'steam' && (game.playtimeMinutes ?? 0) > 0)
      .map((game) => Number(game.appId))
    const result = await steamGameInfo.profileAchievements(steamAccount.steamId, played)
    achievements = result.data
    achievementsError = result.error
  }
  const localTotals = Object.values(localLibraries).flatMap((provider) => provider.achievementTotals())
  if (localTotals.length > 0) {
    const base = achievements ?? { unlocked: 0, total: 0, perfectGames: 0, gamesWithAchievements: 0 }
    achievements = {
      unlocked: base.unlocked + localTotals.reduce((sum, entry) => sum + entry.unlocked, 0),
      total: base.total + localTotals.reduce((sum, entry) => sum + entry.total, 0),
      perfectGames: base.perfectGames + localTotals.filter((entry) => entry.unlocked >= entry.total).length,
      gamesWithAchievements: base.gamesWithAchievements + localTotals.length
    }
  }

  return {
    name: settings.profileName ?? (steamAccount ? steamAccount.personaName || steamAccount.accountName : null),
    avatarUrl: settings.profileAvatar ?? steamAccount?.avatarUrl ?? null,
    customName: settings.profileName,
    hasCustomAvatar: settings.profileAvatar !== null,
    games: games.length,
    installed: games.filter((game) => game.state !== 'not-installed').length,
    playtimeMinutes: games.reduce((sum, game) => sum + (game.playtimeMinutes ?? 0), 0),
    launchers,
    achievements,
    achievementsError
  }
}

function artTarget(game: Game, search?: SteamGridDbSearch): SteamGridDbTarget {
  const name = search?.name || game.name
  const hasCustomSearch = Boolean(search?.name || search?.gameId)
  const steamGridDbId = search?.gameId
  return {
    key: `${game.id}:${steamGridDbId ? `id:${steamGridDbId}` : `name:${name.toLocaleLowerCase()}`}`,
    steamAppId: hasCustomSearch || game.launcher !== 'steam' ? undefined : Number(game.appId),
    steamGridDbId,
    name
  }
}

function gameFor(gameId: unknown): Game {
  const game = typeof gameId === 'string' ? library.findGame(gameId) : null
  if (!game) throw new Error('That game is no longer in your library.')
  return game
}

function assetType(type: unknown): SteamGridDbAssetType {
  if (!(ASSET_TYPES as unknown[]).includes(type)) throw new Error('Unknown artwork type.')
  return type as SteamGridDbAssetType
}

async function saveArtwork(game: Game, kind: ArtKind, image: Buffer): Promise<void> {
  if (game.launcher === 'steam') await steamArt.saveOverride(Number(game.appId), kind, image)
  else await artOverrides.save(game.launcher, game.appId, kind, image)
}

async function fillIn(launcher: LinkedLauncherId | LocalLauncherId, appId: string, kind: ArtKind): Promise<Buffer | null> {
  const type = FILL_IN_TYPES[kind]
  if (!type || !steamGridDb.configured || launcher === 'minecraft') return null
  const stored = await artFillIns.read(launcher, appId, kind)
  if (stored) return stored
  const key = `${launcher}:${appId}:${kind}`
  const missed = fillInMisses.get(key)
  if (missed && Date.now() - missed < FILL_IN_RETRY_MS) return null
  const game = library.findGame(`${launcher}:${appId}`)
  if (!game) return null
  const image = await steamGridDb.first(artTarget(game), type).catch(() => null)
  if (!image) {
    fillInMisses.set(key, Date.now())
    return null
  }
  await artFillIns.save(launcher, appId, kind, image).catch(() => undefined)
  return image
}

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024

async function uploadArtwork(gameId: unknown, kind: unknown): Promise<boolean> {
  const game = gameFor(gameId)
  if (typeof kind !== 'string' || !isArtKind(kind)) throw new Error('Unknown artwork type.')
  const options = {
    title: 'Choose an image',
    properties: ['openFile' as const],
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }]
  }
  const picked = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options)
  const path = picked.filePaths[0]
  if (picked.canceled || !path) return false
  if ((await stat(path)).size > MAX_UPLOAD_BYTES) throw new Error('That image is too large (25 MB at most).')
  const image = await readFile(path)
  const isGif = image.subarray(0, 4).toString('ascii') === 'GIF8'
  if (!isGif && !looksLikeImage(image)) throw new Error('That file is not a PNG, JPEG, WebP or GIF image.')
  await saveArtwork(game, kind, image)
  return true
}

function steamGridDbFilters(input: unknown): SteamGridDbFilters {
  if (!input || typeof input !== 'object') return {}
  const source = input as Record<string, unknown>
  const filters: SteamGridDbFilters = {}
  for (const key of ['nsfw', 'humor', 'epilepsy'] as const) {
    const value = source[key]
    if (typeof value === 'boolean' || value === 'any') filters[key] = value
  }
  for (const key of ['types', 'mimes', 'styles', 'dimensions'] as const) {
    const value = source[key]
    if (typeof value === 'string' && /^[a-zA-Z0-9_.,/x-]+$/.test(value)) filters[key] = value
  }
  return filters
}

function steamGridDbSearch(input: unknown): SteamGridDbSearch | undefined {
  if (!input || typeof input !== 'object') return undefined
  const source = input as Record<string, unknown>
  const name = typeof source.name === 'string' ? source.name.trim().slice(0, 160) : ''
  const rawId = source.gameId
  const gameId =
    typeof rawId === 'number' && Number.isSafeInteger(rawId) && rawId > 0
      ? rawId
      : typeof rawId === 'string' && /^\d+$/.test(rawId) && Number(rawId) <= Number.MAX_SAFE_INTEGER
        ? Number(rawId)
        : undefined
  return name || gameId ? { ...(name ? { name } : {}), ...(gameId ? { gameId } : {}) } : undefined
}

function registerIpc(): void {
  ipcMain.handle('library:get', (_event, options: unknown) =>
    library.snapshot({
      refreshOwned: typeof options === 'object' && options !== null && 'refreshOwned' in options && options.refreshOwned === true
    })
  )
  ipcMain.handle('game:action', (_event, gameId: unknown, action: unknown) =>
    runGameAction(gameId, action, library, epicLibrary, localLibraries)
  )
  ipcMain.handle('game:info', (_event, gameId: unknown) => gameInfo(gameId))
  ipcMain.handle('launcher:open', (_event, launcher: unknown) => {
    if (typeof launcher !== 'string' || !(launcher in localLibraries)) throw new Error('Unknown launcher.')
    return localLibraries[launcher as LocalLauncherId].open()
  })
  ipcMain.handle('window:title-bar', (_event, colors: unknown) => {
    const { color, symbolColor } = (colors ?? {}) as Record<string, unknown>
    const hex = /^#[0-9a-fA-F]{6}$/
    if (typeof color !== 'string' || typeof symbolColor !== 'string' || !hex.test(color) || !hex.test(symbolColor)) {
      throw new Error('Invalid title bar colors.')
    }
    if (!mainWindow || process.platform === 'darwin') return
    mainWindow.setBackgroundColor(color)
    mainWindow.setTitleBarOverlay({ color, symbolColor, height: 48 })
  })
  ipcMain.handle('profile:get', () => userProfile())
  ipcMain.handle('collections:get', () => settings.collections)
  ipcMain.handle('collections:save', async (_event, input: unknown) => {
    await settings.saveCollections(parseCollections(input))
    return settings.collections
  })
  ipcMain.handle('profile:update', async (_event, update: unknown) => {
    await settings.updateCustomProfile(parseProfileUpdate(update))
    return userProfile()
  })
  ipcMain.handle('art:quick-replace-cover', async (_event, gameId: unknown) => {
    const game = gameFor(gameId)
    const image = await steamGridDb.first(artTarget(game), 'grid')
    if (!image) throw new Error('SteamGridDB does not have a suitable cover for this game.')
    await saveArtwork(game, 'cover', image)
  })
  ipcMain.handle('art:restore', async (_event, gameId: unknown) => {
    const game = gameFor(gameId)
    if (game.launcher === 'steam') await steamArt.removeOverrides(Number(game.appId))
    else await artOverrides.clear(game.launcher, game.appId)
  })
  ipcMain.handle('art:choices', (_event, gameId: unknown, type: unknown, rawFilters: unknown, rawSearch: unknown) =>
    steamGridDb.choices(artTarget(gameFor(gameId), steamGridDbSearch(rawSearch)), assetType(type), steamGridDbFilters(rawFilters))
  )
  ipcMain.handle('art:choose', async (_event, gameId: unknown, type: unknown, assetId: unknown, rawSearch: unknown) => {
    const game = gameFor(gameId)
    const kind = assetType(type)
    if (typeof assetId !== 'string') throw new Error('Unknown SteamGridDB asset.')
    const asset = await steamGridDb.find(artTarget(game, steamGridDbSearch(rawSearch)), kind, assetId)
    if (!asset) throw new Error('That SteamGridDB asset is no longer available.')
    const image = await steamGridDb.download(asset.url)
    if (!image) throw new Error('Could not download that SteamGridDB asset.')
    await saveArtwork(game, ASSET_KINDS[kind], image)
  })
  ipcMain.handle('art:upload', (_event, gameId: unknown, kind: unknown) => uploadArtwork(gameId, kind))
  ipcMain.handle('art:overrides', async () => [
    ...settings.steamGridDbCoverOverrides.map((appId) => `steam:${appId}`),
    ...(await artOverrides.list())
  ])
  ipcMain.handle('settings:get', () => settingsView())
  ipcMain.handle('settings:update', async (_event, input: unknown) => {
    const update = parseSettingsUpdate(input)
    if (update.steamPathOverride && !(await pathExists(join(update.steamPathOverride, 'steamapps')))) {
      throw new Error('No Steam installation was found in that folder.')
    }
    await settings.update(update)
    void library.refresh({ refreshOwned: true })
    return settingsView()
  })
  ipcMain.handle('accounts:get', () => settings.accounts)
  ipcMain.handle('accounts:switch', (_event, steamId: unknown) => switchAccount(parseSteamId(steamId)))
  ipcMain.handle('accounts:sign-out', async (_event, steamId: unknown) => {
    await signOut(parseSteamId(steamId))
    return settings.accounts
  })
  ipcMain.handle('signin:start', async () => ({ qrDataUrl: await auth.startSignIn() }))
  ipcMain.handle('signin:password', (_event, accountName: unknown, password: unknown) => {
    if (
      typeof accountName !== 'string' ||
      typeof password !== 'string' ||
      !accountName.trim() ||
      !password ||
      accountName.length > 64 ||
      password.length > 256
    ) {
      throw new Error('Enter your Steam account name and password.')
    }
    return auth.startPasswordSignIn(accountName.trim(), password)
  })
  ipcMain.handle('signin:guard-code', (_event, code: unknown) => {
    if (typeof code !== 'string' || !/^[A-Za-z0-9]{4,10}$/.test(code.trim())) throw new Error('Enter the Steam Guard code.')
    return auth.submitSteamGuardCode(code.trim().toUpperCase())
  })
  ipcMain.handle('signin:cancel', () => auth.cancelSignIn())
  ipcMain.handle('accounts:link', (_event, launcher: unknown, accountId: unknown) =>
    linkAccount(parseLinkedLauncher(launcher), accountId === undefined ? undefined : parseAccountId(accountId))
  )
  ipcMain.handle('accounts:switch-linked', (_event, launcher: unknown, accountId: unknown) =>
    switchLinkedAccount(parseLinkedLauncher(launcher), parseAccountId(accountId))
  )
  ipcMain.handle('accounts:unlink', (_event, launcher: unknown, accountId: unknown) =>
    unlinkAccount(parseLinkedLauncher(launcher), parseAccountId(accountId))
  )
}

async function start(): Promise<void> {
  session.defaultSession.setUserAgent(cleanUserAgent(session.defaultSession.getUserAgent()))
  await settings.load()
  protocol.handle('art', handleArtRequest)
  registerIpc()
  mainWindow = createWindow()
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
  app.on('activate', () => {
    if (!mainWindow) mainWindow = createWindow()
  })
  app.on('before-quit', () => library.dispose())
  void app.whenReady().then(start)
}
