export type LinkedLauncherId = 'epic' | 'ubisoft' | 'ea'

export type LocalLauncherId =
  | 'gog'
  | 'amazon'
  | 'battlenet'
  | 'xbox'
  | 'riot'
  | 'rockstar'
  | 'hoyoplay'
  | 'meta'
  | 'itch'
  | 'humble'
  | 'legacy'
  | 'googleplay'
  | 'minecraft'

export type LauncherId = 'steam' | LinkedLauncherId | LocalLauncherId

export type InstallState =
  | 'installed'
  | 'not-installed'
  | 'downloading'
  | 'paused'
  | 'queued'
  | 'update-required'
  | 'uninstalling'

export type GameSource = 'owned' | 'family'

export interface Game {
  id: string
  launcher: LauncherId
  appId: string
  name: string
  state: InstallState
  source: GameSource
  sharedBy: string[]
  progress: number | null
  sizeOnDisk: number | null
  installPath: string | null
  playtimeMinutes: number | null
  lastPlayed: number | null
}

export type LibrarySource = 'live' | 'cache' | 'none'

export interface SteamAccount {
  steamId: string
  accountName: string
  personaName: string
  avatarUrl: string | null
}

export interface LinkedAccount {
  accountId: string
  displayName: string
  avatarUrl: string | null
}

export interface SteamStatus {
  steamPath: string | null
  account: SteamAccount | null
  clientSteamId: string | null
  librarySource: LibrarySource
  libraryFetchedAt: number | null
  error: string | null
}

export interface LauncherStatus {
  launcherInstalled: boolean
  account: LinkedAccount | null
  librarySource: LibrarySource
  libraryFetchedAt: number | null
  error: string | null
}

export interface LibrarySnapshot {
  games: Game[]
  steam: SteamStatus
  linked: Record<LinkedLauncherId, LauncherStatus>
  local: Record<LocalLauncherId, LauncherStatus>
}

export interface SteamUser {
  steamId: string
  accountName: string
  personaName: string
}

export interface AccountGroup<Account> {
  accounts: Account[]
  activeId: string | null
}

export type SteamAccounts = AccountGroup<SteamAccount>
export type LinkedAccounts = AccountGroup<LinkedAccount>

export interface AccountsView {
  steam: SteamAccounts
  linked: Record<LinkedLauncherId, LinkedAccounts>
}

export type SteamGuardPrompt = 'email-code' | 'device-code' | 'device-confirmation' | 'email-confirmation'

export interface PasswordSignInStep {

  guards: SteamGuardPrompt[]
  emailDomain: string | null
}

export type SteamClientSwitch = 'switched' | 'already-active' | 'needs-login' | 'steam-not-found'

export interface SwitchResult {
  accounts: AccountsView
  steam: SteamClientSwitch
}

export type SignInEvent =
  | { type: 'scanned' }
  | { type: 'signed-in'; account: SteamAccount }
  | { type: 'expired' }
  | { type: 'error'; message: string }

export interface SettingsView {
  steamPathOverride: string
  detectedSteamPath: string | null
  steamGridDbConfigured: boolean
  steamWebApiKeyConfigured: boolean
  useGameLogos: boolean
}

export interface SettingsUpdate {
  steamPathOverride?: string
  steamGridDbApiKey?: string
  steamWebApiKey?: string
  useGameLogos?: boolean
}

export interface GameOverview {
  shortDescription: string | null

  description: string | null
  developers: string[]
  publishers: string[]
  releaseDate: string | null
  genres: string[]
  website: string | null
}

export interface Achievement {
  id: string
  name: string
  description: string | null
  iconUrl: string | null
  lockedIconUrl: string | null
  hidden: boolean
  unlocked: boolean
  unlockedAt: number | null
  globalPercent: number | null
}

export interface GameAchievements {
  unlocked: number
  total: number

  detailed: boolean
  items: Achievement[]
}

export interface GameInfo {
  overview: GameOverview | null
  achievements: GameAchievements | null
  error: string | null
}

export interface ProfileLauncher {
  launcher: LauncherId
  account: string | null
  games: number
  installed: number
}

export interface ProfileAchievements {
  unlocked: number
  total: number
  perfectGames: number
  gamesWithAchievements: number
}

export interface Collection {
  id: string
  name: string

  gameIds: string[]

  expanded: boolean
}

export interface ProfileUpdate {
  name?: string | null

  avatarDataUrl?: string | null
}

export interface UserProfile {
  name: string | null

  avatarUrl: string | null
  customName: string | null
  hasCustomAvatar: boolean
  games: number
  installed: number
  playtimeMinutes: number
  launchers: ProfileLauncher[]
  achievements: ProfileAchievements | null
  achievementsError: string | null
}

export type GameAction = 'play' | 'install' | 'uninstall' | 'downloads' | 'store' | 'folder'

export type ArtKind = 'cover' | 'header' | 'hero' | 'logo' | 'icon'

export type SteamGridDbAssetType = 'grid' | 'wide-grid' | 'hero' | 'logo' | 'icon'

export interface SteamGridDbFilters {
  nsfw?: boolean | 'any'
  humor?: boolean | 'any'
  epilepsy?: boolean | 'any'
  types?: string
  mimes?: string
  styles?: string
  dimensions?: string
}

export interface SteamGridDbSearch {
  name?: string
  gameId?: number
}

export interface SteamGridDbCover {
  id: string
  width: number | null
  height: number | null
  style: string | null
}

export interface PortalApi {
  platform: string
  getLibrary(options?: { refreshOwned?: boolean }): Promise<LibrarySnapshot>
  runAction(gameId: string, action: GameAction): Promise<void>
  openLauncher(launcher: LocalLauncherId): Promise<void>
  setTitleBarColors(colors: { color: string; symbolColor: string }): Promise<void>
  getGameInfo(gameId: string): Promise<GameInfo>
  getProfile(): Promise<UserProfile>
  getCollections(): Promise<Collection[]>
  saveCollections(collections: Collection[]): Promise<Collection[]>
  updateProfile(update: ProfileUpdate): Promise<UserProfile>
  quickReplaceCover(gameId: string): Promise<void>
  restoreArtwork(gameId: string): Promise<void>
  getArtChoices(gameId: string, type: SteamGridDbAssetType, filters?: SteamGridDbFilters, search?: SteamGridDbSearch): Promise<SteamGridDbCover[]>
  chooseArt(gameId: string, type: SteamGridDbAssetType, assetId: string, search?: SteamGridDbSearch): Promise<void>
  uploadArt(gameId: string, kind: ArtKind): Promise<boolean>
  getArtOverrides(): Promise<string[]>
  getSettings(): Promise<SettingsView>
  updateSettings(update: SettingsUpdate): Promise<SettingsView>
  getAccounts(): Promise<AccountsView>
  startSignIn(): Promise<{ qrDataUrl: string }>
  startPasswordSignIn(accountName: string, password: string): Promise<PasswordSignInStep>
  submitSteamGuardCode(code: string): Promise<void>
  cancelSignIn(): Promise<void>
  switchAccount(steamId: string): Promise<SwitchResult>
  signOut(steamId: string): Promise<AccountsView>
  linkAccount(launcher: LinkedLauncherId, accountId?: string): Promise<AccountsView>
  switchLinkedAccount(launcher: LinkedLauncherId, accountId: string): Promise<AccountsView>
  unlinkAccount(launcher: LinkedLauncherId, accountId: string): Promise<AccountsView>
  onLibraryChanged(listener: (snapshot: LibrarySnapshot) => void): () => void
  onAccountsChanged(listener: (accounts: AccountsView) => void): () => void
  onSignInEvent(listener: (event: SignInEvent) => void): () => void
}
