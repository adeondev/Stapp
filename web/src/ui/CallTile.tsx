import { useEffect, useMemo, useRef, useState } from 'react'
import type { Tile } from './CallStage'
import type { VoiceMediaState, VoiceTransport } from '../voice/VoiceTransport'
import { useVoiceStore } from '../stores/voiceStore'
import { useUserMenu, type UserMenuRequest } from './UserMenu'
import { Avatar, useProfile } from './Avatar'
import {
  IconFullscreen, IconHeadphones, IconHeadphonesOff, IconLeave,
  IconMic, IconMicOff, IconMinimize, IconMore, IconScreen,
} from './Icons'
import { avatarGifUrl, avatarStaticUrl, avatarUrl } from '../net/avatars'

export interface CallTileAvatarUser {
  avatar_gif_url?: string
  avatar_static_url?: string
  has_avatar?: boolean
  display_name?: string
  username?: string
}

export function CallTileAvatar({
  user,
  isSpeaking,
  className = '',
  fallbackName = '',
}: {
  user: CallTileAvatarUser
  isSpeaking: boolean
  className?: string
  fallbackName?: string
}) {
  const [error, setError] = useState(false)
  const hasImage = !error && Boolean(user.avatar_static_url || user.avatar_gif_url)

  if (!hasImage) {
    const letter = (user.display_name || fallbackName || '?')[0].toUpperCase()
    return <span className={`avatar-initial ${className}`}>{letter}</span>
  }

  // Quando o avatar for um GIF, alterna a URL exibida conforme a flag de voz:
  // sem renderizar ou pausar frames dinâmicos via <canvas> na thread principal
  return (
    <img
      className={className}
      src={isSpeaking ? user.avatar_gif_url : user.avatar_static_url}
      alt=""
      onError={() => setError(true)}
    />
  )
}

export interface CallTileProps {
  tile: Tile
  primary: boolean
  focused?: boolean
  transport: VoiceTransport
  onFocus(): void
  isFullscreen?: boolean
  isMouseIdle?: boolean
  onToggleFullscreen?(el?: HTMLElement | null): void
  onLeave?(): void
  avatarBase?: string | null
}

export function CallTile({
  tile,
  primary,
  focused = false,
  transport,
  onFocus,
  isFullscreen,
  isMouseIdle,
  onToggleFullscreen,
  onLeave,
  avatarBase = null,
}: CallTileProps) {
  const tileRef = useRef<HTMLElement>(null)
  const userMenu = useUserMenu()
  const muted = useVoiceStore((s) => s.muted)
  const deafened = useVoiceStore((s) => s.deafened)
  const toggleMute = useVoiceStore((s) => s.toggleMute)
  const toggleDeafen = useVoiceStore((s) => s.toggleDeafen)

  const fallbackName = tile.kind === 'avatar' ? tile.name : tile.media.name
  const profile = useProfile(tile.userId, fallbackName)
  const displayName = profile.display_name || fallbackName

  const isSpeaking = tile.kind === 'avatar' ? tile.speaking : false

  const user = useMemo<CallTileAvatarUser>(() => {
    const resolve = (url?: string | null) => {
      if (!url) return undefined
      if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('blob:') || url.startsWith('data:')) return url
      return avatarBase ? `${avatarBase}${url.startsWith('/') ? '' : '/'}${url}` : url
    }
    const isGif = Boolean(profile.avatar_gif || (profile.avatar_gif_url && profile.avatar_gif_url.length > 0))
    const defaultStatic = profile.has_avatar && avatarBase
      ? (isGif ? avatarStaticUrl(avatarBase, profile.user_id, profile.updated_at) : avatarUrl(avatarBase, profile.user_id, profile.updated_at))
      : undefined
    const staticUrl = resolve(profile.avatar_static_url) ?? defaultStatic
    const gifUrl = resolve(profile.avatar_gif_url) ?? (isGif && avatarBase ? avatarGifUrl(avatarBase, profile.user_id, profile.updated_at) : undefined)
    return {
      ...profile,
      avatar_static_url: staticUrl,
      avatar_gif_url: gifUrl,
    }
  }, [profile, avatarBase])

  const activate = (event: React.MouseEvent<HTMLElement> | React.KeyboardEvent<HTMLElement>) => {
    if (event.target instanceof Element && event.target.closest('button, input, label, [role="menu"]')) return
    if (tile.kind === 'media' && tile.media.kind === 'screen' && !tile.media.local && !tile.media.subscribed) {
      transport.setPublicationSubscribed(tile.media.id, true)
    }
    onFocus()
  }

  const menuRequest = (): UserMenuRequest => tile.kind === 'avatar'
    ? { userId: tile.userId, name: displayName,
        call: { peerId: tile.peerId, transport, local: tile.local, focused, onFocus, kind: 'person' } }
    : { userId: tile.userId, name: displayName,
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
      if (event.detail === 0) toggleMenuFromButton(event.currentTarget)
    },
  }

  const renderFullscreenControls = () => (
    <div className="calltile__fullscreen-controls" onClick={(e) => e.stopPropagation()}>
      <button
        className={`callstage__dock-button ${!muted && !deafened ? 'is-active' : 'is-off'}`}
        onClick={toggleMute}
        title={muted || deafened ? 'Ligar microfone' : 'Desligar microfone'}
        aria-label={muted || deafened ? 'ligar microfone' : 'desligar microfone'}
      >
        {muted || deafened ? <IconMicOff size={18} /> : <IconMic size={18} />}
      </button>
      <button
        className={`callstage__dock-button ${!deafened ? 'is-active' : 'is-off'}`}
        onClick={toggleDeafen}
        title={deafened ? 'Voltar a ouvir' : 'Ensurdecer'}
        aria-label={deafened ? 'voltar a ouvir' : 'ensurdecer'}
      >
        {deafened ? <IconHeadphonesOff size={18} /> : <IconHeadphones size={18} />}
      </button>
      <button
        className="callstage__dock-button"
        onClick={() => onToggleFullscreen?.(tileRef.current)}
        title="Sair da tela cheia (Esc)"
        aria-label="sair da tela cheia"
      >
        <IconMinimize size={18} />
      </button>
      {onLeave && (
        <button
          className="callstage__dock-button is-danger"
          onClick={onLeave}
          title="Desconectar"
          aria-label="desconectar"
        >
          <IconLeave size={18} />
        </button>
      )}
    </div>
  )

  if (tile.kind === 'avatar') return (
    <article
      ref={tileRef}
      data-tile-id={tile.id}
      className={`calltile calltile--avatar ${tile.speaking ? 'is-speaking' : ''} ${primary ? 'is-primary' : ''} ${isMouseIdle ? 'is-mouse-idle' : ''}`}
      role="button" tabIndex={0} aria-pressed={focused} aria-label={focused ? `voltar da mídia de ${displayName}` : `focar mídia de ${displayName}`} onClick={activate}
      onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') activate(event) }}
      onContextMenu={(event) => userMenu.open(event, menuRequest())}>
      <div className={`calltile__avatar-container ${tile.speaking ? 'is-speaking' : ''}`}>
        {user.avatar_gif_url ? (
          <CallTileAvatar
            user={user}
            isSpeaking={isSpeaking}
            className="calltile__avatar-img"
            fallbackName={displayName}
          />
        ) : (
          <Avatar
            userId={tile.userId ?? tile.peerId}
            fallbackName={displayName}
            className="calltile__avatar-img"
            speaking={tile.speaking}
          />
        )}
      </div>
      <div className="calltile__meta">
        <span className="calltile__meta-name">{displayName}</span>
        {tile.muted && <IconMicOff size={16} className="calltile__meta-icon" />}
      </div>
      <div className="calltile__top-actions">
        {onToggleFullscreen && (primary || isFullscreen) && (
          <button
            className="calltile__fullscreen-btn"
            onClick={(e) => {
              e.stopPropagation()
              onToggleFullscreen(tileRef.current)
            }}
            title={isFullscreen ? 'Sair da tela cheia (Esc)' : 'Tela cheia'}
            aria-label={isFullscreen ? 'sair da tela cheia' : `tela cheia de ${displayName}`}
          >
            {isFullscreen ? <IconMinimize size={16} /> : <IconFullscreen size={16} />}
          </button>
        )}
        <button className="calltile__more" {...moreButtonProps} aria-haspopup="menu"
          aria-label={`opções de ${displayName}`}><IconMore /></button>
      </div>
      {isFullscreen && renderFullscreenControls()}
    </article>
  )

  const media = tile.media
  const showFullscreenBtn = onToggleFullscreen && (media.kind === 'screen' || primary)
  const isUnsubscribed = !media.subscribed && !media.local

  return (
    <article
      ref={tileRef}
      data-tile-id={tile.id}
      className={`calltile ${primary ? 'is-primary' : ''} ${media.kind === 'screen' ? 'calltile--screen' : ''} ${isUnsubscribed ? 'calltile--unsubscribed' : ''} ${isMouseIdle ? 'is-mouse-idle' : ''}`}
      role="button" tabIndex={0} aria-pressed={focused} aria-label={focused ? `voltar da mídia de ${displayName}` : `focar mídia de ${displayName}`} onClick={activate}
      onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') activate(event) }}
      onContextMenu={(event) => userMenu.open(event, menuRequest())}>
      {media.subscribed || media.local
        ? <MediaVideo publication={media} transport={transport} />
        : <div className="calltile__watch-panel">
            <div className="calltile__watch-icon-wrap"><IconScreen size={32} /></div>
            <strong>{displayName} está transmitindo</strong>
            <button className="calltile__watch-button" onClick={() => { transport.setPublicationSubscribed(media.id, true); onFocus() }}>
              Assistir transmissão
            </button>
          </div>}
      {media.kind === 'screen' && (media.subscribed || media.local) && (
        <span className="calltile__badge-live"><IconScreen size={16} /> AO VIVO</span>
      )}
      <div className="calltile__meta"><span className="calltile__meta-name">{displayName}{media.kind === 'screen' ? ' (Tela)' : ''}</span></div>
      <div className="calltile__top-actions">
        {showFullscreenBtn && (
          <button
            className="calltile__fullscreen-btn"
            onClick={(e) => {
              e.stopPropagation()
              onToggleFullscreen(tileRef.current)
            }}
            title={isFullscreen ? 'Sair da tela cheia (Esc)' : 'Tela cheia'}
            aria-label={isFullscreen ? 'sair da tela cheia' : `tela cheia de ${displayName}`}
          >
            {isFullscreen ? <IconMinimize size={16} /> : <IconFullscreen size={16} />}
          </button>
        )}
        <button className="calltile__more" {...moreButtonProps} aria-haspopup="menu"
          aria-label={`opções de ${displayName}`}><IconMore /></button>
      </div>
      {isFullscreen && renderFullscreenControls()}
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
