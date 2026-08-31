let windowPromise: Promise<ReturnType<typeof import('@tauri-apps/api/window')['getCurrentWindow']>> | null = null

export function currentDesktopWindow() {
  windowPromise ??= import('@tauri-apps/api/window').then(({ getCurrentWindow }) => getCurrentWindow())
  return windowPromise
}
