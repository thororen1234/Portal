import { JSX, useEffect, useRef, useState, type FormEvent } from 'react'
import type { ProfileUpdate, UserProfile } from '../../../shared/types'
import { errorMessage, formatPlaytime } from '../lib/format'
import { LAUNCHER_NAMES } from '../lib/games'
import { Avatar } from './Avatar'
import { CloseIcon } from './Icons'

interface ProfileDialogProps {
  onClose: () => void
  onSaved: (profile: UserProfile) => void
}

const AVATAR_SIZE = 256

async function resizeAvatar(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file)
  const side = Math.min(bitmap.width, bitmap.height)
  const canvas = document.createElement('canvas')
  canvas.width = AVATAR_SIZE
  canvas.height = AVATAR_SIZE
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Could not process that picture.')
  context.imageSmoothingQuality = 'high'
  context.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, AVATAR_SIZE, AVATAR_SIZE)
  bitmap.close()
  return canvas.toDataURL('image/webp', 0.9)
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }): JSX.Element {
  return (
    <div className="profile-stat">
      <span className="profile-stat-value">{value}</span>
      <span className="profile-stat-label">{label}</span>
      {sub && <span className="profile-stat-sub">{sub}</span>}
    </div>
  )
}

export function ProfileDialog({ onClose, onSaved }: ProfileDialogProps): JSX.Element {
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [draftName, setDraftName] = useState('')

  const [draftAvatar, setDraftAvatar] = useState<string | null | undefined>(undefined)
  const [saving, setSaving] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let active = true
    window.portal
      .getProfile()
      .then((next) => active && setProfile(next))
      .catch((reason: unknown) => active && setError(errorMessage(reason)))
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !saving) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, saving])

  function startEditing(): void {
    setDraftName(profile?.customName ?? '')
    setDraftAvatar(undefined)
    setError(null)
    setEditing(true)
  }

  async function pickAvatar(file: File | undefined): Promise<void> {
    if (!file) return
    try {
      setDraftAvatar(await resizeAvatar(file))
      setError(null)
    } catch {
      setError('That picture could not be used. Try a PNG, JPEG or WebP image.')
    }
  }

  async function saveProfile(event: FormEvent): Promise<void> {
    event.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const update: ProfileUpdate = { name: draftName.trim() || null }
      if (draftAvatar !== undefined) update.avatarDataUrl = draftAvatar
      const savedProfile = await window.portal.updateProfile(update)
      setProfile(savedProfile)
      onSaved(savedProfile)
      setEditing(false)
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setSaving(false)
    }
  }

  const previewAvatar =
    draftAvatar === undefined ? (profile?.avatarUrl ?? null) : draftAvatar
  const hasPicture = draftAvatar === undefined ? Boolean(profile?.hasCustomAvatar) : draftAvatar !== null

  const achievements = profile?.achievements
  const achievementPercent =
    achievements && achievements.total > 0 ? Math.round((achievements.unlocked / achievements.total) * 100) : null

  return (
    <div className="overlay" onMouseDown={onClose}>
      <section
        className="dialog profile"
        role="dialog"
        aria-modal="true"
        aria-labelledby="profile-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="dialog-header">
          <div className="profile-identity">
            <Avatar name={profile?.name || 'P'} url={profile?.avatarUrl ?? null} size={48} />
            <div>
              <h2 id="profile-title">{profile?.name ?? 'Your library'}</h2>
              <p className="profile-subtitle">Across every linked launcher</p>
            </div>
          </div>
          <div className="profile-header-actions">
            {profile && !editing && (
              <button type="button" className="btn" onClick={startEditing}>
                Edit profile
              </button>
            )}
            <button type="button" className="icon-btn" onClick={onClose} aria-label="Close" disabled={saving}>
              <CloseIcon />
            </button>
          </div>
        </header>

        {editing && profile && (
          <form className="profile-edit" onSubmit={(event) => void saveProfile(event)}>
            <div className="profile-edit-avatar">
              <Avatar name={draftName || profile.name || 'P'} url={previewAvatar} size={72} />
              <div className="profile-edit-avatar-actions">
                <button type="button" className="btn" onClick={() => fileRef.current?.click()} disabled={saving}>
                  Choose picture
                </button>
                {hasPicture && (
                  <button type="button" className="link-btn link-btn-inline" onClick={() => setDraftAvatar(null)} disabled={saving}>
                    Use Steam picture
                  </button>
                )}
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  hidden
                  onChange={(event) => {
                    void pickAvatar(event.target.files?.[0])
                    event.target.value = ''
                  }}
                />
              </div>
            </div>
            <label className="field">
              <span className="field-label">Display name</span>
              <input
                value={draftName}
                onChange={(event) => setDraftName(event.target.value)}
                placeholder={profile.customName ? 'Use my Steam name' : (profile.name ?? 'Your name')}
                maxLength={40}
                autoFocus
              />
              <span className="field-help">Leave blank to use your Steam name. Only shown in Portal.</span>
            </label>
            <footer className="dialog-footer">
              <button type="button" className="btn" onClick={() => setEditing(false)} disabled={saving}>
                Cancel
              </button>
              <button type="submit" className="btn btn-install" disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            </footer>
          </form>
        )}

        {error && <p className="dialog-error">{error}</p>}
        {!profile && !error && <p className="cover-picker-status">Loading your profile…</p>}

        {profile && (
          <>
            <div className="profile-stats">
              <Stat label="Games" value={profile.games.toLocaleString()} />
              <Stat label="Installed" value={profile.installed.toLocaleString()} />
              <Stat label="Play time" value={formatPlaytime(profile.playtimeMinutes || null)} />
              {achievements && (
                <Stat
                  label="Achievements"
                  value={achievements.unlocked.toLocaleString()}
                  sub={`of ${achievements.total.toLocaleString()}${achievementPercent !== null ? ` · ${achievementPercent}%` : ''}`}
                />
              )}
              {achievements && (
                <Stat
                  label="Perfect games"
                  value={achievements.perfectGames.toLocaleString()}
                  sub={`of ${achievements.gamesWithAchievements.toLocaleString()} with achievements`}
                />
              )}
            </div>
            {profile.achievementsError && (
              <p className="field-help">Achievements may be out of date: {profile.achievementsError}</p>
            )}
            {achievements && (
              <p className="field-help">Achievements count Steam games you've played.</p>
            )}

            <h3 className="details-section-title profile-section-title">Launchers</h3>
            <ul className="profile-launchers">
              {profile.launchers.map((entry) => (
                <li key={entry.launcher}>
                  <span className="profile-launcher-name">{LAUNCHER_NAMES[entry.launcher]}</span>
                  <span className={`profile-launcher-account${entry.account ? '' : ' profile-launcher-account-none'}`}>
                    {entry.account ?? 'Not linked'}
                  </span>
                  <span className="profile-launcher-count">
                    {entry.games.toLocaleString()} games · {entry.installed.toLocaleString()} installed
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  )
}
