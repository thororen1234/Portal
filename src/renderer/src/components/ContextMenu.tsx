import { JSX, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

const EDGE_GAP = 8

interface ContextMenuProps {
  x: number
  y: number
  children: ReactNode
}

export function ContextMenu({ x, y, children }: ContextMenuProps): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null)

  useLayoutEffect(() => {
    const menu = ref.current
    if (!menu) return
    const { width, height } = menu.getBoundingClientRect()
    const left = x + width > window.innerWidth - EDGE_GAP ? Math.max(EDGE_GAP, x - width) : x
    const top = y + height > window.innerHeight - EDGE_GAP ? Math.max(EDGE_GAP, y - height) : y
    setPosition({ left, top })
  }, [x, y])

  return createPortal(
    <div
      ref={ref}
      className="game-context-menu"
      role="menu"

      style={position ? { left: position.left, top: position.top } : { left: x, top: y, visibility: 'hidden' }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {children}
    </div>,
    document.body
  )
}
