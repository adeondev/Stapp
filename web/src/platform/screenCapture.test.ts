// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'
import { isTauriRuntime, listScreenSources, thumbnailDataUrl } from './screenCapture'

describe('captura de tela por plataforma', () => {
  afterEach(() => {
    delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__
  })

  it('mantem o navegador puro sem dependencia do Tauri', async () => {
    expect(isTauriRuntime()).toBe(false)
    expect(await listScreenSources()).toEqual([])
  })

  it('monta a miniatura sem guardar um segundo payload', () => {
    expect(thumbnailDataUrl('abc')).toBe('data:image/png;base64,abc')
    expect(thumbnailDataUrl(null)).toBeNull()
  })
})
