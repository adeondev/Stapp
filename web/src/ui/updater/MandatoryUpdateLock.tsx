import { IconShield } from '../Icons'
import type { UpdateDownloadProgress } from '../../platform/updater/types'
import './updater.css'

export interface MandatoryUpdateLockProps {
  currentVersion: string
  requiredVersion: string
  serverName?: string
  isDesktop: boolean
  isDownloading: boolean
  progress: UpdateDownloadProgress | null
  isReadyToRelaunch?: boolean
  error?: string | null
  onStartUpdate: () => void | Promise<void>
  onRelaunch?: () => void | Promise<void>
  onWebReload?: () => void
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}

export function MandatoryUpdateLock({
  currentVersion,
  requiredVersion,
  serverName,
  isDesktop,
  isDownloading,
  progress,
  isReadyToRelaunch,
  error,
  onStartUpdate,
  onRelaunch,
  onWebReload,
}: MandatoryUpdateLockProps) {
  const percentage = progress?.percentage ?? (isReadyToRelaunch ? 100 : 0)

  return (
    <div
      className="updater-lock-screen"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="updater-lock-title"
      aria-describedby="updater-lock-desc"
    >
      <div className="updater-lock-card">
        <div className="updater-lock-icon" aria-hidden="true">
          <IconShield size={24} />
        </div>

        <div style={{ textAlign: 'center' }}>
          <span className="updater-header__badge updater-header__badge--mandatory" style={{ margin: '0 auto 8px' }}>
            Atualização Obrigatória
          </span>
          <h1 id="updater-lock-title" className="updater-lock-title">
            Versão do Cliente Incompatível
          </h1>
          <p id="updater-lock-desc" className="updater-lock-desc" style={{ marginTop: '8px' }}>
            {serverName
              ? `O servidor "${serverName}" exige a versão v${requiredVersion} ou superior para conectar.`
              : `O servidor conectado exige a versão v${requiredVersion} ou superior para evitar quebra de compatibilidade.`}
          </p>
        </div>

        <div className="updater-body">
          <div className="updater-version-tag" style={{ justifyContent: 'center' }}>
            <span>Sua Versão: <strong style={{ color: 'var(--danger)' }}>v{currentVersion}</strong></span>
            <span aria-hidden="true">→</span>
            <span>Versão Mínima: <strong style={{ color: 'var(--online)' }}>v{requiredVersion}</strong></span>
          </div>

          {(isDownloading || isReadyToRelaunch) && (
            <div className="updater-progress-box">
              <div className="updater-progress-header">
                <span>
                  {isReadyToRelaunch
                    ? 'Download concluído com sucesso!'
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

        <footer style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {isDesktop ? (
            <>
              {!isDownloading && !isReadyToRelaunch && (
                <button
                  type="button"
                  className="updater-btn updater-btn--primary"
                  onClick={() => void onStartUpdate()}
                  style={{ width: '100%', padding: '12px' }}
                  autoFocus
                >
                  Baixar e Atualizar Agora
                </button>
              )}

              {isDownloading && (
                <button
                  type="button"
                  className="updater-btn updater-btn--primary"
                  disabled
                  style={{ width: '100%', padding: '12px' }}
                >
                  Instalando atualização ({percentage}%)...
                </button>
              )}

              {isReadyToRelaunch && (
                <button
                  type="button"
                  className="updater-btn updater-btn--primary"
                  onClick={() => void onRelaunch?.()}
                  style={{ width: '100%', padding: '12px' }}
                  autoFocus
                >
                  Reiniciar Aplicativo
                </button>
              )}

              {error && (
                <a
                  href="https://github.com/adeondev/Stapp/releases/latest"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="updater-btn updater-btn--secondary"
                  style={{ width: '100%', padding: '10px', textDecoration: 'none' }}
                >
                  Baixar Manualmente no GitHub
                </a>
              )}
            </>
          ) : (
            <button
              type="button"
              className="updater-btn updater-btn--primary"
              onClick={() => onWebReload ? onWebReload() : window.location.reload()}
              style={{ width: '100%', padding: '12px' }}
              autoFocus
            >
              Recarregar Página
            </button>
          )}
        </footer>
      </div>
    </div>
  )
}
