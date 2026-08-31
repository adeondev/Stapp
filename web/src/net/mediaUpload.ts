export interface PresignResponse {
  attachment_id: string
  upload_url: string
  download_url: string
  s3_key: string
}

export interface UploadProgressCallback {
  (percentage: number): void
}

/**
 * Faz o upload de um arquivo para o MinIO / S3 via Presigned URL gerada pelo servidor Stapp.
 */
export async function uploadMediaFile(
  serverUrl: string,
  accessToken: string,
  file: File,
  onProgress?: UploadProgressCallback
): Promise<string> {
  const baseUrl = serverUrl.replace(/\/+$/, '')
  const presignEndpoint = `${baseUrl}/attachments/presign`

  // 1. Solicita a Presigned URL no backend Stapp
  const presignRes = await fetch(presignEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      filename: file.name,
      content_type: file.type || 'application/octet-stream',
      size_bytes: file.size,
    }),
  })

  if (!presignRes.ok) {
    const errorText = await presignRes.text().catch(() => 'Erro ao obter permissão de upload')
    throw new Error(errorText || 'Falha ao solicitar URL pré-assinada')
  }

  const presignData: PresignResponse = await presignRes.json()

  // 2. Envia o arquivo diretamente para o S3 / MinIO via HTTP PUT com acompanhamento de progresso
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', presignData.upload_url, true)
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream')

    if (xhr.upload && onProgress) {
      xhr.upload.onprogress = (evt) => {
        if (evt.lengthComputable) {
          const percent = Math.round((evt.loaded / evt.total) * 100)
          onProgress(percent)
        }
      }
    }

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve()
      } else {
        reject(new Error(`Falha no upload para o storage: status ${xhr.status}`))
      }
    }

    xhr.onerror = () => reject(new Error('Erro de conexão durante o upload de mídia'))
    xhr.send(file)
  })

  // 3. Confirma o registro do anexo no SQLite do Stapp
  const confirmEndpoint = `${baseUrl}/attachments/confirm`
  const confirmRes = await fetch(confirmEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      attachment_id: presignData.attachment_id,
      filename: file.name,
      content_type: file.type || 'application/octet-stream',
      size_bytes: file.size,
      s3_key: presignData.s3_key,
    }),
  })

  if (!confirmRes.ok) {
    console.warn('Aviso: anexo enviado ao storage mas confirmação no servidor retornou status', confirmRes.status)
  }

  return presignData.attachment_id
}