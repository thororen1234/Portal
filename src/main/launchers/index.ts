import type { LocalLauncherId } from '../../shared/types'
import { amazon } from './amazon'
import { battlenet } from './battlenet'
import { gog } from './gog'
import { hoyoplay } from './hoyoplay'
import { humble } from './humble'
import { itch } from './itch'
import { meta } from './meta'
import { minecraft } from './minecraft'
import { riot } from './riot'
import { rockstar } from './rockstar'
import type { LauncherIntegration } from './types'
import { googleplay, legacy } from './uninstallBased'
import { xbox } from './xbox'

export const LOCAL_INTEGRATIONS: Record<LocalLauncherId, LauncherIntegration> = {
  gog,
  amazon,
  battlenet,
  xbox,
  riot,
  rockstar,
  hoyoplay,
  meta,
  itch,
  humble,
  legacy,
  googleplay,
  minecraft
}
