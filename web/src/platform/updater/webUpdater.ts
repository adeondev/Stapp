import type { AvailableUpdate, UpdateDownloadProgress, UpdaterService } from './types'
import pkg from '../../../package.json'

export const WEB_APP_VERSION = pkg.version

export class WebUpdater implements UpdaterService {
  readonly isDesktop = false

  async getCurrentVersion(): Promise<string> {
    return WEB_APP_VERSION
  }

  async checkForUpdate(): Promise<AvailableUpdate | null> {
    // Na web, atualizacoes de cliente sao gerenciadas por recarregamento da pagina e service workers.
    return null
  }

  async downloadAndInstall(
    _update: AvailableUpdate,
    _onProgress?: (progress: UpdateDownloadProgress) => void,
  ): Promise<void> {
    // Na web, nao ha download de binario nativo.
  }

  async relaunch(): Promise<void> {
    if (typeof window !== 'undefined') {
      window.location.reload()
    }
  }
}
