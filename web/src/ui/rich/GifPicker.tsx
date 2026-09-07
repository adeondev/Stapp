import { memo, useEffect, useRef, useState } from 'react'
import { fetchTrendingGifs, searchGifs, extractGifUrl, extractGifPreview, type KlipyGifItem } from '../../net/klipy'
import { IconGif, IconStar } from '../Icons'
import {
  GIF_FAVORITES_EVENT,
  getStoredFavoriteGifs,
  removeFavoriteGif,
} from './gifFavorites'
import './gifPicker.css'

interface Props {
  isOpen: boolean
  onClose(): void
  onSelectGif(gifUrl: string): void
}

export const GifPicker = memo(function GifPicker({ isOpen, onClose, onSelectGif }: Props) {
  const [tab, setTab] = useState<'explore' | 'favorites'>('explore')
  const [favorites, setFavorites] = useState<string[]>(() => getStoredFavoriteGifs())
  const [query, setQuery] = useState('')
  const [gifs, setGifs] = useState<KlipyGifItem[]>([])
  const [loading, setLoading] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<any>(null)

  useEffect(() => {
    if (!isOpen) return
    setFavorites(getStoredFavoriteGifs())
    const onUpdate = () => setFavorites(getStoredFavoriteGifs())
    window.addEventListener(GIF_FAVORITES_EVENT, onUpdate)
    window.addEventListener('storage', onUpdate)
    return () => {
      window.removeEventListener(GIF_FAVORITES_EVENT, onUpdate)
      window.removeEventListener('storage', onUpdate)
    }
  }, [isOpen])

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
      <div className="stapp-gif-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'explore'}
          className={`stapp-gif-tab ${tab === 'explore' ? 'is-active' : ''}`}
          onClick={() => setTab('explore')}
        >
          <IconGif size={16} />
          <span>Explorar</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'favorites'}
          className={`stapp-gif-tab ${tab === 'favorites' ? 'is-active' : ''}`}
          onClick={() => setTab('favorites')}
        >
          <IconStar size={16} filled={tab === 'favorites'} />
          <span>Favoritos</span>
          {favorites.length > 0 && <span className="stapp-gif-tab-badge">{favorites.length}</span>}
        </button>
      </div>

      {tab === 'explore' && (
        <>
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
              <div className="stapp-gif-aviso">Carregando GIFs...</div>
            )}

            {!loading && gifs.length === 0 && (
              <div className="stapp-gif-aviso">Nenhum GIF encontrado.</div>
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
        </>
      )}

      {tab === 'favorites' && (
        <div className="stapp-gif-grid">
          {favorites.length === 0 ? (
            <div className="stapp-gif-empty-state">
              <IconStar size={32} className="stapp-gif-empty-icon" />
              <p className="stapp-gif-empty-title">Nenhum GIF favorito ainda</p>
              <p className="stapp-gif-empty-desc">
                Passe o mouse sobre qualquer GIF no chat e clique na estrela para salvá-lo aqui.
              </p>
            </div>
          ) : (
            favorites.map((favUrl, idx) => (
              <div key={`${favUrl}-${idx}`} className="stapp-gif-card">
                <button
                  type="button"
                  className="stapp-gif-item"
                  onClick={() => onSelectGif(favUrl)}
                  title="Enviar GIF"
                  aria-label="Enviar GIF favorito"
                >
                  <img
                    src={favUrl}
                    alt="GIF favorito"
                    loading="lazy"
                    className="stapp-gif-image"
                  />
                </button>
                <button
                  type="button"
                  className="stapp-gif-remove-btn"
                  onClick={(e) => {
                    e.stopPropagation()
                    removeFavoriteGif(favUrl)
                    setFavorites(getStoredFavoriteGifs())
                  }}
                  title="Remover dos favoritos"
                  aria-label="Remover dos favoritos"
                >
                  <IconStar size={16} filled />
                </button>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
})