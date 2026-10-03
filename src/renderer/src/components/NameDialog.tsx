import { FormEvent, JSX, useEffect, useState } from 'react'
import { CloseIcon } from './Icons'

interface NameDialogProps {
  title: string
  label: string
  confirmLabel: string
  initial?: string
  onSubmit: (name: string) => void
  onCancel: () => void
}

export function NameDialog({ title, label, confirmLabel, initial = '', onSubmit, onCancel }: NameDialogProps): JSX.Element {
  const [name, setName] = useState(initial)

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  const submit = (event: FormEvent): void => {
    event.preventDefault()
    if (name.trim()) onSubmit(name.trim())
  }

  return (
    <div className="overlay" onMouseDown={onCancel}>
      <form className="dialog confirm" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event) => event.stopPropagation()} onSubmit={submit}>
        <header className="dialog-header">
          <h2>{title}</h2>
          <button type="button" className="icon-btn" onClick={onCancel} aria-label="Close">
            <CloseIcon />
          </button>
        </header>
        <label className="field">
          <span className="field-label">{label}</span>
          <input value={name} onChange={(event) => setName(event.target.value)} maxLength={60} autoFocus spellCheck={false} />
        </label>
        <footer className="dialog-footer">
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="btn btn-install" disabled={!name.trim()}>
            {confirmLabel}
          </button>
        </footer>
      </form>
    </div>
  )
}
