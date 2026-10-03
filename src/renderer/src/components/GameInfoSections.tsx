import { JSX, useEffect, useState } from 'react'
import type { Achievement, Game, GameAchievements, GameInfo, GameOverview } from '../../../shared/types'
import { errorMessage } from '../lib/format'
import { CheckIcon } from './Icons'

const ACHIEVEMENT_PREVIEW = 8

export function useGameInfo(game: Game): { info: GameInfo | null; loading: boolean } {
  const [info, setInfo] = useState<GameInfo | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    setInfo(null)
    setLoading(true)
    window.portal
      .getGameInfo(game.id)
      .then((next) => active && setInfo(next))
      .catch((reason: unknown) => active && setInfo({ overview: null, achievements: null, error: errorMessage(reason) }))
      .finally(() => active && setLoading(false))
    return () => {
      active = false
    }
  }, [game.id])

  return { info, loading }
}

export function OverviewSection({ overview }: { overview: GameOverview }): JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const body = overview.description ?? overview.shortDescription
  const long = (body?.length ?? 0) > 420

  return (
    <section className="details-section">
      <h3 className="details-section-title">About</h3>
      {overview.genres.length > 0 && (
        <div className="genre-list">
          {overview.genres.map((genre) => (
            <span key={genre} className="genre">
              {genre}
            </span>
          ))}
        </div>
      )}
      {overview.shortDescription && overview.description && <p className="overview-lead">{overview.shortDescription}</p>}
      {body && (
        <>
          <p className={`overview-text${long && !expanded ? ' overview-text-clamped' : ''}`}>{body}</p>
          {long && (
            <button type="button" className="link-btn" onClick={() => setExpanded((value) => !value)}>
              {expanded ? 'Show less' : 'Read more'}
            </button>
          )}
        </>
      )}
    </section>
  )
}

function AchievementRow({ achievement }: { achievement: Achievement }): JSX.Element {
  const secret = achievement.hidden && !achievement.unlocked
  const icon = achievement.unlocked ? achievement.iconUrl : (achievement.lockedIconUrl ?? achievement.iconUrl)
  const detail = achievement.unlocked
    ? achievement.unlockedAt
      ? `Unlocked ${new Date(achievement.unlockedAt).toLocaleDateString(undefined, { dateStyle: 'medium' })}`
      : 'Unlocked'
    : achievement.globalPercent !== null
      ? `${achievement.globalPercent.toFixed(1)}% of players`
      : null

  return (
    <li className={`achievement${achievement.unlocked ? ' achievement-unlocked' : ''}`}>
      {icon ? <img src={icon} alt="" loading="lazy" draggable={false} /> : <span className="achievement-icon-empty" />}
      <div className="achievement-text">
        <span className="achievement-name">
          {secret ? 'Hidden achievement' : achievement.name}
          {achievement.unlocked && <CheckIcon width={13} height={13} />}
        </span>
        <span className="achievement-desc">{secret ? 'Keep playing to reveal it.' : achievement.description}</span>
        {detail && <span className="achievement-meta">{detail}</span>}
      </div>
    </li>
  )
}

export function AchievementsSection({ achievements }: { achievements: GameAchievements }): JSX.Element {
  const [showAll, setShowAll] = useState(false)
  const percent = achievements.total > 0 ? Math.round((achievements.unlocked / achievements.total) * 100) : 0
  const items = showAll ? achievements.items : achievements.items.slice(0, ACHIEVEMENT_PREVIEW)

  return (
    <section className="details-section">
      <div className="details-section-head">
        <h3 className="details-section-title">Achievements</h3>
        <span className="achievement-count">
          {achievements.unlocked} of {achievements.total} · {percent}%
        </span>
      </div>
      <div className="progress achievement-progress">
        <div className="progress-fill" style={{ width: `${percent}%` }} />
      </div>
      {items.length > 0 && (
        <ul className="achievement-list">
          {items.map((achievement) => (
            <AchievementRow key={achievement.id} achievement={achievement} />
          ))}
        </ul>
      )}
      {achievements.items.length > ACHIEVEMENT_PREVIEW && (
        <button type="button" className="link-btn" onClick={() => setShowAll((value) => !value)}>
          {showAll ? 'Show fewer' : `Show all ${achievements.items.length}`}
        </button>
      )}
      {!achievements.detailed && achievements.unlocked > 0 && achievements.items.length > 0 && (
        <p className="field-help">
          Steam only shared your unlock count. Add a Steam Web API key in Settings to see exactly which achievements you
          have and when you unlocked them.
        </p>
      )}
    </section>
  )
}
