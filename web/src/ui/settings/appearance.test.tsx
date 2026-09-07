// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { VoiceSnapshot } from '../../voice/VoiceTransport'
import {
  applyMotionPreference,
  applyTheme,
  CUSTOM_ACCENT_KEY,
  CUSTOM_BG_KEY,
  DEFAULT_CUSTOM_THEME,
  loadCustomThemeSettings,
  loadMotionPreference,
  loadThemePreference,
  THEME_KEY,
} from './appearance'

describe('appearance settings', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.removeAttribute('data-theme')
    document.documentElement.removeAttribute('data-motion')
    document.documentElement.style.removeProperty('--custom-bg')
    document.documentElement.style.removeProperty('--custom-accent')
  })

  afterEach(() => {
    localStorage.clear()
  })

  describe('tema', () => {
    it('carrega cinza por padrao quando nada esta salvo', () => {
      expect(loadThemePreference()).toBe('cinza')
    })

    it('carrega o tema valido salvo no localStorage', () => {
      localStorage.setItem(THEME_KEY, 'onix')
      expect(loadThemePreference()).toBe('onix')

      localStorage.setItem(THEME_KEY, 'escuro')
      expect(loadThemePreference()).toBe('escuro')

      localStorage.setItem(THEME_KEY, 'claro')
      expect(loadThemePreference()).toBe('claro')

      localStorage.setItem(THEME_KEY, 'personalizado')
      expect(loadThemePreference()).toBe('personalizado')
    })

    it('ignora valor invalido e cai no cinza', () => {
      localStorage.setItem(THEME_KEY, 'invalido-inexistente')
      expect(loadThemePreference()).toBe('cinza')
    })

    it('aplica tema no documentElement e persiste no localStorage', () => {
      applyTheme('onix')
      expect(document.documentElement.getAttribute('data-theme')).toBe('onix')
      expect(localStorage.getItem(THEME_KEY)).toBe('onix')

      applyTheme('claro')
      expect(document.documentElement.getAttribute('data-theme')).toBe('claro')
      expect(localStorage.getItem(THEME_KEY)).toBe('claro')
    })

    it('aplica tema personalizado com cores customizadas e persiste', () => {
      applyTheme('personalizado', { bg: '#0f172a', accent: '#38bdf8' })
      expect(document.documentElement.getAttribute('data-theme')).toBe('personalizado')
      expect(document.documentElement.style.getPropertyValue('--custom-bg')).toBe('#0f172a')
      expect(document.documentElement.style.getPropertyValue('--custom-accent')).toBe('#38bdf8')
      expect(localStorage.getItem(THEME_KEY)).toBe('personalizado')
      expect(localStorage.getItem(CUSTOM_BG_KEY)).toBe('#0f172a')
      expect(localStorage.getItem(CUSTOM_ACCENT_KEY)).toBe('#38bdf8')
    })

    it('remove variaveis customizadas ao alternar para outro tema fixo', () => {
      applyTheme('personalizado', { bg: '#112233', accent: '#445566' })
      expect(document.documentElement.style.getPropertyValue('--custom-bg')).toBe('#112233')

      applyTheme('escuro')
      expect(document.documentElement.getAttribute('data-theme')).toBe('escuro')
      expect(document.documentElement.style.getPropertyValue('--custom-bg')).toBe('')
      expect(document.documentElement.style.getPropertyValue('--custom-accent')).toBe('')
    })

    it('carrega configuracoes padrao de tema personalizado se nada foi salvo', () => {
      const config = loadCustomThemeSettings()
      expect(config).toEqual(DEFAULT_CUSTOM_THEME)
    })
  })

  describe('movimento', () => {
    it('carrega system por padrao', () => {
      expect(loadMotionPreference()).toBe('system')
    })

    it('carrega reduced quando salvo', () => {
      localStorage.setItem('stapp.appearance.motion', 'reduced')
      expect(loadMotionPreference()).toBe('reduced')
    })

    it('aplica data-motion reduced no documentElement', () => {
      applyMotionPreference('reduced')
      expect(document.documentElement.getAttribute('data-motion')).toBe('reduced')

      applyMotionPreference('system')
      expect(document.documentElement.getAttribute('data-motion')).toBeNull()
    })
  })

  describe('UI de AppSettings - Aparência', () => {
    it('renderiza os 5 cartões visuais de tema e troca o tema ao clicar', async () => {
      const { render, screen } = await import('@testing-library/react')
      const userEvent = (await import('@testing-library/user-event')).default
      const { AppSettings } = await import('./AppSettings')

      const profile = {
        user_id: 'u1',
        username: 'daniel',
        display_name: 'Daniel',
        accent: 'blue' as const,
        bio: '',
        has_avatar: false,
        has_banner: false,
        created_at: 0,
        updated_at: 0,
      }

      const snapshot: VoiceSnapshot = {
        status: 'idle',
        channel: null,
        muted: false,
        deafened: false,
        cameraEnabled: false,
        screenSharing: false,
        screenHasAudio: null,
        participants: [],
        media: [],
        audioProcessor: { status: 'idle', effective: 'none' },
        error: null,
      }

      const updater = {
        currentVersion: '0.1.0',
        availableUpdate: null,
        isDownloading: false,
        isReadyToRelaunch: false,
        progress: 0,
        error: null,
        relaunchFailed: false,
        isChecking: false,
        checkError: null,
        dismissModal: () => {},
        startUpdate: () => {},
        relaunch: () => {},
        isModalOpen: false,
        isDesktop: false,
        channel: 'stable' as const,
        setChannel: () => {},
        checkNow: async () => false,
        checkForUpdates: async () => null,
        mandatoryRequirement: null,
        enforceMandatoryVersion: () => {},
        bootPhase: 'ready' as const,
      }

      render(
        <AppSettings
          open={true}
          initialCategory="appearance"
          onClose={() => {}}
          profile={profile}
          avatarBase={null}
          onSaveProfile={() => {}}
          onAvatar={async () => {}}
          onBanner={async () => {}}
          transport={null}
          snapshot={snapshot}
          updater={updater}
          serverName="Stapp Test"
          protocolVersion={1}
        />,
      )

      expect(screen.getByRole('radio', { name: /Selecionar tema Ônix/i })).toBeTruthy()
      expect(screen.getByRole('radio', { name: /Selecionar tema Escuro/i })).toBeTruthy()
      expect(screen.getByRole('radio', { name: /Selecionar tema Cinza Neutro/i })).toBeTruthy()
      expect(screen.getByRole('radio', { name: /Selecionar tema Claro/i })).toBeTruthy()
      expect(screen.getByRole('radio', { name: /Selecionar tema Personalizado/i })).toBeTruthy()

      // Clicar no tema Ônix
      await userEvent.click(screen.getByRole('radio', { name: /Selecionar tema Ônix/i }))
      expect(document.documentElement.getAttribute('data-theme')).toBe('onix')
      expect(localStorage.getItem(THEME_KEY)).toBe('onix')

      // Clicar no tema Claro
      await userEvent.click(screen.getByRole('radio', { name: /Selecionar tema Claro/i }))
      expect(document.documentElement.getAttribute('data-theme')).toBe('claro')
      expect(localStorage.getItem(THEME_KEY)).toBe('claro')

      // Clicar no tema Personalizado e verificar que campos de cor aparecem
      await userEvent.click(screen.getByRole('radio', { name: /Selecionar tema Personalizado/i }))
      expect(document.documentElement.getAttribute('data-theme')).toBe('personalizado')
      expect(screen.getByLabelText(/Selecionar tom de fundo personalizado/i)).toBeTruthy()
      expect(screen.getByLabelText(/Selecionar cor de destaque personalizada/i)).toBeTruthy()
    })
  })
})
