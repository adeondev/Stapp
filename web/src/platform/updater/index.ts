import { DesktopUpdater } from './desktopUpdater'
import { WebUpdater, WEB_APP_VERSION } from './webUpdater'
import type { UpdaterService } from './types'

export * from './types'
export * from './semver'
export { DesktopUpdater } from './desktopUpdater'
export { WebUpdater, WEB_APP_VERSION } from './webUpdater'

export const APP_VERSION = WEB_APP_VERSION

/**
 * Detecta se a execucao atual esta ocorrendo dentro do runtime nativo do Tauri.
 */
export function isDesktopRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

let updaterInstance: UpdaterService | null = null

/**
 * Retorna a instancia correta do servico de atualizacoes baseada no runtime.
 */
export function getUpdaterService(): UpdaterService {
  if (!updaterInstance) {
    updaterInstance = isDesktopRuntime() ? new DesktopUpdater() : new WebUpdater()
  }
  return updaterInstance
}

export const updaterService = getUpdaterService()
