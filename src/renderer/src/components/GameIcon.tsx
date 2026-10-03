import { JSX, useState } from 'react'
import type { Game } from '../../../shared/types'
import { artUrl } from '../lib/games'

type Stage = 'icon' | 'cover' | 'letter'

export function GameIcon({ game, size = 24, artRevision }: { game: Game; size?: number; artRevision?: number }): JSX.Element {
  const [stage, setStage] = useState<Stage>('icon')
  if (stage === 'letter') {
    return (
      <span className="game-icon game-icon-letter" style={{ width: size, height: size, fontSize: size * 0.5 }} aria-hidden="true">
        {game.name.slice(0, 1).toUpperCase()}
      </span>
    )
  }
  return (
    <img
      className="game-icon"
      src={artUrl(game, stage, artRevision)}
      width={size}
      height={size}
      alt=""
      loading="lazy"
      draggable={false}
      onError={() => setStage(stage === 'icon' ? 'cover' : 'letter')}
    />
  )
}
