import { JSX, useEffect, useState } from 'react'
import type { Game, GameAction } from '../../../shared/types'
import { formatBytes, formatLastPlayed, formatPlaytime } from '../lib/format'
import { artUrl, idLabel, isInstalled, isPlayable, LAUNCHER_NAMES, primaryAction, showsBadge, stateLabel, supports } from '../lib/games'
import { Cover } from './Cover'
import { AchievementsSection, OverviewSection, useGameInfo } from './GameInfoSections'
import {
  CalendarIcon,
  ClockIcon,
  CloseIcon,
  DownloadIcon,
  DriveIcon,
  ExternalIcon,
  FolderIcon,
  GamepadIcon,
  HashIcon,
  ImageIcon,
  PlayIcon,
  StoreIcon,
  TrashIcon,
  UserIcon
} from './Icons'

interface GameDetailsProps {
  game: Game
  onClose: () => void
  onAction: (gameId: string, action: GameAction) => void
  onChooseArtwork: (gameId: string) => void
  artPickerOpen: boolean
  useGameLogos: boolean
  artRevision: number
}

export function GameDetails({
  game,
  onClose,
  onAction,
  onChooseArtwork,
  artPickerOpen,
  useGameLogos,
  artRevision
}: GameDetailsProps): JSX.Element {
  const [heroFailed, setHeroFailed] = useState(false)
  const [logoFailed, setLogoFailed] = useState(false)
  const primary = primaryAction(game)
  const installed = isInstalled(game)
  const { info, loading: infoLoading } = useGameInfo(game)
  const overview = info?.overview

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !artPickerOpen) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, artPickerOpen])

  useEffect(() => {
    setHeroFailed(false)
    setLogoFailed(false)
  }, [game.id, useGameLogos, artRevision])

  return (
    <div className="overlay" onMouseDown={onClose}>
      <section
        className="details"
        role="dialog"
        aria-modal="true"
        aria-label={game.name}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="details-hero">
          {heroFailed ? (
            <img className="details-hero-fallback" src={artUrl(game, 'header')} alt="" />
          ) : (
            <img src={artUrl(game, 'hero')} alt="" onError={() => setHeroFailed(true)} />
          )}
          <button className="icon-btn details-close" onClick={onClose} aria-label="Close">
            <CloseIcon />
          </button>
        </div>

        <div className="details-body">
          <div className="details-side">
            <div className="details-cover">
              <Cover game={game} eager artRevision={artRevision} />
            </div>
            <dl className="stats">
              <div>
                <GamepadIcon width={16} height={16} />
                <dt>Platform</dt>
                <dd>{LAUNCHER_NAMES[game.launcher]}</dd>
              </div>
              <div>
                <ClockIcon width={16} height={16} />
                <dt>Play time</dt>
                <dd>{formatPlaytime(game.playtimeMinutes)}</dd>
              </div>
              <div>
                <CalendarIcon width={16} height={16} />
                <dt>Last played</dt>
                <dd>{formatLastPlayed(game.lastPlayed)}</dd>
              </div>
              <div>
                <DriveIcon width={16} height={16} />
                <dt>Size on disk</dt>
                <dd>{formatBytes(game.sizeOnDisk)}</dd>
              </div>
              <div>
                <HashIcon width={16} height={16} />
                <dt>{idLabel(game)}</dt>
                <dd>
                  <button
                    className="stats-copy"
                    onClick={() => void navigator.clipboard.writeText(game.appId)}
                    title={`Copy ${game.appId}`}
                    aria-label={`Copy ${idLabel(game)}: ${game.appId}`}
                  >
                    {game.appId}
                  </button>
                </dd>
              </div>
              {overview && overview.developers.length > 0 && (
                <div>
                  <UserIcon width={16} height={16} />
                  <dt>Developer</dt>
                  <dd>{overview.developers.join(', ')}</dd>
                </div>
              )}
              {overview && overview.publishers.length > 0 && (
                <div>
                  <StoreIcon width={16} height={16} />
                  <dt>Publisher</dt>
                  <dd>{overview.publishers.join(', ')}</dd>
                </div>
              )}
              {overview?.releaseDate && (
                <div>
                  <CalendarIcon width={16} height={16} />
                  <dt>Release date</dt>
                  <dd>{overview.releaseDate}</dd>
                </div>
              )}
            </dl>
          </div>

          <div className="details-main">
            {useGameLogos && !logoFailed ? (
              <img className="details-logo" src={artUrl(game, 'logo')} alt={game.name} onError={() => setLogoFailed(true)} />
            ) : (
              <h2 className="details-title">{game.name}</h2>
            )}
            {showsBadge(game) && (
              <div className="details-state-row">
                <span className={`state state-${game.state}`}>{stateLabel(game)}</span>
              </div>
            )}
            {game.source === 'family' && (
              <div className="details-shared">Shared through Steam Family by {game.sharedBy.join(', ')}</div>
            )}
            {game.progress !== null && (
              <div className="progress progress-details">
                <div className="progress-fill" style={{ width: `${game.progress * 100}%` }} />
              </div>
            )}

            <div className="details-actions">
              <button
                className={`btn btn-${primary.variant} btn-large`}
                onClick={() => onAction(game.id, primary.action)}
                autoFocus
              >
                {primary.variant === 'play' && <PlayIcon width={16} height={16} />}
                {primary.variant === 'install' && <DownloadIcon />}
                {primary.label}
              </button>
              {isPlayable(game) && game.installPath && (
                <button className="btn" onClick={() => onAction(game.id, 'folder')}>
                  <FolderIcon width={16} height={16} />
                  Browse files
                </button>
              )}
              {supports(game, 'store') && (
                <button className="btn" onClick={() => onAction(game.id, 'store')}>
                  <StoreIcon width={16} height={16} />
                  Store page
                </button>
              )}
              <button className="btn" onClick={() => onChooseArtwork(game.id)}>
                <ImageIcon width={16} height={16} />
                Choose artwork
              </button>
              {installed && supports(game, 'uninstall') && (
                <button className="btn btn-danger" onClick={() => onAction(game.id, 'uninstall')}>
                  <TrashIcon width={16} height={16} />
                  Uninstall
                </button>
              )}
              {installed && !supports(game, 'uninstall') && supports(game, 'downloads') && primary.action !== 'downloads' && (
                <button className="btn" onClick={() => onAction(game.id, 'downloads')}>
                  <ExternalIcon width={16} height={16} />
                  Open {LAUNCHER_NAMES[game.launcher]}
                </button>
              )}
            </div>

            {game.installPath && installed && <p className="details-path">{game.installPath}</p>}

            {info?.overview && <OverviewSection overview={info.overview} />}
            {info?.achievements && <AchievementsSection achievements={info.achievements} />}
            {infoLoading && <p className="details-loading">Loading game info…</p>}
            {info?.error && !info.overview && !info.achievements && <p className="details-loading">{info.error}</p>}
          </div>
        </div>
      </section>
    </div>
  )
}
