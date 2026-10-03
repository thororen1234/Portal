import { JSX, useEffect, type ReactNode } from 'react'

interface ConfirmDialogProps {
  title: string
  children: ReactNode
  confirmLabel: string
  busy?: boolean
  busyLabel?: string
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  busy = false,
  busyLabel,
  onConfirm,
  onCancel
}: ConfirmDialogProps): JSX.Element {
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !busy) onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onCancel])

  return (
    <div className="overlay" onMouseDown={() => !busy && onCancel()}>
      <section
        className="dialog confirm"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2 id="confirm-title">{title}</h2>
        <div className="confirm-body">{children}</div>
        <footer className="dialog-footer">
          <button type="button" className="btn" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="btn btn-install" onClick={onConfirm} disabled={busy} autoFocus>
            {busy ? (busyLabel ?? confirmLabel) : confirmLabel}
          </button>
        </footer>
      </section>
    </div>
  )
}
