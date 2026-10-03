import { JSX, useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { CheckIcon, ChevronDownIcon } from './Icons'

const CLOSE_ANIMATION_MS = 120

interface DropdownOption<T extends string> {
  id: T
  label: string
}

interface DropdownProps<T extends string> {
  label: string
  options: Array<DropdownOption<T>>
  value: T
  onChange: (value: T) => void
  className?: string
}

type MenuState = 'closed' | 'open' | 'closing'

export function Dropdown<T extends string>({ label, options, value, onChange, className }: DropdownProps<T>): JSX.Element {
  const [state, setState] = useState<MenuState>('closed')
  const [highlighted, setHighlighted] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const closeTimer = useRef<number | null>(null)
  const id = useId()
  const labelId = `${id}-label`
  const listId = `${id}-list`
  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.id === value)
  )
  const selected = options[selectedIndex]

  const open = (): void => {
    if (closeTimer.current) window.clearTimeout(closeTimer.current)
    setHighlighted(selectedIndex)
    setState('open')
  }

  const close = (focusTrigger = true): void => {
    if (state === 'closed') return
    setState('closing')
    if (closeTimer.current) window.clearTimeout(closeTimer.current)
    closeTimer.current = window.setTimeout(() => setState('closed'), CLOSE_ANIMATION_MS)
    if (focusTrigger) triggerRef.current?.focus()
  }

  const choose = (index: number): void => {
    const option = options[index]
    if (option && option.id !== value) onChange(option.id)
    close()
  }

  useEffect(() => {
    if (state === 'open') listRef.current?.focus()
  }, [state])

  useEffect(() => {
    if (state !== 'open') return
    const onPointer = (event: MouseEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) close(false)
    }
    document.addEventListener('mousedown', onPointer, true)
    return () => document.removeEventListener('mousedown', onPointer, true)
  })

  useEffect(
    () => () => {
      if (closeTimer.current) window.clearTimeout(closeTimer.current)
    },
    []
  )

  const onTriggerKey = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      open()
    }
  }

  const onListKey = (event: KeyboardEvent<HTMLDivElement>): void => {
    const last = options.length - 1
    switch (event.key) {
      case 'ArrowDown':
        setHighlighted((index) => Math.min(last, index + 1))
        break
      case 'ArrowUp':
        setHighlighted((index) => Math.max(0, index - 1))
        break
      case 'Home':
        setHighlighted(0)
        break
      case 'End':
        setHighlighted(last)
        break
      case 'Enter':
      case ' ':
        choose(highlighted)
        break
      case 'Escape':
        close()
        break
      case 'Tab':
        close(false)
        return
      default:
        return
    }
    event.preventDefault()
  }

  return (
    <div className={className ? `dropdown ${className}` : 'dropdown'} ref={rootRef}>
      <span className="dropdown-label" id={labelId}>
        {label}
      </span>
      <button
        ref={triggerRef}
        type="button"
        className={`dropdown-trigger${state === 'open' ? ' dropdown-trigger-open' : ''}`}
        aria-haspopup="listbox"
        aria-expanded={state === 'open'}
        aria-controls={listId}
        aria-labelledby={`${labelId} ${id}-value`}
        onClick={() => (state === 'open' ? close() : open())}
        onKeyDown={onTriggerKey}
      >
        <span id={`${id}-value`}>{selected?.label}</span>
        <ChevronDownIcon className="dropdown-chevron" width={14} height={14} />
      </button>

      {state !== 'closed' && (
        <div
          ref={listRef}
          id={listId}
          className={`dropdown-menu dropdown-menu-${state}`}
          role="listbox"
          tabIndex={-1}
          aria-labelledby={labelId}
          aria-activedescendant={`${id}-option-${highlighted}`}
          onKeyDown={onListKey}
        >
          {options.map((option, index) => {
            const isSelected = option.id === value
            return (
              <div
                key={option.id}
                id={`${id}-option-${index}`}
                role="option"
                aria-selected={isSelected}
                className={`dropdown-option${index === highlighted ? ' dropdown-option-highlighted' : ''}${isSelected ? ' dropdown-option-selected' : ''
                  }`}
                onMouseEnter={() => setHighlighted(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(index)}
              >
                <span>{option.label}</span>
                {isSelected && <CheckIcon width={14} height={14} />}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
