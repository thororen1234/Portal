import { JSX, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import type { ArtKind, Collection, Game, GameAction, LinkedLauncherId, LocalLauncherId, SteamAccount, SteamGridDbAssetType, SteamGridDbSearch, UserProfile } from '../../shared/types'
import { AccountMenu } from './components/AccountMenu'
import { AccountsDialog, type DetectedLauncher } from './components/AccountsDialog'
import { ConfirmDialog } from './components/ConfirmDialog'
import { Dropdown } from './components/Dropdown'
import { GameCard } from './components/GameCard'
import { GameDetails } from './components/GameDetails'
import { NameDialog } from './components/NameDialog'
import { ProfileDialog } from './components/ProfileDialog'
import { Sidebar, type LibraryView } from './components/Sidebar'
import { RefreshIcon, SearchIcon, SettingsIcon, SidebarIcon } from './components/Icons'
import { SettingsDialog } from './components/SettingsDialog'
import { SignInDialog } from './components/SignInDialog'
import { SteamGridDbCoverDialog } from './components/SteamGridDbCoverDialog'
import { Tabs } from './components/Tabs'
import { errorMessage } from './lib/format'
import {
  countGames,
  LAUNCHER_IDS,
  LAUNCHER_NAMES,
  LINKED_LAUNCHERS,
  LOCAL_LAUNCHERS,
  visibleGames,
  type Filter,
  type LauncherFilter,
  type Sort
} from './lib/games'
import { useAccounts } from './lib/useAccounts'
import { useCollections } from './lib/useCollections'
import { useLibrary } from './lib/useLibrary'
import { applyTheme, THEME_IDS, type ThemeId } from './lib/themes'
import { usePersistentChoice } from './lib/usePersistentState'

interface Toast {
  message: string
  kind: 'error' | 'info'
}

function accountLabel(account: SteamAccount): string {
  return account.personaName || account.accountName
}

const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: 'all', label: 'All games' },
  { id: 'installed', label: 'Installed' },
  { id: 'not-installed', label: 'Not installed' }
]

const LAUNCHERS: Array<{ id: LauncherFilter; label: string }> = [
  { id: 'all', label: 'All launchers' },
  ...LAUNCHER_IDS.map((id) => ({ id, label: LAUNCHER_NAMES[id] }))
]

const SORTS: Array<{ id: Sort; label: string }> = [
  { id: 'recent', label: 'Recently played' },
  { id: 'name', label: 'Name' },
  { id: 'playtime', label: 'Play time' },
  { id: 'size', label: 'Size on disk' }
]

const VIEW_KEY = 'portal:view'

function storedView(): LibraryView {
  try {
    const value = window.localStorage.getItem(VIEW_KEY)
    return value && (value === 'all' || value.startsWith('collection:')) ? (value as LibraryView) : 'all'
  } catch {
    return 'all'
  }
}

const FILTER_IDS = FILTERS.map((option) => option.id)
const LAUNCHER_FILTER_IDS = LAUNCHERS.map((option) => option.id)
const SORT_IDS = SORTS.map((option) => option.id)

export default function App(): JSX.Element {
  const { snapshot, loading, refreshing, error, refresh } = useLibrary()
  const accounts = useAccounts()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = usePersistentChoice<Filter>('filter', 'all', FILTER_IDS)
  const [launcher, setLauncher] = usePersistentChoice<LauncherFilter>('launcher', 'all', LAUNCHER_FILTER_IDS)
  const [sort, setSort] = usePersistentChoice<Sort>('sort', 'recent', SORT_IDS)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [accountsOpen, setAccountsOpen] = useState(false)
  const [signInOpen, setSignInOpen] = useState(false)
  const [pendingSwitch, setPendingSwitch] = useState<SteamAccount | null>(null)
  const [switching, setSwitching] = useState(false)
  const [toast, setToast] = useState<Toast | null>(null)
  const [artRevision, setArtRevision] = useState(0)
  const [artOverrides, setArtOverrides] = useState<Set<string>>(() => new Set())
  const [artPickerId, setArtPickerId] = useState<string | null>(null)
  const [useGameLogos, setUseGameLogos] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const [theme, setTheme] = usePersistentChoice<ThemeId>('theme', 'dark', THEME_IDS)
  useEffect(() => applyTheme(theme), [theme])
  const [sidebar, setSidebar] = usePersistentChoice<'open' | 'closed'>('sidebar', 'open', ['open', 'closed'])
  const [view, setViewState] = useState<LibraryView>(storedView)
  const [newCollectionFor, setNewCollectionFor] = useState<string | null>(null)
  const [pendingRemoval, setPendingRemoval] = useState<Collection | null>(null)

  useEffect(() => {
    let active = true
    window.portal
      .getProfile()
      .then((next) => active && setProfile(next))
      .catch((reason: unknown) => console.error('Could not load profile:', reason))
    return () => {
      active = false
    }
  }, [])

  const reportCollectionError = useCallback((message: string) => setToast({ message, kind: 'error' }), [])
  const collections = useCollections(reportCollectionError)
  const setView = useCallback((next: LibraryView) => {
    setViewState(next)
    try {
      window.localStorage.setItem(VIEW_KEY, next)
    } catch {

    }
  }, [])
  const viewCollection =
    view === 'all' ? null : (collections.collections.find((collection) => `collection:${collection.id}` === view) ?? null)
  const deferredQuery = useDeferredValue(query)

  const allGames = snapshot?.games ?? []
  const scopedGames = useMemo(() => {
    if (!viewCollection) return allGames
    const members = new Set(viewCollection.gameIds)
    return allGames.filter((game) => members.has(game.id))
  }, [allGames, viewCollection])
  const games = useMemo(
    () => visibleGames(scopedGames, deferredQuery, filter, launcher, sort),
    [scopedGames, deferredQuery, filter, launcher, sort]
  )
  const counts = useMemo(() => countGames(scopedGames, launcher), [scopedGames, launcher])

  useEffect(() => {
    if (collections.loaded && view !== 'all' && !viewCollection) setView('all')
  }, [collections.loaded, view, viewCollection, setView])
  const detectedLaunchers = useMemo<DetectedLauncher[]>(
    () =>
      LOCAL_LAUNCHERS.flatMap((id) => {
        const owned = allGames.filter((game) => game.launcher === id)
        if (owned.length === 0 && !snapshot?.local?.[id]?.launcherInstalled) return []
        return [{ launcher: id, games: owned.length, installed: owned.filter((game) => game.state !== 'not-installed').length }]
      }),
    [allGames, snapshot]
  )
  const launcherOptions = useMemo(() => {
    const present = new Set(allGames.map((game) => game.launcher))
    return LAUNCHERS.filter((option) => option.id === 'all' || option.id === launcher || present.has(option.id))
  }, [allGames, launcher])
  const selected = allGames.find((game) => game.id === selectedId) ?? null
  const artPickerGame = allGames.find((game) => game.id === artPickerId) ?? null
  const steam = snapshot?.steam ?? null
  const linked = snapshot?.linked ?? null

  const runAction = useCallback(async (gameId: string, action: GameAction) => {
    try {
      await window.portal.runAction(gameId, action)
    } catch (reason) {
      setToast({ message: errorMessage(reason), kind: 'error' })
    }
  }, [])

  const setArtOverride = useCallback((gameId: string, selected: boolean): void => {
    setArtOverrides((overrides) => {
      const next = new Set(overrides)
      if (selected) next.add(gameId)
      else next.delete(gameId)
      return next
    })
    setArtRevision((revision) => revision + 1)
  }, [])

  const quickReplaceCover = useCallback(async (gameId: string) => {
    try {
      await window.portal.quickReplaceCover(gameId)
      setArtOverride(gameId, true)
      setToast({ message: 'Cover replaced with SteamGridDB artwork.', kind: 'info' })
    } catch (reason) {
      setToast({ message: errorMessage(reason), kind: 'error' })
    }
  }, [setArtOverride])

  const restoreArtwork = useCallback(async (gameId: string) => {
    try {
      await window.portal.restoreArtwork(gameId)
      setArtOverride(gameId, false)
      setToast({ message: 'Original artwork restored.', kind: 'info' })
    } catch (reason) {
      setToast({ message: errorMessage(reason), kind: 'error' })
    }
  }, [setArtOverride])

  const chooseArt = useCallback(async (gameId: string, type: SteamGridDbAssetType, assetId: string, search?: SteamGridDbSearch): Promise<void> => {
    await window.portal.chooseArt(gameId, type, assetId, search)
    setArtOverride(gameId, true)
    setArtPickerId(null)
    setToast({ message: 'Artwork applied.', kind: 'info' })
  }, [setArtOverride])

  const uploadArt = useCallback(async (gameId: string, kind: ArtKind): Promise<boolean> => {
    if (!(await window.portal.uploadArt(gameId, kind))) return false
    setArtOverride(gameId, true)
    setArtPickerId(null)
    setToast({
      message: 'Your image is now this games artwork.', kind: 'info'
    })
    return true
  }, [setArtOverride])

  const performSwitch = useCallback(async (account: SteamAccount) => {
    setSwitching(true)
    try {
      const result = await window.portal.switchAccount(account.steamId)
      setPendingSwitch(null)
      if (result.steam === 'needs-login') {
        setToast({
          message: `Steam hasn't saved a login for ${accountLabel(account)} on this PC, so it will ask you to sign in.`,
          kind: 'info'
        })
      } else if (result.steam === 'steam-not-found') {
        setToast({ message: `Switched Portal to ${accountLabel(account)}. Steam wasn't found, so it wasn't changed.`, kind: 'info' })
      }
    } catch (reason) {
      setPendingSwitch(null)
      setToast({ message: errorMessage(reason), kind: 'error' })
    } finally {
      setSwitching(false)
    }
  }, [])

  const requestSwitch = useCallback(
    (account: SteamAccount) => {
      const steamAlreadyOnAccount = steam?.clientSteamId === account.steamId
      if (account.steamId === accounts.steam.activeId && steamAlreadyOnAccount) return
      if (steamAlreadyOnAccount || !steam?.steamPath) void performSwitch(account)
      else setPendingSwitch(account)
    },
    [accounts.steam.activeId, performSwitch, steam?.clientSteamId, steam?.steamPath]
  )

  const signOut = useCallback(async (account: SteamAccount) => {
    try {
      await window.portal.signOut(account.steamId)
    } catch (reason) {
      setToast({ message: errorMessage(reason), kind: 'error' })
    }
  }, [])

  const linkAccount = useCallback(async (target: LinkedLauncherId, accountId?: string) => {
    try {
      await window.portal.linkAccount(target, accountId)
    } catch (reason) {
      const message = errorMessage(reason)
      if (!/cancelled/i.test(message)) setToast({ message, kind: 'error' })
    }
  }, [])

  const switchLinkedAccount = useCallback(async (target: LinkedLauncherId, accountId: string) => {
    try {
      await window.portal.switchLinkedAccount(target, accountId)
    } catch (reason) {
      setToast({ message: errorMessage(reason), kind: 'error' })
    }
  }, [])

  const unlinkAccount = useCallback(async (target: LinkedLauncherId, accountId: string) => {
    try {
      await window.portal.unlinkAccount(target, accountId)
    } catch (reason) {
      setToast({ message: errorMessage(reason), kind: 'error' })
    }
  }, [])

  const closeDetails = useCallback(() => setSelectedId(null), [])
  const closeSettings = useCallback(() => setSettingsOpen(false), [])
  const closeProfile = useCallback(() => setProfileOpen(false), [])
  const closeAccounts = useCallback(() => setAccountsOpen(false), [])
  const openLauncher = useCallback(async (target: LocalLauncherId) => {
    try {
      await window.portal.openLauncher(target)
    } catch (reason) {
      setToast({ message: errorMessage(reason), kind: 'error' })
    }
  }, [])
  const closeSignIn = useCallback(() => setSignInOpen(false), [])
  const cancelSwitch = useCallback(() => setPendingSwitch(null), [])
  const openSignIn = useCallback(() => setSignInOpen(true), [])

  const account = steam?.account ?? null
  const steamOnOtherAccount = Boolean(account && steam?.clientSteamId && steam.clientSteamId !== account.steamId)
  const noLaunchers = Boolean(
    snapshot &&
    !steam?.steamPath &&
    !LINKED_LAUNCHERS.some((id) => linked?.[id].launcherInstalled) &&
    !LOCAL_LAUNCHERS.some((id) => snapshot.local?.[id]?.launcherInstalled) &&
    allGames.length === 0
  )
  const linkedErrors = LINKED_LAUNCHERS.filter((id) => linked?.[id].error)
  const unlinked = LINKED_LAUNCHERS.filter((id) => linked?.[id].launcherInstalled && !linked[id].account && !linked[id].error)

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 5000)
    return () => clearTimeout(timer)
  }, [toast])

  useEffect(() => {
    window.portal.getSettings().then((settings) => setUseGameLogos(settings.useGameLogos)).catch(() => undefined)
  }, [])

  useEffect(() => {
    let active = true
    window.portal
      .getArtOverrides()
      .then((overrides) => active && setArtOverrides(new Set(overrides)))
      .catch((reason: unknown) => console.error('Could not load SteamGridDB cover overrides:', reason))
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const typing = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement
      if ((event.key === 'f' && (event.ctrlKey || event.metaKey)) || (event.key === '/' && !typing)) {
        event.preventDefault()
        searchRef.current?.focus()
        searchRef.current?.select()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="app">
      <header className="topbar">
        <button
          className="icon-btn sidebar-toggle"
          onClick={() => setSidebar(sidebar === 'open' ? 'closed' : 'open')}
          aria-label={sidebar === 'open' ? 'Hide sidebar' : 'Show sidebar'}
          aria-pressed={sidebar === 'open'}
          title={sidebar === 'open' ? 'Hide sidebar' : 'Show sidebar'}
        >
          <SidebarIcon width={18} height={18} />
        </button>
        <div className="brand">
          Portal
        </div>
        <div className="search">
          <SearchIcon className="search-icon" width={16} height={16} />
          <input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                setQuery('')
                event.currentTarget.blur()
              }
            }}
            placeholder="Search your library"
            spellCheck={false}
          />
        </div>
        <div className="topbar-actions">
          <AccountMenu
            accounts={accounts}
            profile={profile}
            busy={switching}
            onOpenProfile={() => setProfileOpen(true)}
            onOpenAccounts={() => setAccountsOpen(true)}
          />
          <button
            className="icon-btn"
            onClick={() => void refresh()}
            disabled={refreshing}
            aria-label="Refresh library"
            title="Refresh library"
          >
            <RefreshIcon className={refreshing ? 'spin' : undefined} />
          </button>
          <button className="icon-btn" onClick={() => setSettingsOpen(true)} aria-label="Settings" title="Settings">
            <SettingsIcon />
          </button>
        </div>
      </header>

      <div className="workspace">
        {sidebar === 'open' && (
          <Sidebar
            games={allGames}
            collections={collections}
            view={viewCollection ? view : 'all'}
            artRevision={artRevision}
            onView={setView}
            onOpenGame={setSelectedId}
            onConfirmRemove={setPendingRemoval}
          />
        )}
        <div className="content">
          {viewCollection && <h1 className="view-title">{viewCollection.name}</h1>}
          <div className="toolbar">
            <Tabs
              label="Filter games"
              options={FILTERS.map((option) => ({ ...option, count: counts[option.id] }))}
              value={filter}
              onChange={setFilter}
            />
            <div className="toolbar-controls">
              <Dropdown label="Show" options={launcherOptions} value={launcher} onChange={setLauncher} />
              <Dropdown label="Sort by" options={SORTS} value={sort} onChange={setSort} />
            </div>
          </div>

          <main className="library">
            {steam?.steamPath && steam.error && (
              <div className="banner banner-warn">
                <span>{steam.error}</span>
                <button className="btn" onClick={openSignIn}>
                  Sign in again
                </button>
              </div>
            )}
            {linkedErrors.map((id) => (
              <div key={id} className="banner banner-warn">
                <span>{linked?.[id].error}</span>
                <button className="btn" onClick={() => void linkAccount(id, linked?.[id].account?.accountId)}>
                  Sign in to {LAUNCHER_NAMES[id]} again
                </button>
              </div>
            ))}
            {steam?.steamPath && !account && (
              <div className="banner">
                <span>
                  Showing installed games only. Sign in with Steam to see every game you own, plus your Steam Family
                  library.
                </span>
                <button className="btn btn-install" onClick={openSignIn}>
                  Sign in
                </button>
              </div>
            )}
            {account && steamOnOtherAccount && (
              <div className="banner">
                <span>
                  Steam is signed in to a different account than {accountLabel(account)}, so installs and launches will
                  use that account.
                </span>
                <button className="btn" onClick={() => setPendingSwitch(account)} disabled={switching}>
                  Switch Steam to {accountLabel(account)}
                </button>
              </div>
            )}
            {unlinked.length > 0 && (
              <div className="banner">
                <span>
                  Sign in to {unlinked.map((id) => LAUNCHER_NAMES[id]).join(', ').replace(/, ([^,]*)$/, ' and $1')} to
                  see games you own there but haven't installed.
                </span>
                <div className="banner-actions">
                  {unlinked.map((id) => (
                    <button key={id} className="btn" onClick={() => void linkAccount(id)}>
                      {LAUNCHER_NAMES[id]}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {error && <div className="banner banner-warn">{error}</div>}

            {loading ? (
              <div className="grid" aria-busy="true">
                {Array.from({ length: 18 }, (_, index) => (
                  <div key={index} className="card card-skeleton">
                    <div className="card-art" />
                    <div className="skeleton-line" />
                  </div>
                ))}
              </div>
            ) : noLaunchers ? (
              <div className="empty">
                <h2>No game launchers found</h2>
                <p>Install Steam, Epic Games, Ubisoft Connect or the EA app, or tell Portal where Steam lives.</p>
                <button className="btn btn-install" onClick={() => setSettingsOpen(true)}>
                  Choose Steam folder
                </button>
              </div>
            ) : games.length === 0 ? (
              <div className="empty">
                <h2>{query ? 'No matches' : 'Nothing here yet'}</h2>
                <p>
                  {query
                    ? `No games match “${query}”.`
                    : filter === 'not-installed'
                      ? 'Every game you own is installed.'
                      : 'Install a game in any of your launchers and it will show up here.'}
                </p>
              </div>
            ) : (
              <div className="grid">
                {games.map((game: Game) => (
                  <GameCard
                    key={game.id}
                    game={game}
                    onSelect={setSelectedId}
                    onAction={runAction}
                    onQuickReplaceCover={quickReplaceCover}
                    onChooseArtwork={setArtPickerId}
                    onRestoreArtwork={restoreArtwork}
                    hasCustomArt={artOverrides.has(game.id)}
                    collections={collections.collections}
                    onToggleCollection={(collectionId, gameId) => void collections.toggleGame(collectionId, gameId)}
                    onNewCollection={setNewCollectionFor}
                    artRevision={artRevision}
                  />
                ))}
              </div>
            )}
          </main>
        </div>
      </div>

      {selected && (
        <GameDetails
          key={selected.id}
          game={selected}
          onClose={closeDetails}
          onAction={runAction}
          onChooseArtwork={setArtPickerId}
          artPickerOpen={artPickerGame !== null}
          useGameLogos={useGameLogos}
          artRevision={artRevision}
        />
      )}
      {artPickerGame && (
        <SteamGridDbCoverDialog
          game={artPickerGame}
          onClose={() => setArtPickerId(null)}
          onChoose={(type, assetId, search) => chooseArt(artPickerGame.id, type, assetId, search)}
          onUpload={(kind) => uploadArt(artPickerGame.id, kind)}
        />
      )}
      {profileOpen && <ProfileDialog onClose={closeProfile} onSaved={setProfile} />}
      {accountsOpen && (
        <AccountsDialog
          accounts={accounts}
          detected={detectedLaunchers}
          busy={switching}
          covered={signInOpen || pendingSwitch !== null}
          onClose={closeAccounts}
          onSwitch={requestSwitch}
          onAdd={openSignIn}
          onSignOut={(target) => void signOut(target)}
          onLink={(target) => void linkAccount(target)}
          onSwitchLinked={(target, accountId) => void switchLinkedAccount(target, accountId)}
          onUnlink={(target, accountId) => void unlinkAccount(target, accountId)}
          onOpenLauncher={(target) => void openLauncher(target)}
        />
      )}
      {settingsOpen && <SettingsDialog
        onClose={closeSettings}
        onSaved={(settings) => setUseGameLogos(settings.useGameLogos)}
        theme={theme}
        onTheme={setTheme}
      />}
      {signInOpen && <SignInDialog onClose={closeSignIn} />}
      {pendingSwitch && (
        <ConfirmDialog
          title={`Switch to ${accountLabel(pendingSwitch)}?`}
          confirmLabel="Switch and restart Steam"
          busy={switching}
          busyLabel="Switching…"
          onConfirm={() => void performSwitch(pendingSwitch)}
          onCancel={cancelSwitch}
        >
          <p>
            Steam will close and reopen signed in as <strong>{accountLabel(pendingSwitch)}</strong>. Any game running
            through Steam will close.
          </p>
        </ConfirmDialog>
      )}
      {newCollectionFor && (
        <NameDialog
          title="New collection"
          label="Name"
          confirmLabel="Create"
          onCancel={() => setNewCollectionFor(null)}
          onSubmit={(name) => {
            const gameId = newCollectionFor
            setNewCollectionFor(null)
            void collections.create(name, [gameId])
          }}
        />
      )}
      {pendingRemoval && (
        <ConfirmDialog
          title={`Delete “${pendingRemoval.name}”?`}
          confirmLabel="Delete collection"
          onConfirm={() => {
            void collections.remove(pendingRemoval.id)
            setPendingRemoval(null)
          }}
          onCancel={() => setPendingRemoval(null)}
        >
          <p>The games stay in your library, only the collection is removed.</p>
        </ConfirmDialog>
      )}
      {toast && (
        <div className={`toast toast-${toast.kind}`} role="status">
          {toast.message}
        </div>
      )}
    </div>
  )
}
