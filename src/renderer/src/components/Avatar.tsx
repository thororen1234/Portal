import { JSX, useState } from 'react'

interface AvatarProps {
  name: string
  url: string | null
  size?: number
}

export function Avatar({ name, url, size = 24 }: AvatarProps): JSX.Element {
  const [failedUrl, setFailedUrl] = useState<string | null>(null)

  if (url && url !== failedUrl) {
    return (
      <img
        className="avatar"
        src={url.startsWith('data:') ? url : `art://avatar/${encodeURIComponent(url)}`}
        alt=""
        width={size}
        height={size}
        draggable={false}
        onError={() => setFailedUrl(url)}
      />
    )
  }

  return (
    <span className="avatar avatar-initial" style={{ width: size, height: size, fontSize: size * 0.45 }} aria-hidden="true">
      {name.slice(0, 1).toUpperCase()}
    </span>
  )
}
