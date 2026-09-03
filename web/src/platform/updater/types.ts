export type UpdateChannel = 'stable' | 'beta'

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
  isPrerelease?: boolean
  rawUpdate?: unknown
}

export interface UpdaterService {
  readonly isDesktop: boolean
  getChannel(): UpdateChannel
  setChannel(channel: UpdateChannel): void
  getCurrentVersion(): Promise<string>
  checkForUpdate(channel?: UpdateChannel): Promise<AvailableUpdate | null>
  downloadAndInstall(
    update: AvailableUpdate,
    onProgress?: (progress: UpdateDownloadProgress) => void,
  ): Promise<void>
  relaunch(): Promise<void>
}
