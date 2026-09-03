import type { AvailableUpdate, UpdateChannel, UpdateDownloadProgress, UpdaterService } from './types'
import { resolveUpdateEndpoint } from './githubReleases'
import { WEB_APP_VERSION } from './webUpdater'

const STORAGE_KEY_CHANNEL = 'stapp_updater_channel'

export class DesktopUpdater implements UpdaterService {
  readonly isDesktop = true

  getChannel(): UpdateChannel {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const saved = window.localStorage.getItem(STORAGE_KEY_CHANNEL)
        if (saved === 'stable' || saved === 'beta') return saved
      }
    } catch {
      // ignore
    }
    return WEB_APP_VERSION.includes('-') ? 'beta' : 'stable'
  }

  setChannel(channel: UpdateChannel): void {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(STORAGE_KEY_CHANNEL, channel)
      }
    } catch {
      // ignore
    }
  }

  async getCurrentVersion(): Promise<string> {
    try {
      const { getVersion } = await import('@tauri-apps/api/app')
      return await getVersion()
    } catch (err) {
      console.warn('[DesktopUpdater] Falha ao obter versao nativa via getVersion():', err)
      return '0.1.0'
    }
  }

  async checkForUpdate(channel?: UpdateChannel): Promise<AvailableUpdate | null> {
    const activeChannel = channel ?? this.getChannel()
    console.info(`[DesktopUpdater] Verificando atualizacoes no canal: ${activeChannel}`)

    let customEndpoint: string | null = null
    try {
      customEndpoint = await resolveUpdateEndpoint(activeChannel)
      if (customEndpoint) {
        console.info(`[DesktopUpdater] Endpoint resolvido para ${activeChannel}:`, customEndpoint)
      }
    } catch (err) {
      console.warn('[DesktopUpdater] Falha ao consultar endpoint dinâmico do GitHub:', err)
    }

    try {
      const { invoke } = await import('@tauri-apps/api/core')
      const { Update } = await import('@tauri-apps/plugin-updater')
      const metadata = await invoke<any>('check_update_with_endpoint', {
        endpoint: customEndpoint ?? undefined,
      })

      if (!metadata) {
        console.info('[DesktopUpdater] Nenhuma atualizacao disponivel.')
        return null
      }

      const update = new Update(metadata)
      const isPrerelease = metadata.version.includes('-')
      console.info(`[DesktopUpdater] Atualizacao encontrada: v${update.version} (pre-release: ${isPrerelease})`)

      return {
        version: update.version,
        currentVersion: update.currentVersion,
        date: update.date,
        body: update.body,
        isPrerelease,
        rawUpdate: update,
      }
    } catch (err) {
      console.warn('[DesktopUpdater] Erro no check_update_with_endpoint, tentando fallback no plugin:', err)
      const { check } = await import('@tauri-apps/plugin-updater')
      const update = await check()
      if (!update) return null

      return {
        version: update.version,
        currentVersion: update.currentVersion,
        date: update.date,
        body: update.body,
        isPrerelease: update.version.includes('-'),
        rawUpdate: update,
      }
    }
  }

  async downloadAndInstall(
    update: AvailableUpdate,
    onProgress?: (progress: UpdateDownloadProgress) => void,
  ): Promise<void> {
    let rawUpdate = update.rawUpdate as {
      downloadAndInstall: (
        handler?: (event: {
          event: 'Started' | 'Progress' | 'Finished'
          data?: { contentLength?: number; chunkLength?: number }
        }) => void,
      ) => Promise<void>
    } | undefined

    if (!rawUpdate) {
      const { check } = await import('@tauri-apps/plugin-updater')
      const checked = await check()
      if (!checked) {
        throw new Error('Nenhuma atualizacao encontrada para download.')
      }
      rawUpdate = checked
    }

    let totalBytes: number | null = null
    let downloadedBytes = 0

    await rawUpdate.downloadAndInstall((event) => {
      if (event.event === 'Started') {
        totalBytes = event.data?.contentLength ?? null
        downloadedBytes = 0
        onProgress?.({
          chunkLength: 0,
          downloadedBytes: 0,
          totalBytes,
          percentage: 0,
        })
      } else if (event.event === 'Progress') {
        const chunk = event.data?.chunkLength ?? 0
        downloadedBytes += chunk
        const percentage = totalBytes && totalBytes > 0
          ? Math.min(100, Math.round((downloadedBytes / totalBytes) * 100))
          : 0
        onProgress?.({
          chunkLength: chunk,
          downloadedBytes,
          totalBytes,
          percentage,
        })
      } else if (event.event === 'Finished') {
        onProgress?.({
          chunkLength: 0,
          downloadedBytes: totalBytes ?? downloadedBytes,
          totalBytes,
          percentage: 100,
        })
      }
    })
  }

  async relaunch(): Promise<void> {
    const { relaunch } = await import('@tauri-apps/plugin-process')
    await relaunch()
  }
}
