// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest'
import {
  GIF_FAVORITES_STORAGE_KEY,
  addFavoriteGif,
  getStoredFavoriteGifs,
  isFavoriteGif,
  isGifMedia,
  removeFavoriteGif,
  toggleFavoriteGif,
} from './gifFavorites'

describe('gifFavorites', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('retorna array vazio quando nao ha favoritos ou json invalido', () => {
    expect(getStoredFavoriteGifs()).toEqual([])

    localStorage.setItem(GIF_FAVORITES_STORAGE_KEY, 'invalido')
    expect(getStoredFavoriteGifs()).toEqual([])
  })

  it('adiciona e remove favoritos no localStorage', () => {
    addFavoriteGif('https://media.klipy.com/gif-1.gif')
    expect(isFavoriteGif('https://media.klipy.com/gif-1.gif')).toBe(true)
    expect(getStoredFavoriteGifs()).toEqual(['https://media.klipy.com/gif-1.gif'])

    // Adicionar repetido nao duplica
    addFavoriteGif('https://media.klipy.com/gif-1.gif')
    expect(getStoredFavoriteGifs()).toHaveLength(1)

    removeFavoriteGif('https://media.klipy.com/gif-1.gif')
    expect(isFavoriteGif('https://media.klipy.com/gif-1.gif')).toBe(false)
    expect(getStoredFavoriteGifs()).toEqual([])
  })

  it('toggleFavoriteGif alterna entre favoritar e remover', () => {
    const url = 'https://media.klipy.com/toggle.gif'
    const added = toggleFavoriteGif(url)
    expect(added).toBe(true)
    expect(isFavoriteGif(url)).toBe(true)

    const removed = toggleFavoriteGif(url)
    expect(removed).toBe(false)
    expect(isFavoriteGif(url)).toBe(false)
  })

  it('identifica midia GIF por extensao, mime type ou provedor', () => {
    expect(isGifMedia('https://site.com/anim.gif')).toBe(true)
    expect(isGifMedia('https://site.com/anim.gif?quality=high')).toBe(true)
    expect(isGifMedia('https://api.klipy.com/123')).toBe(true)
    expect(isGifMedia('https://site.com/img.png', 'GIF animado')).toBe(true)
    expect(isGifMedia('https://site.com/file', undefined, 'image/gif')).toBe(true)

    expect(isGifMedia('https://site.com/foto.jpg')).toBe(false)
    expect(isGifMedia('https://site.com/video.mp4')).toBe(false)
  })
})
