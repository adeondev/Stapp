import type { AvailableUpdate, UpdateDownloadProgress, UpdaterService } from './types'

export class DesktopUpdater implements UpdaterService {
  readonly isDesktop = true

  async getCurrentVersion(): Promise<string> {
    try {
      const { getVersion } = await import('@tauri-apps/api/app')
      return await getVersion()
    } catch {
      return '0.1.0'
    }
  }

  async checkForUpdate(): Promise<AvailableUpdate | null> {
    try {
      const { check } = await import('@tauri-apps/plugin-updater')
      const update = await check()
      if (!update) return null

      return {
        version: update.version,
        currentVersion: update.currentVersion,
        date: update.date,
        body: update.body,
        rawUpdate: update,
      }
    } catch (err) {
      console.warn('[DesktopUpdater] Erro ao verificar atualizacoes:', err)
      return null
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
