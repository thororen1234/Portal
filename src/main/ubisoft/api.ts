import { UBI_APP_ID, UBI_USER_AGENT, type UbisoftSession } from './auth'

const ENTITLEMENTS_URL = 'https://api-ubiservices.ubi.com/v1/profiles/me/global/ubiconnect/entitlement/api/entitlements'
const GRAPHQL_URL = 'https://public-ubiservices.ubi.com/v1/profiles/me/uplay/graphql'
const DETAILS_BATCH = 50

const OWNED_GAMES_QUERY = `query GetOwnedGames($spaceIds: [String!]) {
  games(spaceIds: $spaceIds) {
    id
    spaceId
    name
    platform { ...PlatformFragment }
    availablePlatformGroups { ...PlatformFragment }
    availablePlatforms { nodes { ...PlatformFragment } }
  }
}
fragment PlatformFragment on Platform { id name type applicationId }`

export class UbisoftApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
  }
}

export interface UbisoftOwnedGame {
  productId: string
  spaceId: string | null
  name: string | null
}

interface Entitlement {
  spaceId?: string
  productId?: string | number
  accessLevel?: string
  type?: string
  availability?: string
}

interface GraphGame {
  spaceId?: string
  id?: string
  name?: string
}

async function request<T>(session: UbisoftSession, url: string, init: { method?: string; body?: string } = {}): Promise<T> {
  let response: Response
  try {
    response = await fetch(url, {
      method: init.method ?? 'GET',
      body: init.body,
      headers: {
        Authorization: `Ubi_v1 t=${session.ticket}`,
        'Ubi-AppId': UBI_APP_ID,
        'Ubi-SessionId': session.sessionId,
        'Ubi-LocaleCode': 'en-US',
        'User-Agent': UBI_USER_AGENT,
        ...(init.body ? { 'Content-Type': 'application/json' } : {})
      }
    })
  } catch {
    throw new UbisoftApiError('Could not reach Ubisoft Connect. Showing your last known library.', 0)
  }
  if (!response.ok) throw new UbisoftApiError(`Ubisoft Connect returned an error (${response.status}).`, response.status)
  return (await response.json()) as T
}

function hasPcPlatform(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasPcPlatform)
  if (value && typeof value === 'object') {
    if (String((value as { type?: unknown }).type ?? '').toUpperCase() === 'PC') return true
    return Object.values(value).some(hasPcPlatform)
  }
  return false
}

export async function fetchOwnedUbisoftGames(session: UbisoftSession): Promise<UbisoftOwnedGame[]> {
  const body = await request<{ entitlements?: Entitlement[] | { nodes?: Entitlement[] } }>(session, ENTITLEMENTS_URL)
  const raw = Array.isArray(body.entitlements) ? body.entitlements : (body.entitlements?.nodes ?? [])

  const owned = new Map<string, UbisoftOwnedGame>()
  for (const entitlement of raw) {
    if (String(entitlement.accessLevel ?? '').toLowerCase() !== 'owned') continue
    if (String(entitlement.type ?? '').toLowerCase() !== 'game') continue
    if (String(entitlement.availability ?? '').toLowerCase() === 'expired') continue
    const productId = String(entitlement.productId ?? '').trim()
    if (!/^\d+$/.test(productId) || owned.has(productId)) continue
    owned.set(productId, { productId, spaceId: entitlement.spaceId?.trim() || null, name: null })
  }

  const bySpace = new Map([...owned.values()].filter((game) => game.spaceId).map((game) => [game.spaceId!, game]))
  const spaceIds = [...bySpace.keys()]
  const pcSpaces = new Set<string>()
  let detailsLoaded = false
  for (let i = 0; i < spaceIds.length; i += DETAILS_BATCH) {
    try {
      const response = await request<{ data?: { games?: GraphGame[] } }>(session, GRAPHQL_URL, {
        method: 'POST',
        body: JSON.stringify({
          operationName: 'GetOwnedGames',
          variables: { spaceIds: spaceIds.slice(i, i + DETAILS_BATCH) },
          query: OWNED_GAMES_QUERY
        })
      })
      detailsLoaded = true
      for (const game of response.data?.games ?? []) {
        const spaceId = game.spaceId ?? game.id
        const match = spaceId ? bySpace.get(spaceId) : undefined
        if (!match) continue
        if (game.name) match.name = game.name.trim()
        if (hasPcPlatform(game)) pcSpaces.add(spaceId!)
      }
    } catch (error) {
      if (error instanceof UbisoftApiError && error.status === 401) throw error
      continue
    }
  }

  return [...owned.values()].filter((game) => !detailsLoaded || !game.spaceId || pcSpaces.has(game.spaceId))
}
