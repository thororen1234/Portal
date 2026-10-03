import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { PortalApi } from '../shared/types'

function subscribe<T>(channel: string, listener: (payload: T) => void): () => void {
  const handler = (_event: IpcRendererEvent, payload: T): void => listener(payload)
  ipcRenderer.on(channel, handler)
  return () => {
    ipcRenderer.removeListener(channel, handler)
  }
}

const api: PortalApi = {
  platform: process.platform,
  getLibrary: (options) => ipcRenderer.invoke('library:get', options),
  runAction: (gameId, action) => ipcRenderer.invoke('game:action', gameId, action),
  openLauncher: (launcher) => ipcRenderer.invoke('launcher:open', launcher),
  setTitleBarColors: (colors) => ipcRenderer.invoke('window:title-bar', colors),
  getGameInfo: (gameId) => ipcRenderer.invoke('game:info', gameId),
  getProfile: () => ipcRenderer.invoke('profile:get'),
  getCollections: () => ipcRenderer.invoke('collections:get'),
  saveCollections: (collections) => ipcRenderer.invoke('collections:save', collections),
  updateProfile: (update) => ipcRenderer.invoke('profile:update', update),
  quickReplaceCover: (gameId) => ipcRenderer.invoke('art:quick-replace-cover', gameId),
  restoreArtwork: (gameId) => ipcRenderer.invoke('art:restore', gameId),
  getArtChoices: (gameId, type, filters, search) => ipcRenderer.invoke('art:choices', gameId, type, filters, search),
  chooseArt: (gameId, type, assetId, search) => ipcRenderer.invoke('art:choose', gameId, type, assetId, search),
  uploadArt: (gameId, kind) => ipcRenderer.invoke('art:upload', gameId, kind),
  getArtOverrides: () => ipcRenderer.invoke('art:overrides'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  updateSettings: (update) => ipcRenderer.invoke('settings:update', update),
  getAccounts: () => ipcRenderer.invoke('accounts:get'),
  startSignIn: () => ipcRenderer.invoke('signin:start'),
  startPasswordSignIn: (accountName, password) => ipcRenderer.invoke('signin:password', accountName, password),
  submitSteamGuardCode: (code) => ipcRenderer.invoke('signin:guard-code', code),
  cancelSignIn: () => ipcRenderer.invoke('signin:cancel'),
  switchAccount: (steamId) => ipcRenderer.invoke('accounts:switch', steamId),
  signOut: (steamId) => ipcRenderer.invoke('accounts:sign-out', steamId),
  linkAccount: (launcher, accountId) => ipcRenderer.invoke('accounts:link', launcher, accountId),
  switchLinkedAccount: (launcher, accountId) => ipcRenderer.invoke('accounts:switch-linked', launcher, accountId),
  unlinkAccount: (launcher, accountId) => ipcRenderer.invoke('accounts:unlink', launcher, accountId),
  onLibraryChanged: (listener) => subscribe('library:changed', listener),
  onAccountsChanged: (listener) => subscribe('accounts:changed', listener),
  onSignInEvent: (listener) => subscribe('signin:event', listener)
}

contextBridge.exposeInMainWorld('portal', api)
