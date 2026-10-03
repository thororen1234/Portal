/// <reference types="vite/client" />
import type { PortalApi } from '../../shared/types'

declare global {
  interface Window {
    portal: PortalApi
  }
}
