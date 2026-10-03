import { BrowserWindow, net } from 'electron'
import type { LinkedAccount } from '../../shared/types'
import { clearLoginSession, loginPartition, saveSignedInAccount } from '../loginSessions'
import { openLoginWindow, type LoginAttempt } from '../loginWindow'
import type { SettingsStore } from '../settings'

const CLIENT_ID = '34a02cf8f4414e29b15921876da36f9a'
const CLIENT_SECRET = 'daafbccc737745039dffe53d94fc76cf'
const TOKEN_URL = 'https://account-public-service-prod03.ol.epicgames.com/account/api/oauth/token'
const REDIRECT_URL = `https://www.epicgames.com/id/api/redirect?clientId=${CLIENT_ID}&responseType=code`
const LOGIN_URL = `https://www.epicgames.com/id/login?redirectUrl=${encodeURIComponent(REDIRECT_URL)}`
const EXPIRY_MARGIN_MS = 60 * 1000
const MIN_TOKEN_AGE_FOR_RETRY_MS = 5 * 60 * 1000
const MAX_LOGIN_RETRIES = 3

interface TokenResponse {
  access_token: string
  expires_at: string
  refresh_token?: string
  account_id?: string
  displayName?: string
}

interface CachedToken {
  token: string
  expiresAt: number
  issuedAt?: number
}

export class EpicSignedOutError extends Error {
  constructor() {
    super('Your Epic Games sign-in has expired. Sign in again from the account menu.')
  }
}

async function requestToken(params: Record<string, string>): Promise<TokenResponse> {
  let response: Response
  try {
    response = await net.fetch(TOKEN_URL, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({ ...params, token_type: 'eg1' }).toString()
    })
  } catch {
    throw new Error('Could not reach Epic Games.')
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { errorCode?: string; errorMessage?: string }

    if (
      response.status === 401 ||
      /invalid_grant|invalid_refresh_token|auth_token|authorization_code|invalid_token/i.test(body.errorCode ?? '')
    ) {
      throw new EpicSignedOutError()
    }
    throw new Error(body.errorMessage || `Epic Games returned an error (${response.status}).`)
  }
  return (await response.json()) as TokenResponse
}

function cache(response: TokenResponse): CachedToken {
  return {
    token: response.access_token,
    expiresAt: Date.parse(response.expires_at) || Date.now() + 60 * 60 * 1000,
    issuedAt: Date.now()
  }
}

function isFresh(token: CachedToken | null): token is CachedToken {
  return token !== null && token.expiresAt - EXPIRY_MARGIN_MS > Date.now()
}

export class EpicAuth {
  private readonly userTokens = new Map<string, CachedToken>()
  private readonly restored = new Set<string>()
  private clientToken: CachedToken | null = null
  private readonly renewals = new Map<string, Promise<string>>()
  private signInAttempt: LoginAttempt<LinkedAccount> | null = null

  constructor(
    private readonly settings: SettingsStore,
    private readonly parentWindow: () => BrowserWindow | null
  ) { }

  signIn(reuseAccountId?: string): Promise<LinkedAccount> {
    if (this.signInAttempt && !this.signInAttempt.window.isDestroyed()) {
      this.signInAttempt.window.focus()
      return this.signInAttempt.promise
    }

    let retries = 0
    const { partition, reused } = loginPartition(this.settings, 'epic', reuseAccountId)
    const attempt = openLoginWindow<LinkedAccount>({
      url: LOGIN_URL,
      title: 'Sign in to Epic Games',
      partition,
      parent: this.parentWindow(),
      check: async (contents, url) => {
        if (!url.startsWith('https://www.epicgames.com/id/api/redirect')) return null
        const body = JSON.parse(await contents.executeJavaScript('document.body.innerText')) as {
          authorizationCode?: string | null
        }
        if (!body.authorizationCode) {
          if (++retries > MAX_LOGIN_RETRIES) throw new Error('Epic Games did not complete the sign-in.')
          void contents.loadURL(LOGIN_URL)
          return null
        }
        return this.exchange(body.authorizationCode, partition)
      }
    })
    this.signInAttempt = attempt
    void attempt.promise.catch(() => (reused ? undefined : clearLoginSession(partition))).finally(() => {
      if (this.signInAttempt === attempt) this.signInAttempt = null
    })
    return attempt.promise
  }

  async signOut(accountId: string): Promise<void> {
    this.userTokens.delete(accountId)
    await clearLoginSession(this.settings.linkedPartition('epic', accountId))
    await this.settings.removeLinkedAccount('epic', accountId)
  }

  async accessToken(accountId: string): Promise<string> {
    if (!this.restored.has(accountId)) {
      this.restored.add(accountId)
      const stored = this.settings.storedLinkedAccessToken('epic', accountId)
      if (stored) this.userTokens.set(accountId, stored)
    }
    const cached = this.userTokens.get(accountId) ?? null
    if (isFresh(cached)) return cached.token
    let renewal = this.renewals.get(accountId)
    if (!renewal) {
      renewal = this.renewUserToken(accountId).finally(() => this.renewals.delete(accountId))
      this.renewals.set(accountId, renewal)
    }
    return renewal
  }

  async clientAccessToken(): Promise<string> {
    if (isFresh(this.clientToken)) return this.clientToken.token
    this.clientToken = cache(await requestToken({ grant_type: 'client_credentials' }))
    return this.clientToken.token
  }

  rejectToken(accountId: string): boolean {
    const cached = this.userTokens.get(accountId)
    if (cached?.issuedAt && Date.now() - cached.issuedAt < MIN_TOKEN_AGE_FOR_RETRY_MS) return false
    this.userTokens.delete(accountId)
    void this.settings.saveLinkedAccessToken('epic', accountId, null).catch(() => undefined)
    return true
  }

  private async renewUserToken(accountId: string): Promise<string> {
    const refreshToken = this.settings.linkedToken('epic', accountId)
    if (!refreshToken) throw new EpicSignedOutError()
    const response = await requestToken({ grant_type: 'refresh_token', refresh_token: refreshToken })
    if (response.refresh_token) await this.settings.updateLinkedToken('epic', accountId, response.refresh_token)
    const token = cache(response)
    this.userTokens.set(accountId, token)
    await this.settings.saveLinkedAccessToken('epic', accountId, token).catch(() => undefined)
    return token.token
  }

  private async exchange(code: string, partition: string): Promise<LinkedAccount> {
    const response = await requestToken({ grant_type: 'authorization_code', code })
    if (!response.account_id || !response.refresh_token) throw new Error('Epic Games did not return an account.')
    const account: LinkedAccount = {
      accountId: response.account_id,
      displayName: response.displayName || 'Epic Games',
      avatarUrl: null
    }
    await saveSignedInAccount(this.settings, 'epic', account, response.refresh_token, partition)
    const token = cache(response)
    this.userTokens.set(account.accountId, token)
    this.restored.add(account.accountId)
    await this.settings.saveLinkedAccessToken('epic', account.accountId, token).catch(() => undefined)
    return account
  }
}
