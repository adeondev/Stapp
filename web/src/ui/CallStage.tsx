import { useEffect, useMemo, useRef, useState } from 'react'
import type { PeerId, UserId } from '../protocol'
import type { VoiceMediaState, VoiceSnapshot, VoiceTransport } from '../voice/VoiceTransport'
import type { ScreenPreset } from '../voice/preferences'
import { CallTile } from './CallTile'
import { ScreenSharePicker } from './ScreenSharePicker'
import { MenuDivider, MenuItem, MenuLabel, PopupMenu, type MenuPosition } from './Menu'
import {
  IconCamera, IconCameraOff, IconChevronDown, IconChevronUp,
  IconHeadphones, IconHeadphonesOff, IconLeave, IconMic, IconMicOff,
  IconScreen, IconSettings, IconSignal,
} from './Icons'
import { useVoiceStore } from '../stores'
import { calculateCallGridLayout } from './callGridLayout'
import './callstage.css'

interface Props {
  channelName: string
  snapshot: VoiceSnapshot
  transport: VoiceTransport
  onLeave(): void
  onOpenSettings(): void
  resolveUserId?: (peerId: PeerId) => UserId | undefined
  selfUserId?: UserId | null
  variant?: 'embedded' | 'fullscreen'
}

export type Tile =
  | { id: string; kind: 'media'; media: VoiceMediaState; userId?: UserId }
  | { id: string; kind: 'avatar'; peerId: PeerId; userId?: UserId; name: string; local: boolean; speaking: boolean; muted: boolean }

export function CallStage({ channelName, snapshot, transport, onLeave, onOpenSettings, resolveUserId, selfUserId, variant = 'fullscreen' }: Props) {
  const root = useRef<HTMLDivElement>(null)
  const preferences = transport.getPreferences()
  const muted = useVoiceStore((s) => s.muted)
  const deafened = useVoiceStore((s) => s.deafened)
  const toggleMute = useVoiceStore((s) => s.toggleMute)
  const toggleDeafen = useVoiceStore((s) => s.toggleDeafen)

  useEffect(() => {
    transport.setMuted(muted || deafened)
    transport.setDeafened(deafened)
  }, [transport, muted, deafened])

  const [focused, setFocused] = useState<string | null>(null)
  const [sharePicker, setSharePicker] = useState(false)
  const [quickMenu, setQuickMenu] = useState<{ kind: 'audio' | 'camera' | 'call'; position: MenuPosition } | null>(null)
  const [pingMs, setPingMs] = useState<number | null>(null)

  const [devices, setDevices] = useState<{ inputs: MediaDeviceInfo[]; outputs: MediaDeviceInfo[]; cameras: MediaDeviceInfo[] }>({
    inputs: [], outputs: [], cameras: [],
  })

  useEffect(() => {
    let active = true
    const checkPing = async () => {
      try {
        const diag = await transport.diagnosticReport()
        if (active && diag.rttMs !== undefined) {
          setPingMs(Math.round(diag.rttMs))
        }
      } catch {}
    }
    void checkPing()
    const timer = setInterval(() => { void checkPing() }, 4000)
    return () => { active = false; clearInterval(timer) }
  }, [transport])

  useEffect(() => {
    void transport.enumerateDevices().then(setDevices).catch(() => {})
  }, [transport, quickMenu?.kind])

  const tiles = useMemo<Tile[]>(() => {
    const media = snapshot.media
      .filter((publication) => (preferences.showSelf || !publication.local)
        && (publication.kind !== 'camera' || !publication.muted))
      .map((publication) => ({
        id: `media:${publication.id}`,
        kind: 'media' as const,
        media: publication,
        userId: resolveUserId?.(publication.peerId) ?? (publication.local ? (selfUserId ?? undefined) : undefined),
      }))
    const peopleWithCamera = new Set(media
      .filter((tile) => tile.media.kind === 'camera')
      .map((tile) => tile.media.peerId))
    const peopleWithScreen = new Set(media
      .filter((tile) => tile.media.kind === 'screen')
      .map((tile) => tile.media.peerId))
    const avatars = snapshot.participants
          .filter((participant) => (preferences.showSelf || !participant.local)
            && !peopleWithCamera.has(participant.peerId)
            && (preferences.showVideoOffParticipants || participant.screen || peopleWithScreen.has(participant.peerId)))
          .map((participant) => ({
            id: `peer:${participant.peerId}`,
            kind: 'avatar' as const,
            peerId: participant.peerId,
            userId: resolveUserId?.(participant.peerId) ?? (participant.local ? (selfUserId ?? undefined) : undefined),
            name: participant.name,
            local: participant.local,
            speaking: participant.speaking,
            muted: !participant.microphone,
          }))
    return [...media, ...avatars]
  }, [preferences.showSelf, preferences.showVideoOffParticipants, snapshot.media, snapshot.participants, resolveUserId, selfUserId])

  const [isAppFullscreen, setIsAppFullscreen] = useState(false)
  const [fullscreenTileId, setFullscreenTileId] = useState<string | null>(null)
  const [isTrayCollapsed, setIsTrayCollapsed] = useState(false)

  const viewportRef = useRef<HTMLDivElement | null>(null)
  const [viewportBounds, setViewportBounds] = useState<{ width: number; height: number }>({
    width: typeof window !== 'undefined' ? window.innerWidth : 1280,
    height: typeof window !== 'undefined' ? window.innerHeight : 720,
  })

  useEffect(() => {
    const el = viewportRef.current
    if (!el) return

    const updateSize = () => {
      const rect = el.getBoundingClientRect()
      if (rect.width > 0 && rect.height > 0) {
        setViewportBounds({ width: rect.width, height: rect.height })
      }
    }

    updateSize()

    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const { width, height } = entry.contentRect
          if (width > 0 && height > 0) {
            setViewportBounds({ width, height })
          }
        }
      })
      observer.observe(el)
      return () => observer.disconnect()
    }

    window.addEventListener('resize', updateSize)
    return () => window.removeEventListener('resize', updateSize)
  }, [])

  const [isMouseIdle, setIsMouseIdle] = useState(false)
  const mouseIdleTimerRef = useRef<number | null>(null)

  const handleMouseMove = () => {
    setIsMouseIdle(false)
    if (mouseIdleTimerRef.current !== null) {
      window.clearTimeout(mouseIdleTimerRef.current)
    }
    mouseIdleTimerRef.current = window.setTimeout(() => {
      setIsMouseIdle(true)
    }, 2500)
  }

  useEffect(() => {
    const onPointerMove = () => {
      handleMouseMove()
    }
    window.addEventListener('pointermove', onPointerMove, { passive: true })
    window.addEventListener('mousemove', onPointerMove, { passive: true })
    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('mousemove', onPointerMove)
      if (mouseIdleTimerRef.current !== null) {
        window.clearTimeout(mouseIdleTimerRef.current)
      }
    }
  }, [])

  const toggleFullscreen = async (targetTileId?: string, targetElement?: HTMLElement | null) => {
    if (targetTileId) {
      setFocused(targetTileId)
    }

    const doc = document as Document & {
      webkitFullscreenElement?: Element | null
      mozFullScreenElement?: Element | null
      msFullscreenElement?: Element | null
      exitFullscreen?: () => Promise<void>
      webkitExitFullscreen?: () => Promise<void>
      mozCancelFullScreen?: () => Promise<void>
      msExitFullscreen?: () => Promise<void>
    }
    const isCurrentlyFs = Boolean(
      doc.fullscreenElement || doc.webkitFullscreenElement || doc.mozFullScreenElement || doc.msFullscreenElement,
    ) || isAppFullscreen

    if (!isCurrentlyFs) {
      setIsAppFullscreen(true)
      let elToFullscreen: HTMLElement | null = targetElement ?? null
      if (!elToFullscreen && targetTileId) {
        elToFullscreen = root.current?.querySelector<HTMLElement>(`[data-tile-id="${targetTileId}"]`) ?? null
      }
      if (!elToFullscreen && focused) {
        elToFullscreen = root.current?.querySelector<HTMLElement>(`[data-tile-id="${focused}"]`) ?? null
      }
      if (!elToFullscreen) {
        elToFullscreen = root.current?.querySelector<HTMLElement>('.calltile.is-primary')
          ?? root.current?.querySelector<HTMLElement>('.calltile--screen')
          ?? root.current?.querySelector<HTMLElement>('.calltile')
          ?? root.current
      }

      setFullscreenTileId(targetTileId ?? elToFullscreen?.getAttribute('data-tile-id') ?? focused ?? null)

      try {
        const el = elToFullscreen as (HTMLElement & {
          webkitRequestFullscreen?: () => Promise<void>
          mozRequestFullScreen?: () => Promise<void>
          msRequestFullscreen?: () => Promise<void>
        }) | null

        if (el?.requestFullscreen) {
          await el.requestFullscreen()
        } else if (el?.webkitRequestFullscreen) {
          await el.webkitRequestFullscreen()
        } else if (el?.mozRequestFullScreen) {
          await el.mozRequestFullScreen()
        } else if (el?.msRequestFullscreen) {
          await el.msRequestFullscreen()
        }
      } catch {}
    } else {
      setIsAppFullscreen(false)
      setFullscreenTileId(null)
      try {
        if (doc.fullscreenElement || doc.webkitFullscreenElement || doc.mozFullScreenElement || doc.msFullscreenElement) {
          if (doc.exitFullscreen) {
            await doc.exitFullscreen()
          } else if (doc.webkitExitFullscreen) {
            await doc.webkitExitFullscreen()
          } else if (doc.mozCancelFullScreen) {
            await doc.mozCancelFullScreen()
          } else if (doc.msExitFullscreen) {
            await doc.msExitFullscreen()
          }
        }
      } catch {}
    }
  }

  useEffect(() => {
    const onFsChange = () => {
      const doc = document as Document & {
        webkitFullscreenElement?: Element | null
        mozFullScreenElement?: Element | null
        msFullscreenElement?: Element | null
      }
      const isFs = Boolean(
        doc.fullscreenElement || doc.webkitFullscreenElement || doc.mozFullScreenElement || doc.msFullscreenElement,
      )
      setIsAppFullscreen(isFs)
      if (!isFs) {
        setFullscreenTileId(null)
      }
    }
    document.addEventListener('fullscreenchange', onFsChange)
    document.addEventListener('webkitfullscreenchange', onFsChange)
    return () => {
      document.removeEventListener('fullscreenchange', onFsChange)
      document.removeEventListener('webkitfullscreenchange', onFsChange)
    }
  }, [])

  useEffect(() => {
    return () => {
      const doc = document as Document & {
        webkitFullscreenElement?: Element | null
        exitFullscreen?: () => Promise<void>
        webkitExitFullscreen?: () => Promise<void>
      }
      if (doc.fullscreenElement || doc.webkitFullscreenElement) {
        doc.exitFullscreen?.().catch?.(() => {})
      }
    }
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        const doc = document as Document & {
          webkitFullscreenElement?: Element | null
          exitFullscreen?: () => Promise<void>
          webkitExitFullscreen?: () => Promise<void>
        }
        if (doc.fullscreenElement || doc.webkitFullscreenElement) {
          void (doc.exitFullscreen?.() || doc.webkitExitFullscreen?.())?.catch?.(() => {})
          setIsAppFullscreen(false)
          setFullscreenTileId(null)
          event.stopPropagation()
          return
        }
        if (isAppFullscreen) {
          setIsAppFullscreen(false)
          setFullscreenTileId(null)
          event.stopPropagation()
          return
        }
        if (isTrayCollapsed) {
          setIsTrayCollapsed(false)
          event.stopPropagation()
          return
        }
        if (focused) {
          setFocused(null)
          event.stopPropagation()
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [focused, isAppFullscreen, isTrayCollapsed])

  const ordered = focused
    ? [...tiles.filter((tile) => tile.id === focused), ...tiles.filter((tile) => tile.id !== focused)]
    : tiles

  const gridLayout = useMemo(() => {
    return calculateCallGridLayout(
      ordered.length,
      viewportBounds.width,
      viewportBounds.height,
      16 / 9,
      12,
    )
  }, [ordered.length, viewportBounds.width, viewportBounds.height])

  const startShare = (sourceId: string | undefined, preset: ScreenPreset, includeAudio: boolean) =>
    transport.setScreenShareEnabled(true, { preset, sourceId, includeAudio })

  const isPartyOnly = ordered.length > 0 && ordered.every((t) => t.kind === 'avatar')
  const isSecure = typeof window === 'undefined' || (window.isSecureContext && Boolean(navigator.mediaDevices?.getUserMedia))

  return (
    <div className={`callstage ${variant === 'embedded' ? 'callstage--embedded' : 'callstage--fullscreen'} ${isAppFullscreen ? 'callstage--app-fullscreen' : ''} ${focused ? 'callstage--focus' : ''} ${isPartyOnly ? 'callstage--party-mode' : ''} ${isTrayCollapsed ? 'callstage--tray-collapsed' : ''} ${isMouseIdle ? 'is-mouse-idle' : ''}`} ref={root}
      onPointerDownCapture={() => { void transport.resumeAudio() }}
      onPointerMove={handleMouseMove}
      onMouseMove={handleMouseMove}
      role="region" aria-label={`Chamada em ${channelName}`}>
      <header className="callstage__header">
        <div className="callstage__channel-info">
          <div className="callstage__status-badge">
            <IconSignal size={16} className="callstage__signal-icon" />
            <span className="callstage__eyebrow">{statusLabel(snapshot.status)}</span>
          </div>
          {pingMs !== null && (
            <div className={`callstage__ping-badge ${pingMs < 70 ? 'is-good' : pingMs < 160 ? 'is-fair' : 'is-poor'}`} title={`Latência de áudio/vídeo: ${pingMs}ms`}>
              <span className="callstage__ping-dot" />
              <span>{pingMs}ms</span>
            </div>
          )}
          <h1>{channelName}</h1>
        </div>
      </header>

      {(!isSecure || snapshot.error) && (
        <div className="callstage__banner" role="alert">
          <IconMicOff size={16} />
          <span>
            {snapshot.error || 'Navegador em conexão HTTP remota: o microfone e a câmera estão bloqueados. Conecte via HTTPS ou use o aplicativo Desktop.'}
          </span>
        </div>
      )}

      <div className="callstage__body">
        <div ref={viewportRef} className="callstage__viewport">
          {ordered.length === 0 ? (
            <div className="callstage__empty">
              <strong>Conectando ao palco…</strong>
              <span>As pessoas e transmissões aparecem aqui.</span>
            </div>
          ) : isPartyOnly ? (
            /* Co-op Party: avatares limpos e alinhados no centro como no Discord / Party de RPG */
            <div className="callstage__party">
              <div className="callstage__party-line">
                {ordered.map((tile) => (
                  <CallTile key={tile.id} tile={tile} primary={false}
                    focused={false} transport={transport}
                    isFullscreen={isAppFullscreen && (fullscreenTileId === tile.id || (!fullscreenTileId && false))}
                    isMouseIdle={isMouseIdle}
                    onToggleFullscreen={(el) => toggleFullscreen(tile.id, el)}
                    onLeave={onLeave}
                    onFocus={() => {}} />
                ))}
              </div>
            </div>
          ) : focused ? (
            <div className={`callstage__focus-layout ${ordered.length === 1 ? 'is-solo' : ''} ${isTrayCollapsed ? 'is-tray-collapsed' : ''}`}>
              <CallTile tile={ordered[0]} primary focused transport={transport}
                isFullscreen={isAppFullscreen && (fullscreenTileId === ordered[0].id || !fullscreenTileId)}
                isMouseIdle={isMouseIdle}
                onToggleFullscreen={(el) => toggleFullscreen(ordered[0].id, el)}
                onLeave={onLeave}
                onFocus={() => setFocused(null)} />
              {ordered.length > 1 && !isTrayCollapsed && (
                <div className="callstage__focus-tray-wrap">
                  <div className="callstage__focus-tray" aria-label="outros participantes">
                    {ordered.slice(1).map((tile) => (
                      <CallTile key={tile.id} tile={tile} primary={false} focused={false} transport={transport}
                        isFullscreen={isAppFullscreen && fullscreenTileId === tile.id}
                        isMouseIdle={isMouseIdle}
                        onToggleFullscreen={(el) => toggleFullscreen(tile.id, el)}
                        onLeave={onLeave}
                        onFocus={() => setFocused(tile.id)} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div
              className={`callstage__layout ${ordered.length === 1 ? 'callstage__layout--count-1' : ''}`}
              style={{
                '--callstage-columns': gridLayout.columns,
                '--callstage-rows': gridLayout.rows,
              } as React.CSSProperties}
            >
              {ordered.map((tile) => (
                <CallTile key={tile.id} tile={tile} primary={false}
                  focused={false} transport={transport}
                  isFullscreen={isAppFullscreen && (fullscreenTileId === tile.id || (!fullscreenTileId && ordered.length === 1))}
                  isMouseIdle={isMouseIdle}
                  onToggleFullscreen={(el) => toggleFullscreen(tile.id, el)}
                  onLeave={onLeave}
                  onFocus={() => setFocused(tile.id)} />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Botão de alternar barra inferior (chevron para baixo/cima) para deixar tela REALMENTE cheia */}
      {focused && (
        <div className="callstage__tray-toggle-bar">
          <button
            className="callstage__tray-toggle-btn"
            onClick={() => setIsTrayCollapsed((prev) => !prev)}
            title={isTrayCollapsed ? 'Mostrar participantes e barra (v)' : 'Ocultar barra e deixar tela realmente cheia (v)'}
            aria-label={isTrayCollapsed ? 'mostrar barra de participantes' : 'ocultar barra de participantes'}
          >
            {isTrayCollapsed ? <IconChevronUp size={16} /> : <IconChevronDown size={16} />}
          </button>
        </div>
      )}

      <div className={`callstage__dock-wrap ${isTrayCollapsed ? 'is-collapsed' : ''}`}>
        {quickMenu && <PopupMenu position={quickMenu.position}
          label={quickMenu.kind === 'audio' ? 'Dispositivos de áudio'
            : quickMenu.kind === 'camera' ? 'Câmera e qualidade' : 'Opções da chamada'}
          onClose={() => setQuickMenu(null)}>
          {quickMenu.kind === 'call' ? <>
            <MenuLabel>Chamada</MenuLabel>
            <MenuItem icon={<IconScreen />} onClick={() => {
              void transport.setScreenShareEnabled(false); setQuickMenu(null)
            }}>Parar compartilhamento</MenuItem>
            <MenuDivider />
            <MenuItem icon={<IconLeave />} danger onClick={() => { setQuickMenu(null); onLeave() }}>
              Sair da chamada
            </MenuItem>
          </> : quickMenu.kind === 'audio' ? <>
            <MenuLabel>Microfone</MenuLabel>
            {devices.inputs.map((device, index) => <MenuItem key={device.deviceId}
              icon={<IconMic />} checked={preferences.inputDeviceId === device.deviceId} onClick={() => {
                void transport.setInputDevice(device.deviceId); setQuickMenu(null)
              }}>{device.label || `Microfone ${index + 1}`}</MenuItem>)}
            {devices.inputs.length === 0 && <MenuLabel>Nenhum microfone detectado</MenuLabel>}
            <MenuDivider />
            <MenuLabel>Saída</MenuLabel>
            {devices.outputs.map((device, index) => <MenuItem key={device.deviceId}
              icon={<IconHeadphones />} checked={preferences.outputDeviceId === device.deviceId} onClick={() => {
                void transport.setOutputDevice(device.deviceId); setQuickMenu(null)
              }}>{device.label || `Alto-falante ${index + 1}`}</MenuItem>)}
            {devices.outputs.length === 0 && <MenuLabel>Padrão do sistema operacional</MenuLabel>}
          </> : <>
            <MenuLabel>Câmera</MenuLabel>
            {devices.cameras.map((device, index) => <MenuItem key={device.deviceId}
              icon={<IconCamera />} checked={preferences.cameraDeviceId === device.deviceId} onClick={() => {
                void transport.setCameraDevice(device.deviceId); setQuickMenu(null)
              }}>{device.label || `Câmera ${index + 1}`}</MenuItem>)}
            <MenuDivider />
            <MenuLabel>Qualidade</MenuLabel>
            <MenuItem icon={<IconCamera />} checked={preferences.cameraQuality === '720p'} onClick={() => {
              void transport.updatePreferences({ cameraQuality: '720p' }); setQuickMenu(null)
            }}>720p · 30 FPS</MenuItem>
            <MenuItem icon={<IconCamera />} checked={preferences.cameraQuality === '1080p'} onClick={() => {
              void transport.updatePreferences({ cameraQuality: '1080p' }); setQuickMenu(null)
            }}>1080p · 30 FPS</MenuItem>
          </>}
        </PopupMenu>}

        <div className="callstage__dock" aria-label="controles da chamada">
          {/* Microfone */}
          <div className="callstage__dock-combo">
            <DockButton
              tone={muted || deafened ? 'problem' : 'neutral'}
              pressed={!muted && !deafened}
              label={muted || deafened ? 'ligar microfone' : 'desligar microfone'}
              onClick={toggleMute}
              icon={muted || deafened
                ? <IconMicOff size={20} filled />
                : <IconMic size={20} />}
            />
            <button
              className="callstage__dock-chevron"
              onClick={(event) => {
                const rect = event.currentTarget.getBoundingClientRect()
                setQuickMenu((current) => current?.kind === 'audio' ? null
                  : { kind: 'audio', position: { x: rect.left - 110, y: rect.top - 330 } })
                setSharePicker(false)
              }}
              title="Dispositivos de áudio"
              aria-label="opções do microfone"
            >
              <IconChevronDown size={16} />
            </button>
          </div>

          {/* Ensurdecer */}
          <DockButton
            tone={deafened ? 'problem' : 'neutral'}
            pressed={!deafened}
            label={deafened ? 'voltar a ouvir' : 'ensurdecer'}
            onClick={toggleDeafen}
            icon={deafened
              ? <IconHeadphonesOff size={20} filled />
              : <IconHeadphones size={20} />}
          />

          {/* Câmera */}
          <div className="callstage__dock-combo">
            <DockButton
              tone={snapshot.cameraEnabled ? 'capturing' : 'neutral'}
              pressed={snapshot.cameraEnabled}
              label={snapshot.cameraEnabled ? 'desligar camera' : 'ligar camera'}
              onClick={() => void transport.setCameraEnabled(!snapshot.cameraEnabled)}
              icon={snapshot.cameraEnabled
                ? <IconCamera size={20} filled />
                : <IconCameraOff size={20} />}
            />
            <button
              className="callstage__dock-chevron"
              onClick={(event) => {
                const rect = event.currentTarget.getBoundingClientRect()
                setQuickMenu((current) => current?.kind === 'camera' ? null
                  : { kind: 'camera', position: { x: rect.left - 110, y: rect.top - 280 } })
                setSharePicker(false)
              }}
              title="opções da câmera"
              aria-label="opções da câmera"
            >
              <IconChevronDown size={16} />
            </button>
          </div>

          {/* Compartilhamento de Tela */}
          <div className="callstage__dock-combo">
            <DockButton
              tone={snapshot.screenSharing ? 'active' : 'neutral'}
              pressed={snapshot.screenSharing}
              label={snapshot.screenSharing ? 'trocar fonte compartilhada' : 'compartilhar tela'}
              onClick={() => setSharePicker(true)}
              icon={<IconScreen size={20} filled={snapshot.screenSharing} />}
            />
            <button
              className="callstage__dock-chevron"
              onClick={() => { setSharePicker(true); setQuickMenu(null) }}
              title="opções do compartilhamento"
              aria-label="opções do compartilhamento"
            >
              <IconChevronDown size={16} />
            </button>
          </div>

          {/* Configurações */}
          <DockButton
            tone="neutral"
            label="voz e vídeo"
            onClick={onOpenSettings}
            icon={<IconSettings size={20} />}
          />

          {/* Acao principal.
              Sem compartilhamento ela e "desconectar". Com compartilhamento no ar
              ela vira "parar compartilhamento", que e o que quase sempre se quer
              nesse momento — e sair continua a um clique, pela seta ao lado.
              Quem manda e `snapshot.screenSharing`, o estado REAL do transporte:
              se o proprio sistema operacional encerrar a captura, ou a pessoa
              cancelar o seletor, o botao volta a ser "desconectar" sozinho. */}
          {snapshot.screenSharing ? (
            <div className="callstage__dock-combo callstage__dock-combo--primary">
              <DockButton
                tone="capturing"
                label="parar compartilhamento"
                onClick={() => void transport.setScreenShareEnabled(false)}
                icon={<IconScreen size={20} filled />}
              />
              <button
                className="callstage__dock-chevron"
                onClick={(event) => {
                  const rect = event.currentTarget.getBoundingClientRect()
                  setQuickMenu((current) => current?.kind === 'call' ? null
                    : { kind: 'call', position: { x: rect.left - 180, y: rect.top - 96 } })
                  setSharePicker(false)
                }}
                title="mais opções da chamada"
                aria-label="mais opções da chamada"
              >
                <IconChevronUp size={16} />
              </button>
            </div>
          ) : (
            <DockButton
              tone="danger"
              label="desconectar"
              onClick={onLeave}
              icon={<IconLeave size={20} />}
            />
          )}
        </div>
      </div>

      {sharePicker && (
        <ScreenSharePicker transport={transport} initialPreset={preferences.screenPreset}
          onClose={() => setSharePicker(false)} onShare={startShare} />
      )}
    </div>
  )
}


/**
 * O tom do botao do dock. Antes existia so o par `active`/`off`, e `off` servia
 * a dois significados incompativeis:
 *
 * - microfone mudo / fone desligado = **problema**, e vermelho faz sentido;
 * - camera e tela desligadas = **ociosas**, e vermelho ali dizia "erro".
 *
 * Era por isso que a camera desligada parecia estar com defeito, e o
 * compartilhamento parado parecia mais alarmante que o compartilhamento no ar —
 * ainda mais porque o icone de tela era o mesmo nos dois estados.
 *
 * Agora sao cinco tons, e o vermelho quer dizer uma coisa so: "existe algo
 * acontecendo aqui, e clicar interrompe".
 */
type DockTone =
  /** ocioso, sem opiniao */
  | 'neutral'
  /** ligado/selecionado, mas clicar nao interrompe nada */
  | 'active'
  /** algo esta errado agora: mudo, ensurdecido */
  | 'problem'
  /** capturando agora; clicar para */
  | 'capturing'
  /** encerrar a chamada */
  | 'danger'

function DockButton({ tone, label, onClick, icon, pressed }: {
  tone: DockTone
  label: string
  onClick(): void
  icon: React.ReactNode
  pressed?: boolean
}) {
  return <button className={`callstage__dock-button is-${tone}`}
    onClick={onClick} title={label} aria-label={label} aria-pressed={pressed}>{icon}</button>
}

function statusLabel(status: VoiceSnapshot['status']) {
  return ({ idle: 'Desconectado', requesting: 'Conectando…', connecting: 'Conectando áudio…',
    connected: 'Voz Conectada', reconnecting: 'Reconectando…' })[status]
}
