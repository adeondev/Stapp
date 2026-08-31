import { describe, expect, it } from 'vitest'
import { extractGifUrl } from './klipy'

describe('extractGifUrl', () => {
  it('prefere a rendition de midia ao campo url do item', () => {
    // No Giphy `url` e a PAGINA do GIF: mandar aquilo no chat gerava <img>
    // apontando para HTML e a imagem ficava quebrada.
    const url = extractGifUrl({
      id: 'g1',
      title: 'gato',
      type: 'gif',
      url: 'https://giphy.com/gifs/gato-abc123',
      images: { original: { url: 'https://media.giphy.com/media/abc123/giphy.gif' } },
    })
    expect(url).toBe('https://media.giphy.com/media/abc123/giphy.gif')
  })

  it('descarta o link da pagina quando nao ha rendition', () => {
    expect(
      extractGifUrl({ id: 'g2', title: 'x', type: 'gif', url: 'https://giphy.com/gifs/x-1' })
    ).toBe('')
  })

  it('aceita url direta quando ela aponta para um arquivo de midia', () => {
    expect(
      extractGifUrl({ id: 'g3', title: 'x', type: 'gif', url: 'https://cdn.klipy.com/x.gif' })
    ).toBe('https://cdn.klipy.com/x.gif')
  })
})
