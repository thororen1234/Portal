import { JSX, useEffect, useState, type FormEvent } from 'react'
import type { SettingsView } from '../../../shared/types'
import { errorMessage } from '../lib/format'
import { THEMES, type ThemeId } from '../lib/themes'
import { CloseIcon } from './Icons'

interface SettingsDialogProps {
  onClose: () => void
  onSaved: (settings: SettingsView) => void
  theme: ThemeId

  onTheme: (theme: ThemeId) => void
}

export function SettingsDialog({ onClose, onSaved, theme, onTheme }: SettingsDialogProps): JSX.Element {
  const [settings, setSettings] = useState<SettingsView | null>(null)
  const [steamPath, setSteamPath] = useState('')
  const [steamGridDbApiKey, setSteamGridDbApiKey] = useState('')
  const [steamWebApiKey, setSteamWebApiKey] = useState('')
  const [removeSteamWebApiKey, setRemoveSteamWebApiKey] = useState(false)
  const [useGameLogos, setUseGameLogos] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    window.portal
      .getSettings()
      .then((view) => {
        setSettings(view)
        setSteamPath(view.steamPathOverride)
        setUseGameLogos(view.useGameLogos)
      })
      .catch((reason: unknown) => setError(errorMessage(reason)))
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function save(event: FormEvent): Promise<void> {
    event.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const view = await window.portal.updateSettings({
        steamPathOverride: steamPath,
        ...(steamGridDbApiKey.trim() ? { steamGridDbApiKey } : {}),
        ...(steamWebApiKey.trim() ? { steamWebApiKey } : removeSteamWebApiKey ? { steamWebApiKey: '' } : {}),
        useGameLogos
      })
      onSaved(view)
      onClose()
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="overlay" onMouseDown={onClose}>
      <form
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={save}
      >
        <header className="dialog-header">
          <h2 id="settings-title">Settings</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <CloseIcon />
          </button>
        </header>

        <div className="field">
          <span className="field-label">Theme</span>
          <div className="theme-picker" role="radiogroup" aria-label="Theme">
            {THEMES.map((option) => (
              <button
                key={option.id}
                type="button"
                role="radio"
                aria-checked={option.id === theme}
                className={`theme-option${option.id === theme ? ' theme-option-active' : ''}`}
                onClick={() => onTheme(option.id)}
              >
                <span className="theme-swatch" aria-hidden="true">
                  {option.swatch.map((color) => (
                    <span key={color} style={{ background: color }} />
                  ))}
                </span>
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <label className="field">
          <span className="field-label">Steam folder</span>
          <input
            value={steamPath}
            onChange={(event) => setSteamPath(event.target.value)}
            placeholder={settings?.detectedSteamPath ?? 'Not found'}
            spellCheck={false}
            autoFocus
          />
          <span className="field-help">Leave blank to find Steam automatically.</span>
        </label>

        <label className="field-check">
          <input type="checkbox" checked={useGameLogos} onChange={(event) => setUseGameLogos(event.target.checked)} />
          <span>
            <strong>Use game logos in details</strong>
            <small>Show a game logo instead of its text title in the game details when one is available.</small>
          </span>
        </label>

        <label className="field">
          <span className="field-label">SteamGridDB API key</span>
          <input
            type="password"
            value={steamGridDbApiKey}
            onChange={(event) => setSteamGridDbApiKey(event.target.value)}
            placeholder={settings?.steamGridDbConfigured ? 'Configured' : 'Optional'}
            autoComplete="off"
            spellCheck={false}
          />
          <span className="field-help">
            Optional artwork for Steam games. Your key is encrypted on this computer.{' '}
            <a href="https://www.steamgriddb.com/profile/preferences/api" target="_blank" rel="noreferrer">
              Get a key
            </a>
          </span>
        </label>

        <label className="field">
          <span className="field-label">Steam Web API key</span>
          <input
            type="password"
            value={steamWebApiKey}
            onChange={(event) => {
              setSteamWebApiKey(event.target.value)
              setRemoveSteamWebApiKey(false)
            }}
            placeholder={settings?.steamWebApiKeyConfigured && !removeSteamWebApiKey ? 'Configured' : 'Optional'}
            autoComplete="off"
            spellCheck={false}
          />
          <span className="field-help">
            Optional. Shows exactly which Steam achievements you've unlocked and when. Your key is encrypted on this
            computer.{' '}
            <a href="https://steamcommunity.com/dev/apikey" target="_blank" rel="noreferrer">
              Get a key
            </a>
            {settings?.steamWebApiKeyConfigured && !removeSteamWebApiKey && (
              <>
                {' · '}
                <button type="button" className="link-btn link-btn-inline" onClick={() => setRemoveSteamWebApiKey(true)}>
                  Remove key
                </button>
              </>
            )}
          </span>
        </label>

        {error && <p className="dialog-error">{error}</p>}

        <footer className="dialog-footer">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-install" disabled={saving || !settings}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </footer>
      </form>
    </div>
  )
}
