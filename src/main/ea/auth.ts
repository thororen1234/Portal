import { session, type BrowserWindow } from 'electron'
import type { LinkedAccount } from '../../shared/types'
import { clearLoginSession, loginPartition, saveSignedInAccount } from '../loginSessions'
import { openLoginWindow, type LoginAttempt } from '../loginWindow'
import type { SettingsStore } from '../settings'
import { fetchEaIdentity } from './api'

const LEGACY_PARTITION = 'persist:ea-login'
const LOGIN_URL = 'https://www.ea.com/login'
const TOKEN_URL =
  'https://accounts.ea.com/connect/auth?client_id=ORIGIN_JS_SDK&response_type=token&redirect_uri=nucleus:rest&prompt=none'
const EXPIRY_MARGIN_MS = 5 * 60 * 1000
const MIN_TOKEN_AGE_FOR_RETRY_MS = 5 * 60 * 1000

interface TokenResponse {
  access_token?: string
  expires_in?: number | string
  error?: string
}

export class EaSignedOutError extends Error {
  constructor() {
    super('Your EA sign-in has expired. Sign in again from the account menu.')
  }
}

export class EaAuth {
  private readonly tokens = new Map<string, { value: string; expiresAt: number; issuedAt: number }>()
  private readonly restored = new Set<string>()
  private readonly renewals = new Map<string, Promise<string>>()
  private signInAttempt: LoginAttempt<LinkedAccount> | null = null

  constructor(
    private readonly settings: SettingsStore,
    private readonly parentWindow: () => BrowserWindow | null
  ) {}

                                                                                              
  signIn(reuseAccountId?: string): Promise<LinkedAccount> {
    if (this.signInAttempt && !this.signInAttempt.window.isDestroyed()) {
      this.signInAttempt.window.focus()
      return this.signInAttempt.promise
    }

    const { partition, reused } = loginPartition(this.settings, 'ea', reuseAccountId)
    const attempt = openLoginWindow<LinkedAccount>({
      url: LOGIN_URL,
      title: 'Sign in to EA',
      partition,
      parent: this.parentWindow(),
      check: async (_contents, url) => {
        if (!/^https:\/\/www\.ea\.com\//.test(url)) return null
        try {
          return await this.finishSignIn(partition)
        } catch (error) {
          if (error instanceof EaSignedOutError) return null
          throw error
        }
      }
    })
    this.signInAttempt = attempt
    void attempt.promise
      .catch(() => (reused ? undefined : clearLoginSession(partition)))
      .finally(() => {
        if (this.signInAttempt === attempt) this.signInAttempt = null
      })
    return attempt.promise
  }

  async signOut(accountId: string): Promise<void> {
    this.tokens.delete(accountId)
    await clearLoginSession(this.partitionFor(accountId))
    await this.settings.removeLinkedAccount('ea', accountId)
  }

                                                                                                 
  rejectToken(accountId: string): boolean {
    const cached = this.tokens.get(accountId)
    if (cached && Date.now() - cached.issuedAt < MIN_TOKEN_AGE_FOR_RETRY_MS) return false
    this.tokens.delete(accountId)
    void this.settings.saveLinkedAccessToken('ea', accountId, null).catch(() => undefined)
    return true
  }

  async accessToken(accountId: string): Promise<string> {
    if (!this.restored.has(accountId)) {
      this.restored.add(accountId)
      const stored = this.settings.storedLinkedAccessToken('ea', accountId)
      if (stored) this.tokens.set(accountId, { value: stored.token, expiresAt: stored.expiresAt, issuedAt: 0 })
    }
    const cached = this.tokens.get(accountId)
    if (cached && cached.expiresAt - EXPIRY_MARGIN_MS > Date.now()) return cached.value
    let renewal = this.renewals.get(accountId)
    if (!renewal) {
      renewal = this.requestToken(this.partitionFor(accountId))
        .then(async (token) => {
          this.tokens.set(accountId, token)
          await this.settings
            .saveLinkedAccessToken('ea', accountId, { token: token.value, expiresAt: token.expiresAt })
            .catch(() => undefined)
          return token.value
        })
        .finally(() => this.renewals.delete(accountId))
      this.renewals.set(accountId, renewal)
    }
    return renewal
  }

  private partitionFor(accountId: string): string {
    return this.settings.linkedPartition('ea', accountId) ?? LEGACY_PARTITION
  }

  private async requestToken(partition: string): Promise<{ value: string; expiresAt: number; issuedAt: number }> {
    let body: TokenResponse
    const store = session.fromPartition(partition)
    try {
      const response = await store.fetch(TOKEN_URL, { credentials: 'include' })
      body = (await response.json()) as TokenResponse
    } catch {
      throw new Error('Could not reach EA.')
    }
                                                                                      
                                                                                    
    await store.cookies.flushStore().catch(() => undefined)
    if (!body.access_token) throw new EaSignedOutError()
    const seconds = Number(body.expires_in) || 3600
    return { value: body.access_token, expiresAt: Date.now() + seconds * 1000, issuedAt: Date.now() }
  }

  private async finishSignIn(partition: string): Promise<LinkedAccount> {
    const token = await this.requestToken(partition)
    const identity = await fetchEaIdentity(token.value)
    const account: LinkedAccount = {
      accountId: identity.userId,
      displayName: identity.displayName || 'EA',
      avatarUrl: identity.avatarUrl
    }
    await saveSignedInAccount(this.settings, 'ea', account, null, partition)
    this.tokens.set(account.accountId, token)
    this.restored.add(account.accountId)
    await this.settings
      .saveLinkedAccessToken('ea', account.accountId, { token: token.value, expiresAt: token.expiresAt })
      .catch(() => undefined)
    return account
  }
}
