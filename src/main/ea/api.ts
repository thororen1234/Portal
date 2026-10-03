import { net } from 'electron'

const GRAPHQL_URL = 'https://service-aggregation-layer.juno.ea.com/graphql'
const PAGE_SIZE = 100
const OFFER_BATCH = 100

const ENTITLEMENTS_QUERY = `query getEntitlements($limit: Int, $next: String) {
  me {
    ownedGameProducts(
      locale: "DEFAULT"
      entitlementEnabled: true
      storefronts: [EA]
      type: [DIGITAL_FULL_GAME, PACKAGED_FULL_GAME]
      platforms: [PC]
      paging: { limit: $limit, next: $next }
    ) {
      next
      items {
        originOfferId
        product { baseItem { gameType } }
      }
    }
  }
}`

const OFFERS_QUERY = `query getOffers($offerIds: [String!]!) {
  legacyOffers(offerIds: $offerIds, locale: "DEFAULT") {
    offerId: id
    contentId
  }
  gameProducts(offerIds: $offerIds, locale: "DEFAULT") {
    items {
      id
      originOfferId
      gameSlug
      baseItem {
        title
        keyArt { largestImage { path } }
        packArt { largestImage { path } }
      }
    }
  }
}`

export class EaApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
  }
}

export interface EaOwnedGame {
  contentId: string
  offerId: string
  title: string
  packArt: string | null
  keyArt: string | null
}

interface GameProduct {
  id?: string
  originOfferId?: string
  baseItem?: {
    title?: string
    keyArt?: { largestImage?: { path?: string } | null } | null
    packArt?: { largestImage?: { path?: string } | null } | null
  }
}

async function query<T>(token: string, body: { query: string; variables?: Record<string, unknown> }): Promise<T> {
  let response: Response
  try {
    response = await net.fetch(GRAPHQL_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        AuthToken: token,
        'X-AuthToken': token,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ variables: {}, ...body })
    })
  } catch {
    throw new EaApiError('Could not reach EA. Showing your last known library.', 0)
  }
  if (!response.ok) throw new EaApiError(`EA returned an error (${response.status}).`, response.status)
  const result = (await response.json()) as { data?: T; errors?: Array<{ message?: string }> }
  if (!result.data) {
    const message = result.errors?.[0]?.message
    throw new EaApiError(message ? `EA returned an error: ${message}` : 'EA returned an empty response.', 200)
  }
  return result.data
}

async function fetchEaAvatar(token: string): Promise<string | null> {
  try {
    const data = await query<{
      me?: { player?: { avatar?: { large?: { path?: string } | null; medium?: { path?: string } | null } | null } }
    }>(token, { query: 'query { me { player { avatar { large { path } medium { path } } } } }' })
    const avatar = data.me?.player?.avatar
    return avatar?.large?.path ?? avatar?.medium?.path ?? null
  } catch {
    return null
  }
}

export async function fetchEaIdentity(
  token: string
): Promise<{ userId: string; displayName: string; avatarUrl: string | null }> {
  const data = await query<{ me?: { player?: { pd?: string | number; displayName?: string } } }>(token, {
    query: 'query { me { player { pd psd displayName } } }'
  })
  const player = data.me?.player
  if (!player?.pd) throw new Error('EA did not return an account.')
  return { userId: String(player.pd), displayName: player.displayName ?? '', avatarUrl: await fetchEaAvatar(token) }
}

export async function fetchOwnedEaGames(token: string): Promise<EaOwnedGame[]> {
  const offerIds: string[] = []
  let next: string | null = null
  do {
    const data: {
      me?: {
        ownedGameProducts?: {
          next?: string | null
          items?: Array<{ originOfferId?: string; product?: { baseItem?: { gameType?: string } } | null }>
        }
      }
    } = await query(token, { query: ENTITLEMENTS_QUERY, variables: { limit: PAGE_SIZE, next } })
    const page = data.me?.ownedGameProducts
    for (const item of page?.items ?? []) {
      if (item.originOfferId && item.product?.baseItem?.gameType === 'BASE_GAME') offerIds.push(item.originOfferId)
    }
    next = page?.next ?? null
  } while (next)

  const games = new Map<string, EaOwnedGame>()
  for (let i = 0; i < offerIds.length; i += OFFER_BATCH) {
    const batch = offerIds.slice(i, i + OFFER_BATCH)
    const data = await query<{
      legacyOffers?: Array<{ offerId?: string; contentId?: string } | null>
      gameProducts?: { items?: Array<GameProduct | null> }
    }>(token, { query: OFFERS_QUERY, variables: { offerIds: batch } })

    const products = (data.gameProducts?.items ?? []).filter((item): item is GameProduct => Boolean(item))
    const byOffer = new Map(products.filter((p) => p.originOfferId).map((p) => [p.originOfferId!, p]))
    const byId = new Map(products.filter((p) => p.id).map((p) => [p.id!, p]))

    for (const offer of data.legacyOffers ?? []) {
      if (!offer?.offerId || !offer.contentId) continue
      const product = byOffer.get(offer.offerId) ?? byId.get(offer.contentId) ?? byId.get(offer.offerId)
      const title = product?.baseItem?.title
      if (!title || games.has(offer.contentId)) continue
      games.set(offer.contentId, {
        contentId: offer.contentId,
        offerId: offer.offerId,
        title,
        packArt: product.baseItem?.packArt?.largestImage?.path ?? null,
        keyArt: product.baseItem?.keyArt?.largestImage?.path ?? null
      })
    }
  }
  return [...games.values()]
}
