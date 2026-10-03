import { net } from 'electron'
import type { GameAction, GameOverview } from '../../shared/types'
import { htmlToText } from '../text'
import type { LauncherGame, LauncherIntegration } from './types'
import { launchDetached, openUri, runPowerShell, unsupported } from './util'

const LIST_GAMES = `
$ErrorActionPreference = 'SilentlyContinue'
$games = Get-AppxPackage | Where-Object {
  -not $_.IsFramework -and $_.SignatureKind -eq 'Store' -and $_.InstallLocation -and
  (Test-Path (Join-Path $_.InstallLocation 'MicrosoftGame.config'))
} | ForEach-Object {
  $manifest = Get-AppxPackageManifest $_
  $app = @($manifest.Package.Applications.Application)[0]
  [pscustomobject]@{
    family = $_.PackageFamilyName
    appId = $app.Id
    name = [string]$manifest.Package.Properties.DisplayName
    location = $_.InstallLocation
  }
}
ConvertTo-Json -InputObject @($games) -Compress
`

interface PackageInfo {
  family: string
  appId: string
  name: string
  location: string
}

interface CatalogImage {
  ImagePurpose?: string
  Uri?: string
  Width?: number
}

interface CatalogResponse {
  Products?: Array<{
    ProductId?: string
    LocalizedProperties?: Array<{
      ProductTitle?: string
      ShortDescription?: string
      ProductDescription?: string
      DeveloperName?: string
      PublisherName?: string
      Images?: CatalogImage[]
    }>
    Properties?: { Categories?: string[]; Category?: string }
    MarketProperties?: Array<{ OriginalReleaseDate?: string }>
  }>
}

const productIds = new Map<string, string>()

async function lookup(family: string): Promise<NonNullable<CatalogResponse['Products']>[number] | null> {
  const url = `https://displaycatalog.mp.microsoft.com/v7.0/products/lookup?${new URLSearchParams({
    market: 'US',
    languages: 'en-us',
    value: family,
    alternateId: 'PackageFamilyName',
    fieldsTemplate: 'details'
  })}`
  const response = await net.fetch(url)
  if (!response.ok) throw new Error(`The Microsoft Store returned an error (${response.status}).`)
  const product = ((await response.json()) as CatalogResponse).Products?.[0] ?? null
  if (product?.ProductId) productIds.set(family, product.ProductId)
  return product
}

function image(images: CatalogImage[], ...purposes: string[]): string | undefined {
  for (const purpose of purposes) {
    const match = images
      .filter((candidate) => candidate.ImagePurpose === purpose && candidate.Uri)
      .sort((a, b) => (b.Width ?? 0) - (a.Width ?? 0))[0]
    if (match?.Uri) return match.Uri.startsWith('//') ? `https:${match.Uri}` : match.Uri
  }
  return undefined
}

async function productId(family: string): Promise<string | null> {
  return productIds.get(family) ?? (await lookup(family).catch(() => null))?.ProductId ?? null
}

export const xbox: LauncherIntegration = {
  id: 'xbox',

  async detect() {
    return process.platform === 'win32'
  },

  async games() {
    if (process.platform !== 'win32') return []
    const output = (await runPowerShell(LIST_GAMES)).trim()
    if (!output) return []
    const packages = JSON.parse(output) as PackageInfo[]
    return packages.map((info) => ({
      appId: info.family,
      name: info.name && !info.name.startsWith('ms-resource:') ? info.name : info.family.split('_')[0],
      installed: true,
      installPath: info.location,
      extra: { appId: info.appId }
    }))
  },

  async enrich(game: LauncherGame) {
    const product = await lookup(game.appId)
    const details = product?.LocalizedProperties?.[0]
    if (!details) return null
    const images = details.Images ?? []
    const released = product?.MarketProperties?.[0]?.OriginalReleaseDate
    const overview: GameOverview = {
      shortDescription: details.ShortDescription ? htmlToText(details.ShortDescription) : null,
      description: details.ProductDescription ? htmlToText(details.ProductDescription) : null,
      developers: details.DeveloperName ? [details.DeveloperName] : [],
      publishers: details.PublisherName ? [details.PublisherName] : [],
      releaseDate: released ? new Date(released).toLocaleDateString('en-US', { dateStyle: 'medium' }) : null,
      genres: product?.Properties?.Categories ?? (product?.Properties?.Category ? [product.Properties.Category] : []),
      website: null
    }
    return {
      art: {
        cover: image(images, 'Poster', 'BoxArt'),
        header: image(images, 'SuperHeroArt', 'TitledHeroArt', 'BoxArt'),
        hero: image(images, 'SuperHeroArt', 'TitledHeroArt'),
        logo: image(images, 'Logo'),
        icon: image(images, 'BoxArt', 'Logo')
      },
      overview
    }
  },

  async open() {
    await openUri('msxbox://')
  },

  async run(game: LauncherGame, action: GameAction) {
    switch (action) {
      case 'play':
        return launchDetached('explorer.exe', [`shell:AppsFolder\\${game.appId}!${game.extra?.appId ?? 'App'}`])
      case 'uninstall':
      case 'downloads': {
        const id = await productId(game.appId)
        return openUri(id ? `msxbox://gameinstall?productId=${id}` : 'msxbox://downloads')
      }
      case 'store': {
        const id = await productId(game.appId)
        if (!id) throw new Error('Could not find this game in the Microsoft Store.')
        return openUri(`ms-windows-store://pdp/?ProductId=${id}`)
      }
      default:
        return unsupported()
    }
  }
}
