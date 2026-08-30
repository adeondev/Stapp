import { useEffect, useMemo, useRef, useState } from 'react'
import type { PeerId, UserId } from '../protocol'
import type { VoiceMediaState, VoiceSnapshot, VoiceTransport } from '../voice/VoiceTransport'
import type { ScreenPreset, StreamQuality } from '../voice/preferences'
import { Avatar } from './Avatar'
import { ScreenSharePicker } from './ScreenSharePicker'
import {
  IconCamera, IconCameraOff, IconChat, IconChevronDown, IconExpand, IconFullscreen, IconGrid,
  IconHeadphones, IconHeadphonesOff, IconLeave, IconMic, IconMicOff, IconMinimize,
  IconMore, IconPictureInPicture, IconScreen, IconSettings, IconSignal,
} from './Icons'
import './callstage.css'

interface Props {
  channelName: string
  snapshot: VoiceSnapshot
  transport: VoiceTransport
  onMinimize(): void
  onLeave(): void
  onOpenSettings(): void
  chatPanel?: React.ReactNode
  resolveUserId?: (peerId: PeerId) => UserId | undefined
  selfUserId?: UserId | null
  variant?: 'embedded' | 'fullscreen'
  onToggleVariant?: () => void
}

type Tile =
  | { id: string; kind: 'media'; media: VoiceMediaState }
  | { id: string; kind: 'avatar'; peerId: PeerId; userId?: UserId; name: string; local: boolean; speaking: boolean; muted: boolean }

export function CallStage({ channelName, snapshot, transport, onMinimize, onLeave, onOpenSettings, chatPanel, resolveUserId, selfUserId, variant = 'fullscreen', onToggleVariant }: Props) {
  const root = useRef<HTMLDivElement>(null)
  const preferences = transport.getPreferences()
  const [focused, setFocused] = useState<string | null>(null)
  const [showSelf, setShowSelf] = useState(preferences.showSelf)
  const [showVideoOff, setShowVideoOff] = useState(preferences.showVideoOffParticipants)
  const [menu, setMenu] = useState<string | null>(null)
  const [sharePicker, setSharePicker] = useState(false)
  const [cameraMenu, setCameraMenu] = useState(false)
  const [audioMenu, setAudioMenu] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)
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
    setShowSelf(preferences.showSelf)
    setShowVideoOff(preferences.showVideoOffParticipants)
  }, [preferences.showSelf, preferences.showVideoOffParticipants])

  useEffect(() => {
    void transport.enumerateDevices().then(setDevices).catch(() => {})
  }, [transport, cameraMenu, audioMenu])

  const tiles = useMemo<Tile[]>(() => {
    const media = snapshot.media
      .filter((publication) => showSelf || !publication.local)
      .map((publication) => ({ id: `media:${publication.id}`, kind: 'media' as const, media: publication }))
    const peopleWithMedia = new Set(media.map((tile) => tile.media.peerId))
    const avatars = showVideoOff
      ? snapshot.participants
          .filter((participant) => (showSelf || !participant.local) && !peopleWithMedia.has(participant.peerId))
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
      : []
    return [...media, ...avatars]
  }, [showSelf, showVideoOff, snapshot.media, snapshot.participants, resolveUserId, selfUserId])

  useEffect(() => {
    if (focused && !tiles.some((tile) => tile.id === focused)) setFocused(null)
  }, [focused, tiles])

  const ordered = focused
    ? [...tiles.filter((tile) => tile.id === focused), ...tiles.filter((tile) => tile.id !== focused)]
    : tiles

  const startShare = (sourceId: string | undefined, preset: ScreenPreset) =>
    transport.setScreenShareEnabled(true, preset, sourceId)

  const popOut = async () => {
    const media = focused?.startsWith('media:')
      ? snapshot.media.find((item) => `media:${item.id}` === focused)
      : snapshot.media.find((item) => item.subscribed)
    if (!media) return
    const documentPip = (window as Window & {
      documentPictureInPicture?: { requestWindow(options: { width: number; height: number }): Promise<Window> }
    }).documentPictureInPicture
    if (documentPip) {
      const pip = await documentPip.requestWindow({ width: 640, height: 400 })
      for (const node of document.querySelectorAll('style, link[rel="stylesheet"]')) {
        pip.document.head.append(node.cloneNode(true))
      }
      pip.document.body.className = 'call-popout'
      const video = pip.document.createElement('video')
      video.autoplay = true
      video.playsInline = true
      pip.document.body.append(video)
      const detach = transport.attachMedia(media.id, video)
      pip.addEventListener('pagehide', detach, { once: true })
      return
    }
    const video = root.current?.querySelector<HTMLVideoElement>(`video[data-publication="${media.id}"]`)
    if (video?.requestPictureInPicture) await video.requestPictureInPicture()
  }

  const isPartyOnly = ordered.length > 0 && ordered.every((t) => t.kind === 'avatar')

  return (
    <div className={`callstage ${variant === 'embedded' ? 'callstage--embedded' : 'callstage--fullscreen'} ${focused ? 'callstage--focus' : ''} ${chatOpen && chatPanel ? 'callstage--with-chat' : ''} ${isPartyOnly ? 'callstage--party-mode' : ''}`} ref={root}
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

        <div className="callstage__window-actions">
          {onToggleVariant && (
            <button
              className="callstage__action-pill"
              onClick={onToggleVariant}
              title={variant === 'embedded' ? 'Expandir chamada para tela cheia' : 'Embutir chamada no topo do chat'}
              aria-label={variant === 'embedded' ? 'tela cheia' : 'embutir'}
            >
              {variant === 'embedded' ? <IconExpand size={16} /> : <IconPictureInPicture size={16} />}
              <span>{variant === 'embedded' ? 'Tela cheia' : 'Embutir'}</span>
            </button>
          )}

          {variant === 'fullscreen' && chatPanel && (
            <button
              className={`callstage__action-pill ${chatOpen ? 'is-active' : ''}`}
              onClick={() => setChatOpen((open) => !open)}
              title="Alternar chat de texto do canal"
              aria-label="chat do canal"
              aria-pressed={chatOpen}
            >
              <IconChat size={16} />
              <span>Chat</span>
            </button>
          )}

          {focused && (
            <button
              className="callstage__action-pill"
              onClick={() => setFocused(null)}
              title="Voltar para a visualização em grade"
              aria-label="modo grade"
            >
              <IconGrid size={16} />
              <span>Grade</span>
            </button>
          )}

          {variant === 'fullscreen' && (
            <>
              <button onClick={() => setShowVideoOff((value) => !value)} aria-pressed={showVideoOff}
                title="Mostrar ou ocultar participantes sem vídeo">
                Sem vídeo
              </button>
              <button onClick={() => setShowSelf((value) => !value)} aria-pressed={showSelf}
                title="Mostrar ou ocultar sua própria imagem">
                Minha prévia
              </button>
              <button onClick={popOut} title="Abrir chamada em uma janela flutuante" aria-label="pop-out">
                <IconPictureInPicture />
              </button>
              <button onClick={() => root.current?.requestFullscreen()} title="Tela cheia" aria-label="tela cheia">
                <IconFullscreen />
              </button>
            </>
          )}
          <button onClick={onMinimize} title="Minimizar para continuar navegando" aria-label="minimizar">
            <IconMinimize />
          </button>
        </div>
      </header>

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
                    onFocus={() => {}}
                    menuOpen={menu === tile.id} onMenu={() => setMenu((current) => current === tile.id ? null : tile.id)} />
                ))}
              </div>
            </div>
          ) : (
            <div className="callstage__layout">
              {ordered.map((tile, index) => (
                <CallTile key={tile.id} tile={tile} primary={Boolean(focused && index === 0)}
                  focused={tile.id === focused} transport={transport}
                  onFocus={() => setFocused((current) => current === tile.id ? null : tile.id)}
                  menuOpen={menu === tile.id} onMenu={() => setMenu((current) => current === tile.id ? null : tile.id)} />
              ))}
            </div>
          )}
        </div>

        {variant === 'fullscreen' && chatOpen && chatPanel && (
          <aside className="callstage__sidechat">
            {chatPanel}
          </aside>
        )}
      </div>

      <div className="callstage__dock-wrap">
        {(cameraMenu || audioMenu) && (
          <div className="callstage__submenu" role="menu">
            {audioMenu ? (
              <>
                <strong>Dispositivos de Áudio</strong>
                <div className="callstage__submenu-section">
                  <small>Microfone</small>
                  {devices.inputs.map((d) => (
                    <button
                      key={d.deviceId}
                      role="menuitem"
                      className={preferences.inputDeviceId === d.deviceId ? 'is-selected' : ''}
                      onClick={() => { void transport.setInputDevice(d.deviceId); setAudioMenu(false) }}
                    >
                      <span>{d.label || `Microfone (${d.deviceId.slice(0, 5)})`}</span>
                    </button>
                  ))}
                  {devices.inputs.length === 0 && <small className="callstage__submenu-empty">Nenhum microfone detectado</small>}
                </div>
                <div className="callstage__submenu-section">
                  <small>Dispositivo de Saída</small>
                  {devices.outputs.map((d) => (
                    <button
                      key={d.deviceId}
                      role="menuitem"
                      className={preferences.outputDeviceId === d.deviceId ? 'is-selected' : ''}
                      onClick={() => { void transport.setOutputDevice(d.deviceId); setAudioMenu(false) }}
                    >
                      <span>{d.label || `Alto-falante (${d.deviceId.slice(0, 5)})`}</span>
                    </button>
                  ))}
                  {devices.outputs.length === 0 && <small className="callstage__submenu-empty">Padrão do sistema operacional</small>}
                </div>
              </>
            ) : (
              <>
                <strong>Câmera & Qualidade</strong>
                <div className="callstage__submenu-section">
                  {devices.cameras.map((d) => (
                    <button
                      key={d.deviceId}
                      role="menuitem"
                      className={preferences.cameraDeviceId === d.deviceId ? 'is-selected' : ''}
                      onClick={() => { void transport.setCameraDevice(d.deviceId); setCameraMenu(false) }}
                    >
                      <span>{d.label || `Câmera (${d.deviceId.slice(0, 5)})`}</span>
                    </button>
                  ))}
                </div>
                <div className="callstage__submenu-divider" />
                <button
                  role="menuitem"
                  className={preferences.cameraQuality === '720p' ? 'is-selected' : ''}
                  onClick={() => { void transport.updatePreferences({ cameraQuality: '720p' }); setCameraMenu(false) }}
                >
                  <span>720p / 30 FPS</span>
                  <small>Padrão e econômico</small>
                </button>
                <button
                  role="menuitem"
                  className={preferences.cameraQuality === '1080p' ? 'is-selected' : ''}
                  onClick={() => { void transport.updatePreferences({ cameraQuality: '1080p' }); setCameraMenu(false) }}
                >
                  <span>1080p / 30 FPS</span>
                  <small>Alta definição</small>
                </button>
              </>
            )}
          </div>
        )}

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
              onClick={() => { setAudioMenu((v) => !v); setCameraMenu(false); setSharePicker(false) }}
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
              onClick={() => { setCameraMenu((v) => !v); setAudioMenu(false); setSharePicker(false) }}
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
              onClick={() => { setSharePicker(true); setCameraMenu(false); setAudioMenu(false) }}
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

function CallTile({ tile, primary, focused, transport, onFocus, menuOpen, onMenu }: {
  tile: Tile; primary: boolean; focused: boolean; transport: VoiceTransport
  onFocus(): void; menuOpen: boolean; onMenu(): void
}) {
  const [voiceVolume, setVoiceVolume] = useState(100)
  const [streamVolume, setStreamVolume] = useState(100)

  if (tile.kind === 'avatar') return (
    <article className={`calltile calltile--avatar ${tile.speaking ? 'is-speaking' : ''} ${primary ? 'is-primary' : ''}`}>
      <div className={`calltile__avatar-container ${tile.speaking ? 'is-speaking' : ''}`}>
        <Avatar userId={tile.userId ?? tile.peerId} fallbackName={tile.name} className="calltile__avatar-img" />
      </div>
      <div className="calltile__meta">
        <span className="calltile__meta-name">{tile.name}</span>
        {tile.muted && <IconMicOff size={14} className="calltile__meta-icon" />}
      </div>
      <button className="calltile__more" onClick={onMenu} aria-label={`opções de ${tile.name}`}><IconMore /></button>
      {menuOpen && <ParticipantMenu name={tile.name} focused={focused} onFocus={onFocus}
        canAdjustAudio={!tile.local}
        voiceVolume={voiceVolume} onVoiceVolume={(value) => { setVoiceVolume(value); transport.setParticipantVolume(tile.peerId, value) }} />}
    </article>
  )

  const media = tile.media
  return (
    <article className={`calltile ${primary ? 'is-primary' : ''} ${media.kind === 'screen' ? 'calltile--screen' : ''}`}>
      {media.subscribed || media.local
        ? <MediaVideo publication={media} transport={transport} />
        : (
          <div className="calltile__watch-panel">
            <div className="calltile__watch-icon-wrap">
              <IconScreen size={36} />
            </div>
            <strong>{media.name} está transmitindo</strong>
            <button className="calltile__watch-button" onClick={() => transport.setPublicationSubscribed(media.id, true)}>
              Assistir transmissão
            </button>
          </div>
        )}

      {media.kind === 'screen' && (
        <span className="calltile__badge-live">
          <IconScreen size={11} /> AO VIVO
        </span>
      )}

      <div className="calltile__meta">
        <span className="calltile__meta-name">{media.name}</span>
      </div>

      <button className="calltile__more" onClick={onMenu} aria-label={`opções de ${media.name}`}><IconMore /></button>
      {menuOpen && <ParticipantMenu name={media.name} focused={focused} onFocus={onFocus}
        canAdjustAudio={!media.local}
        voiceVolume={voiceVolume} onVoiceVolume={(value) => { setVoiceVolume(value); transport.setParticipantVolume(media.peerId, value) }}
        streamVolume={media.local ? undefined : streamVolume}
        onStreamVolume={media.local ? undefined : (value) => { setStreamVolume(value); transport.setPublicationVolume(media.id, value) }}
        quality={media.local ? undefined : (quality) => transport.setPublicationQuality(media.id, quality)}
        onStop={media.local ? undefined : () => transport.setPublicationSubscribed(media.id, false)} />}
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

function ParticipantMenu({ name, focused, onFocus, canAdjustAudio, voiceVolume, onVoiceVolume,
  streamVolume, onStreamVolume, quality, onStop }: {
  name: string; focused: boolean; onFocus(): void; canAdjustAudio: boolean
  voiceVolume: number; onVoiceVolume(value: number): void
  streamVolume?: number; onStreamVolume?(value: number): void; quality?(quality: StreamQuality): void; onStop?(): void
}) {
  return <div className="calltile__menu" role="menu" aria-label={`opções de ${name}`}>
    <button role="menuitem" onClick={onFocus}>{focused ? 'Voltar para a grade' : 'Focar'}</button>
    {canAdjustAudio && <button role="menuitem" onClick={() => onVoiceVolume(voiceVolume === 0 ? 100 : 0)}>
      {voiceVolume === 0 ? 'Ativar som local' : 'Silenciar localmente'}
    </button>}
    {canAdjustAudio && <label>Volume da voz <output>{voiceVolume}%</output>
      <input type="range" min="0" max="200" value={voiceVolume}
        onChange={(event) => onVoiceVolume(Number(event.target.value))} /></label>}
    {onStreamVolume && <label>Volume da transmissão <output>{streamVolume}%</output>
      <input type="range" min="0" max="200" value={streamVolume}
        onChange={(event) => onStreamVolume(Number(event.target.value))} /></label>}
    {quality && <div className="calltile__quality" aria-label="qualidade da transmissão">
      {(['auto', 'low', 'high', 'original'] as StreamQuality[]).map((value) =>
        <button key={value} onClick={() => quality(value)}>{qualityLabel(value)}</button>)}</div>}
    {onStop && <button role="menuitem" onClick={onStop}>Parar de assistir</button>}
  </div>
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

function qualityLabel(quality: StreamQuality) {
  return ({ auto: 'Auto', low: 'Baixo', high: 'Alto', original: 'Original' })[quality]
}
