import { JSX, useEffect, useRef, useState } from 'react'
import type { AccountsView, UserProfile } from '../../../shared/types'
import { LINKED_LAUNCHERS } from '../lib/games'
import { Avatar } from './Avatar'
import { ChevronDownIcon, UserIcon, UsersIcon } from './Icons'

interface AccountMenuProps {
  accounts: AccountsView
  profile: UserProfile | null
  busy: boolean
  onOpenProfile: () => void
  onOpenAccounts: () => void
}

export function AccountMenu({ accounts, profile, busy, onOpenProfile, onOpenAccounts }: AccountMenuProps): JSX.Element {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const active = accounts.steam.accounts.find((account) => account.steamId === accounts.steam.activeId) ?? null
  const firstLinked =
    LINKED_LAUNCHERS.map((launcher) => {
      const group = accounts.linked[launcher]
      return group.accounts.find((account) => account.accountId === group.activeId)
    }).find(Boolean) ?? null
  const signedIn =
    accounts.steam.accounts.length + LINKED_LAUNCHERS.reduce((sum, launcher) => sum + accounts.linked[launcher].accounts.length, 0)
  const avatarUrl = profile?.hasCustomAvatar ? profile.avatarUrl : (active?.avatarUrl ?? null)
  const identityName = profile?.customName ?? (active ? active.personaName || active.accountName : null)
  const hasIdentity = Boolean(identityName || avatarUrl)

  useEffect(() => {
    if (!open) return
    const onPointer = (event: MouseEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointer)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const choose = (action: () => void) => () => {
    setOpen(false)
    action()
  }

  return (
    <div className="account-menu" ref={rootRef}>
      <button
        className={`account-button${hasIdentity ? '' : ' account-button-empty'}`}
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={busy}
      >
        {hasIdentity && <Avatar name={identityName || 'P'} url={avatarUrl} size={22} />}
        <span className="account-button-name">
          {identityName ?? firstLinked?.displayName ?? 'Sign in'}
        </span>
        <ChevronDownIcon width={14} height={14} />
      </button>

      {open && (
        <div className="account-panel account-panel-compact" role="menu">
          <button className="account-menu-item" role="menuitem" onClick={choose(onOpenProfile)}>
            <UserIcon width={16} height={16} />
            View profile
          </button>
          <button className="account-menu-item" role="menuitem" onClick={choose(onOpenAccounts)}>
            <UsersIcon width={16} height={16} />
            <span>Accounts</span>
            <span className="account-menu-count">{signedIn > 0 ? `${signedIn} signed in` : 'Sign in'}</span>
          </button>
        </div>
      )}
    </div>
  )
}
