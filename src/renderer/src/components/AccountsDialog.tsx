import { JSX, useEffect } from 'react'
import type { AccountsView, LinkedLauncherId, LocalLauncherId, SteamAccount } from '../../../shared/types'
import { LAUNCHER_NAMES, LINKED_LAUNCHERS } from '../lib/games'
import { Avatar } from './Avatar'
import { CloseIcon, PlusIcon, SignOutIcon } from './Icons'

export interface DetectedLauncher {
  launcher: LocalLauncherId
  games: number
  installed: number
}

interface AccountsDialogProps {
  accounts: AccountsView
  detected: DetectedLauncher[]
  busy: boolean

  covered: boolean
  onClose: () => void
  onSwitch: (account: SteamAccount) => void
  onAdd: () => void
  onSignOut: (account: SteamAccount) => void
  onLink: (launcher: LinkedLauncherId) => void
  onSwitchLinked: (launcher: LinkedLauncherId, accountId: string) => void
  onUnlink: (launcher: LinkedLauncherId, accountId: string) => void
  onOpenLauncher: (launcher: LocalLauncherId) => void
}

interface RowProps {
  name: string
  sub: string
  avatarUrl: string | null
  active: boolean
  busy: boolean
  onUse: () => void
  onRemove: () => void
}

function AccountRow({ name, sub, avatarUrl, active, busy, onUse, onRemove }: RowProps): JSX.Element {
  return (
    <li className={`accounts-row${active ? ' accounts-row-active' : ''}`}>
      <Avatar name={name} url={avatarUrl} size={36} />
      <span className="accounts-row-text">
        <span className="accounts-row-name">{name}</span>
        <span className="accounts-row-sub">{sub}</span>
      </span>
      {active ? (
        <span className="accounts-pill accounts-pill-active">Active</span>
      ) : (
        <button type="button" className="btn accounts-use" onClick={onUse} disabled={busy}>
          Use
        </button>
      )}
      <button
        type="button"
        className="icon-btn accounts-remove"
        onClick={onRemove}
        disabled={busy}
        aria-label={`Remove ${name} from Portal`}
        title="Remove from Portal"
      >
        <SignOutIcon width={16} height={16} />
      </button>
    </li>
  )
}

function LauncherCard({
  name,
  count,
  children,
  addLabel,
  onAdd,
  busy
}: {
  name: string
  count: number
  children: JSX.Element[]
  addLabel: string
  onAdd: () => void
  busy: boolean
}): JSX.Element {
  return (
    <section className="accounts-card">
      <header className="accounts-card-head">
        <h3>{name}</h3>
        <span className={`accounts-pill${count > 0 ? '' : ' accounts-pill-muted'}`}>
          {count > 0 ? `${count} signed in` : 'Not signed in'}
        </span>
      </header>
      {count > 0 ? <ul className="accounts-list">{children}</ul> : <p className="accounts-empty">Sign in to see games you own here but haven't installed.</p>}
      <button type="button" className="accounts-add" onClick={onAdd} disabled={busy}>
        <PlusIcon width={15} height={15} />
        {addLabel}
      </button>
    </section>
  )
}

export function AccountsDialog({
  accounts,
  detected,
  busy,
  covered,
  onClose,
  onSwitch,
  onAdd,
  onSignOut,
  onLink,
  onSwitchLinked,
  onUnlink,
  onOpenLauncher
}: AccountsDialogProps): JSX.Element {
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !covered && !event.defaultPrevented) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, covered])

  const steam = accounts.steam

  return (
    <div className="overlay" onMouseDown={() => !covered && onClose()}>
      <section
        className="dialog accounts-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="accounts-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="dialog-header">
          <div>
            <h2 id="accounts-title">Accounts</h2>
            <p className="profile-subtitle">Sign in to see everything you own, and switch between accounts.</p>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <CloseIcon />
          </button>
        </header>

        <div className="accounts-grid">
          <LauncherCard
            name="Steam"
            count={steam.accounts.length}
            addLabel={steam.accounts.length > 0 ? 'Add Steam account' : 'Sign in to Steam'}
            onAdd={onAdd}
            busy={busy}
          >
            {steam.accounts.map((account) => (
              <AccountRow
                key={account.steamId}
                name={account.personaName || account.accountName}
                sub={account.accountName || 'Steam account'}
                avatarUrl={account.avatarUrl}
                active={account.steamId === steam.activeId}
                busy={busy}
                onUse={() => onSwitch(account)}
                onRemove={() => onSignOut(account)}
              />
            ))}
          </LauncherCard>

          {LINKED_LAUNCHERS.map((launcher) => {
            const group = accounts.linked[launcher]
            const name = LAUNCHER_NAMES[launcher]
            return (
              <LauncherCard
                key={launcher}
                name={name}
                count={group.accounts.length}
                addLabel={group.accounts.length > 0 ? `Add ${name} account` : `Sign in to ${name}`}
                onAdd={() => onLink(launcher)}
                busy={busy}
              >
                {group.accounts.map((account) => (
                  <AccountRow
                    key={account.accountId}
                    name={account.displayName}
                    sub={`${name} account`}
                    avatarUrl={account.avatarUrl}
                    active={account.accountId === group.activeId}
                    busy={busy}
                    onUse={() => onSwitchLinked(launcher, account.accountId)}
                    onRemove={() => onUnlink(launcher, account.accountId)}
                  />
                ))}
              </LauncherCard>
            )
          })}
        </div>

        {detected.length > 0 && (
          <>
            <h3 className="accounts-section-title">Found on this PC</h3>
            <p className="field-help accounts-section-help">
              Portal reads these from each launcher's files. To sign in, or to see and install games you own that
              aren't listed yet, open the launcher and sign in there.
            </p>
            <ul className="accounts-detected">
              {detected.map((entry) => (
                <li key={entry.launcher}>
                  <span className="accounts-detected-text">
                    <span className="accounts-row-name">{LAUNCHER_NAMES[entry.launcher]}</span>
                    <span className="accounts-row-sub">
                      {entry.games === 0
                        ? 'No games found yet'
                        : `${entry.games.toLocaleString()} ${entry.games === 1 ? 'game' : 'games'} · ${entry.installed.toLocaleString()} installed`}
                    </span>
                  </span>
                  <button type="button" className="btn accounts-use" onClick={() => onOpenLauncher(entry.launcher)}>
                    Open
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  )
}
