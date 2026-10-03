import { FormEvent, JSX, useCallback, useEffect, useRef, useState } from 'react'
import type { PasswordSignInStep } from '../../../shared/types'
import { errorMessage } from '../lib/format'
import { CloseIcon } from './Icons'

type Mode = 'qr' | 'password'
type QrStatus = 'loading' | 'waiting' | 'scanned' | 'expired' | 'error'

interface SignInDialogProps {
  onClose: () => void
}

export function SignInDialog({ onClose }: SignInDialogProps): JSX.Element {
  const [mode, setMode] = useState<Mode>('qr')

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="overlay" onMouseDown={onClose}>
      <section
        className="dialog signin"
        role="dialog"
        aria-modal="true"
        aria-labelledby="signin-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="dialog-header">
          <h2 id="signin-title">Sign in with Steam</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <CloseIcon />
          </button>
        </header>

        <div className="art-type-tabs signin-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={mode === 'qr'} className={mode === 'qr' ? 'active' : ''} onClick={() => setMode('qr')}>
            QR code
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'password'}
            className={mode === 'password' ? 'active' : ''}
            onClick={() => setMode('password')}
          >
            Password
          </button>
        </div>

        {mode === 'qr' ? <QrSignIn onClose={onClose} /> : <PasswordSignIn onClose={onClose} />}
      </section>
    </div>
  )
}

function QrSignIn({ onClose }: SignInDialogProps): JSX.Element {
  const [qr, setQr] = useState<string | null>(null)
  const [status, setStatus] = useState<QrStatus>('loading')
  const [error, setError] = useState<string | null>(null)
  const attempt = useRef(0)

  const start = useCallback(async () => {
    const current = ++attempt.current
    setStatus('loading')
    setError(null)
    try {
      const { qrDataUrl } = await window.portal.startSignIn()
      if (attempt.current !== current) return
      setQr(qrDataUrl)
      setStatus('waiting')
    } catch (reason) {
      if (attempt.current !== current) return
      setError(errorMessage(reason))
      setStatus('error')
    }
  }, [])

  useEffect(() => {
    void start()
    const unsubscribe = window.portal.onSignInEvent((event) => {
      switch (event.type) {
        case 'scanned':
          setStatus('scanned')
          break
        case 'signed-in':
          onClose()
          break
        case 'expired':
          setStatus('expired')
          break
        case 'error':
          setError(event.message)
          setStatus('error')
          break
      }
    })
    return () => {
      attempt.current++
      unsubscribe()
      void window.portal.cancelSignIn()
    }
  }, [start, onClose])

  const showCode = status === 'waiting' || status === 'scanned'

  return (
    <>
      <div className={`signin-code${showCode ? '' : ' signin-code-idle'}${status === 'scanned' ? ' signin-code-scanned' : ''}`}>
        {qr && showCode ? <img src={qr} alt="Steam sign-in QR code" draggable={false} /> : <div className="signin-spinner" />}
      </div>

      <div className="signin-status" role="status">
        {status === 'loading' && <p>Getting a sign-in code from Steam…</p>}
        {status === 'waiting' && (
          <p>
            Open the Steam mobile app, tap the <strong>shield</strong> icon, then <strong>Scan a QR code</strong>.
          </p>
        )}
        {status === 'scanned' && <p>Code scanned. Approve the sign-in on your phone.</p>}
        {status === 'expired' && <p>This code expired.</p>}
        {status === 'error' && <p className="dialog-error">{error}</p>}
      </div>

      {(status === 'expired' || status === 'error') && (
        <footer className="dialog-footer">
          <button type="button" className="btn btn-install" onClick={() => void start()}>
            Get a new code
          </button>
        </footer>
      )}

      <p className="field-help signin-note">
        Your password never passes through Portal. It keeps a sign-in token, stored encrypted on this computer.
      </p>
    </>
  )
}

function guardInstructions(step: PasswordSignInStep): string[] {
  const lines: string[] = []
  const hasCode = step.guards.includes('device-code') || step.guards.includes('email-code')
  if (step.guards.includes('device-code')) lines.push('Enter the code from the Steam Guard authenticator in the Steam mobile app.')
  if (step.guards.includes('email-code')) {
    lines.push(`Enter the code Steam emailed to your address${step.emailDomain ? ` at ${step.emailDomain}` : ''}.`)
  }
  if (step.guards.includes('device-confirmation')) {
    lines.push(hasCode ? 'Or approve the sign-in in the Steam mobile app.' : 'Approve the sign-in in the Steam mobile app.')
  }
  if (step.guards.includes('email-confirmation')) {
    lines.push(hasCode ? 'Or approve it from the email Steam sent you.' : 'Approve the sign-in from the email Steam sent you.')
  }
  return lines
}

function PasswordSignIn({ onClose }: SignInDialogProps): JSX.Element {
  const [accountName, setAccountName] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [step, setStep] = useState<PasswordSignInStep | null>(null)
  const [busy, setBusy] = useState(false)
  const [waiting, setWaiting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const unsubscribe = window.portal.onSignInEvent((event) => {
      switch (event.type) {
        case 'signed-in':
          onClose()
          break
        case 'expired':
          setStep(null)
          setWaiting(false)
          setError('The sign-in attempt timed out. Try again.')
          break
        case 'error':
          setWaiting(false)
          setError(event.message)
          break
      }
    })
    return () => {
      unsubscribe()
      void window.portal.cancelSignIn()
    }
  }, [onClose])

  async function submitCredentials(event: FormEvent): Promise<void> {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const next = await window.portal.startPasswordSignIn(accountName, password)
      setPassword('')
      if (next.guards.length === 0) setWaiting(true)
      else setStep(next)
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setBusy(false)
    }
  }

  async function submitCode(event: FormEvent): Promise<void> {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await window.portal.submitSteamGuardCode(code)
      setWaiting(true)
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setBusy(false)
    }
  }

  function startOver(): void {
    void window.portal.cancelSignIn()
    setStep(null)
    setCode('')
    setError(null)
  }

  if (waiting) {
    return (
      <div className="signin-status" role="status">
        <div className="signin-spinner signin-spinner-inline" />
        <p>Signing in…</p>
      </div>
    )
  }

  if (step) {
    const needsCode = step.guards.includes('device-code') || step.guards.includes('email-code')
    return (
      <form className="signin-form" onSubmit={(event) => void submitCode(event)}>
        <div className="signin-status" role="status">
          {guardInstructions(step).map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
        {needsCode && (
          <label className="field signin-guard-code">
            <span className="field-label">Steam Guard code</span>
            <input
              value={code}
              onChange={(event) => setCode(event.target.value.toUpperCase())}
              autoComplete="one-time-code"
              autoFocus
              maxLength={10}
              spellCheck={false}
            />
          </label>
        )}
        {error && <p className="dialog-error">{error}</p>}
        <footer className="dialog-footer">
          <button type="button" className="btn" onClick={startOver} disabled={busy}>
            Back
          </button>
          {needsCode && (
            <button type="submit" className="btn btn-install" disabled={busy || code.trim().length < 4}>
              {busy ? 'Checking…' : 'Continue'}
            </button>
          )}
        </footer>
      </form>
    )
  }

  return (
    <form className="signin-form" onSubmit={(event) => void submitCredentials(event)}>
      <label className="field">
        <span className="field-label">Account name</span>
        <input
          value={accountName}
          onChange={(event) => setAccountName(event.target.value)}
          autoComplete="username"
          autoFocus
          spellCheck={false}
        />
      </label>
      <label className="field">
        <span className="field-label">Password</span>
        <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" />
      </label>
      {error && <p className="dialog-error">{error}</p>}
      <footer className="dialog-footer">
        <button type="submit" className="btn btn-install" disabled={busy || !accountName.trim() || !password}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </footer>
      <p className="field-help signin-note">
        Your password goes straight to Steam and is never saved. Portal keeps a sign-in token, stored encrypted on this
        computer.
      </p>
    </form>
  )
}
