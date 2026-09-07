/**
 * Medir imagem e video ANTES de mandar.
 *
 * `Attachment.width` e `Attachment.height` existem no protocolo e no banco desde
 * a migracao v8, e o `PATCH /attachments/{id}` sempre aceitou os dois — mas
 * ninguem preenchia. O servidor nao decodifica anexo (so avatar), e o cliente
 * mandava apenas `filename` e `description`. Resultado: toda midia chegava sem
 * proporcao conhecida.
 *
 * Isso e o que fazia o video vertical ficar espremido numa caixa horizontal e a
 * lista de mensagens dar salto — o `<video>` tem altura 0 ate o `loadedmetadata`
 * chegar, e ai a conversa inteira pula.
 *
 * Medir aqui custa quase nada (o arquivo ja esta na memoria do navegador) e
 * resolve na origem: com `width`/`height` gravados, o container recebe
 * `aspect-ratio` **antes** de qualquer byte de midia ser baixado.
 */

export interface MediaDimensions {
  width: number
  height: number
}

/** Nao vale segurar o envio por causa de um arquivo que nao quer decodificar. */
const TIMEOUT_MS = 5_000

export function isImageFile(file: File): boolean {
  return file.type.startsWith('image/')
}

export function isVideoFile(file: File): boolean {
  return file.type.startsWith('video/')
}

/**
 * As dimensoes reais do arquivo, ou `null` quando nao da para saber.
 *
 * `null` nao e erro: SVG sem tamanho intrinseco, codec que o navegador nao
 * decodifica, arquivo corrompido. Quem chama simplesmente nao manda o metadado,
 * e o player mede no `loadedmetadata` como fazia antes.
 */
export async function probeMediaDimensions(file: File): Promise<MediaDimensions | null> {
  if (isImageFile(file)) return medirImagem(file)
  if (isVideoFile(file)) return medirVideo(file)
  return null
}

function medirImagem(file: File): Promise<MediaDimensions | null> {
  return comObjectUrl(file, (url) => new Promise((resolve) => {
    const imagem = new Image()
    const encerrar = (valor: MediaDimensions | null) => resolve(valor)
    const relogio = window.setTimeout(() => encerrar(null), TIMEOUT_MS)
    imagem.onload = () => {
      window.clearTimeout(relogio)
      // `naturalWidth` zero acontece com SVG sem dimensao intrinseca.
      encerrar(imagem.naturalWidth && imagem.naturalHeight
        ? { width: imagem.naturalWidth, height: imagem.naturalHeight }
        : null)
    }
    imagem.onerror = () => {
      window.clearTimeout(relogio)
      encerrar(null)
    }
    imagem.src = url
  }))
}

function medirVideo(file: File): Promise<MediaDimensions | null> {
  return comObjectUrl(file, (url) => new Promise((resolve) => {
    const video = document.createElement('video')
    // `metadata` basta: nao vale baixar o arquivo inteiro para saber o tamanho.
    video.preload = 'metadata'
    video.muted = true
    const encerrar = (valor: MediaDimensions | null) => {
      video.removeAttribute('src')
      video.load()
      resolve(valor)
    }
    const relogio = window.setTimeout(() => encerrar(null), TIMEOUT_MS)
    video.onloadedmetadata = () => {
      window.clearTimeout(relogio)
      encerrar(video.videoWidth && video.videoHeight
        ? { width: video.videoWidth, height: video.videoHeight }
        : null)
    }
    video.onerror = () => {
      window.clearTimeout(relogio)
      encerrar(null)
    }
    video.src = url
  }))
}

/** O object URL e sempre revogado, inclusive quando a medicao falha. */
async function comObjectUrl<T>(file: File, usar: (url: string) => Promise<T>): Promise<T> {
  const url = URL.createObjectURL(file)
  try {
    return await usar(url)
  } finally {
    URL.revokeObjectURL(url)
  }
}
