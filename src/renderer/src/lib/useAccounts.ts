import { useEffect, useState } from 'react'
import type { AccountsView } from '../../../shared/types'

const EMPTY: AccountsView = {
  steam: { accounts: [], activeId: null },
  linked: {
    epic: { accounts: [], activeId: null },
    ubisoft: { accounts: [], activeId: null },
    ea: { accounts: [], activeId: null }
  }
}

export function useAccounts(): AccountsView {
  const [accounts, setAccounts] = useState<AccountsView>(EMPTY)

  useEffect(() => {
    let active = true
    window.portal
      .getAccounts()
      .then((view) => active && setAccounts(view))
      .catch((error: unknown) => console.error('Could not load accounts:', error))
    const unsubscribe = window.portal.onAccountsChanged(setAccounts)
    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  return accounts
}
