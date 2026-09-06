import type { ReactNode } from 'react'
import { IconStappLogo } from '../Icons'
import { UpdateModal } from './UpdateModal'
import type { AvailableUpdate, UpdateDownloadProgress } from '../../platform/updater/types'
import './splash.css'

export interface SplashScreenProps {
  isModalOpen?: boolean
  update?: AvailableUpdate | null
  isDownloading?: boolean
  progress?: UpdateDownloadProgress | null
  isReadyToRelaunch?: boolean
  error?: string | null
  onClose?: () => void
  onStartUpdate?: () => void | Promise<void>
  onRelaunch?: () => void | Promise<void>
  children?: ReactNode
}

export function SplashScreen({
  isModalOpen = false,
  update = null,
  isDownloading = false,
  progress = null,
  isReadyToRelaunch = false,
  error = null,
  onClose = () => {},
  onStartUpdate = () => {},
  onRelaunch = () => {},
  children,
}: SplashScreenProps) {
  const showModal = isModalOpen && Boolean(update)

  return (
    <div className="splash-screen" role="status" aria-live="polite">
      <div className="splash-screen__content">
        <div className="splash-screen__brand">
          <IconStappLogo size={64} className="splash-screen__logo" />
          <h1 className="splash-screen__title">Stapp</h1>
        </div>
        <div className="splash-screen__status-box">
          <svg
            className="splash-screen__spinner"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="9" stroke="var(--accent-quiet)" strokeWidth="2.5" />
            <path
              d="M12 3a9 9 0 0 1 9 9"
              stroke="var(--accent)"
              strokeWidth="2.5"
              strokeLinecap="round"
            />
          </svg>
          <span className="splash-screen__text">Procurando atualizações...</span>
        </div>
      </div>

      {children}

      {showModal && (
        <UpdateModal
          isOpen={isModalOpen}
          update={update}
          isDownloading={isDownloading}
          progress={progress}
          isReadyToRelaunch={isReadyToRelaunch}
          error={error}
          onClose={onClose}
          onStartUpdate={onStartUpdate}
          onRelaunch={onRelaunch}
        />
      )}
    </div>
  )
}
