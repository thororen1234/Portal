import { JSX, useLayoutEffect, useRef, useState } from 'react'

interface TabOption<T extends string> {
  id: T
  label: string
  count?: number
}

interface TabsProps<T extends string> {
  label: string
  options: Array<TabOption<T>>
  value: T
  onChange: (value: T) => void
}

interface Indicator {
  left: number
  width: number
}

export function Tabs<T extends string>({ label, options, value, onChange }: TabsProps<T>): JSX.Element {
  const listRef = useRef<HTMLDivElement>(null)
  const tabRefs = useRef(new Map<T, HTMLButtonElement>())
  const [indicator, setIndicator] = useState<Indicator | null>(null)
  const [animated, setAnimated] = useState(false)

  useLayoutEffect(() => {
    const measure = (): void => {
      const tab = tabRefs.current.get(value)
      if (tab) setIndicator({ left: tab.offsetLeft, width: tab.offsetWidth })
    }
    measure()
    const observer = new ResizeObserver(measure)
    if (listRef.current) observer.observe(listRef.current)
    for (const tab of tabRefs.current.values()) observer.observe(tab)
    return () => observer.disconnect()
  }, [value, options])

  useLayoutEffect(() => {
    if (!indicator || animated) return
    const frame = requestAnimationFrame(() => setAnimated(true))
    return () => cancelAnimationFrame(frame)
  }, [indicator, animated])

  const focusTab = (index: number): void => {
    const option = options[(index + options.length) % options.length]
    onChange(option.id)
    tabRefs.current.get(option.id)?.focus()
  }

  return (
    <div className={`tabs${animated ? ' tabs-animated' : ''}`} role="tablist" aria-label={label} ref={listRef}>
      {indicator && (
        <span
          className="tab-indicator"
          style={{ width: indicator.width, transform: `translateX(${indicator.left}px)` }}
          aria-hidden="true"
        />
      )}
      {options.map((option, index) => {
        const selected = option.id === value
        return (
          <button
            key={option.id}
            ref={(element) => {
              if (element) tabRefs.current.set(option.id, element)
              else tabRefs.current.delete(option.id)
            }}
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            className={`tab${selected ? ' tab-active' : ''}`}
            onClick={() => onChange(option.id)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowRight') focusTab(index + 1)
              else if (event.key === 'ArrowLeft') focusTab(index - 1)
              else if (event.key === 'Home') focusTab(0)
              else if (event.key === 'End') focusTab(options.length - 1)
              else return
              event.preventDefault()
            }}
          >
            {option.label}
            {option.count !== undefined && <span className="tab-count">{option.count}</span>}
          </button>
        )
      })}
    </div>
  )
}
