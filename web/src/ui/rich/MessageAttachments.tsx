import { memo, useState } from 'react'
import type { Attachment } from '../../protocol'
import { AudioPlayer } from './AudioPlayer'
import { httpBaseFromWs } from '../../net/auth'
import './attachments.css'
import './mediaGallery.css'

interface Props {
  attachments: Attachment[]
  serverUrl?: string
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}

export function resolveAttachmentUrl(rawUrl: string, serverUrl?: string): string {
  if (!rawUrl) return ''
  if (rawUrl.startsWith('http://') || rawUrl.startsWith('https://') || rawUrl.startsWith('blob:') || rawUrl.startsWith('data:')) {
    return rawUrl
  }

  if (serverUrl) {
    try {
      const httpBase = httpBaseFromWs(serverUrl)
      const cleanPath = rawUrl.startsWith('/') ? rawUrl : `/${rawUrl}`
      return `${httpBase}${cleanPath}`
    } catch {
      // Falha ao parsear WebSocket URL; prossegue com relativo
    }
  }

  return rawUrl
}

export const MessageAttachments = memo(function MessageAttachments({ attachments, serverUrl }: Props) {
  const [lightboxImage, setLightboxImage] = useState<string | null>(null)

  if (!attachments || attachments.length === 0) return null

  return (
    <>
      <div className="stapp-attachments-container">
        {attachments.map((att) => {
          const resolvedUrl = resolveAttachmentUrl(att.url, serverUrl)
          const isImage = att.content_type.startsWith('image/')
          const isVideo =
            att.content_type.startsWith('video/') ||
            att.filename.endsWith('.mp4') ||
            att.filename.endsWith('.mov') ||
            att.filename.endsWith('.mkv')
          const isVoiceNote =
            att.content_type === 'audio/voice' ||
            att.filename.startsWith('voice-note-') ||
            att.filename.startsWith('audio-recording-')
          // `.webm` serve para os dois; video ganha na frente para nao virar audio.
          const isAudio =
            !isVideo &&
            (isVoiceNote ||
              att.content_type.startsWith('audio/') ||
              att.filename.endsWith('.webm') ||
              att.filename.endsWith('.ogg') ||
              att.filename.endsWith('.mp3') ||
              att.filename.endsWith('.wav'))

          if (isAudio) {
            return (
              <div key={att.id} className={isVoiceNote ? 'stapp-voice-note-wrapper' : 'stapp-audio-attachment-wrapper'}>
                {isVoiceNote && (
                  <div className="flex items-center gap-1.5 mb-1 text-[11px] text-[var(--accent)] font-semibold select-none">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                      <line x1="12" y1="19" x2="12" y2="22" />
                    </svg>
                    <span>Mensagem de voz</span>
                  </div>
                )}
                <AudioPlayer src={resolvedUrl} filename={att.filename} />
              </div>
            )
          }

          if (isVideo) {
            return (
              <div key={att.id} className="stapp-attachment-video-wrapper">
                <video
                  className="stapp-attachment-video"
                  src={resolvedUrl}
                  controls
                  preload="metadata"
                  playsInline
                />
              </div>
            )
          }

          if (isImage) {
            return (
              <div
                key={att.id}
                className="stapp-attachment-image-wrapper cursor-pointer"
                onClick={() => setLightboxImage(resolvedUrl)}
              >
                <img
                  src={resolvedUrl}
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
              href={resolvedUrl}
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