import type { BrowserWindow } from 'electron'
import type { LinkedAccount } from '../../shared/types'
import { clearLoginSession, loginPartition, saveSignedInAccount } from '../loginSessions'
import { openLoginWindow, type LoginAttempt } from '../loginWindow'
import type { SettingsStore } from '../settings'

export const UBI_APP_ID = 'f68a4bb5-608a-4ff2-8123-be8ef797e0a6'
const UBI_GENOME_ID = '954e66a0-be1b-4aa0-9690-fb75201e4e9e'
const LOGIN_URL = `https://connect.ubisoft.com/login?appId=${UBI_APP_ID}&genomeId=${UBI_GENOME_ID}&lang=en-US&nextUrl=https:%2F%2Fconnect.ubisoft.com%2F`
const SESSIONS_URL = 'https://public-ubiservices.ubi.com/v3/profiles/sessions'
const SESSIONS_V2_URL = 'https://public-ubiservices.ubi.com/v2/profiles/sessions'
export const UBI_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
const EXPIRY_MARGIN_MS = 5 * 60 * 1000
const DEFAULT_SESSION_MS = 2 * 60 * 60 * 1000
const MIN_SESSION_AGE_FOR_RETRY_MS = 5 * 60 * 1000

export interface UbisoftSession {
  ticket: string
  sessionId: string
  userId: string
  expiresAt: number
}

interface StoredSession extends UbisoftSession {
  rememberMeTicket?: string
}

interface SessionResponse {
  ticket?: string
  sessionId?: string
  userId?: string
  nameOnPlatform?: string
  expiration?: string
  serverTime?: string
  rememberMeTicket?: string | null
}

export class UbisoftSignedOutError extends Error {
  constructor() {
    super('Your Ubisoft Connect sign-in has expired. Sign in again from the account menu.')
  }
}

function expiresAt(response: SessionResponse): number {
  const expiration = Date.parse(response.expiration ?? '')
  const serverTime = Date.parse(response.serverTime ?? '')
  if (Number.isFinite(expiration) && Number.isFinite(serverTime)) return Date.now() + (expiration - serverTime)
  return Date.now() + DEFAULT_SESSION_MS
}

async function requestSession(
  method: 'POST' | 'PUT',
  authorization: string,
  options: { url?: string; sessionId?: string; body?: boolean } = {}
): Promise<SessionResponse> {
  let response: Response
  try {
    response = await fetch(options.url ?? SESSIONS_URL, {
      method,
      headers: {
        Authorization: authorization,
        'Ubi-AppId': UBI_APP_ID,
        'Content-Type': 'application/json',
        'User-Agent': UBI_USER_AGENT,
        ...(options.sessionId ? { 'Ubi-SessionId': options.sessionId } : {}),
        Origin: 'https://connect.ubisoft.com',
        Referer: 'https://connect.ubisoft.com/'
      },
      body: method === 'POST' && options.body !== false ? JSON.stringify({ rememberMe: true }) : undefined
    })
  } catch {
    throw new Error('Could not reach Ubisoft Connect.')
  }
  if (response.status === 400 || response.status === 401 || response.status === 403) throw new UbisoftSignedOutError()
  if (!response.ok) throw new Error(`Ubisoft Connect returned an error (${response.status}).`)
  return (await response.json()) as SessionResponse
}

function parseStorageValue(value: unknown): Record<string, unknown> {
  if (typeof value !== 'string') return {}
  try {
    const parsed = JSON.parse(value) as unknown
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

export class UbisoftAuth {
  private readonly sessions = new Map<string, StoredSession>()
  private readonly issuedAt = new Map<string, number>()
  private readonly renewals = new Map<string, Promise<UbisoftSession>>()
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

    const { partition, reused } = loginPartition(this.settings, 'ubisoft', reuseAccountId)
    const attempt = openLoginWindow<LinkedAccount>({
      url: LOGIN_URL,
      title: 'Sign in to Ubisoft Connect',
      partition,
      parent: this.parentWindow(),
      width: 480,
      height: 720,
      pollMs: 700,
      check: async (contents, url) => {
        if (!url.startsWith('https://connect.ubisoft.com/')) return null
        const raw = (await contents.executeJavaScript(
          "JSON.stringify([localStorage.getItem('PRODloginData'), localStorage.getItem('PRODrememberMe')])"
        )) as string
        const [loginData, rememberMe] = JSON.parse(raw) as unknown[]
        const values = { ...parseStorageValue(rememberMe), ...parseStorageValue(loginData) }
        const { ticket, sessionId, userId, nameOnPlatform, rememberMeTicket } = values
        if (typeof ticket !== 'string' || typeof sessionId !== 'string' || typeof userId !== 'string') return null
        return this.finishSignIn(partition, {
          ticket,
          sessionId,
          userId,
          displayName: typeof nameOnPlatform === 'string' ? nameOnPlatform : 'Ubisoft',
          rememberMeTicket: typeof rememberMeTicket === 'string' ? rememberMeTicket : undefined
        })
      }
    })
    this.signInAttempt = attempt
    void attempt.promise.catch(() => (reused ? undefined : clearLoginSession(partition))).finally(() => {
      if (this.signInAttempt === attempt) this.signInAttempt = null
    })
    return attempt.promise
  }

  async signOut(accountId: string): Promise<void> {
    this.sessions.delete(accountId)
    await clearLoginSession(this.settings.linkedPartition('ubisoft', accountId))
    await this.settings.removeLinkedAccount('ubisoft', accountId)
  }

  rejectToken(accountId: string): boolean {
    const issued = this.issuedAt.get(accountId)
    if (issued && Date.now() - issued < MIN_SESSION_AGE_FOR_RETRY_MS) return false
    const session = this.sessions.get(accountId) ?? this.storedSession(accountId)
    if (session) {
      session.expiresAt = 0
      this.sessions.set(accountId, session)
    }
    return true
  }

  async currentSession(accountId: string): Promise<UbisoftSession> {
    const session = this.sessions.get(accountId) ?? this.storedSession(accountId)
    if (session && session.expiresAt - EXPIRY_MARGIN_MS > Date.now()) {
      this.sessions.set(accountId, session)
      return session
    }
    let renewal = this.renewals.get(accountId)
    if (!renewal) {
      renewal = this.renew(accountId, session).finally(() => this.renewals.delete(accountId))
      this.renewals.set(accountId, renewal)
    }
    return renewal
  }

  private storedSession(accountId: string): StoredSession | null {
    const token = this.settings.linkedToken('ubisoft', accountId)
    if (!token) return null
    try {
      return JSON.parse(token) as StoredSession
    } catch {
      return null
    }
  }

  private async renew(accountId: string, previous: StoredSession | null): Promise<UbisoftSession> {
    if (!previous) throw new UbisoftSignedOutError()
    let response: SessionResponse
    try {
      response = await requestSession('PUT', `Ubi_v1 t=${previous.ticket}`)
    } catch (error) {
      if (!(error instanceof UbisoftSignedOutError) || !previous.rememberMeTicket) throw error
      response = await requestSession('POST', `rm_v1 t=${previous.rememberMeTicket}`)
    }
    return this.store(accountId, response, previous)
  }

  private async store(accountId: string, response: SessionResponse, previous: StoredSession): Promise<UbisoftSession> {
    if (!response.ticket || !response.sessionId) throw new UbisoftSignedOutError()
    const session: StoredSession = {
      ticket: response.ticket,
      sessionId: response.sessionId,
      userId: response.userId ?? previous.userId,
      expiresAt: expiresAt(response),
      rememberMeTicket: response.rememberMeTicket || previous.rememberMeTicket
    }
    this.sessions.set(accountId, session)
    this.issuedAt.set(accountId, Date.now())
    await this.settings.updateLinkedToken('ubisoft', accountId, JSON.stringify(session))
    return session
  }

  private async finishSignIn(partition: string, login: {
    ticket: string
    sessionId: string
    userId: string
    displayName: string
    rememberMeTicket?: string
  }): Promise<LinkedAccount> {
    const account: LinkedAccount = {
      accountId: login.userId,
      displayName: login.displayName,
      avatarUrl: `https://ubisoft-avatars.akamaized.net/${login.userId}/default_146_146.png`
    }
    let session: StoredSession = {
      ticket: login.ticket,
      sessionId: login.sessionId,
      userId: login.userId,
      expiresAt: Date.now() + DEFAULT_SESSION_MS,
      rememberMeTicket: login.rememberMeTicket
    }
    try {
      const upgraded = await requestSession('POST', `Ubi_v1 t=${login.ticket}`, {
        url: SESSIONS_V2_URL,
        sessionId: login.sessionId,
        body: false
      })
      if (upgraded.ticket && upgraded.sessionId) {
        session = {
          ticket: upgraded.ticket,
          sessionId: upgraded.sessionId,
          userId: upgraded.userId ?? login.userId,
          expiresAt: expiresAt(upgraded),
          rememberMeTicket: upgraded.rememberMeTicket || login.rememberMeTicket
        }
      }
    } catch (error) {
      console.error('Could not upgrade the Ubisoft Connect session:', error)
    }
    await saveSignedInAccount(this.settings, 'ubisoft', account, JSON.stringify(session), partition)
    this.sessions.set(account.accountId, session)
    this.issuedAt.set(account.accountId, Date.now())
    return account
  }
}
