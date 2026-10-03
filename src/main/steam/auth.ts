import { EAuthSessionGuardType, EAuthTokenPlatformType, EResult, LoginSession } from 'steam-session'
import { toDataURL } from 'qrcode'
import type { PasswordSignInStep, SignInEvent, SteamAccount, SteamGuardPrompt } from '../../shared/types'
import { errorMessage } from '../fsutil'
import type { SettingsStore } from '../settings'
import { fetchProfiles } from './api'

const SIGN_IN_TIMEOUT_MS = 5 * 60 * 1000
const TOKEN_EXPIRY_MARGIN_MS = 60 * 1000

const REFRESH_TOKEN_RENEW_WINDOW_MS = 30 * 24 * 60 * 60 * 1000
const MIN_TOKEN_AGE_FOR_RETRY_MS = 5 * 60 * 1000
const AUTH_PLATFORM = EAuthTokenPlatformType.MobileApp

function steamResult(error: unknown): number | null {
  if (!(error instanceof Error) || !('eresult' in error)) return null
  const result = (error as Error & { eresult?: unknown }).eresult
  return typeof result === 'number' ? result : null
}

function isInvalidRefreshToken(error: unknown): boolean {
  const result = steamResult(error)
  return (
    result === EResult.Invalid ||
    result === EResult.Revoked ||
    result === EResult.Expired ||
    result === EResult.CachedCredentialInvalid ||
    (error instanceof Error && /token.*(expired|invalid|revoked)|(expired|invalid|revoked).*token/i.test(error.message))
  )
}

const GUARD_PROMPTS: Partial<Record<EAuthSessionGuardType, SteamGuardPrompt>> = {
  [EAuthSessionGuardType.EmailCode]: 'email-code',
  [EAuthSessionGuardType.DeviceCode]: 'device-code',
  [EAuthSessionGuardType.DeviceConfirmation]: 'device-confirmation',
  [EAuthSessionGuardType.EmailConfirmation]: 'email-confirmation'
}

function signInError(error: unknown): Error {
  switch (steamResult(error)) {
    case EResult.InvalidPassword:
      return new Error('Incorrect account name or password.')
    case EResult.RateLimitExceeded:
    case EResult.AccountLoginDeniedThrottle:
      return new Error('Steam is limiting sign-in attempts from this network. Wait a while before trying again.')
    case EResult.InvalidLoginAuthCode:
    case EResult.TwoFactorCodeMismatch:
      return new Error('That Steam Guard code is incorrect.')
    case EResult.ExpiredLoginAuthCode:
      return new Error('That Steam Guard code has expired.')
  }
  return new Error(errorMessage(error))
}

export class SignedOutError extends Error {
  constructor(readonly account: SteamAccount | null) {
    super(
      `Your Steam sign-in${account ? ` for ${account.personaName || account.accountName}` : ''} has expired. Sign in again from the account menu.`
    )
  }
}

function tokenExpiry(token: string): number {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')) as { exp?: number }
    return payload.exp ? payload.exp * 1000 : 0
  } catch {
    return 0
  }
}

export interface SteamAuthEvents {
  onSignInEvent: (event: SignInEvent) => void
  onSignedIn: (account: SteamAccount) => void
}

export class SteamAuth {
  private login: LoginSession | null = null
  private readonly tokens = new Map<string, { token: string; expiresAt: number; issuedAt: number }>()
  private readonly restored = new Set<string>()
  private readonly renewals = new Map<string, Promise<string>>()

  constructor(
    private readonly settings: SettingsStore,
    private readonly events: SteamAuthEvents
  ) { }

  async startSignIn(): Promise<string> {
    const session = this.beginLogin()
    const { qrChallengeUrl } = await session.startWithQR()
    if (this.login !== session) {
      session.cancelLoginAttempt()
      throw new Error('Sign-in was cancelled.')
    }
    if (!qrChallengeUrl) throw new Error('Steam did not return a sign-in code.')
    return toDataURL(qrChallengeUrl, { width: 320, margin: 1 })
  }

  async startPasswordSignIn(accountName: string, password: string): Promise<PasswordSignInStep> {
    const session = this.beginLogin()
    let response: Awaited<ReturnType<LoginSession['startWithCredentials']>>
    try {
      response = await session.startWithCredentials({ accountName, password })
    } catch (error) {
      if (this.login === session) this.login = null
      throw signInError(error)
    }
    if (this.login !== session) throw new Error('Sign-in was cancelled.')
    if (!response.actionRequired) return { guards: [], emailDomain: null }

    const actions = response.validActions ?? []
    const guards = actions.flatMap((action) => {
      const prompt = GUARD_PROMPTS[action.type]
      return prompt ? [prompt] : []
    })
    if (guards.length === 0) {
      this.cancelSignIn()
      throw new Error("Steam asked for a verification step Portal doesn't support. Sign in with the QR code instead.")
    }
    const emailDomain = actions.find((action) => action.type === EAuthSessionGuardType.EmailCode)?.detail ?? null
    return { guards, emailDomain }
  }

  async submitSteamGuardCode(code: string): Promise<void> {
    const session = this.login
    if (!session) throw new Error('This sign-in attempt has ended. Start again.')
    try {
      await session.submitSteamGuardCode(code)
    } catch (error) {
      throw signInError(error)
    }
  }

  private beginLogin(): LoginSession {
    this.cancelSignIn()

    const session = new LoginSession(AUTH_PLATFORM)
    session.loginTimeout = SIGN_IN_TIMEOUT_MS
    this.login = session

    session.on('remoteInteraction', () => {
      if (this.login === session) this.events.onSignInEvent({ type: 'scanned' })
    })
    session.on('timeout', () => {
      if (this.login !== session) return
      this.login = null
      this.events.onSignInEvent({ type: 'expired' })
    })
    session.on('error', (error) => {
      if (this.login !== session) return
      this.login = null
      this.events.onSignInEvent({ type: 'error', message: errorMessage(error) })
    })
    session.on('authenticated', () => {
      if (this.login === session) void this.finishSignIn(session)
    })
    return session
  }

  cancelSignIn(): void {
    const session = this.login
    this.login = null
    try {
      session?.cancelLoginAttempt()
    } catch {
      return
    }
  }

  async accessToken(steamId: string): Promise<string> {
    if (!this.restored.has(steamId)) {
      this.restored.add(steamId)
      const stored = this.settings.storedAccessToken(steamId)
      if (stored) this.tokens.set(steamId, { token: stored, expiresAt: tokenExpiry(stored), issuedAt: 0 })
    }
    const cached = this.tokens.get(steamId)
    if (cached && cached.expiresAt - TOKEN_EXPIRY_MARGIN_MS > Date.now()) return cached.token

    let renewal = this.renewals.get(steamId)
    if (!renewal) {
      renewal = this.renew(steamId).finally(() => this.renewals.delete(steamId))
      this.renewals.set(steamId, renewal)
    }
    return renewal
  }

  invalidate(steamId: string): void {
    this.tokens.delete(steamId)
  }

  rejectToken(steamId: string): boolean {
    const cached = this.tokens.get(steamId)
    if (cached && Date.now() - cached.issuedAt < MIN_TOKEN_AGE_FOR_RETRY_MS) return false
    this.tokens.delete(steamId)
    void this.settings.saveAccessToken(steamId, null).catch(() => undefined)
    return true
  }

  private async renew(steamId: string): Promise<string> {
    const account = this.settings.account(steamId)
    const refreshToken = this.settings.refreshToken(steamId)
    if (!refreshToken) throw new SignedOutError(account)

    const session = new LoginSession(AUTH_PLATFORM)
    try {
      session.refreshToken = refreshToken
      if (tokenExpiry(refreshToken) - Date.now() < REFRESH_TOKEN_RENEW_WINDOW_MS) {
        if (await session.renewRefreshToken()) await this.settings.updateRefreshToken(steamId, session.refreshToken)
      } else {
        await session.refreshAccessToken()
      }
    } catch (error) {
      if (isInvalidRefreshToken(error)) {
        throw new SignedOutError(account)
      }
      const result = steamResult(error)
      if (result !== null) {
        throw new Error(`Steam rejected Portal's saved sign-in (${EResult[result] ?? `result ${result}`}). Try signing in again.`)
      }
      throw new Error('Could not reach Steam to refresh your sign-in.')
    }
    this.remember(steamId, session.accessToken)
    await this.settings.saveAccessToken(steamId, session.accessToken).catch(() => undefined)
    return session.accessToken
  }

  private remember(steamId: string, token: string): void {
    this.tokens.set(steamId, { token, expiresAt: tokenExpiry(token), issuedAt: Date.now() })
  }

  private async finishSignIn(session: LoginSession): Promise<void> {
    if (this.login === session) this.login = null
    try {
      const steamId = session.steamID.getSteamID64()
      if (!session.accessToken) await session.refreshAccessToken()
      this.remember(steamId, session.accessToken)
      const profile = (await fetchProfiles([steamId])).get(steamId)
      const account: SteamAccount = {
        steamId,
        accountName: session.accountName ?? '',
        personaName: profile?.personaName || session.accountName || steamId,
        avatarUrl: profile?.avatarUrl ?? null
      }
      await this.settings.saveAccount(account, session.refreshToken)
      await this.settings.saveAccessToken(steamId, session.accessToken)
      this.events.onSignInEvent({ type: 'signed-in', account })
      this.events.onSignedIn(account)
    } catch (error) {
      this.events.onSignInEvent({ type: 'error', message: errorMessage(error) })
    }
  }
}
