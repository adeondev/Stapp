import { useCallback, useEffect, useRef, useState } from 'react'
import { APP_VERSION, isSatisfied, updaterService } from './index'
import type { AvailableUpdate, UpdateChannel, UpdateDownloadProgress } from './types'

export interface MandatoryRequirement {
  minVersion: string
  serverName?: string
}

export function useAutoUpdater() {
  const [currentVersion, setCurrentVersion] = useState<string>(APP_VERSION)
  const [availableUpdate, setAvailableUpdate] = useState<AvailableUpdate | null>(null)
  const [channel, setChannelState] = useState<UpdateChannel>(() => updaterService.getChannel())
  const [isChecking, setIsChecking] = useState(false)
  const [isDownloading, setIsDownloading] = useState(false)
  const [progress, setProgress] = useState<UpdateDownloadProgress | null>(null)
  const [isReadyToRelaunch, setIsReadyToRelaunch] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [mandatoryRequirement, setMandatoryRequirement] = useState<MandatoryRequirement | null>(null)

  const isDesktop = updaterService.isDesktop
  const initialCheckRan = useRef(false)

  // Inicializa a versao real da aplicacao
  useEffect(() => {
    let active = true
    void updaterService.getCurrentVersion().then((ver) => {
      if (active) setCurrentVersion(ver)
    })
    return () => { active = false }
  }, [])

  const checkForUpdates = useCallback(async (interactive = false, targetChannel?: UpdateChannel): Promise<AvailableUpdate | null> => {
    setIsChecking(true)
    setError(null)
    try {
      const update = await updaterService.checkForUpdate(targetChannel)
      if (update) {
        setAvailableUpdate(update)
        setIsModalOpen(true)
        return update
      } else if (interactive) {
        // Feedback para checagem manual
        setAvailableUpdate(null)
      }
      return null
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Falha ao buscar atualizações.'
      if (interactive) {
        setError(msg)
      }
      return null
    } finally {
      setIsChecking(false)
    }
  }, [])

  const setChannel = useCallback((newChannel: UpdateChannel) => {
    updaterService.setChannel(newChannel)
    setChannelState(newChannel)
    void checkForUpdates(false, newChannel)
  }, [checkForUpdates])

  // Verificacao em background ao iniciar o aplicativo Desktop
  useEffect(() => {
    if (!isDesktop || initialCheckRan.current) return
    initialCheckRan.current = true

    const timer = setTimeout(() => {
      void checkForUpdates(false)
    }, 2500)

    return () => clearTimeout(timer)
  }, [isDesktop, checkForUpdates])

  const enforceMandatoryVersion = useCallback((minVersion: string, serverName?: string) => {
    if (!isSatisfied(currentVersion, minVersion)) {
      setMandatoryRequirement({ minVersion, serverName })
    }
  }, [currentVersion])

  const startUpdate = useCallback(async () => {
    setIsDownloading(true)
    setError(null)
    setProgress(null)

    try {
      let targetUpdate = availableUpdate
      if (!targetUpdate) {
        targetUpdate = await updaterService.checkForUpdate()
      }

      if (!targetUpdate) {
        throw new Error('Nenhum pacote de atualização disponível no momento.')
      }

      await updaterService.downloadAndInstall(targetUpdate, (prog) => {
        setProgress(prog)
      })

      setIsDownloading(false)
      setIsReadyToRelaunch(true)
    } catch (err) {
      setIsDownloading(false)
      setError(err instanceof Error ? err.message : 'Erro durante o download da atualização.')
    }
  }, [availableUpdate])

  const relaunch = useCallback(async () => {
    try {
      await updaterService.relaunch()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao reiniciar o aplicativo.')
    }
  }, [])

  const dismissModal = useCallback(() => {
    if (!isDownloading && !isReadyToRelaunch) {
      setIsModalOpen(false)
    }
  }, [isDownloading, isReadyToRelaunch])

  return {
    isDesktop,
    currentVersion,
    availableUpdate,
    isChecking,
    isDownloading,
    progress,
    isReadyToRelaunch,
    error,
    isModalOpen,
    mandatoryRequirement,
    channel,
    setChannel,
    checkForUpdates,
    enforceMandatoryVersion,
    startUpdate,
    relaunch,
    dismissModal,
  }
}
