import { describe, expect, it, vi } from 'vitest'
import {
  AvatarError,
  AvatarSessionExpired,
  avatarUrl,
  comRenovacao,
  removeAvatar,
  resolveMediaUrl,
  uploadAvatar,
} from './avatars'

const arquivoFalso = (bytes: number) =>
  ({ size: bytes, type: 'image/png' }) as unknown as File

describe('chamadas de avatar', () => {
  it('401 vira erro de sessao, e nao um erro qualquer', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 401, ok: false }))
    await expect(uploadAvatar('http://s', 'tok', arquivoFalso(10))).rejects.toBeInstanceOf(
      AvatarSessionExpired,
    )
    await expect(removeAvatar('http://s', 'tok')).rejects.toBeInstanceOf(AvatarSessionExpired)
  })

  it('recusa arquivo grande antes de subir qualquer byte', async () => {
    const chamou = vi.fn()
    vi.stubGlobal('fetch', chamou)
    await expect(uploadAvatar('http://s', 'tok', arquivoFalso(5 * 1024 * 1024))).rejects.toBeInstanceOf(
      AvatarError,
    )
    expect(chamou).not.toHaveBeenCalled()
  })

  it('a URL leva a versao, para o cache nao segurar a foto velha', () => {
    expect(avatarUrl('http://s', 'u1', 42)).toBe('http://s/avatars/u1?v=42')
  })
})

describe('renovacao de sessao no upload', () => {
  it('token vencido: renova e tenta de novo', async () => {
    // Foi exatamente isto que aconteceu numa call longa: o access token dura
    // 15 minutos e vencia com o WebSocket ainda vivo.
    const executar = vi
      .fn()
      .mockRejectedValueOnce(new AvatarSessionExpired('venceu'))
      .mockResolvedValueOnce(undefined)
    const renovar = vi.fn().mockResolvedValue('token-novo')

    await comRenovacao(executar, 'token-velho', renovar)

    expect(executar).toHaveBeenNthCalledWith(1, 'token-velho')
    expect(executar).toHaveBeenNthCalledWith(2, 'token-novo')
    expect(renovar).toHaveBeenCalledTimes(1)
  })

  it('nao tenta de novo quando o erro nao e de sessao', async () => {
    const executar = vi.fn().mockRejectedValue(new AvatarError('nao e imagem'))
    const renovar = vi.fn()

    await expect(comRenovacao(executar, 'tok', renovar)).rejects.toThrow('nao e imagem')
    expect(executar).toHaveBeenCalledTimes(1)
    expect(renovar).not.toHaveBeenCalled()
  })

  it('so tenta uma vez a mais: se a renovacao tambem falhar, desiste', async () => {
    const executar = vi.fn().mockRejectedValue(new AvatarSessionExpired('venceu'))
    const renovar = vi.fn().mockResolvedValue(null)

    await expect(comRenovacao(executar, 'tok', renovar)).rejects.toBeInstanceOf(
      AvatarSessionExpired,
    )
    expect(executar).toHaveBeenCalledTimes(1)
  })

  it('sem token nenhum, renova antes de tentar', async () => {
    const executar = vi.fn().mockResolvedValue(undefined)
    const renovar = vi.fn().mockResolvedValue('token-novo')

    await comRenovacao(executar, null, renovar)

    expect(renovar).toHaveBeenCalledTimes(1)
    expect(executar).toHaveBeenCalledWith('token-novo')
  })
})

/* O `Profile` traz `avatar_static_url`, `avatar_gif_url` e `banner_url`
   RELATIVAS ao servidor. Usadas cruas num `<img src>` elas sao resolvidas
   contra a origem da PAGINA: `tauri://localhost` no app desktop e `:5173` no
   dev. Foi assim que o banner sumiu no desktop com a imagem salva. */
describe('resolveMediaUrl', () => {
  it('prefixa o que veio relativo', () => {
    expect(resolveMediaUrl('https://servidor.exemplo', '/banners/u1?v=7'))
      .toBe('https://servidor.exemplo/banners/u1?v=7')
  })

  it('nao come a barra de quem veio sem ela', () => {
    expect(resolveMediaUrl('https://servidor.exemplo', 'banners/u1'))
      .toBe('https://servidor.exemplo/banners/u1')
  })

  it('deixa passar o que ja e absoluto', () => {
    for (const url of [
      'https://outro/img.webp',
      'http://outro/img.webp',
      'blob:https://app/1234',
      'data:image/png;base64,AAAA',
    ]) {
      expect(resolveMediaUrl('https://servidor.exemplo', url)).toBe(url)
    }
  })

  it('sem URL nao inventa endereco nenhum', () => {
    expect(resolveMediaUrl('https://servidor.exemplo', undefined)).toBeUndefined()
    expect(resolveMediaUrl('https://servidor.exemplo', null)).toBeUndefined()
    expect(resolveMediaUrl('https://servidor.exemplo', '')).toBeUndefined()
  })

  it('sem base devolve o que veio, em vez de quebrar a tela', () => {
    expect(resolveMediaUrl(null, '/banners/u1')).toBe('/banners/u1')
  })
})
