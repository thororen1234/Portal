import { app } from 'electron'

export function cleanUserAgent(userAgent: string): string {
  const appToken = app.getName().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return userAgent.replace(new RegExp(String.raw`\s(Electron|${appToken}|portal)\/\S+`, 'gi'), '')
}
