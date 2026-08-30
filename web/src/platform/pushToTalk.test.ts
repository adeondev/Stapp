// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindPushToTalk } from './pushToTalk'

describe('Push-to-Talk no navegador', () => {
  afterEach(() => {
    delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__
  })

  it('funciona em foco, ignora repeticao e fecha o microfone ao perder foco', async () => {
    const states: boolean[] = []
    const binding = await bindPushToTalk('Control+Space', (pressed) => states.push(pressed))
    expect(binding.global).toBe(false)

    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', key: ' ', ctrlKey: true }))
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', key: ' ', ctrlKey: true, repeat: true }))
    window.dispatchEvent(new Event('blur'))
    expect(states).toEqual([true, false])

    await binding.dispose()
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space', key: ' ', ctrlKey: true }))
    expect(states).toEqual([true, false])
  })

  it('nao aceita uma tecla sem os modificadores configurados', async () => {
    const callback = vi.fn()
    const binding = await bindPushToTalk('Control+Space', callback)
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', key: ' ' }))
    expect(callback).not.toHaveBeenCalled()
    await binding.dispose()
  })
})
