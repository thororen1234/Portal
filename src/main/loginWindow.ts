import { BrowserWindow, type WebContents } from 'electron'
import { cleanUserAgent } from './userAgent'

export interface LoginWindowOptions<T> {
  url: string
  title: string
  partition: string
  parent: BrowserWindow | null
  width?: number
  height?: number
  pollMs?: number
  clearSessionAfter?: boolean
  interceptUrl?: (url: string) => boolean
  check: (contents: WebContents, url: string) => Promise<T | null>
}

export interface LoginAttempt<T> {
  window: BrowserWindow
  promise: Promise<T>
}

export function openLoginWindow<T>(options: LoginWindowOptions<T>): LoginAttempt<T> {
  const parent = options.parent ?? undefined
  const login = new BrowserWindow({
    parent,
    modal: Boolean(parent),
    width: options.width ?? 520,
    height: options.height ?? 780,
    title: options.title,
    autoHideMenuBar: true,
    backgroundColor: '#121212',
    webPreferences: { partition: options.partition, contextIsolation: true, nodeIntegration: false, sandbox: true }
  })
  const session = login.webContents.session
  session.setUserAgent(cleanUserAgent(session.getUserAgent()))
  login.webContents.setWindowOpenHandler(() => ({ action: 'allow' }))

  const promise = new Promise<T>((resolve, reject) => {
    let settled = false
    let checking = false
    let timer: NodeJS.Timeout | null = null

    const settle = (complete: () => void): void => {
      if (settled) return
      settled = true
      if (timer) clearInterval(timer)
      complete()
      if (!login.isDestroyed()) login.close()
      if (options.clearSessionAfter) void session.clearStorageData().catch(() => undefined)
    }

    const run = async (url: string): Promise<void> => {
      if (settled || checking || login.isDestroyed()) return
      checking = true
      try {
        const result = await options.check(login.webContents, url)
        if (result !== null) settle(() => resolve(result))
      } catch (error) {
        settle(() => reject(error))
      } finally {
        checking = false
      }
    }

    const intercept = (event: { preventDefault: () => void }, url: string): void => {
      if (!options.interceptUrl?.(url)) return
      event.preventDefault()
      void run(url)
    }

    login.webContents.on('will-redirect', intercept)
    login.webContents.on('will-navigate', intercept)
    login.webContents.on('did-finish-load', () => void run(login.webContents.getURL()))
    login.webContents.on('did-navigate-in-page', (_event, url) => void run(url))
    if (options.pollMs) {
      timer = setInterval(() => {
        if (!login.isDestroyed()) void run(login.webContents.getURL())
      }, options.pollMs)
    }
    login.on('closed', () => settle(() => reject(new Error(`${options.title} was cancelled.`))))
    void login.loadURL(options.url)
  })

  return { window: login, promise }
}
