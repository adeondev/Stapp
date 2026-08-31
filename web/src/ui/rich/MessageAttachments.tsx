import { memo, useState } from 'react'
import type { Attachment } from '../../protocol'
import './attachments.css'
import './mediaGallery.css'

interface Props {
  attachments: Attachment[]
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}

export const MessageAttachments = memo(function MessageAttachments({ attachments }: Props) {
  const [lightboxImage, setLightboxImage] = useState<string | null>(null)

  if (!attachments || attachments.length === 0) return null

  return (
    <>
      <div className="stapp-attachments-container">
        {attachments.map((att) => {
          const isImage = att.content_type.startsWith('image/')
          if (isImage) {
            return (
              <div
                key={att.id}
                className="stapp-attachment-image-wrapper cursor-pointer"
                onClick={() => setLightboxImage(att.url)}
              >
                <img
                  src={att.url}
                  alt={att.filename}
                  loading="lazy"
                  className="stapp-attachment-image hover:opacity-95 transition-opacity"
                />
              </div>
            )
          }

          return (
            <a
              key={att.id}
              href={att.url}
              target="_blank"
              rel="noopener noreferrer"
              download={att.filename}
              className="stapp-attachment-file"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--accent)] shrink-0">
                <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
                <polyline points="14 2 14 8 20 8" />
              </svg>
              <div className="flex flex-col min-w-0">
                <span className="stapp-attachment-file-name">{att.filename}</span>
                <span className="stapp-attachment-file-size">{formatBytes(att.size_bytes)}</span>
              </div>
            </a>
          )
        })}
      </div>

      {lightboxImage && (
        <div
          className="stapp-media-lightbox"
          onClick={() => setLightboxImage(null)}
        >
          <button
            type="button"
            className="stapp-media-lightbox__close"
            onClick={() => setLightboxImage(null)}
            title="Fechar"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
          <img
            src={lightboxImage}
            alt="Mídia ampliada"
            className="stapp-media-lightbox__img"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </>
  )
})