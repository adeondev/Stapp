import { useEffect, useRef } from 'react'
import type { PeerId, UserId } from '../protocol'
import type { VoiceSnapshot, VoiceTransport } from '../voice/VoiceTransport'
import { Avatar } from './Avatar'
import { IconExpand, IconLeave, IconMic, IconMicOff, IconScreen, IconSignal } from './Icons'
import { useUserMenu } from './UserMenu'
import './callminipip.css'

interface Props {
  channelName: string
  snapshot: VoiceSnapshot
  transport: VoiceTransport
  onExpand(): void
  onLeave(): void
  resolveUserId?: (peerId: PeerId) => UserId | undefined
  selfUserId?: UserId | null
}

export function CallMiniPip({ channelName, snapshot, transport, onExpand, onLeave, resolveUserId, selfUserId }: Props) {
  const userMenu = useUserMenu()
  // Procura primeira transmissão de tela ativa ou câmera
  const activeMedia = snapshot.media.find((m) => m.subscribed || m.local)
  const speakingParticipant = snapshot.participants.find((p) => p.speaking) ?? snapshot.participants[0]
  const menuParticipant = activeMedia
    ? snapshot.participants.find((participant) => participant.peerId === activeMedia.peerId) ?? speakingParticipant
    : speakingParticipant
  const speakerUserId = speakingParticipant
    ? (resolveUserId?.(speakingParticipant.peerId) ?? (speakingParticipant.local ? (selfUserId ?? undefined) : undefined))
    : undefined

  const micOff = snapshot.muted || snapshot.deafened

  return (
    <aside className="callminipip" role="complementary" aria-label={`Chamada ativa em ${channelName}`}>
      <div className="callminipip__screen" onClick={onExpand} title="Clique para voltar para a chamada"
        onContextMenu={(event) => menuParticipant && userMenu.open(event, {
          userId: resolveUserId?.(menuParticipant.peerId)
            ?? (menuParticipant.local ? (selfUserId ?? undefined) : undefined),
          name: activeMedia?.name ?? menuParticipant.name,
          call: {
            peerId: activeMedia?.peerId ?? menuParticipant.peerId,
            transport,
            local: activeMedia?.local ?? menuParticipant.local,
            focused: false,
            onFocus: onExpand,
            publicationId: activeMedia?.id,
            kind: activeMedia?.kind === 'screen' ? 'screen' : 'person',
          },
        })}>
        {activeMedia ? (
          <PipVideo publicationId={activeMedia.id} transport={transport} />
        ) : (
          <div className="callminipip__placeholder">
            {speakingParticipant ? (
              <div className={`callminipip__avatar-wrap ${speakingParticipant.speaking ? 'is-speaking' : ''}`}>
                <Avatar userId={speakerUserId ?? speakingParticipant.peerId} fallbackName={speakingParticipant.name} className="callminipip__avatar" />
              </div>
            ) : (
              <div className="callminipip__avatar-wrap">
                <div className="callminipip__avatar-generic">{channelName.slice(0, 1).toUpperCase()}</div>
              </div>
            )}
            <span className="callminipip__speaker-name">
              {speakingParticipant ? speakingParticipant.name : channelName}
            </span>
          </div>
        )}

        <div className="callminipip__overlay">
          <div className="callminipip__badge">
            <IconSignal size={12} className="callminipip__signal" />
            <span>{channelName}</span>
            {activeMedia && activeMedia.kind === 'screen' && (
              <span className="callminipip__live-tag">
                <IconScreen size={11} /> AO VIVO
              </span>
            )}
          </div>
          <button className="callminipip__expand-btn" onClick={(e) => { e.stopPropagation(); onExpand() }} title="Expandir chamada">
            <IconExpand size={16} />
          </button>
        </div>
      </div>

      <div className="callminipip__controls">
        <button
          className={`callminipip__action-btn ${micOff ? 'is-muted' : ''}`}
          onClick={() => transport.setMuted(!snapshot.muted)}
          title={micOff ? 'Ligar microfone' : 'Desligar microfone'}
        >
          {micOff ? <IconMicOff size={16} /> : <IconMic size={16} />}
        </button>

        <button
          className="callminipip__action-btn callminipip__action-btn--leave"
          onClick={onLeave}
          title="Desconectar"
        >
          <IconLeave size={16} />
        </button>
      </div>
    </aside>
  )
}

function PipVideo({ publicationId, transport }: { publicationId: string; transport: VoiceTransport }) {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    return transport.attachMedia(publicationId, el)
  }, [publicationId, transport])

  return <video ref={ref} autoPlay playsInline muted className="callminipip__video" />
}
