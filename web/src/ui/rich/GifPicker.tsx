import { memo, useEffect, useRef, useState } from 'react'
import { fetchTrendingGifs, searchGifs, extractGifUrl, extractGifPreview, type KlipyGifItem } from '../../net/klipy'
import './gifPicker.css'

interface Props {
  isOpen: boolean
  onClose(): void
  onSelectGif(gifUrl: string): void
}

export const GifPicker = memo(function GifPicker({ isOpen, onClose, onSelectGif }: Props) {
  const [query, setQuery] = useState('')
  const [gifs, setGifs] = useState<KlipyGifItem[]>([])
  const [loading, setLoading] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<any>(null)

  useEffect(() => {
    if (!isOpen) return

    setLoading(true)
    void fetchTrendingGifs().then((items) => {
      setGifs(items)
      setLoading(false)
    })
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return

    if (debounceRef.current) clearTimeout(debounceRef.current)

    debounceRef.current = setTimeout(() => {
      setLoading(true)
      void searchGifs(query).then((items) => {
        setGifs(items)
        setLoading(false)
      })
    }, 300)

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [query, isOpen])

  useEffect(() => {
    if (!isOpen) return

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }

    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('mousedown', handleClickOutside)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen, onClose])

  if (!isOpen) return null

  return (
    <div ref={containerRef} className="stapp-gif-picker-popover">
      <div className="stapp-gif-header">
        <input
          type="text"
          className="stapp-gif-search-input"
          placeholder="Buscar GIFs no Klipy..."
          value={query}
          autoFocus
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <div className="stapp-gif-grid">
        {loading && (
          <div className="col-span-2 py-8 text-center text-xs text-[var(--text-dim)]">
            Carregando GIFs...
          </div>
        )}

        {!loading && gifs.length === 0 && (
          <div className="col-span-2 py-8 text-center text-xs text-[var(--text-dim)]">
            Nenhum GIF encontrado.
          </div>
        )}

        {!loading &&
          gifs.map((gif) => {
            const url = extractGifUrl(gif)
            const previewUrl = extractGifPreview(gif)
            if (!url) return null

            return (
              <button
                key={gif.id}
                type="button"
                className="stapp-gif-item"
                onClick={() => onSelectGif(url)}
                title={gif.title}
              >
                <img
                  src={previewUrl}
                  alt={gif.title}
                  loading="lazy"
                  className="stapp-gif-image"
                />
              </button>
            )
          })}
      </div>

      <div className="stapp-gif-attribution">Powered by Klipy</div>
    </div>
  )
})