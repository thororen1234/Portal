import { CSSProperties, JSX, useState } from 'react'
import type { Game } from '../../../shared/types'
import { artUrl } from '../lib/games'

type Stage = 'cover' | 'header' | 'placeholder'

interface CoverProps {
  game: Pick<Game, 'launcher' | 'appId' | 'name'>
  eager?: boolean
  artRevision?: number
}

function shade(id: string): number {
  let hash = 0
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) % 997
  return hash % 12
}

export function Cover({ game, eager = false, artRevision }: CoverProps): JSX.Element {
  const [stage, setStage] = useState<Stage>('cover')
  const loading = eager ? 'eager' : 'lazy'
  const { name } = game

  if (stage === 'placeholder') {
    return (
      <div className="cover cover-placeholder" style={{ '--shade': shade(game.appId) } as CSSProperties}>
        <span>{name}</span>
      </div>
    )
  }

  if (stage === 'header') {
    return (
      <div className="cover cover-header">
        <img className="cover-backdrop" src={artUrl(game, 'header', artRevision)} alt="" loading={loading} draggable={false} />
        <img
          className="cover-header"
          src={artUrl(game, 'header', artRevision)}
          alt={name}
          loading={loading}
          draggable={false}
          onError={() => setStage('placeholder')}
        />
        <span className="cover-caption">{name}</span>
      </div>
    )
  }

  return (
    <img
      className="cover"
      src={artUrl(game, 'cover', artRevision)}
      alt={name}
      loading={loading}
      draggable={false}
      onError={() => setStage('header')}
    />
  )
}
