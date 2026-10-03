import { CSSProperties, type FormEvent, JSX, useEffect, useState } from 'react'
import type { ArtKind, Game, SteamGridDbAssetType, SteamGridDbCover, SteamGridDbFilters, SteamGridDbSearch } from '../../../shared/types'
import { errorMessage } from '../lib/format'
import { steamGridDbPreviewUrl } from '../lib/games'
import { Dropdown } from './Dropdown'
import { CloseIcon } from './Icons'

interface SteamGridDbCoverDialogProps {
  game: Game
  onClose: () => void
  onChoose: (type: SteamGridDbAssetType, coverId: string, search?: SteamGridDbSearch) => Promise<void>

  onUpload: (kind: ArtKind) => Promise<boolean>
}

const UPLOAD_KINDS: Record<SteamGridDbAssetType, ArtKind> = {
  grid: 'cover',
  'wide-grid': 'header',
  hero: 'hero',
  logo: 'logo',
  icon: 'icon'
}

type FilterChoice = 'any' | 'true' | 'false'

interface PickerFilters {
  nsfw: FilterChoice
  humor: FilterChoice
  epilepsy: FilterChoice
  types: 'all' | 'static' | 'animated'
  mimes: 'all' | 'image/png' | 'image/jpeg' | 'image/webp'
  styles: 'all' | 'alternate' | 'blurred' | 'material' | 'no_logo' | 'white_logo'
  dimensions: string
}

const DEFAULT_FILTERS: PickerFilters = {
  nsfw: 'false', humor: 'any', epilepsy: 'any', types: 'all', mimes: 'all', styles: 'all', dimensions: ''
}

const CHOICE_OPTIONS: Array<{ id: FilterChoice; label: string }> = [
  { id: 'any', label: 'Any' },
  { id: 'false', label: 'False' },
  { id: 'true', label: 'True' }
]

const TYPE_OPTIONS: Array<{ id: PickerFilters['types']; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'static', label: 'Static' },
  { id: 'animated', label: 'Animated' }
]

const MIME_OPTIONS: Array<{ id: PickerFilters['mimes']; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'image/png', label: 'PNG' },
  { id: 'image/jpeg', label: 'JPEG' },
  { id: 'image/webp', label: 'WebP' }
]

const STYLE_OPTIONS: Array<{ id: PickerFilters['styles']; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'alternate', label: 'Alternate' },
  { id: 'blurred', label: 'Blurred' },
  { id: 'material', label: 'Material' },
  { id: 'no_logo', label: 'No logo' },
  { id: 'white_logo', label: 'White logo' }
]

function apiFilters(filters: PickerFilters): SteamGridDbFilters {
  return {
    nsfw: filters.nsfw === 'any' ? 'any' : filters.nsfw === 'true',
    humor: filters.humor === 'any' ? 'any' : filters.humor === 'true',
    epilepsy: filters.epilepsy === 'any' ? 'any' : filters.epilepsy === 'true',
    types: filters.types === 'all' ? 'static,animated' : filters.types,
    ...(filters.mimes === 'all' ? {} : { mimes: filters.mimes }),
    ...(filters.styles === 'all' ? {} : { styles: filters.styles }),
    ...(filters.dimensions.trim() ? { dimensions: filters.dimensions.trim() } : {})
  }
}

function coverLabel(cover: SteamGridDbCover): string {
  const size = cover.width && cover.height ? `${cover.width} × ${cover.height}` : null
  return [size, cover.style].filter(Boolean).join(' · ') || 'SteamGridDB cover'
}

export function SteamGridDbCoverDialog({ game, onClose, onChoose, onUpload }: SteamGridDbCoverDialogProps): JSX.Element {
  const [covers, setCovers] = useState<SteamGridDbCover[] | null>(null)
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [selecting, setSelecting] = useState<string | null>(null)
  const [type, setType] = useState<SteamGridDbAssetType>('grid')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [filters, setFilters] = useState<PickerFilters>(DEFAULT_FILTERS)
  const [widthScale, setWidthScale] = useState(7)
  const [searchName, setSearchName] = useState(game.name)
  const [searchId, setSearchId] = useState('')
  const [search, setSearch] = useState<SteamGridDbSearch | undefined>()
  const filterKey = JSON.stringify(filters)
  const searchKey = JSON.stringify(search)

  useEffect(() => {
    let active = true
    setCovers(null)
    setFailed(new Set())
    setError(null)
    window.portal
      .getArtChoices(game.id, type, apiFilters(filters), search)
      .then((choices) => active && setCovers(choices))
      .catch((reason: unknown) => active && setError(errorMessage(reason)))
    return () => {
      active = false
    }
  }, [filterKey, game.id, searchKey, type])

  const visible = covers?.filter((cover) => !failed.has(cover.id)) ?? null

  function updateFilter<Key extends keyof PickerFilters>(key: Key, value: PickerFilters[Key]): void {
    setFilters((current) => ({ ...current, [key]: value }))
  }

  function submitSearch(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    const name = searchName.trim()
    const id = searchId.trim()
    if (id && !/^\d+$/.test(id)) {
      setError('SteamGridDB game ID must be a positive whole number.')
      return
    }
    const gameId = id ? Number(id) : undefined
    if (gameId !== undefined && (!Number.isSafeInteger(gameId) || gameId <= 0)) {
      setError('SteamGridDB game ID must be a positive whole number.')
      return
    }
    setError(null)
    setSearch(name || gameId ? { ...(name ? { name } : {}), ...(gameId ? { gameId } : {}) } : undefined)
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !event.defaultPrevented && !selecting) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, selecting])

  async function upload(): Promise<void> {
    setError(null)
    setSelecting('upload')
    try {
      if (!(await onUpload(UPLOAD_KINDS[type]))) setSelecting(null)
    } catch (reason) {
      setError(errorMessage(reason))
      setSelecting(null)
    }
  }

  async function choose(coverId: string): Promise<void> {
    setSelecting(coverId)
    setError(null)
    try {
      await onChoose(type, coverId, search)
    } catch (reason) {
      setError(errorMessage(reason))
      setSelecting(null)
    }
  }

  return (
    <div className="overlay" onMouseDown={() => !selecting && onClose()}>
      <section
        className="dialog cover-picker"
        role="dialog"
        aria-modal="true"
        aria-labelledby="steamgriddb-cover-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="dialog-header">
          <div>
            <h2 id="steamgriddb-cover-title">Choose artwork</h2>
            <p className="cover-picker-title">{game.name}</p>
          </div>
          <button className="icon-btn" onClick={onClose} disabled={Boolean(selecting)} aria-label="Close">
            <CloseIcon />
          </button>
        </header>
        <form className="steamgriddb-search" onSubmit={submitSearch}>
          <label>
            <span>Game name</span>
            <input value={searchName} onChange={(event) => setSearchName(event.target.value)} placeholder={game.name} />
          </label>
          <label>
            <span>SteamGridDB game ID</span>
            <input value={searchId} onChange={(event) => setSearchId(event.target.value)} inputMode="numeric" placeholder="Optional" />
          </label>
          <button type="submit" className="btn btn-install" disabled={Boolean(selecting)}>Search</button>
        </form>
        <div className="art-type-tabs">
          {(['hero', 'logo', 'grid', 'wide-grid', 'icon'] as SteamGridDbAssetType[]).map((candidate) => (
            <button key={candidate} type="button" className={candidate === type ? 'active' : ''} onClick={() => setType(candidate)}>
              {candidate === 'wide-grid' ? 'Wide Grid' : candidate[0].toUpperCase() + candidate.slice(1)}
            </button>
          ))}
          <button type="button" className={filtersOpen ? 'active' : ''} onClick={() => setFiltersOpen((open) => !open)}>Filters</button>
          <button type="button" className="art-upload btn" onClick={() => void upload()} disabled={Boolean(selecting)}>
            Upload your own…
          </button>
        </div>

        {filtersOpen && (
          <div className="steamgriddb-filters">
            <Dropdown className="filter-dropdown" label="NSFW" options={CHOICE_OPTIONS} value={filters.nsfw} onChange={(value) => updateFilter('nsfw', value)} />
            <Dropdown className="filter-dropdown" label="Humor" options={CHOICE_OPTIONS} value={filters.humor} onChange={(value) => updateFilter('humor', value)} />
            <Dropdown className="filter-dropdown" label="Epilepsy" options={CHOICE_OPTIONS} value={filters.epilepsy} onChange={(value) => updateFilter('epilepsy', value)} />
            <Dropdown className="filter-dropdown" label="Types" options={TYPE_OPTIONS} value={filters.types} onChange={(value) => updateFilter('types', value)} />
            <Dropdown className="filter-dropdown" label="Mimes" options={MIME_OPTIONS} value={filters.mimes} onChange={(value) => updateFilter('mimes', value)} />
            <Dropdown className="filter-dropdown" label="Styles" options={STYLE_OPTIONS} value={filters.styles} onChange={(value) => updateFilter('styles', value)} />
            <label><span>Dimensions</span><input value={filters.dimensions} onChange={(event) => updateFilter('dimensions', event.target.value)} placeholder="Any" /></label>
            <label><span>Width scale</span><input type="number" min="4" max="12" value={widthScale} onChange={(event) => setWidthScale(Math.max(4, Math.min(12, Number(event.target.value) || 7)))} /></label>
          </div>
        )}

        {error && <p className="dialog-error">{error}</p>}
        {!covers && !error && <p className="cover-picker-status">Loading SteamGridDB artwork…</p>}
        {visible?.length === 0 && <p className="cover-picker-status">No matching SteamGridDB artwork was found.</p>}
        {visible && visible.length > 0 && (
          <div className={`cover-picker-grid cover-picker-grid-${type}`} style={{ '--picker-width-scale': widthScale } as CSSProperties}>
            {visible.map((cover) => (
              <button
                key={cover.id}
                className={`cover-picker-option${cover.style === 'black' ? ' cover-picker-option-black' : ''}`}
                onClick={() => void choose(cover.id)}
                disabled={Boolean(selecting)}
                aria-label={`Use ${coverLabel(cover)}`}
              >
                <img
                  src={steamGridDbPreviewUrl(game.id, type, cover.id, search)}
                  alt=""
                  loading="lazy"
                  draggable={false}
                  onError={() => setFailed((current) => new Set(current).add(cover.id))}
                />
                <span>{selecting === cover.id ? 'Applying…' : coverLabel(cover)}</span>
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
