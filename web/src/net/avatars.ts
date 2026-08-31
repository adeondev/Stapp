import { httpBaseFromWs } from './auth'

/**
 * O avatar vai por HTTP, e nao pelo WebSocket, porque o socket carrega eventos
 * pequenos em tempo real — centenas de KB por ele atrasariam a conversa de todo
 * mundo naquela conexao.
 */

/** Acima disto o servidor recusa; conferir aqui evita a subida inutil. */
export const LIMITE_BYTES = 2 * 1024 * 1024

export class AvatarError extends Error {}

/**
 * O access token venceu. Vale a pena separar de um erro qualquer porque tem
 * conserto automatico: renovar a sessao e tentar de novo.
 */
export class AvatarSessionExpired extends AvatarError {}

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

  if (resposta.status === 401) throw new AvatarSessionExpired('sessão expirada')
  if (!resposta.ok) {
    throw new AvatarError((await resposta.text()) || 'não consegui enviar a imagem')
  }
}

export async function removeAvatar(base: string, token: string): Promise<void> {
  const resposta = await fetch(`${base}/avatars`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  })
  if (resposta.status === 401) throw new AvatarSessionExpired('sessão expirada')
  if (!resposta.ok) throw new AvatarError('não consegui remover a imagem')
}

/**
 * Executa uma chamada autenticada e, se o token tiver vencido, renova a sessao
 * e tenta **uma** vez mais.
 *
 * Existe porque o access token dura 15 minutos e so era renovado ao reconectar:
 * numa call longa ele vence com o WebSocket ainda vivo, e o upload — que vai
 * por HTTP, nao pelo socket — levava um token velho e tomava 401.
 */
export async function comRenovacao(
  executar: (token: string) => Promise<void>,
  tokenAtual: string | null,
  renovar: () => Promise<string | null>,
): Promise<void> {
  if (!tokenAtual) {
    const novo = await renovar()
    if (!novo) throw new AvatarSessionExpired('sua sessão expirou, entre de novo')
    return executar(novo)
  }

  try {
    await executar(tokenAtual)
  } catch (erro) {
    if (!(erro instanceof AvatarSessionExpired)) throw erro
    const novo = await renovar()
    if (!novo) throw new AvatarSessionExpired('sua sessão expirou, entre de novo')
    await executar(novo)
  }
}
