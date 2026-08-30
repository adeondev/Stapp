import { httpBaseFromWs } from './auth'

/**
 * O avatar vai por HTTP, e nao pelo WebSocket, porque o socket carrega eventos
 * pequenos em tempo real — centenas de KB por ele atrasariam a conversa de todo
 * mundo naquela conexao.
 */

/** Acima disto o servidor recusa; conferir aqui evita a subida inutil. */
export const LIMITE_BYTES = 2 * 1024 * 1024

export class AvatarError extends Error {}

export function avatarBaseFromWs(serverUrl: string): string {
  return httpBaseFromWs(serverUrl)
}

/**
 * A URL da imagem de alguem. O `v` e o `updated_at` do perfil: trocar a foto
 * muda o endereco, entao o cache do navegador pode ser longo sem segurar a
 * imagem velha.
 */
export function avatarUrl(base: string, userId: string, version: number): string {
  return `${base}/avatars/${encodeURIComponent(userId)}?v=${version}`
}

export async function uploadAvatar(base: string, token: string, file: File): Promise<void> {
  if (file.size > LIMITE_BYTES) {
    throw new AvatarError('a imagem precisa ter menos de 2MB')
  }

  const resposta = await fetch(`${base}/avatars`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: file,
  })

  if (resposta.status === 401) throw new AvatarError('sua sessão expirou, entre de novo')
  if (!resposta.ok) {
    throw new AvatarError((await resposta.text()) || 'não consegui enviar a imagem')
  }
}

export async function removeAvatar(base: string, token: string): Promise<void> {
  const resposta = await fetch(`${base}/avatars`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!resposta.ok) throw new AvatarError('não consegui remover a imagem')
}
