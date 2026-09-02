import { memo, useEffect, useState } from 'react'
import type { Attachment } from '../../protocol'
import { attachmentContentUrl } from '../../net/mediaUpload'
import { httpBaseFromWs } from '../../net/auth'
import { AudioPlayer } from './AudioPlayer'
import './attachments.css'

const SAFE_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif'])
import './mediaGallery.css'

interface Props {
  attachments: Attachment[]
  serverUrl?: string
  accessToken?: string | null
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const index = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${Number((bytes / Math.pow(1024, index)).toFixed(1))} ${units[index]}`
}

export function resolveAttachmentUrl(rawUrl: string, serverUrl?: string): string {
  if (!rawUrl || /^(https?:|blob:|data:)/.test(rawUrl)) return rawUrl
  if (!serverUrl) return rawUrl
  const path = rawUrl.startsWith('/') ? rawUrl : `/${rawUrl}`
  return `${httpBaseFromWs(serverUrl)}${path}`
}

function TicketedAttachment({ attachment, serverUrl, accessToken, onLightbox }: {
  attachment: Attachment
  serverUrl?: string
  accessToken?: string | null
  onLightbox(url: string): void
}) {
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (attachment.url) {
      setUrl(resolveAttachmentUrl(attachment.url, serverUrl))
      return
    }
    if (!serverUrl || !accessToken) return
    let disposed = false
    let timer = 0
    const refresh = async () => {
      try {
        const next = await attachmentContentUrl(serverUrl, accessToken, attachment.id)
        if (!disposed) {
          setUrl(next)
          setError(false)
          timer = window.setTimeout(refresh, 8 * 60 * 1000)
        }
      } catch {
        if (!disposed) setError(true)
      }
    }
    void refresh()
    return () => {
      disposed = true
      window.clearTimeout(timer)
    }
  }, [accessToken, attachment.id, attachment.url, serverUrl])

  if (error) return <div className="stapp-attachment-error" role="alert">Anexo indisponivel</div>
  if (!url) return <div className="stapp-attachment-loading" role="status">Carregando anexo...</div>

  const lowerName = attachment.filename.toLowerCase()
  const image = SAFE_IMAGE_TYPES.has(attachment.content_type)
  const video = attachment.content_type.startsWith('video/') || /\.(mp4|mov|mkv)$/.test(lowerName)
  const voice = lowerName.startsWith('voice-note-')
  const audio = !video && (attachment.content_type.startsWith('audio/') || /\.(webm|ogg|mp3|wav|m4a)$/.test(lowerName))

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
      <div className="stapp-attachment-video-wrapper">
        <video
          className="stapp-attachment-video"
          src={url}
          controls
          preload="metadata"
          playsInline
          onError={() => setError(true)}
        />
      </div>
    )
  }
  if (image) {
    return (
      <button type="button" className="stapp-attachment-image-wrapper" onClick={() => onLightbox(url)}>
        <img
          src={url}
          alt={attachment.description || attachment.filename}
          loading="lazy"
          className="stapp-attachment-image"
          onError={() => setError(true)}
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

export const MessageAttachments = memo(function MessageAttachments({ attachments, serverUrl, accessToken }: Props) {
  const [lightboxImage, setLightboxImage] = useState<string | null>(null)
  if (!attachments?.length) return null

  return (
    <>
      <div className={`stapp-attachments-container ${attachments.filter((item) => SAFE_IMAGE_TYPES.has(item.content_type)).length > 1 ? 'is-gallery' : ''}`}>
        {attachments.map((attachment) => (
          <TicketedAttachment key={attachment.id} attachment={attachment} serverUrl={serverUrl} accessToken={accessToken} onLightbox={setLightboxImage} />
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
