import { lazy, Suspense, useEffect, useRef } from 'react'

// Import lazy do picker do emoji-mart para evitar carregar o dataset pesado no bundle inicial
const Picker = lazy(() =>
  import('@emoji-mart/react').then((mod) =>
    import('@emoji-mart/data').then((data) => ({
      default: (props: any) => <mod.default data={data.default} {...props} />,
    }))
  )
)

interface Props {
  isOpen: boolean
  onClose: () => void
  onSelectEmoji: (emoji: string) => void
}

export function EmojiPicker({ isOpen, onClose, onSelectEmoji }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isOpen) return

    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        onClose()
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen, onClose])

  if (!isOpen) return null

  return (
    <div
      ref={containerRef}
      className="absolute bottom-full right-0 mb-2 z-50 rounded-[var(--radius)] overflow-hidden bg-[var(--bg-raised)] border border-[var(--bg-input)]"
    >
      <Suspense
        fallback={
          <div className="w-[352px] h-[435px] flex items-center justify-center text-[var(--text-dim)] text-xs bg-[var(--bg-raised)]">
            carregando emojis...
          </div>
        }
      >
        <Picker
          theme="dark"
          locale="pt"
          previewPosition="none"
          skinTonePosition="none"
          onEmojiSelect={(emoji: any) => {
            if (emoji?.native) {
              onSelectEmoji(emoji.native)
            }
          }}
        />
      </Suspense>
    </div>
  )
}