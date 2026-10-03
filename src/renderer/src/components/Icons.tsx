import type { JSX, SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement>

function Icon({ children, ...props }: IconProps): JSX.Element {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  )
}

export function SearchIcon(props: IconProps): JSX.Element {
  return (
    <Icon {...props}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </Icon>
  )
}

export function RefreshIcon(props: IconProps): JSX.Element {
  return (
    <Icon {...props}>
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <path d="M21 3v6h-6" />
    </Icon>
  )
}

export function SettingsIcon(props: IconProps): JSX.Element {
  return (
    <Icon {...props}>
      <path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12" />
      <circle cx="16" cy="6" r="2" />
      <circle cx="10" cy="12" r="2" />
      <circle cx="18" cy="18" r="2" />
    </Icon>
  )
}

export function CloseIcon(props: IconProps): JSX.Element {
  return (
    <Icon {...props}>
      <path d="M6 6l12 12M18 6 6 18" />
    </Icon>
  )
}

export function PlayIcon(props: IconProps): JSX.Element {
  return (
    <Icon fill="currentColor" stroke="none" {...props}>
      <path d="M7 4.5v15a1 1 0 0 0 1.52.85l12-7.5a1 1 0 0 0 0-1.7l-12-7.5A1 1 0 0 0 7 4.5Z" />
    </Icon>
  )
}

export function DownloadIcon(props: IconProps): JSX.Element {
  return (
    <Icon {...props}>
      <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
    </Icon>
  )
}

export function ChevronDownIcon(props: IconProps): JSX.Element {
  return (
    <Icon {...props}>
      <path d="m6 9 6 6 6-6" />
    </Icon>
  )
}

export function CheckIcon(props: IconProps): JSX.Element {
  return (
    <Icon {...props}>
      <path d="M5 12.5 10 17 19 7" />
    </Icon>
  )
}

export function PlusIcon(props: IconProps): JSX.Element {
  return (
    <Icon {...props}>
      <path d="M12 5v14M5 12h14" />
    </Icon>
  )
}

export function SignOutIcon(props: IconProps): JSX.Element {
  return (
    <Icon {...props}>
      <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" />
      <path d="M10 17l-5-5 5-5M5 12h11" />
    </Icon>
  )
}

export function ClockIcon(props: IconProps): JSX.Element {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </Icon>
  )
}

export function CalendarIcon(props: IconProps): JSX.Element {
  return (
    <Icon {...props}>
      <rect x="4" y="5" width="16" height="15" rx="2" />
      <path d="M4 10h16M8 3v4M16 3v4" />
    </Icon>
  )
}

export function DriveIcon(props: IconProps): JSX.Element {
  return (
    <Icon {...props}>
      <rect x="3" y="13" width="18" height="7" rx="2" />
      <path d="M5.5 13 8 5h8l2.5 8M17 16.5h.01" />
    </Icon>
  )
}

export function HashIcon(props: IconProps): JSX.Element {
  return (
    <Icon {...props}>
      <path d="M5 9h15M4 15h15M10 4 8 20M16 4l-2 16" />
    </Icon>
  )
}

export function ImageIcon(props: IconProps): JSX.Element {
  return (
    <Icon {...props}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="9" cy="10" r="1.5" />
      <path d="m21 16-5-5-9 9" />
    </Icon>
  )
}

export function FolderIcon(props: IconProps): JSX.Element {
  return (
    <Icon {...props}>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
    </Icon>
  )
}

export function StoreIcon(props: IconProps): JSX.Element {
  return (
    <Icon {...props}>
      <path d="M5 8h14l-1 12H6Z" />
      <path d="M9 8V6a3 3 0 0 1 6 0v2" />
    </Icon>
  )
}

export function ExternalIcon(props: IconProps): JSX.Element {
  return (
    <Icon {...props}>
      <path d="M14 4h6v6M20 4l-9 9" />
      <path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" />
    </Icon>
  )
}

export function TrashIcon(props: IconProps): JSX.Element {
  return (
    <Icon {...props}>
      <path d="M4 7h16M10 11v6M14 11v6M9 7V4h6v3" />
      <path d="M6 7l1 13h10l1-13" />
    </Icon>
  )
}

export function GamepadIcon(props: IconProps): JSX.Element {
  return (
    <Icon {...props}>
      <path d="M7 7h10a5 5 0 0 1 4.9 6l-.6 3a2.5 2.5 0 0 1-4.3 1.2L15 15H9l-2 2.2A2.5 2.5 0 0 1 2.7 16l-.6-3A5 5 0 0 1 7 7Z" />
      <path d="M8 10v3M6.5 11.5h3M15.5 11h.01M17.5 13h.01" />
    </Icon>
  )
}

export function UserIcon(props: IconProps): JSX.Element {
  return (
    <Icon {...props}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20a8 8 0 0 1 16 0" />
    </Icon>
  )
}

export function UsersIcon(props: IconProps): JSX.Element {
  return (
    <Icon {...props}>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
      <path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.2a6.5 6.5 0 0 1 3.5 5.8" />
    </Icon>
  )
}

export function GridIcon(props: IconProps): JSX.Element {
  return (
    <Icon {...props}>
      <rect x="4" y="4" width="7" height="7" rx="1.5" />
      <rect x="13" y="4" width="7" height="7" rx="1.5" />
      <rect x="4" y="13" width="7" height="7" rx="1.5" />
      <rect x="13" y="13" width="7" height="7" rx="1.5" />
    </Icon>
  )
}

export function PencilIcon(props: IconProps): JSX.Element {
  return (
    <Icon {...props}>
      <path d="M4 20h4L19 9l-4-4L4 16Z" />
      <path d="m13.5 6.5 4 4" />
    </Icon>
  )
}

export function SidebarIcon(props: IconProps): JSX.Element {
  return (
    <Icon {...props}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9 4v16" />
    </Icon>
  )
}
