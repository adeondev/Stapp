import {
  Add01Icon,
  ArrowRight01Icon,
  Call02Icon,
  Cancel01Icon,
  HashtagIcon,
  HeadphoneMuteIcon,
  HeadphonesIcon,
  HelpCircleIcon,
  Home01Icon,
  LockPasswordIcon,
  Logout01Icon,
  Mic01Icon,
  MicOff01Icon,
  ServerStack01Icon,
  Setting07Icon,
  Shield01Icon,
  UserAccountIcon,
  UserGroupIcon,
  ViewIcon,
  ViewOffSlashIcon,
  VolumeHighIcon,
} from 'hugeicons-react'

interface IconProps {
  size?: number
  className?: string
}

export function IconHash({ size = 16, className }: IconProps) {
  return <HashtagIcon size={size} className={className} />
}

export function IconAt({ size = 16, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8" />
    </svg>
  )
}

export function IconSpeaker({ size = 16, className }: IconProps) {
  return <VolumeHighIcon size={size} className={className} />
}

export function IconMic({ size = 16, className }: IconProps) {
  return <Mic01Icon size={size} className={className} />
}

export function IconMicOff({ size = 16, className }: IconProps) {
  return <MicOff01Icon size={size} className={className} />
}

export function IconHeadphones({ size = 16, className }: IconProps) {
  return <HeadphonesIcon size={size} className={className} />
}

export function IconHeadphonesOff({ size = 16, className }: IconProps) {
  return <HeadphoneMuteIcon size={size} className={className} />
}

export function IconPhone({ size = 16, className }: IconProps) {
  return <Call02Icon size={size} className={className} />
}

export function IconLeave({ size = 16, className }: IconProps) {
  return <Logout01Icon size={size} className={className} />
}

export function IconCheck({ size = 13, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M2.5 7.5L5.5 10.5L11.5 3.5" />
    </svg>
  )
}

export function IconHome({ size = 16, className }: IconProps) {
  return <Home01Icon size={size} className={className} />
}

export function IconUsers({ size = 16, className }: IconProps) {
  return <UserGroupIcon size={size} className={className} />
}

export function IconPlus({ size = 16, className }: IconProps) {
  return <Add01Icon size={size} className={className} />
}

export function IconSettings({ size = 16, className }: IconProps) {
  return <Setting07Icon size={size} className={className} />
}

export function IconEye({ size = 16, className }: IconProps) {
  return <ViewIcon size={size} className={className} />
}

export function IconEyeOff({ size = 16, className }: IconProps) {
  return <ViewOffSlashIcon size={size} className={className} />
}

export function IconUser({ size = 16, className }: IconProps) {
  return <UserAccountIcon size={size} className={className} />
}

export function IconLock({ size = 16, className }: IconProps) {
  return <LockPasswordIcon size={size} className={className} />
}

export function IconServer({ size = 16, className }: IconProps) {
  return <ServerStack01Icon size={size} className={className} />
}

export function IconArrowRight({ size = 15, className }: IconProps) {
  return <ArrowRight01Icon size={size} className={className} />
}

export function IconHelp({ size = 16, className }: IconProps) {
  return <HelpCircleIcon size={size} className={className} />
}

export function IconX({ size = 14, className }: IconProps) {
  return <Cancel01Icon size={size} className={className} />
}

export function IconShield({ size = 16, className }: IconProps) {
  return <Shield01Icon size={size} className={className} />
}

function StrokeIcon({ size = 18, className, children }: IconProps & { children: React.ReactNode }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}
    aria-hidden="true">{children}</svg>
}

export function IconCamera({ size = 18, className }: IconProps) {
  return <StrokeIcon size={size} className={className}><rect x="3" y="6" width="13" height="12" rx="2" />
    <path d="m16 10 5-3v10l-5-3" /></StrokeIcon>
}

export function IconCameraOff({ size = 18, className }: IconProps) {
  return <StrokeIcon size={size} className={className}><path d="M3 3l18 18" />
    <path d="M10 6h4a2 2 0 0 1 2 2v4m0 4H5a2 2 0 0 1-2-2V8c0-.6.3-1.2.7-1.5" />
    <path d="m16 10 5-3v10l-3-1.8" /></StrokeIcon>
}

export function IconScreen({ size = 18, className }: IconProps) {
  return <StrokeIcon size={size} className={className}><rect x="3" y="4" width="18" height="13" rx="2" />
    <path d="M8 21h8m-4-4v4" /></StrokeIcon>
}

export function IconMinimize({ size = 18, className }: IconProps) {
  return <StrokeIcon size={size} className={className}><path d="M8 3v5H3m18 0h-5V3M3 16h5v5m8 0v-5h5" /></StrokeIcon>
}

export function IconFullscreen({ size = 18, className }: IconProps) {
  return <StrokeIcon size={size} className={className}><path d="M3 8V3h5m8 0h5v5m0 8v5h-5M8 21H3v-5" /></StrokeIcon>
}

export function IconPictureInPicture({ size = 18, className }: IconProps) {
  return <StrokeIcon size={size} className={className}><rect x="3" y="5" width="18" height="14" rx="2" />
    <rect x="12" y="11" width="7" height="5" rx="1" /></StrokeIcon>
}

export function IconMore({ size = 18, className }: IconProps) {
  return <StrokeIcon size={size} className={className}><circle cx="5" cy="12" r="1" fill="currentColor" />
    <circle cx="12" cy="12" r="1" fill="currentColor" /><circle cx="19" cy="12" r="1" fill="currentColor" /></StrokeIcon>
}

export function IconSignal({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <rect x="3" y="16" width="3" height="5" rx="1" />
      <rect x="8" y="12" width="3" height="9" rx="1" />
      <rect x="13" y="8" width="3" height="13" rx="1" />
      <rect x="18" y="4" width="3" height="17" rx="1" />
    </svg>
  )
}

export function IconChat({ size = 18, className }: IconProps) {
  return (
    <StrokeIcon size={size} className={className}>
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    </StrokeIcon>
  )
}

export function IconGrid({ size = 18, className }: IconProps) {
  return (
    <StrokeIcon size={size} className={className}>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
    </StrokeIcon>
  )
}

export function IconChevronDown({ size = 14, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="m6 9 6 6 6-6" />
    </svg>
  )
}

export function IconExpand({ size = 16, className }: IconProps) {
  return (
    <StrokeIcon size={size} className={className}>
      <polyline points="15 3 21 3 21 9" />
      <polyline points="9 21 3 21 3 15" />
      <line x1="21" y1="3" x2="14" y2="10" />
      <line x1="3" y1="21" x2="10" y2="14" />
    </StrokeIcon>
  )
}

export function IconStappLogo({ size = 48, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={Math.round(size * (220 / 239))}
      viewBox="0 0 239 220"
      fill="currentColor"
      aria-hidden="true"
      className={className}
    >
      <path d="M126.31 0C-30.1899 0 -28.6903 219.5 62.3097 219.5C153.31 219.5 161.31 102.5 126.31 102.5C91.3096 102.5 95.9784 131.704 65.81 127C35.6415 122.295 64.8985 45.7406 132.31 53.4998C214.31 70.4998 154.31 191 197.31 191C258.31 191 263.31 0 126.31 0Z" />
    </svg>
  )
}
