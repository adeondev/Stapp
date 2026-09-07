import type { Attachment } from '../../protocol'
import { AudioPlayer } from './AudioPlayer'
import { FileAttachment } from './FileAttachment'
import { VideoPlayer } from './VideoPlayer'
import './attachments.css'

/**
 * Quem decide como um anexo aparece.
 *
 * Antes essa decisao morava no meio do `MessageAttachments`, num encadeamento de
 * `if` que misturava tres coisas: buscar o ticket de acesso, escolher o tipo, e
 * desenhar cada caso. Trocar o player de video exigia mexer no arquivo que
 * tambem cuidava da renovacao de ticket.
 *
 * Agora `MessageAttachments` cuida do ticket e da grade; aqui se decide o tipo;
 * e cada tipo tem componente proprio. Tipo novo entra como um caso a mais nesta
 * funcao, e nada mais precisa saber.
 */

export type AttachmentKind = 'image' | 'video' | 'audio' | 'voice' | 'file'

/* Tetos em pixel, iguais aos do player de video: o que se limita e o tamanho da
   caixa, nunca a proporcao. */
const LARGURA_MAXIMA = 480
const ALTURA_MAXIMA = 380

/** Tipos de imagem que o navegador desenha sem susto. */
const IMAGENS_SEGURAS = new Set([
  'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif',
])

/**
 * O tipo de um anexo.
 *
 * A ordem importa e nao e arbitraria: **video antes de audio**. O `MediaRecorder`
 * grava `.webm`, e a mesma extensao serve para os dois — quem separa e o
 * `content_type` que o servidor preservou no envio. Testar audio primeiro faria
 * todo `.webm` de video virar tocador de audio.
 */
export function attachmentKind(attachment: Attachment): AttachmentKind {
  const nome = attachment.filename.toLowerCase()
  const tipo = attachment.content_type

  if (IMAGENS_SEGURAS.has(tipo)) return 'image'
  if (tipo.startsWith('video/') || /\.(mp4|mov|mkv)$/.test(nome)) return 'video'
  // Nota de voz e reconhecida pelo nome que o gravador da — e o unico sinal que
  // existe hoje, e ele decide so o rotulo, nao o tocador.
  if (nome.startsWith('voice-note-')) return 'voice'
  if (tipo.startsWith('audio/') || /\.(webm|ogg|mp3|wav|m4a)$/.test(nome)) return 'audio'
  return 'file'
}

export interface AttachmentRendererProps {
  attachment: Attachment
  /** URL ja resolvida (ticket ou legado). */
  url: string
  /** Abre o visualizador. Ausente = a imagem nao e clicavel. */
  onOpenViewer?(attachmentId: string): void
}

export function AttachmentRenderer({ attachment, url, onOpenViewer }: AttachmentRendererProps) {
  const kind = attachmentKind(attachment)

  if (kind === 'audio' || kind === 'voice') {
    return (
      <div className={kind === 'voice' ? 'stapp-voice-note-wrapper' : 'stapp-audio-attachment-wrapper'}>
        {kind === 'voice' && <div className="stapp-voice-note-label">Mensagem de voz</div>}
        <AudioPlayer
          src={url}
          filename={attachment.filename}
          initialDurationSec={attachment.duration_ms ? attachment.duration_ms / 1000 : undefined}
        />
      </div>
    )
  }

  if (kind === 'video') {
    return (
      <VideoPlayer
        src={url}
        filename={attachment.filename}
        width={attachment.width}
        height={attachment.height}
        durationMs={attachment.duration_ms}
      />
    )
  }

  if (kind === 'image') {
    /* Mesma regra do video: proporcao EXATA, e o que limita e um teto em pixel.
       Com o metadado o espaco ja fica reservado e a conversa nao pula quando a
       imagem carrega — antes a `<img>` entrava com altura 0 e depois esticava. */
    const proporcao = attachment.width && attachment.height
      ? attachment.width / attachment.height
      : undefined
    const caixa = proporcao
      ? {
        aspectRatio: String(proporcao),
        maxWidth: Math.min(LARGURA_MAXIMA, Math.round(ALTURA_MAXIMA * proporcao)),
        maxHeight: `${ALTURA_MAXIMA}px`,
      }
      : undefined
    return (
      <button
        type="button"
        className="stapp-attachment-image-wrapper max-w-[480px] max-h-[380px] w-auto h-auto"
        style={caixa}
        onClick={() => onOpenViewer?.(attachment.id)}
        aria-label={`Abrir ${attachment.filename}`}
      >
        <img
          src={url}
          alt={attachment.description || attachment.filename}
          loading="lazy"
          width={attachment.width}
          height={attachment.height}
          className="stapp-attachment-image max-w-[480px] max-h-[380px] w-auto h-auto object-contain"
        />
      </button>
    )
  }

  return (
    <FileAttachment
      url={url}
      filename={attachment.filename}
      sizeBytes={attachment.size_bytes}
      contentType={attachment.content_type}
      description={attachment.description}
    />
  )
}
