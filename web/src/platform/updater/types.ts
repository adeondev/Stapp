export type UpdateState =
  | 'idle'
  | 'checking'
  | 'available'
  | 'up-to-date'
  | 'downloading'
  | 'downloaded'
  | 'installing'
  | 'error'

export interface UpdateDownloadProgress {
  chunkLength: number
  downloadedBytes: number
  totalBytes: number | null
  percentage: number
}

export interface AvailableUpdate {
  version: string
  currentVersion: string
  date?: string
  body?: string
  rawUpdate?: unknown
}

export interface UpdaterService {
  readonly isDesktop: boolean
  getCurrentVersion(): Promise<string>
  checkForUpdate(): Promise<AvailableUpdate | null>
  downloadAndInstall(
    update: AvailableUpdate,
    onProgress?: (progress: UpdateDownloadProgress) => void,
  ): Promise<void>
  relaunch(): Promise<void>
}
