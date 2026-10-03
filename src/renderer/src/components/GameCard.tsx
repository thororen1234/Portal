import { JSX, memo, useEffect, useState } from 'react'
import type { Collection, Game, GameAction } from '../../../shared/types'
import { formatPlaytime } from '../lib/format'
import { isInstalled, primaryAction, showsBadge, stateLabel } from '../lib/games'
import { ContextMenu } from './ContextMenu'
import { Cover } from './Cover'
import { DownloadIcon, PlayIcon } from './Icons'

interface GameCardProps {
  game: Game
  onSelect: (gameId: string) => void
  onAction: (gameId: string, action: GameAction) => void
  onQuickReplaceCover: (gameId: string) => void
  onChooseArtwork: (gameId: string) => void
  onRestoreArtwork: (gameId: string) => void
  hasCustomArt: boolean
  collections: Collection[]
  onToggleCollection: (collectionId: string, gameId: string) => void
  onNewCollection: (gameId: string) => void
  artRevision: number
}

export const GameCard = memo(function GameCard({
  game,
  onSelect,
  onAction,
  onQuickReplaceCover,
  onChooseArtwork,
  onRestoreArtwork,
  hasCustomArt,
  collections,
  onToggleCollection,
  onNewCollection,
  artRevision
}: GameCardProps): JSX.Element {
  const primary = primaryAction(game)
  const installed = isInstalled(game)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)
  useEffect(() => {
    if (!contextMenu) return
    const close = (): void => setContextMenu(null)
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close()
    }
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [contextMenu])

  return (
    <article
      className={`card${installed ? '' : ' card-missing'}`}
      onContextMenu={(event) => {
        event.preventDefault()
        setContextMenu({ x: event.clientX, y: event.clientY })
      }}
    >
      <div className="card-art">
        <button className="card-hit" onClick={() => onSelect(game.id)} aria-label={`${game.name} details`}>
          <Cover key={`${game.id}:${artRevision}`} game={game} artRevision={artRevision} />
        </button>
        {showsBadge(game) && <span className={`badge badge-${game.state}`}>{stateLabel(game)}</span>}
        <div className="card-action">
          <button
            className={`btn btn-${primary.variant} btn-block`}
            onClick={() => onAction(game.id, primary.action)}
          >
            {primary.variant === 'play' && <PlayIcon width={14} height={14} />}
            {primary.variant === 'install' && <DownloadIcon width={15} height={15} />}
            {primary.label}
          </button>
        </div>
        {game.progress !== null && (
          <div className="progress progress-card">
            <div className="progress-fill" style={{ width: `${game.progress * 100}%` }} />
          </div>
        )}
      </div>
      <div className="card-meta">
        <div className="card-title" title={game.name}>
          {game.name}
        </div>
        <div className="card-sub">
          {installed
            ? formatPlaytime(game.playtimeMinutes)
            : game.source === 'family'
              ? `Shared by ${game.sharedBy[0] ?? 'family'}`
              : 'Not installed'}
        </div>
      </div>
      {contextMenu && (
        <ContextMenu x={contextMenu.x} y={contextMenu.y}>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setContextMenu(null)
              onQuickReplaceCover(game.id)
            }}
          >
            Quick replace with SteamGridDB
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setContextMenu(null)
              onChooseArtwork(game.id)
            }}
          >
            {hasCustomArt ? 'Choose different artwork…' : 'Choose artwork…'}
          </button>
          {hasCustomArt && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setContextMenu(null)
                onRestoreArtwork(game.id)
              }}
            >
              Restore original artwork
            </button>
          )}
          <div className="context-menu-divider" role="separator" />
          <div className="context-menu-label">Collections</div>
          {collections.map((collection) => {
            const included = collection.gameIds.includes(game.id)
            return (
              <button
                key={collection.id}
                type="button"
                role="menuitemcheckbox"
                aria-checked={included}
                className="context-menu-check"
                onClick={() => {
                  setContextMenu(null)
                  onToggleCollection(collection.id, game.id)
                }}
              >
                <span className="context-menu-tick">{included ? '✓' : ''}</span>
                {collection.name}
              </button>
            )
          })}
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setContextMenu(null)
              onNewCollection(game.id)
            }}
          >
            New collection…
          </button>
        </ContextMenu>
      )}
    </article>
  )
})
