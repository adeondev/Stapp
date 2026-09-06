import { memo, useCallback, useState } from 'react'
import type { Attachment } from '../../protocol'
import { AudioPlayer } from './AudioPlayer'
import { resolveAttachmentUrl, useAttachmentTicket } from '../../net/attachmentTickets'
import './attachments.css'
import './mediaGallery.css'

export { resolveAttachmentUrl }

const SAFE_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif'])

interface Props {
  attachments: Attachment[]
  serverUrl?: string
  accessToken?: string | null
  onRenewToken?: () => Promise<string | null>
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const index = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${Number((bytes / Math.pow(1024, index)).toFixed(1))} ${units[index]}`
}

function TicketedAttachment({
  attachment,
  serverUrl,
  accessToken,
  onRenewToken,
  onLightbox,
}: {
  attachment: Attachment
  serverUrl?: string
  accessToken?: string | null
  onRenewToken?: () => Promise<string | null>
  onLightbox(url: string): void
}) {
  const { url, error, retrying, renewTicket, handleMediaError } = useAttachmentTicket({
    attachmentId: attachment.id,
    serverUrl,
    accessToken,
    initialUrl: attachment.url,
    onRenewToken,
  })

  const handleOpenLightbox = useCallback(async () => {
    if (url && !error) {
      onLightbox(url)
    } else {
      const refreshed = await renewTicket(true)
      if (refreshed) onLightbox(refreshed)
    }
  }, [error, onLightbox, renewTicket, url])

  const lowerName = attachment.filename.toLowerCase()
  const image = SAFE_IMAGE_TYPES.has(attachment.content_type)
  const video = attachment.content_type.startsWith('video/') || /\.(mp4|mov|mkv)$/.test(lowerName)
  const voice = lowerName.startsWith('voice-note-')
  const audio = !video && (attachment.content_type.startsWith('audio/') || /\.(webm|ogg|mp3|wav|m4a)$/.test(lowerName))

  const mediaAspectRatio =
    attachment.width && attachment.height && attachment.width > 0 && attachment.height > 0
      ? `${attachment.width} / ${attachment.height}`
      : '16 / 9'

  if (error) {
    return (
      <div className="stapp-attachment-error" role="alert">
        <span>Anexo indisponível</span>
        <button
          type="button"
          className="stapp-attachment-retry-btn"
          disabled={retrying}
          onClick={() => void renewTicket(true)}
        >
          {retrying ? 'Tentando...' : 'Tentar novamente'}
        </button>
      </div>
    )
  }
  if (!url) {
    if (image) {
      return (
        <div
          className="stapp-attachment-image-wrapper stapp-attachment-image-skeleton"
          style={{ aspectRatio: mediaAspectRatio }}
          role="status"
          aria-label="Carregando imagem..."
        >
          <span className="stapp-attachment-loading">Carregando anexo...</span>
        </div>
      )
    }
    if (video) {
      return (
        <div
          className="stapp-attachment-video-wrapper stapp-attachment-video-skeleton"
          style={{ aspectRatio: mediaAspectRatio }}
          role="status"
          aria-label="Carregando vídeo..."
        >
          <span className="stapp-attachment-loading">Carregando anexo...</span>
        </div>
      )
    }
    return <div className="stapp-attachment-loading" role="status">Carregando anexo...</div>
  }

  if (audio) {
    return (
      <div className={voice ? 'stapp-voice-note-wrapper' : 'stapp-audio-attachment-wrapper'}>
        {voice && <div className="stapp-voice-note-label">Mensagem de voz</div>}
        <AudioPlayer
          src={url}
          filename={attachment.filename}
          initialDurationSec={attachment.duration_ms ? attachment.duration_ms / 1000 : undefined}
        />
      </div>
    )
  }
  if (video) {
    return (
      <div className="stapp-attachment-video-wrapper" style={{ aspectRatio: mediaAspectRatio }}>
        <video
          className="stapp-attachment-video"
          src={url}
          controls
          preload="metadata"
          playsInline
          onError={handleMediaError}
        />
      </div>
    )
  }
  if (image) {
    return (
      <button
        type="button"
        className="stapp-attachment-image-wrapper"
        style={{ aspectRatio: mediaAspectRatio }}
        onClick={handleOpenLightbox}
      >
        <img
          src={url}
          alt={attachment.description || attachment.filename}
          loading="lazy"
          className="stapp-attachment-image"
          onError={handleMediaError}
        />
      </button>
    )
  }
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" download={attachment.filename} className="stapp-attachment-file">
      <span className="stapp-attachment-file-icon" aria-hidden="true">↓</span>
      <span className="stapp-attachment-file-copy">
        <span className="stapp-attachment-file-name">{attachment.filename}</span>
        <span className="stapp-attachment-file-size">{formatBytes(attachment.size_bytes)}</span>
      </span>
    </a>
  )
}

export const MessageAttachments = memo(function MessageAttachments({
  attachments,
  serverUrl,
  accessToken,
  onRenewToken,
}: Props) {
  const [lightboxImage, setLightboxImage] = useState<string | null>(null)
  if (!attachments?.length) return null

  const imageCount = attachments.filter((item) => SAFE_IMAGE_TYPES.has(item.content_type)).length

  return (
    <>
      <div className={`stapp-attachments-container ${imageCount > 1 ? 'is-gallery' : ''}`}>
        {attachments.map((attachment) => (
          <TicketedAttachment
            key={attachment.id}
            attachment={attachment}
            serverUrl={serverUrl}
            accessToken={accessToken}
            onRenewToken={onRenewToken}
            onLightbox={setLightboxImage}
          />
        ))}
      </div>
      {lightboxImage && (
        <div className="stapp-media-lightbox" onClick={() => setLightboxImage(null)} role="dialog" aria-modal="true" aria-label="Imagem ampliada">
          <button type="button" className="stapp-media-lightbox__close" onClick={() => setLightboxImage(null)} aria-label="Fechar">×</button>
          <img src={lightboxImage} alt="Midia ampliada" className="stapp-media-lightbox__img" onClick={(event) => event.stopPropagation()} />
        </div>
      )}
    </>
  )
})