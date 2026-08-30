// Icones proprios em vez de biblioteca: sao seis, todos de traco, e assim
// herdam a cor do texto sem trazer dependencia nenhuma.

interface IconProps {
  size?: number
}

function Svg({ size = 16, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

export function IconHash(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6 2.5 4.5 13.5M11.5 2.5 10 13.5M2.5 6h11M2 10h11" />
    </Svg>
  )
}

export function IconAt(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="8" cy="8" r="2.6" />
      <path d="M10.6 5.4v3.4a2 2 0 0 0 3.4 1.4A6.5 6.5 0 1 0 11 13.6" />
    </Svg>
  )
}

export function IconSpeaker(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M8.5 3 5 6H2.5v4H5l3.5 3V3Z" />
      <path d="M11 6a2.8 2.8 0 0 1 0 4" />
    </Svg>
  )
}

export function IconMic(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="6" y="1.5" width="4" height="7" rx="2" />
      <path d="M4 7.5a4 4 0 0 0 8 0M8 11.5v3" />
    </Svg>
  )
}

export function IconMicOff(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="6" y="1.5" width="4" height="7" rx="2" />
      <path d="M4 7.5a4 4 0 0 0 8 0M8 11.5v3M2.5 2.5l11 11" />
    </Svg>
  )
}

export function IconHeadphones(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3 10.5V8a5 5 0 0 1 10 0v2.5" />
      <rect x="1.5" y="9.5" width="3" height="4.5" rx="1.5" />
      <rect x="11.5" y="9.5" width="3" height="4.5" rx="1.5" />
    </Svg>
  )
}

export function IconHeadphonesOff(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3 10.5V8a5 5 0 0 1 10 0v2.5" />
      <rect x="1.5" y="9.5" width="3" height="4.5" rx="1.5" />
      <rect x="11.5" y="9.5" width="3" height="4.5" rx="1.5" />
      <path d="M2.5 2.5l11 11" />
    </Svg>
  )
}

export function IconPhone(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M5.4 2.5 3 3.4c-.7.3-1 1-.8 1.7a12 12 0 0 0 8.7 8.7c.7.2 1.4-.1 1.7-.8l.9-2.4-3.2-1.4-1.2 1.4a9 9 0 0 1-3-3l1.4-1.2L5.4 2.5Z" />
    </Svg>
  )
}

export function IconLeave(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6.5 2.5H3.5v11h3M9 5.5 12 8l-3 2.5M12 8H6" />
    </Svg>
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

export function IconCheck({ size = 12 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2.5 6.5 5 9l4.5-5.5" />
    </svg>
  )
}

export function IconHome(props: IconProps) {
  return <Svg {...props}><path d="M2.5 7.5 8 2.5l5.5 5v6H9.8V9.8H6.2v3.7H2.5v-6Z" /></Svg>
}

export function IconUsers(props: IconProps) {
  return <Svg {...props}><circle cx="6" cy="5" r="2.2" /><path d="M1.8 13c.4-2.5 1.8-3.8 4.2-3.8s3.8 1.3 4.2 3.8M10.5 3.5a2 2 0 0 1 0 3.8M11 9.5c1.8.3 2.8 1.5 3.2 3.5" /></Svg>
}

export function IconPlus(props: IconProps) {
  return <Svg {...props}><path d="M8 3v10M3 8h10" /></Svg>
}

export function IconSettings(props: IconProps) {
  return <Svg {...props}><circle cx="8" cy="8" r="2.3" /><path d="m8 1.8.7 1.5 1.6.7 1.6-.5.7 1.2-1 1.3.2 1.8 1.4 1-.6 1.2-1.7-.2-1.4 1-.3 1.7H6.8l-.3-1.7-1.4-1-1.7.2-.6-1.2 1.4-1 .2-1.8-1-1.3.7-1.2 1.6.5 1.6-.7.7-1.5Z" /></Svg>
}
