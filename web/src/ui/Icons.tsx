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

export function IconLeave(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6.5 2.5H3.5v11h3M9 5.5 12 8l-3 2.5M12 8H6" />
    </Svg>
  )
}
