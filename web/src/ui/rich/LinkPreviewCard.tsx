import { memo, useState } from 'react'
import type { UrlPreview } from '../../protocol'
import { openExternalLink } from '../../platform/externalLink'
import './linkpreview.css'

interface Props {
  preview: UrlPreview
}

export const LinkPreviewCard = memo(function LinkPreviewCard({ preview }: Props) {
  const [isPlaying, setIsPlaying] = useState(false)
  if (!preview.title && !preview.description && !preview.embed_url) return null

  const aspectRatio =
    preview.video_width && preview.video_height && preview.video_width > 0 && preview.video_height > 0
      ? `${preview.video_width} / ${preview.video_height}`
      : '16 / 9'

  const handleOpenExternal = (e: React.MouseEvent) => {
    if (preview.url) {
      e.preventDefault()
      void openExternalLink(preview.url)
    }
  }

  if (preview.embed_url) {
    return (
      <div className="stapp-link-preview has-video">
        <div className="stapp-link-preview__media" style={{ aspectRatio }}>
          {isPlaying ? (
            <iframe
              src={preview.embed_url}
              title={preview.title ?? 'Vídeo incorporado'}
              className="stapp-link-preview__iframe"
              sandbox="allow-scripts allow-same-origin allow-presentation"
              referrerPolicy="no-referrer"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
            />
          ) : (
            <button
              type="button"
              className="stapp-link-preview__thumbnail-btn"
              onClick={() => setIsPlaying(true)}
              aria-label="Reproduzir vídeo"
            >
              {preview.image && (
                <img
                  src={preview.image}
                  alt={preview.title ?? 'Miniatura do vídeo'}
                  loading="lazy"
                  className="stapp-link-preview__image"
                />
              )}
              <div className="stapp-link-preview__play-overlay">
                <span className="stapp-link-preview__play-icon" aria-hidden="true">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                    <polygon points="5 3 19 12 5 21 5 3" />
                  </svg>
                </span>
              </div>
            </button>
          )}
        </div>
        <div className="stapp-link-preview__content">
          {preview.site_name && (
            <div className="stapp-link-preview__site">{preview.site_name}</div>
          )}
          {preview.title && (
            <h4 className="stapp-link-preview__title">
              <a
                href={preview.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={handleOpenExternal}
                className="stapp-link-preview__title-link"
              >
                {preview.title}
              </a>
            </h4>
          )}
          {preview.description && (
            <p className="stapp-link-preview__description">{preview.description}</p>
          )}
        </div>
      </div>
    )
  }

  return (
    <a
      href={preview.url}
      target="_blank"
      rel="noopener noreferrer"
      className="stapp-link-preview"
      onClick={handleOpenExternal}
    >
      {preview.image && (
        <div className="stapp-link-preview__image-wrapper">
          <img
            src={preview.image}
            alt={preview.title ?? 'Link preview'}
            loading="lazy"
            className="stapp-link-preview__image"
          />
        </div>
      )}
      <div className="stapp-link-preview__content">
        {preview.site_name && (
          <div className="stapp-link-preview__site">{preview.site_name}</div>
        )}
        {preview.title && (
          <h4 className="stapp-link-preview__title">{preview.title}</h4>
        )}
        {preview.description && (
          <p className="stapp-link-preview__description">{preview.description}</p>
        )}
      </div>
    </a>
  )
})