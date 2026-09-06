import { memo, useEffect, useMemo, useState } from 'react'
import type { Attachment } from '../../protocol'
import { attachmentContentUrl } from '../../net/mediaUpload'
import { httpBaseFromWs } from '../../net/auth'
import { AttachmentRenderer, attachmentKind } from './AttachmentRenderer'
import { MediaViewer, type MediaViewerItem } from './MediaViewer'
import './attachments.css'
import './mediaGallery.css'

/**
 * Os anexos de uma mensagem: ticket de acesso, grade e visualizador.
 *
 * Quem decide COMO cada anexo aparece e o `AttachmentRenderer`. Aqui ficam as
 * tres coisas que sao da mensagem inteira, e nao de um anexo:
 *
 * - o ticket de acesso (com renovacao antes de expirar);
 * - a grade, quando ha mais de uma imagem;
 * - o visualizador, que precisa conhecer TODAS as imagens da mensagem para
 *   poder navegar entre elas.
 */

export function resolveAttachmentUrl(rawUrl: string, serverUrl?: string): string {
  if (!rawUrl || /^(https?:|blob:|data:)/.test(rawUrl)) return rawUrl
  if (!serverUrl) return rawUrl
  const path = rawUrl.startsWith('/') ? rawUrl : `/${rawUrl}`
  return `${httpBaseFromWs(serverUrl)}${path}`
}

interface Props {
  attachments: Attachment[]
  serverUrl?: string
  accessToken?: string | null
}

/**
 * As URLs de todos os anexos da mensagem, renovadas antes de expirarem.
 *
 * Um hook so para a mensagem inteira, e nao um por anexo: o ticket dura 10
 * minutos e cada anexo tem o seu, mas montar um `useEffect` por arquivo faria a
 * mesma logica de renovacao existir N vezes na mesma mensagem.
 */
function useAttachmentUrls(attachments: Attachment[], serverUrl?: string, accessToken?: string | null) {
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [falhas, setFalhas] = useState<Record<string, true>>({})
  // A lista de ids e o que de fato muda; o array chega novo a cada render.
  const ids = attachments.map((item) => item.id).join(',')

  useEffect(() => {
    let disposto = false
    const timers: number[] = []

    for (const attachment of attachments) {
      // Servidor antigo ainda manda a URL pronta no proprio anexo.
      if (attachment.url) {
        const pronta = resolveAttachmentUrl(attachment.url, serverUrl)
        setUrls((atual) => ({ ...atual, [attachment.id]: pronta }))
        continue
      }
      if (!serverUrl || !accessToken) continue

      const renovar = async () => {
        try {
          const proxima = await attachmentContentUrl(serverUrl, accessToken, attachment.id)
          if (disposto) return
          setUrls((atual) => ({ ...atual, [attachment.id]: proxima }))
          setFalhas((atual) => {
            if (!atual[attachment.id]) return atual
            const copia = { ...atual }
            delete copia[attachment.id]
            return copia
          })
          // O ticket vale 10 minutos; renovar aos 8 deixa margem para a rede.
          timers.push(window.setTimeout(renovar, 8 * 60 * 1000))
        } catch {
          if (!disposto) setFalhas((atual) => ({ ...atual, [attachment.id]: true }))
        }
      }
      void renovar()
    }

    return () => {
      disposto = true
      for (const timer of timers) window.clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids, serverUrl, accessToken])

  return { urls, falhas }
}

export const MessageAttachments = memo(function MessageAttachments({ attachments, serverUrl, accessToken }: Props) {
  const [viewer, setViewer] = useState<string | null>(null)
  const { urls, falhas } = useAttachmentUrls(attachments ?? [], serverUrl, accessToken)

  // As imagens da mensagem, na ordem em que aparecem — e essa a lista pela qual
  // o visualizador navega com as setas.
  const imagens = useMemo<MediaViewerItem[]>(() => (attachments ?? [])
    .filter((item) => attachmentKind(item) === 'image' && urls[item.id])
    .map((item) => ({
      id: item.id,
      url: urls[item.id],
      filename: item.filename,
      size: item.size_bytes,
      width: item.width,
      height: item.height,
    })), [attachments, urls])

  if (!attachments?.length) return null

  const galeria = attachments.filter((item) => attachmentKind(item) === 'image').length > 1
  const indiceInicial = Math.max(0, imagens.findIndex((item) => item.id === viewer))

  return (
    <>
      <div className={`stapp-attachments-container ${galeria ? 'is-gallery' : ''}`}>
        {attachments.map((attachment) => {
          if (falhas[attachment.id]) {
            return (
              <div key={attachment.id} className="stapp-attachment-error" role="alert">
                Anexo indisponível — o arquivo pode ter sido removido.
              </div>
            )
          }
          const url = urls[attachment.id]
          if (!url) {
            return (
              <div key={attachment.id} className="stapp-attachment-loading" role="status">
                Carregando anexo…
              </div>
            )
          }
          return (
            <AttachmentRenderer
              key={attachment.id}
              attachment={attachment}
              url={url}
              onOpenViewer={setViewer}
            />
          )
        })}
      </div>

      {viewer && imagens.length > 0 && (
        <MediaViewer items={imagens} startIndex={indiceInicial} onClose={() => setViewer(null)} />
      )}
    </>
  )
})
