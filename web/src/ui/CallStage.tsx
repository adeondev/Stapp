import { useEffect, useMemo, useRef, useState } from 'react'
import type { PeerId, UserId } from '../protocol'
import type { VoiceMediaState, VoiceSnapshot, VoiceTransport } from '../voice/VoiceTransport'
import type { ScreenPreset } from '../voice/preferences'
import { Avatar } from './Avatar'
import { ScreenSharePicker } from './ScreenSharePicker'
import { useUserMenu, type UserMenuRequest } from './UserMenu'
import { MenuDivider, MenuItem, MenuLabel, PopupMenu, type MenuPosition } from './Menu'
import {
  IconCamera, IconCameraOff, IconChevronDown, IconChevronUp,
  IconFullscreen, IconHeadphones, IconHeadphonesOff, IconLeave, IconMic, IconMicOff,
  IconMinimize, IconMore, IconScreen, IconSettings, IconSignal,
} from './Icons'
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

type Tile =
  | { id: string; kind: 'media'; media: VoiceMediaState; userId?: UserId }
  | { id: string; kind: 'avatar'; peerId: PeerId; userId?: UserId; name: string; local: boolean; speaking: boolean; muted: boolean }

export function CallStage({ channelName, snapshot, transport, onLeave, onOpenSettings, resolveUserId, selfUserId, variant = 'fullscreen' }: Props) {
  const root = useRef<HTMLDivElement>(null)
  const preferences = transport.getPreferences()
  const [focused, setFocused] = useState<string | null>(null)
  const [sharePicker, setSharePicker] = useState(false)
  const [quickMenu, setQuickMenu] = useState<{ kind: 'audio' | 'camera'; position: MenuPosition } | null>(null)
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
  const [isTrayCollapsed, setIsTrayCollapsed] = useState(false)

  const toggleFullscreen = async (targetTileId?: string) => {
    if (targetTileId) {
      setFocused(targetTileId)
    }

    if ('__TAURI_INTERNALS__' in window) {
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window')
        const win = getCurrentWindow()
        const isFs = await win.isFullscreen()
        await win.setFullscreen(!isFs)
        setIsAppFullscreen(!isFs)
        return
      } catch {}
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
      try {
        const docEl = document.documentElement as HTMLElement & {
          webkitRequestFullscreen?: () => Promise<void>
          mozRequestFullScreen?: () => Promise<void>
          msRequestFullscreen?: () => Promise<void>
        }
        if (docEl.requestFullscreen) {
          await docEl.requestFullscreen()
        } else if (docEl.webkitRequestFullscreen) {
          await docEl.webkitRequestFullscreen()
        } else if (docEl.mozRequestFullScreen) {
          await docEl.mozRequestFullScreen()
        } else if (docEl.msRequestFullscreen) {
          await docEl.msRequestFullscreen()
        }
      } catch {}
    } else {
      setIsAppFullscreen(false)
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
          event.stopPropagation()
          return
        }
        if (isAppFullscreen) {
          setIsAppFullscreen(false)
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

  const startShare = (sourceId: string | undefined, preset: ScreenPreset, includeAudio: boolean) =>
    transport.setScreenShareEnabled(true, { preset, sourceId, includeAudio })

  const isPartyOnly = ordered.length > 0 && ordered.every((t) => t.kind === 'avatar')
  const isSecure = typeof window === 'undefined' || (window.isSecureContext && Boolean(navigator.mediaDevices?.getUserMedia))

  return (
    <div className={`callstage ${variant === 'embedded' ? 'callstage--embedded' : 'callstage--fullscreen'} ${isAppFullscreen ? 'callstage--app-fullscreen' : ''} ${focused ? 'callstage--focus' : ''} ${isPartyOnly ? 'callstage--party-mode' : ''} ${isTrayCollapsed ? 'callstage--tray-collapsed' : ''}`} ref={root}
      onPointerDownCapture={() => { void transport.resumeAudio() }}
      role="region" aria-label={`Chamada em ${channelName}`}>
      <header className="callstage__header">
        <div className="callstage__channel-info">
          <div className="callstage__status-badge">
            <IconSignal size={13} className="callstage__signal-icon" />
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
        <div className="callstage__viewport">
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
                    isFullscreen={isAppFullscreen}
                    onToggleFullscreen={() => toggleFullscreen(tile.id)}
                    onFocus={() => {}} />
                ))}
              </div>
            </div>
          ) : focused ? (
            <div className={`callstage__focus-layout ${ordered.length === 1 ? 'is-solo' : ''} ${isTrayCollapsed ? 'is-tray-collapsed' : ''}`}>
              <CallTile tile={ordered[0]} primary focused transport={transport}
                isFullscreen={isAppFullscreen}
                onToggleFullscreen={() => toggleFullscreen(ordered[0].id)}
                onFocus={() => setFocused(null)} />
              {ordered.length > 1 && !isTrayCollapsed && (
                <div className="callstage__focus-tray-wrap">
                  <div className="callstage__focus-tray" aria-label="outros participantes">
                    {ordered.slice(1).map((tile) => (
                      <CallTile key={tile.id} tile={tile} primary={false} focused={false} transport={transport}
                        isFullscreen={isAppFullscreen}
                        onToggleFullscreen={() => toggleFullscreen(tile.id)}
                        onFocus={() => setFocused(tile.id)} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className={`callstage__layout callstage__layout--count-${Math.min(ordered.length, 12)}`}>
              {ordered.map((tile) => (
                <CallTile key={tile.id} tile={tile} primary={false}
                  focused={false} transport={transport}
                  isFullscreen={isAppFullscreen}
                  onToggleFullscreen={() => toggleFullscreen(tile.id)}
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
          label={quickMenu.kind === 'audio' ? 'Dispositivos de áudio' : 'Câmera e qualidade'}
          onClose={() => setQuickMenu(null)}>
          {quickMenu.kind === 'audio' ? <>
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
              active={!snapshot.muted && !snapshot.deafened}
              off={snapshot.muted || snapshot.deafened}
              label={snapshot.muted ? 'ligar microfone' : 'desligar microfone'}
              onClick={() => transport.setMuted(!snapshot.muted)}
              icon={snapshot.muted || snapshot.deafened ? <IconMicOff size={20} /> : <IconMic size={20} />}
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
              <IconChevronDown size={12} />
            </button>
          </div>

          {/* Ensurdecer */}
          <DockButton
            active={!snapshot.deafened}
            off={snapshot.deafened}
            label={snapshot.deafened ? 'voltar a ouvir' : 'ensurdecer'}
            onClick={() => transport.setDeafened(!snapshot.deafened)}
            icon={snapshot.deafened ? <IconHeadphonesOff size={20} /> : <IconHeadphones size={20} />}
          />

          {/* Câmera */}
          <div className="callstage__dock-combo">
            <DockButton
              active={snapshot.cameraEnabled}
              off={!snapshot.cameraEnabled}
              label={snapshot.cameraEnabled ? 'desligar camera' : 'ligar camera'}
              onClick={() => void transport.setCameraEnabled(!snapshot.cameraEnabled)}
              icon={snapshot.cameraEnabled ? <IconCamera size={20} /> : <IconCameraOff size={20} />}
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
              <IconChevronDown size={12} />
            </button>
          </div>

          {/* Compartilhamento de Tela */}
          <div className="callstage__dock-combo">
            <DockButton
              active={snapshot.screenSharing}
              off={!snapshot.screenSharing}
              label={snapshot.screenSharing ? 'parar compartilhamento' : 'compartilhar tela'}
              onClick={() => snapshot.screenSharing
                ? void transport.setScreenShareEnabled(false)
                : setSharePicker(true)}
              icon={<IconScreen size={20} />}
            />
            <button
              className="callstage__dock-chevron"
              onClick={() => { setSharePicker(true); setQuickMenu(null) }}
              title="opções do compartilhamento"
              aria-label="opções do compartilhamento"
            >
              <IconChevronDown size={12} />
            </button>
          </div>

          {/* Configurações */}
          <DockButton
            active={false}
            off={false}
            label="voz e vídeo"
            onClick={onOpenSettings}
            icon={<IconSettings size={20} />}
          />

          {/* Desconectar */}
          <DockButton
            active={false}
            off
            danger
            label="desconectar"
            onClick={onLeave}
            icon={<IconLeave size={20} />}
          />
        </div>
      </div>

      {sharePicker && (
        <ScreenSharePicker transport={transport} initialPreset={preferences.screenPreset}
          onClose={() => setSharePicker(false)} onShare={startShare} />
      )}
    </div>
  )
}

function CallTile({ tile, primary, focused, transport, onFocus, isFullscreen, onToggleFullscreen }: {
  tile: Tile; primary: boolean; focused: boolean; transport: VoiceTransport; onFocus(): void
  isFullscreen?: boolean; onToggleFullscreen?(): void
}) {
  const userMenu = useUserMenu()
  const activate = (event: React.MouseEvent<HTMLElement> | React.KeyboardEvent<HTMLElement>) => {
    if (event.target instanceof Element && event.target.closest('button, input, label, [role="menu"]')) return
    if (tile.kind === 'media' && tile.media.kind === 'screen' && !tile.media.local && !tile.media.subscribed) {
      transport.setPublicationSubscribed(tile.media.id, true)
    }
    onFocus()
  }
  const menuRequest = (): UserMenuRequest => tile.kind === 'avatar'
    ? { userId: tile.userId, name: tile.name,
        call: { peerId: tile.peerId, transport, local: tile.local, focused, onFocus, kind: 'person' } }
    : { userId: tile.userId, name: tile.media.name,
        call: { peerId: tile.media.peerId, transport, local: tile.media.local, focused, onFocus,
          publicationId: tile.media.id, kind: tile.media.kind === 'screen' ? 'screen' : 'person' } }
  const toggleMenuFromButton = (button: HTMLButtonElement) => {
    const rect = button.getBoundingClientRect()
    userMenu.open({
      x: rect.right - 220,
      y: rect.bottom + 4,
      menuKey: `calltile:${tile.id}`,
      trigger: button,
    }, menuRequest())
  }
  const moreButtonProps = {
    onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => {
      if (event.button !== 0) return
      event.preventDefault()
      event.stopPropagation()
      toggleMenuFromButton(event.currentTarget)
    },
    onClick: (event: React.MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation()
      // Enter/Space generate a click without a preceding pointer event.
      if (event.detail === 0) toggleMenuFromButton(event.currentTarget)
    },
  }

  if (tile.kind === 'avatar') return (
    <article className={`calltile calltile--avatar ${tile.speaking ? 'is-speaking' : ''} ${primary ? 'is-primary' : ''}`}
      role="button" tabIndex={0} aria-pressed={focused} aria-label={focused ? `voltar da mídia de ${tile.name}` : `focar mídia de ${tile.name}`} onClick={activate}
      onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') activate(event) }}
      onContextMenu={(event) => userMenu.open(event, menuRequest())}>
      <div className={`calltile__avatar-container ${tile.speaking ? 'is-speaking' : ''}`}>
        <Avatar userId={tile.userId ?? tile.peerId} fallbackName={tile.name} className="calltile__avatar-img" />
      </div>
      <div className="calltile__meta">
        <span className="calltile__meta-name">{tile.name}</span>
        {tile.muted && <IconMicOff size={14} className="calltile__meta-icon" />}
      </div>
      <div className="calltile__top-actions">
        {onToggleFullscreen && (primary || isFullscreen) && (
          <button
            className="calltile__fullscreen-btn"
            onClick={(e) => {
              e.stopPropagation()
              onToggleFullscreen()
            }}
            title={isFullscreen ? 'Sair da tela cheia (Esc)' : 'Tela cheia'}
            aria-label={isFullscreen ? 'sair da tela cheia' : `tela cheia de ${tile.name}`}
          >
            {isFullscreen ? <IconMinimize size={16} /> : <IconFullscreen size={16} />}
          </button>
        )}
        <button className="calltile__more" {...moreButtonProps} aria-haspopup="menu"
          aria-label={`opções de ${tile.name}`}><IconMore /></button>
      </div>
    </article>
  )

  const media = tile.media
  const showFullscreenBtn = onToggleFullscreen && (media.kind === 'screen' || primary)
  const isUnsubscribed = !media.subscribed && !media.local

  return (
    <article className={`calltile ${primary ? 'is-primary' : ''} ${media.kind === 'screen' ? 'calltile--screen' : ''} ${isUnsubscribed ? 'calltile--unsubscribed' : ''}`}
      role="button" tabIndex={0} aria-pressed={focused} aria-label={focused ? `voltar da mídia de ${media.name}` : `focar mídia de ${media.name}`} onClick={activate}
      onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') activate(event) }}
      onContextMenu={(event) => userMenu.open(event, menuRequest())}>
      {media.subscribed || media.local
        ? <MediaVideo publication={media} transport={transport} />
        : <div className="calltile__watch-panel">
            <div className="calltile__watch-icon-wrap"><IconScreen size={36} /></div>
            <strong>{media.name} está transmitindo</strong>
            <button className="calltile__watch-button" onClick={() => { transport.setPublicationSubscribed(media.id, true); onFocus() }}>
              Assistir transmissão
            </button>
          </div>}
      {media.kind === 'screen' && (media.subscribed || media.local) && (
        <span className="calltile__badge-live"><IconScreen size={11} /> AO VIVO</span>
      )}
      <div className="calltile__meta"><span className="calltile__meta-name">{media.name}</span></div>
      <div className="calltile__top-actions">
        {showFullscreenBtn && (
          <button
            className="calltile__fullscreen-btn"
            onClick={(e) => {
              e.stopPropagation()
              onToggleFullscreen()
            }}
            title={isFullscreen ? 'Sair da tela cheia (Esc)' : 'Tela cheia'}
            aria-label={isFullscreen ? 'sair da tela cheia' : `tela cheia de ${media.name}`}
          >
            {isFullscreen ? <IconMinimize size={16} /> : <IconFullscreen size={16} />}
          </button>
        )}
        <button className="calltile__more" {...moreButtonProps} aria-haspopup="menu"
          aria-label={`opções de ${media.name}`}><IconMore /></button>
      </div>
    </article>
  )
}

function MediaVideo({ publication, transport }: { publication: VoiceMediaState; transport: VoiceTransport }) {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const element = ref.current
    if (!element) return
    return transport.attachMedia(publication.id, element)
  }, [publication.id, publication.subscribed, transport])
  return <video ref={ref} data-publication={publication.id} autoPlay playsInline muted={publication.local}
    className={publication.local && publication.kind === 'camera' && transport.getPreferences().mirrorPreview
      ? 'is-mirrored' : ''} />
}

function DockButton({ active, off, danger = false, label, onClick, icon }: {
  active: boolean; off: boolean; danger?: boolean; label: string; onClick(): void; icon: React.ReactNode
}) {
  return <button className={`callstage__dock-button ${active ? 'is-active' : ''} ${off ? 'is-off' : ''} ${danger ? 'is-danger' : ''}`}
    onClick={onClick} title={label} aria-label={label} aria-pressed={active}>{icon}</button>
}

function statusLabel(status: VoiceSnapshot['status']) {
  return ({ idle: 'Desconectado', requesting: 'Conectando…', connecting: 'Conectando áudio…',
    connected: 'Voz Conectada', reconnecting: 'Reconectando…' })[status]
}
