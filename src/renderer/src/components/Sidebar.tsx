import { FormEvent, JSX, useRef, useState } from 'react'
import type { Collection, Game } from '../../../shared/types'
import type { CollectionsState } from '../lib/useCollections'
import { GameIcon } from './GameIcon'
import { ChevronDownIcon, FolderIcon, GridIcon, PencilIcon, PlusIcon, TrashIcon } from './Icons'

export type LibraryView = 'all' | `collection:${string}`

interface SidebarProps {
  games: Game[]
  collections: CollectionsState
  view: LibraryView
  artRevision: number
  onView: (view: LibraryView) => void
  onOpenGame: (gameId: string) => void
  onConfirmRemove: (collection: Collection) => void
}

function NameField({
  initial,
  placeholder,
  onSubmit,
  onCancel
}: {
  initial: string
  placeholder: string
  onSubmit: (name: string) => void
  onCancel: () => void
}): JSX.Element {
  const [name, setName] = useState(initial)
  const done = useRef(false)
  const finish = (save: boolean): void => {
    if (done.current) return
    done.current = true
    if (save && name.trim() && name.trim() !== initial) onSubmit(name.trim())
    else onCancel()
  }
  const submit = (event: FormEvent): void => {
    event.preventDefault()
    finish(true)
  }
  return (
    <form className="sidebar-name-field" onSubmit={submit}>
      <input
        value={name}
        onChange={(event) => setName(event.target.value)}
        onBlur={() => finish(true)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            finish(false)
          }
        }}
        placeholder={placeholder}
        maxLength={60}
        autoFocus
        spellCheck={false}
      />
    </form>
  )
}

export function Sidebar({ games, collections, view, artRevision, onView, onOpenGame, onConfirmRemove }: SidebarProps): JSX.Element {
  const [creating, setCreating] = useState(false)
  const [renaming, setRenaming] = useState<string | null>(null)
  const byId = new Map(games.map((game) => [game.id, game]))

  return (
    <aside className="sidebar" aria-label="Library and collections">
      <nav className="sidebar-nav">
        <button className={`sidebar-item${view === 'all' ? ' sidebar-item-active' : ''}`} onClick={() => onView('all')}>
          <GridIcon width={16} height={16} />
          <span className="sidebar-item-name">All games</span>
          <span className="sidebar-count">{games.length}</span>
        </button>
      </nav>

      <div className="sidebar-section-head">
        <span>Collections</span>
        <button className="icon-btn sidebar-add" onClick={() => setCreating(true)} aria-label="New collection" title="New collection">
          <PlusIcon width={15} height={15} />
        </button>
      </div>

      <div className="sidebar-collections">
        {creating && (
          <NameField
            initial=""
            placeholder="Collection name"
            onSubmit={(name) => {
              setCreating(false)
              void collections.create(name).then((id) => onView(`collection:${id}`))
            }}
            onCancel={() => setCreating(false)}
          />
        )}
        {collections.collections.length === 0 && !creating && (
          <p className="sidebar-empty">Make a collection with +, then right-click games to add them.</p>
        )}
        {collections.collections.map((collection) => {
          const members = collection.gameIds.flatMap((id) => {
            const game = byId.get(id)
            return game ? [game] : []
          })
          const active = view === `collection:${collection.id}`
          return (
            <div key={collection.id} className="sidebar-collection">
              {renaming === collection.id ? (
                <NameField
                  initial={collection.name}
                  placeholder="Collection name"
                  onSubmit={(name) => {
                    setRenaming(null)
                    void collections.rename(collection.id, name)
                  }}
                  onCancel={() => setRenaming(null)}
                />
              ) : (
                <div className={`sidebar-item sidebar-collection-row${active ? ' sidebar-item-active' : ''}`}>
                  <button
                    className={`sidebar-chevron${collection.expanded ? ' sidebar-chevron-open' : ''}`}
                    onClick={() => void collections.setExpanded(collection.id, !collection.expanded)}
                    aria-label={collection.expanded ? `Collapse ${collection.name}` : `Expand ${collection.name}`}
                    aria-expanded={collection.expanded}
                  >
                    <ChevronDownIcon width={14} height={14} />
                  </button>
                  <button className="sidebar-collection-open" onClick={() => onView(`collection:${collection.id}`)}>
                    <FolderIcon width={15} height={15} />
                    <span className="sidebar-item-name">{collection.name}</span>
                  </button>
                  <span className="sidebar-count">{members.length}</span>
                  <span className="sidebar-row-actions">
                    <button className="icon-btn" onClick={() => setRenaming(collection.id)} aria-label={`Rename ${collection.name}`} title="Rename">
                      <PencilIcon width={13} height={13} />
                    </button>
                    <button className="icon-btn" onClick={() => onConfirmRemove(collection)} aria-label={`Delete ${collection.name}`} title="Delete">
                      <TrashIcon width={13} height={13} />
                    </button>
                  </span>
                </div>
              )}
              {collection.expanded && (
                <ul className="sidebar-games">
                  {members.length === 0 && <li className="sidebar-empty">Right-click a game to add it.</li>}
                  {members.map((game) => (
                    <li key={game.id}>
                      <button className="sidebar-game" onClick={() => onOpenGame(game.id)} title={game.name}>
                        <GameIcon key={`${game.id}:${artRevision}`} game={game} size={22} artRevision={artRevision} />
                        <span className="sidebar-item-name">{game.name}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )
        })}
      </div>
    </aside>
  )
}
