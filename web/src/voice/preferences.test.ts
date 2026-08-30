// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_VOICE_PREFERENCES, loadVoicePreferences, saveVoicePreferences } from './preferences'

describe('preferencias de voz', () => {
  beforeEach(() => localStorage.clear())

  it('persiste somente preferencias e limita valores adulterados', () => {
    localStorage.setItem('stapp.voice.preferences.v1', JSON.stringify({
      ...DEFAULT_VOICE_PREFERENCES,
      inputVolume: 900,
      outputVolume: -50,
      sensitivity: 30,
      token: 'nao-deve-sair-do-transporte',
    }))
    const loaded = loadVoicePreferences()
    expect(loaded.inputVolume).toBe(200)
    expect(loaded.outputVolume).toBe(0)
    expect(loaded.sensitivity).toBe(0)

    saveVoicePreferences(loaded)
    const persisted = localStorage.getItem('stapp.voice.preferences.v1') ?? ''
    expect(persisted).not.toContain('token')
    expect(persisted).not.toContain('nao-deve-sair-do-transporte')
  })
})
