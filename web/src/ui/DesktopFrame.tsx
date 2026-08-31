import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { IconStappLogo } from './Icons'
import { currentDesktopWindow } from './desktopWindow'
import './desktopframe.css'

function isDesktopRuntime() {
  return '__TAURI_INTERNALS__' in window
}

export function DesktopFrame({ children }: { children: ReactNode }) {
  const desktop = isDesktopRuntime()
  const appWindowRef = useRef<Awaited<ReturnType<typeof currentDesktopWindow>> | null>(null)
  const [maximized, setMaximized] = useState(false)
  const [focused, setFocused] = useState(true)

  useEffect(() => {
    if (!desktop) return
    let disposed = false
    const unlisten: Array<() => void> = []

    void currentDesktopWindow().then(async (appWindow) => {
      appWindowRef.current = appWindow
      const [isMaximized, isFocused] = await Promise.all([
        appWindow.isMaximized(), appWindow.isFocused(),
      ])
      if (disposed) return
      setMaximized(isMaximized)
      setFocused(isFocused)
      unlisten.push(await appWindow.onResized(async () => {
        const value = await appWindow.isMaximized()
        if (!disposed) setMaximized(value)
      }))
      unlisten.push(await appWindow.onFocusChanged(({ payload }) => {
        if (!disposed) setFocused(payload)
      }))
    })

    return () => {
      disposed = true
      appWindowRef.current = null
      for (const stop of unlisten) stop()
    }
  }, [desktop])

  const windowAction = (action: 'minimize' | 'maximize' | 'close') => {
    const perform = (appWindow: Awaited<ReturnType<typeof currentDesktopWindow>>) => {
      if (action === 'minimize') return appWindow.minimize()
      if (action === 'maximize') return appWindow.toggleMaximize()
      return appWindow.close()
    }
    if (appWindowRef.current) void perform(appWindowRef.current)
    else void currentDesktopWindow().then((appWindow) => {
      appWindowRef.current = appWindow
      return perform(appWindow)
    })
  }

  const startDragging = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0 || event.detail > 1) return
    if (event.target instanceof Element && event.target.closest('button')) return
    event.preventDefault()
    if (appWindowRef.current) void appWindowRef.current.startDragging()
    else void currentDesktopWindow().then((appWindow) => {
      appWindowRef.current = appWindow
      return appWindow.startDragging()
    })
  }

  return (
    <div className={`desktop-frame ${desktop ? 'desktop-frame--native' : ''}`}>
      {desktop && (
        <header
          className={`desktop-titlebar ${focused ? '' : 'is-unfocused'}`}
          onPointerDown={startDragging}
          onDoubleClick={() => windowAction('maximize')}
        >
          <div className="desktop-titlebar__brand">
            <IconStappLogo size={14} />
            <span>Stapp</span>
          </div>
          <div className="desktop-titlebar__drag" aria-hidden="true" />
          <div className="desktop-titlebar__controls">
            <button type="button" aria-label="Minimizar" title="Minimizar"
              onDoubleClick={(event) => event.stopPropagation()}
              onClick={() => windowAction('minimize')}>
              <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2 6.5h8" /></svg>
            </button>
            <button type="button" aria-label={maximized ? 'Restaurar' : 'Maximizar'}
              title={maximized ? 'Restaurar' : 'Maximizar'}
              onDoubleClick={(event) => event.stopPropagation()}
              onClick={() => windowAction('maximize')}>
              {maximized ? (
                <svg viewBox="0 0 12 12" aria-hidden="true">
                  <path d="M3.5 4.5h5v5h-5zM5 4.5V3h4v4H8.5" />
                </svg>
              ) : (
                <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 2.5h7v7h-7z" /></svg>
              )}
            </button>
            <button type="button" className="desktop-titlebar__close" aria-label="Fechar" title="Fechar"
              onDoubleClick={(event) => event.stopPropagation()}
              onClick={() => windowAction('close')}>
              <svg viewBox="0 0 12 12" aria-hidden="true"><path d="m3 3 6 6m0-6L3 9" /></svg>
            </button>
          </div>
        </header>
      )}
      <div className="desktop-frame__content">{children}</div>
    </div>
  )
}
