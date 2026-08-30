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
