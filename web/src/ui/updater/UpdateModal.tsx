import { useEffect } from 'react'
import { IconX } from '../Icons'
import type { AvailableUpdate, UpdateDownloadProgress } from '../../platform/updater/types'
import './updater.css'

export interface UpdateModalProps {
  isOpen: boolean
  update: AvailableUpdate | null
  isDownloading: boolean
  progress: UpdateDownloadProgress | null
  isReadyToRelaunch?: boolean
  error?: string | null
  onClose: () => void
  onStartUpdate: () => void | Promise<void>
  onRelaunch?: () => void | Promise<void>
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}

export function UpdateModal({
  isOpen,
  update,
  isDownloading,
  progress,
  isReadyToRelaunch,
  error,
  onClose,
  onStartUpdate,
  onRelaunch,
}: UpdateModalProps) {
  useEffect(() => {
    if (!isOpen || isDownloading || isReadyToRelaunch) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, isDownloading, isReadyToRelaunch, onClose])

  if (!isOpen || !update) return null

  const percentage = progress?.percentage ?? (isReadyToRelaunch ? 100 : 0)

  return (
    <div
      className="updater-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="updater-modal-title"
      onClick={(e) => {
        if (!isDownloading && !isReadyToRelaunch && e.target === e.currentTarget) {
          onClose()
        }
      }}
    >
      <div className="updater-dialog">
        <header className="updater-header">
          <div className="updater-header__info">
            <span className="updater-header__badge">Nova Versão</span>
            <h2 id="updater-modal-title" className="updater-header__title">
              Atualização Disponível
            </h2>
            <p className="updater-header__subtitle">
              Uma nova versão do Stapp Desktop está pronta para instalação.
            </p>
          </div>
          {!isDownloading && !isReadyToRelaunch && (
            <button
              type="button"
              className="updater-close"
              onClick={onClose}
              aria-label="Fechar"
              title="Fechar"
            >
              <IconX size={16} />
            </button>
          )}
        </header>

        <div className="updater-body">
          <div className="updater-version-tag">
            <span>Versão Atual: <strong>v{update.currentVersion}</strong></span>
            <span aria-hidden="true">→</span>
            <span>Nova Versão: <strong>v{update.version}</strong></span>
          </div>

          {update.body && (
            <div className="updater-notes" tabIndex={0} aria-label="Notas da versão">
              {update.body}
            </div>
          )}

          {(isDownloading || isReadyToRelaunch) && (
            <div className="updater-progress-box">
              <div className="updater-progress-header">
                <span>
                  {isReadyToRelaunch
                    ? 'Download concluído!'
                    : progress?.totalBytes
                      ? `${formatBytes(progress.downloadedBytes)} de ${formatBytes(progress.totalBytes)}`
                      : 'Baixando atualização...'}
                </span>
                <strong>{percentage}%</strong>
              </div>
              <div
                className="updater-progress-track"
                role="progressbar"
                aria-valuenow={percentage}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div
                  className="updater-progress-fill"
                  style={{ width: `${percentage}%` }}
                />
              </div>
            </div>
          )}

          {error && (
            <div className="updater-error" role="alert">
              <span>{error}</span>
            </div>
          )}
        </div>

        <footer className="updater-actions">
          {!isDownloading && !isReadyToRelaunch && (
            <>
              <button
                type="button"
                className="updater-btn updater-btn--secondary"
                onClick={onClose}
              >
                Lembrar mais tarde
              </button>
              <button
                type="button"
                className="updater-btn updater-btn--primary"
                onClick={() => void onStartUpdate()}
                autoFocus
              >
                Atualizar agora
              </button>
            </>
          )}

          {isDownloading && (
            <button
              type="button"
              className="updater-btn updater-btn--primary"
              disabled
            >
              Baixando ({percentage}%)...
            </button>
          )}

          {isReadyToRelaunch && (
            <button
              type="button"
              className="updater-btn updater-btn--primary"
              onClick={() => void onRelaunch?.()}
              autoFocus
            >
              Reiniciar e aplicar
            </button>
          )}
        </footer>
      </div>
    </div>
  )
}
