/**
 * Preferência de tema e movimento.
 *
 * Suporta 5 temas semânticos:
 * - onix: Preto absoluto OLED (#000000), alto contraste
 * - escuro: Paleta dark moderna (#121214)
 * - cinza: Esquema suave balanceado (padrão)
 * - claro: Fundo branco limpo (#ffffff), texto escuro de alto contraste
 * - personalizado: Fundo e acento definidos pelo usuário
 */

export type AppTheme = 'onix' | 'escuro' | 'cinza' | 'claro' | 'personalizado'

export interface CustomThemeSettings {
  bg: string
  accent: string
}

export const THEME_KEY = 'stapp.appearance.theme'
export const CUSTOM_BG_KEY = 'stapp.appearance.custom_bg'
export const CUSTOM_ACCENT_KEY = 'stapp.appearance.custom_accent'

export const DEFAULT_CUSTOM_THEME: CustomThemeSettings = {
  bg: '#1a1a2e',
  accent: '#6366f1',
}

export function loadThemePreference(): AppTheme {
  try {
    const salvo = localStorage.getItem(THEME_KEY)
    if (salvo === 'onix' || salvo === 'escuro' || salvo === 'cinza' || salvo === 'claro' || salvo === 'personalizado') {
      return salvo
    }
    return 'cinza'
  } catch {
    return 'cinza'
  }
}

export function loadCustomThemeSettings(): CustomThemeSettings {
  try {
    const bg = localStorage.getItem(CUSTOM_BG_KEY) || DEFAULT_CUSTOM_THEME.bg
    const accent = localStorage.getItem(CUSTOM_ACCENT_KEY) || DEFAULT_CUSTOM_THEME.accent
    return { bg, accent }
  } catch {
    return DEFAULT_CUSTOM_THEME
  }
}

export function applyTheme(theme: AppTheme, custom?: CustomThemeSettings) {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  root.setAttribute('data-theme', theme)

  if (theme === 'personalizado') {
    const settings = custom ?? loadCustomThemeSettings()
    root.style.setProperty('--custom-bg', settings.bg)
    root.style.setProperty('--custom-accent', settings.accent)
  } else {
    root.style.removeProperty('--custom-bg')
    root.style.removeProperty('--custom-accent')
  }

  try {
    localStorage.setItem(THEME_KEY, theme)
    if (theme === 'personalizado' && custom) {
      localStorage.setItem(CUSTOM_BG_KEY, custom.bg)
      localStorage.setItem(CUSTOM_ACCENT_KEY, custom.accent)
    }
  } catch {}
}

export type MotionPreference = 'system' | 'reduced'

const CHAVE = 'stapp.appearance.motion'

export function loadMotionPreference(): MotionPreference {
  try {
    return localStorage.getItem(CHAVE) === 'reduced' ? 'reduced' : 'system'
  } catch {
    // Aba anonima ou armazenamento bloqueado: cai no padrao do sistema.
    return 'system'
  }
}

export function applyMotionPreference(value: MotionPreference) {
  if (typeof document === 'undefined') return
  if (value === 'reduced') document.documentElement.setAttribute('data-motion', 'reduced')
  else document.documentElement.removeAttribute('data-motion')
  try {
    if (value === 'reduced') localStorage.setItem(CHAVE, 'reduced')
    else localStorage.removeItem(CHAVE)
  } catch {
    // Sem armazenamento a escolha vale so para esta sessao — melhor do que nada.
  }
}
