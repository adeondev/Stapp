import { httpBaseFrom } from './auth'

export interface UploadProgressCallback {
  (percentage: number): void
}

export interface UploadScope {
  kind: 'channel' | 'direct'
  id: string
}

interface UploadResponse {
  attachment_id: string
}

class UploadError extends Error {
  constructor(message: string, readonly status = 0) {
    super(message)
  }
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function friendlyUploadError(status: number, body: string) {
  if (status === 401) return 'Sua sessao expirou. Entre novamente para enviar.'
  if (status === 413) return 'O arquivo excede o limite do servidor.'
  if (status === 415) return body || 'Formato de arquivo incompativel.'
  if (status === 503) return 'O armazenamento esta indisponivel.'
  if (status === 0) return 'A conexao foi interrompida durante o upload.'
  return body || `Nao foi possivel enviar o arquivo (HTTP ${status}).`
}

function uploadOnce(
  endpoint: string,
  accessToken: string,
  file: File,
  scope: UploadScope = { kind: 'channel', id: 'geral' },
  onProgress?: UploadProgressCallback,
  signal?: AbortSignal,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', endpoint, true)
    xhr.setRequestHeader('Authorization', `Bearer ${accessToken}`)
    xhr.responseType = 'json'

    const abort = () => xhr.abort()
    signal?.addEventListener('abort', abort, { once: true })
    const cleanup = () => signal?.removeEventListener('abort', abort)

    if (xhr.upload && onProgress) {
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100))
      }
    }
    xhr.onload = () => {
      cleanup()
      if (xhr.status >= 200 && xhr.status < 300) {
        const response = xhr.response as UploadResponse | null
        if (response?.attachment_id) resolve(response.attachment_id)
        else reject(new UploadError('O servidor devolveu uma resposta de upload invalida.', xhr.status))
        return
      }
      reject(new UploadError(friendlyUploadError(xhr.status, xhr.responseText), xhr.status))
    }
    xhr.onerror = () => {
      cleanup()
      reject(new UploadError(friendlyUploadError(0, ''), 0))
    }
    xhr.onabort = () => {
      cleanup()
      reject(new DOMException('Upload cancelado', 'AbortError'))
    }

    const form = new FormData()
    // O servidor consegue validar a conversa antes de permitir o vinculo.
    form.append('scope_kind', scope.kind)
    form.append('scope_id', scope.id)
    form.append('file', file, file.name)
    xhr.send(form)
  })
}

/** Upload mediado pelo Stapp. Nao expoe MinIO/S3 nem enderecos locais ao cliente. */
export async function uploadMediaFile(
  serverUrl: string,
  accessToken: string,
  file: File,
  scope: UploadScope = { kind: 'channel', id: 'geral' },
  onProgress?: UploadProgressCallback,
  signal?: AbortSignal,
): Promise<string> {
  const endpoint = `${httpBaseFrom(serverUrl)}/attachments`
  const delays = [0, 1_000, 2_000, 4_000]
  let lastError: unknown

  for (let attempt = 0; attempt < delays.length; attempt += 1) {
    if (delays[attempt]) await wait(delays[attempt])
    try {
      return await uploadOnce(endpoint, accessToken, file, scope, onProgress, signal)
    } catch (error) {
      lastError = error
      if (error instanceof DOMException && error.name === 'AbortError') throw error
      // 4xx e decisao definitiva do servidor; repetir so piora a mensagem.
      if (error instanceof UploadError && error.status >= 400 && error.status < 500) throw error
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Falha no upload.')
}

export async function deletePendingAttachment(
  serverUrl: string,
  accessToken: string,
  attachmentId: string,
) {
  await fetch(`${httpBaseFrom(serverUrl)}/attachments/${attachmentId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  })
}

export interface AttachmentMetadata {
  filename?: string
  description?: string
  duration_ms?: number
  waveform?: number[]
  width?: number
  height?: number
}

export async function updatePendingAttachment(
  serverUrl: string,
  accessToken: string,
  attachmentId: string,
  metadata: AttachmentMetadata,
) {
  const response = await fetch(`${httpBaseFrom(serverUrl)}/attachments/${attachmentId}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(metadata),
  })
  if (!response.ok) throw new Error(friendlyUploadError(response.status, await response.text()))
}

export async function attachmentContentUrl(
  serverUrl: string,
  accessToken: string,
  attachmentId: string,
) {
  const base = httpBaseFrom(serverUrl)
  const response = await fetch(`${base}/attachments/${attachmentId}/ticket`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!response.ok) throw new Error(await response.text())
  const payload = (await response.json()) as { content_url: string }
  return new URL(payload.content_url, base).toString()
}
