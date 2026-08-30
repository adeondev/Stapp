import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import stappLogo from '../assets/imgs/svg/stapp_logo.svg'
import { AuthApi, AuthApiError } from './net/auth'
import { Connection, type ConnectionStatus } from './net/connection'
import { IncomingRequestTracker, notificationSound } from './net/notifications'
import { hasPendingLogout, lastServer, loadServers, markLogoutPending, normalizeServerUrl,
  removeServer, saveServer, setPendingLogout, type SavedServer } from './net/servers'
import type { AuthMode, CallEndReason, PeerId, UserId } from './protocol'
import { PROTOCOL_VERSION } from './protocol'
import { directChannelPartner, directChannelPartnerId, initialState, profileOf, reduce } from './store'
import { AccountBar } from './ui/AccountBar'
import { avatarBaseFromWs, removeAvatar, uploadAvatar } from './net/avatars'
import { ProfileProvider } from './ui/Avatar'
import { ProfileEditor } from './ui/ProfileEditor'
import { CallPanel } from './ui/CallPanel'
import { Chat } from './ui/Chat'
import { Connect, type AuthInfo } from './ui/Connect'
import { FriendsHome, type SocialAction } from './ui/FriendsHome'
import { MembersPanel } from './ui/MembersPanel'
import { ServerRail } from './ui/ServerRail'
import { Sidebar, sidebarModeFor, type View } from './ui/Sidebar'
import { VoiceBar } from './ui/VoiceBar'
import { CallStage } from './ui/CallStage'
import { CallMiniPip } from './ui/CallMiniPip'
import { VoiceSettings } from './ui/VoiceSettings'
import { createVoiceTransport, emptySnapshot, type VoiceSnapshot, type VoiceTransport } from './voice/VoiceTransport'
import { loadVoicePreferences, type VoicePreferences } from './voice/preferences'
import './ui/app.css'

interface CallState { channel: string; muted: boolean; deafened: boolean }
interface Ringing { userId: UserId; username: string; direction: 'incoming' | 'outgoing' }
interface ActiveServer { profile: SavedServer; persisted: boolean }

const CALL_REASON: Record<CallEndReason, string> = {
  declined: 'A chamada foi recusada.', canceled: 'A chamada foi cancelada.',
  missed: 'Ninguém atendeu.', busy: 'Essa pessoa já está com o telefone tocando.',
  offline: 'Essa pessoa não está conectada.', unavailable: 'Esta chamada não está disponível.',
}

export default function App() {
  const [servers, setServers] = useState(loadServers)
  const [active, setActive] = useState<ActiveServer | null>(() => {
    const profile = lastServer()
    return profile ? { profile, persisted: true } : null
  })
  const activeRef = useRef(active)
  activeRef.current = active
  const [connectionEpoch, setConnectionEpoch] = useState(0)
  const [authInfo, setAuthInfo] = useState<AuthInfo | null>(null)
  const [authError, setAuthError] = useState<string | null>(null)
  const [authBusy, setAuthBusy] = useState(false)
  const [authenticated, setAuthenticated] = useState(false)
  const attemptedUsername = useRef(active?.profile.username ?? '')

  const [state, dispatch] = useReducer(reduce, initialState)
  const [status, setStatus] = useState<ConnectionStatus>('offline')
  const [notice, setNotice] = useState<string | null>(null)
  const [speaking, setSpeaking] = useState<ReadonlySet<PeerId>>(() => new Set())
  const [view, setView] = useState<View | null>(null)
  const viewRef = useRef<View | null>(null)
  viewRef.current = view
  const [call, setCall] = useState<CallState | null>(null)
  const [callFocused, setCallFocused] = useState(false)
  const [callMode, setCallMode] = useState<'embedded' | 'fullscreen'>('embedded')
  const [voiceSnapshot, setVoiceSnapshot] = useState<VoiceSnapshot>(emptySnapshot)
  const [voiceSettingsOpen, setVoiceSettingsOpen] = useState(false)
  const [_voicePreferences, setVoicePreferences] = useState<VoicePreferences>(loadVoicePreferences)
  const [ringing, setRinging] = useState<Ringing | null>(null)
  const [editingProfile, setEditingProfile] = useState(false)

  const connection = useRef<Connection | null>(null)
  const authApi = useRef<AuthApi | null>(null)
  const voice = useRef<VoiceTransport | null>(null)
  const unsubscribeVoice = useRef<(() => void) | null>(null)

  const resetRoom = useCallback(() => {
    voice.current?.destroy()
    voice.current = null
    unsubscribeVoice.current?.()
    unsubscribeVoice.current = null
    dispatch({ t: 'app.reset' })
    setAuthenticated(false)
    setView(null)
    setCall(null)
    setCallFocused(false)
    setCallMode('embedded')
    setVoiceSnapshot(emptySnapshot())
    setVoiceSettingsOpen(false)
    setRinging(null)
    setSpeaking(new Set())
    setNotice(null)
  }, [])

  const updateActiveProfile = useCallback((patch: Partial<SavedServer>) => {
    const current = activeRef.current
    if (!current) return
    const profile = { ...current.profile, ...patch }
    const next = { ...current, profile }
    activeRef.current = next
    setActive(next)
    if (current.persisted) setServers(saveServer(profile))
  }, [])

  useEffect(() => {
    const serverUrl = active?.profile.url
    if (!serverUrl) return
    resetRoom()
    setAuthInfo(null)
    setAuthError(null)
    setAuthBusy(true)
    setStatus('connecting')
    attemptedUsername.current = active.profile.username

    const api = new AuthApi(serverUrl)
    authApi.current = api
    let disposed = false
    let refreshing = false
    const friendRequests = new IncomingRequestTracker()

    const attemptRefresh = async () => {
      if (refreshing || disposed) return
      refreshing = true
      try {
        if (active.profile.logoutPending) {
          const revoked = await api.logout()
          if (revoked && !disposed) {
            setPendingLogout(active.profile.url, false)
            updateActiveProfile({ logoutPending: undefined })
          }
          if (!disposed) setAuthBusy(false)
          return
        }
        const session = await api.refresh()
        if (disposed) return
        if (session) {
          connection.current?.authenticate(session.access_token)
        } else {
          setAuthBusy(false)
        }
      } catch (error) {
        if (!disposed) {
          setAuthBusy(false)
          setAuthError(error instanceof Error ? error.message : 'Não foi possível restaurar a sessão.')
        }
      } finally {
        refreshing = false
      }
    }

    const conn = new Connection(serverUrl, {
      onMessage(msg) {
        if (msg.t === 'auth.required') {
          setAuthInfo({
            serverId: msg.server_id,
            protocolVersion: msg.protocol_version,
            serverName: msg.server_name,
            registrationEnabled: msg.registration_enabled,
            plaintextAuthAllowed: msg.plaintext_auth_allowed,
          })
          updateActiveProfile({ serverId: msg.server_id, name: msg.server_name, lastUsed: Date.now() })
          if (msg.protocol_version !== PROTOCOL_VERSION) {
            setAuthBusy(false)
            setAuthError(`Versão incompatível: servidor ${msg.protocol_version}, aplicativo ${PROTOCOL_VERSION}.`)
            return
          }
          if (!conn.hasAccess()) void attemptRefresh()
          return
        }

        if (msg.t === 'auth.error') {
          conn.clearAccess()
          setAuthBusy(false)
          setAuthError(msg.message)
          void attemptRefresh()
          return
        }

        if (msg.t === 'welcome') {
          voice.current?.destroy()
          unsubscribeVoice.current?.()
          setCall(null)
          setCallFocused(false)
          setRinging(null)
          setSpeaking(new Set())
          setAuthBusy(false)
          setAuthError(null)
          setAuthenticated(true)
          updateActiveProfile({ username: attemptedUsername.current, lastUsed: Date.now(), logoutPending: undefined })
          const transport = createVoiceTransport(msg.voice, {
            selfPeerId: msg.self_peer_id,
            send: (out) => connection.current?.send(out),
            onSpeaking(peerId, isSpeaking) {
              setSpeaking((previous) => {
                if (previous.has(peerId) === isSpeaking) return previous
                const next = new Set(previous)
                if (isSpeaking) next.add(peerId); else next.delete(peerId)
                return next
              })
            },
            onError: setNotice,
          })
          voice.current = transport
          unsubscribeVoice.current = transport.subscribe((snapshot) => {
            setVoiceSnapshot(snapshot)
            if (snapshot.status === 'idle' && !snapshot.channel) {
              setCall(null)
              setCallFocused(false)
            }
          })
          setView((current) => current ?? { kind: 'home' })
        }

        if (msg.t === 'social.snapshot' && friendRequests.update(msg.members).length > 0) {
          notificationSound.play()
        }
        if (msg.t === 'dm.new') {
          const current = viewRef.current
          if (msg.unread > 0 && msg.msg.kind === 'text') notificationSound.play()
          if (current?.kind === 'direct' && current.userId === msg.user_id && msg.unread > 0) {
            connection.current?.send({ t: 'dm.read', user_id: msg.user_id })
          }
        }
        if (msg.t === 'dm.denied') setNotice('Essa pessoa aceita novas conversas apenas de amigos.')
        if (msg.t === 'call.incoming') setRinging({ userId: msg.user_id, username: msg.username, direction: 'incoming' })
        if (msg.t === 'call.accepted') {
          setRinging(null)
          void voice.current?.join(msg.channel).then((started) => {
            if (started) {
              setCall({ channel: msg.channel, muted: false, deafened: false })
            }
          })
        }
        if (msg.t === 'call.ended') { setRinging(null); setNotice(CALL_REASON[msg.reason]) }
        if (msg.t === 'error') setNotice(msg.message)
        dispatch(msg)
        voice.current?.handleServerMessage(msg)
      },
      onStatus(next, detail) {
        setStatus(next)
        if (next === 'reconnecting' && detail) setNotice(`Conexão interrompida — ${detail}`)
        if (next === 'offline' && detail) setAuthError(detail)
      },
    })
    connection.current = conn

    return () => {
      disposed = true
      voice.current?.destroy()
      voice.current = null
      conn.close()
      if (connection.current === conn) connection.current = null
      if (authApi.current === api) authApi.current = null
    }
  }, [active?.profile.url, connectionEpoch, resetRoom, updateActiveProfile])

  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(null), 6000)
    return () => clearTimeout(timer)
  }, [notice])

  const chooseServer = useCallback((raw: string, remember: boolean) => {
    try {
      const url = normalizeServerUrl(raw)
      const profile: SavedServer = {
        url, name: new URL(url).host, username: '', lastUsed: Date.now(),
        logoutPending: hasPendingLogout(url) || undefined,
      }
      if (remember) setServers(saveServer(profile))
      setActive({ profile, persisted: remember })
      setAuthError(null)
      setConnectionEpoch((value) => value + 1)
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : 'Endereço inválido.')
    }
  }, [])

  const selectServer = useCallback((profile: SavedServer) => {
    if (active?.profile.url === profile.url && authenticated) {
      const first = state.channels.find((channel) => channel.kind === 'text')
      setView(first ? { kind: 'channel', id: first.id } : { kind: 'home' })
      return
    }
    const next = { ...profile, lastUsed: Date.now(), logoutPending: hasPendingLogout(profile.url) || profile.logoutPending }
    setServers(saveServer(next))
    setActive({ profile: next, persisted: true })
    setConnectionEpoch((value) => value + 1)
  }, [active?.profile.url, authenticated, state.channels])

  const removeSaved = useCallback((url: string) => {
    setPendingLogout(url, true)
    void new AuthApi(url).logout().then((revoked) => {
      if (revoked) setPendingLogout(url, false)
    })
    const next = removeServer(url)
    setServers(next)
    if (active?.profile.url === url) {
      resetRoom()
      setActive(null)
    }
  }, [active?.profile.url, resetRoom])

  const authenticate = useCallback(async (mode: AuthMode, username: string, password: string, remember: boolean) => {
    const api = authApi.current
    if (!api) return
    attemptedUsername.current = username
    setAuthBusy(true)
    setAuthError(null)
    try {
      const session = await api.authenticate(mode, username, password, remember)
      connection.current?.authenticate(session.access_token)
      updateActiveProfile({ username, lastUsed: Date.now() })
    } catch (error) {
      setAuthBusy(false)
      if (error instanceof AuthApiError && error.retryAfterMs) {
        setAuthError(`${error.message} — tente novamente em ${Math.max(1, Math.ceil(error.retryAfterMs / 1000))}s`)
      } else {
        setAuthError(error instanceof Error ? error.message : 'Não foi possível autenticar.')
      }
    }
  }, [updateActiveProfile])

  const logout = useCallback(async () => {
    const profile = active?.profile
    if (!profile) return
    const revoked = await authApi.current?.logout()
    const next = markLogoutPending(profile, revoked !== true)
    setPendingLogout(profile.url, revoked !== true)
    if (active.persisted) setServers(saveServer(next))
    setActive({ ...active, profile: next })
    connection.current?.clearAccess()
    resetRoom()
    setConnectionEpoch((value) => value + 1)
  }, [active, resetRoom])

  const backToServers = useCallback(() => {
    resetRoom()
    setActive(null)
    setAuthInfo(null)
    setAuthError(null)
  }, [resetRoom])

  const sendMessage = useCallback((text: string) => {
    const current = viewRef.current
    if (current?.kind === 'channel') connection.current?.send({ t: 'chat.send', channel: current.id, text })
    if (current?.kind === 'direct') connection.current?.send({ t: 'dm.send', user_id: current.userId, text })
  }, [])

  const selectHome = useCallback(() => {
    setView({ kind: 'home' })
    setCallFocused(false)
  }, [])

  const selectChannel = useCallback((id: string) => {
    setView({ kind: 'channel', id })
    setCallFocused(false)
  }, [])

  const selectDirect = useCallback((userId: UserId) => {
    setView({ kind: 'direct', userId })
    setCallFocused(false)
    connection.current?.send({ t: 'dm.open', user_id: userId })
  }, [])

  const socialAction = useCallback((action: SocialAction, userId: UserId) => {
    const messages = {
      request: 'friend.request', accept: 'friend.accept', decline: 'friend.decline',
      cancel: 'friend.cancel', remove: 'friend.remove', block: 'user.block', unblock: 'user.unblock',
    } as const
    connection.current?.send({ t: messages[action], user_id: userId })
  }, [])

  const joinCall = useCallback(async (channelId: string) => {
    const started = await voice.current?.join(channelId)
    if (started) {
      setCall({ channel: channelId, muted: false, deafened: false })
      setCallFocused(true)
    }
  }, [])

  const handleJoinCall = useCallback(async (channelId: string) => {
    if (call?.channel === channelId) {
      setCallFocused(true)
      return
    }
    await joinCall(channelId)
  }, [call?.channel, joinCall])

  const startCall = useCallback((userId: UserId, username: string) => {
    setRinging({ userId, username, direction: 'outgoing' })
    connection.current?.send({ t: 'call.start', user_id: userId })
  }, [])
  const acceptCall = useCallback(() => setRinging((current) => {
    if (current) connection.current?.send({ t: 'call.accept', user_id: current.userId })
    return current
  }), [])
  const dismissCall = useCallback(() => setRinging((current) => {
    if (current) connection.current?.send(current.direction === 'incoming'
      ? { t: 'call.decline', user_id: current.userId }
      : { t: 'call.cancel', user_id: current.userId })
    return null
  }), [])
  /** `null` remove. O token vem do Connection para nao ter duas fontes. */
  const enviarAvatar = useCallback(
    async (file: File | null) => {
      const token = connection.current?.token
      const servidor = active?.profile.url
      if (!token || !servidor) throw new Error('sua sessão expirou, entre de novo')
      const base = avatarBaseFromWs(servidor)
      if (file) await uploadAvatar(base, token, file)
      else await removeAvatar(base, token)
    },
    [active?.profile.url],
  )

  const leaveCall = useCallback(() => { voice.current?.leave(); setCall(null); setCallFocused(false) }, [])
  const toggleMute = useCallback(() => setCall((current) => {
    if (!current) return current
    voice.current?.setMuted(!current.muted)
    return { ...current, muted: !current.muted }
  }), [])
  const toggleDeafen = useCallback(() => setCall((current) => {
    if (!current) return current
    voice.current?.setDeafened(!current.deafened)
    return { ...current, deafened: !current.deafened }
  }), [])

  const resolveUserId = useCallback((peerId: PeerId): UserId | undefined => {
    if (peerId === state.selfPeerId) return state.selfUserId ?? undefined
    const peer = state.voicePeers.find((p) => p.peer_id === peerId)
    if (peer) return peer.user_id
    const user = state.users.find((u) => u.username === peerId)
    if (user) return user.user_id
    const dir = state.directory.find((d) => d.username === peerId)
    return dir?.user_id
  }, [state.selfPeerId, state.selfUserId, state.voicePeers, state.users, state.directory])

  if (!active || !authenticated) {
    return <Connect serverUrl={active?.profile.url ?? null} serverProfile={active?.profile ?? null}
      savedServers={servers} authInfo={authInfo} status={status} busy={authBusy} error={authError}
      onChooseServer={chooseServer} onSelectServer={selectServer} onRemoveServer={removeSaved}
      onAuthenticate={authenticate} onBack={backToServers} />
  }

  const channel = view?.kind === 'channel' ? state.channels.find((item) => item.id === view.id) ?? null : null
  const socialMember = view?.kind === 'direct' ? state.socialMembers.find((item) => item.user_id === view.userId) : null
  const conversation = view?.kind === 'direct'
    ? state.conversations[view.userId] ?? socialMember ?? state.directory.find((item) => item.user_id === view.userId) ?? null
    : null
  const canDirect = status === 'online' && Boolean(socialMember?.can_start_dm)
  const callChannel = call ? state.channels.find((item) => item.id === call.channel) : undefined
  const callName = call ? callChannel?.name ?? directChannelPartner(state, call.channel) ?? call.channel : ''
  const self = state.users.find((user) => user.user_id === state.selfUserId)
  const onlineIds = new Set(state.users.map((user) => user.user_id))
  const railServers = servers.some((server) => server.url === active.profile.url) ? servers : [active.profile, ...servers]
  const sidebarMode = sidebarModeFor(view)
  const showMembers = view?.kind === 'channel'
  const meuPerfil = profileOf(state, state.selfUserId ?? '', attemptedUsername.current)
  const avatarBase = avatarBaseFromWs(active.profile.url)
  const callPartnerId = call ? directChannelPartnerId(state, call.channel) : null
  const isCallView = Boolean(
    call &&
    ((view?.kind === 'direct' && view.userId === callPartnerId) ||
     (view?.kind === 'channel' && view.id === call.channel))
  )

  const sideChatComponent = channel ? (
    <Chat
      title={channel.name}
      kind="channel"
      messages={state.messages[channel.id] ?? []}
      canSend={status === 'online'}
      onSend={sendMessage}
    />
  ) : conversation ? (
    <Chat
      title={conversation.username}
      kind="direct"
      messages={state.directMessages[conversation.user_id] ?? []}
      canSend={canDirect}
      disabledReason={status === 'online' ? 'Você não pode enviar mensagens nesta conversa.' : undefined}
      onSend={sendMessage}
    />
  ) : null

  // Sem isto todo avatar cai no provisorio: e daqui que qualquer tela alcanca
  // o perfil de qualquer pessoa sem receber o estado por prop.
  return (
    <ProfileProvider profiles={state.profiles} avatarBase={avatarBase}>
    <div className={`app ${showMembers ? 'app--members' : ''}`}>
      <ServerRail servers={railServers} activeUrl={active.profile.url} homeActive={sidebarMode === 'home'}
        onHome={selectHome} onSelect={selectServer} onAdd={backToServers} />
      <Sidebar state={state} status={status} view={view} mode={sidebarMode}
        onSelectHome={selectHome}
        onSelectChannel={selectChannel} onSelectDirect={selectDirect}
        callChannel={call?.channel ?? null} onJoinCall={handleJoinCall} speaking={speaking}
        footer={<div className="sidebar__footer-stack">
          {call && <VoiceBar channelName={callName} muted={call.muted} deafened={call.deafened}
            onToggleMute={toggleMute} onToggleDeafen={toggleDeafen} onLeave={leaveCall}
            onOpen={() => {
              if (callPartnerId) selectDirect(callPartnerId)
              else if (call?.channel) selectChannel(call.channel)
              setCallFocused(true)
            }} />}
          <AccountBar onOpenProfile={() => setEditingProfile(true)} userId={state.selfUserId} username={self?.username ?? attemptedUsername.current} onLogout={logout}
            onRemoveServer={() => removeSaved(active.profile.url)} />
        </div>} />

      <main className="main">
        {notice && <div className="notice" role="status">{notice}</div>}
        {call && voice.current && ((callFocused && callMode === 'fullscreen') || (!isCallView && callFocused)) ? (
          <CallStage
            channelName={callName}
            snapshot={voiceSnapshot}
            transport={voice.current}
            onMinimize={() => setCallFocused(false)}
            onLeave={leaveCall}
            onOpenSettings={() => setVoiceSettingsOpen(true)}
            chatPanel={sideChatComponent}
            resolveUserId={resolveUserId}
            selfUserId={state.selfUserId}
            variant="fullscreen"
            onToggleVariant={isCallView ? () => { setCallMode('embedded'); setCallFocused(false) } : undefined}
          />
        ) : (
          <>
            {/* Chamada Embutida no Topo do Chat (Split View) */}
            {call && voice.current && isCallView && (
              <CallStage
                channelName={callName}
                snapshot={voiceSnapshot}
                transport={voice.current}
                onMinimize={() => setCallFocused(false)}
                onLeave={leaveCall}
                onOpenSettings={() => setVoiceSettingsOpen(true)}
                resolveUserId={resolveUserId}
                selfUserId={state.selfUserId}
                variant="embedded"
                onToggleVariant={() => { setCallMode('fullscreen'); setCallFocused(true) }}
              />
            )}

            {view?.kind === 'home' ? (
              <FriendsHome members={state.socialMembers} onlineIds={onlineIds}
                onOpenDirect={selectDirect} onAction={socialAction} />
            ) : channel ? (
              <Chat title={channel.name} kind="channel" messages={state.messages[channel.id] ?? []}
                canSend={status === 'online'} onSend={sendMessage} />
            ) : conversation ? (
              <Chat title={conversation.username} kind="direct"
                messages={state.directMessages[conversation.user_id] ?? []} canSend={canDirect}
                disabledReason={status === 'online' ? 'Você não pode enviar mensagens nesta conversa.' : undefined}
                onSend={sendMessage} onCall={canDirect ? () => startCall(conversation.user_id, conversation.username) : undefined} />
            ) : (
              <div className="placeholder"><img src={stappLogo} alt="" className="placeholder__logo" />
                <strong>Escolha onde quer conversar</strong><span>Um canal, uma conversa ou a área de amigos.</span></div>
            )}
          </>
        )}
      </main>

      {/* Mini-player flutuante estilo Discord */}
      {call && !callFocused && !isCallView && voice.current && (
        <CallMiniPip
          channelName={callName}
          snapshot={voiceSnapshot}
          transport={voice.current}
          onExpand={() => {
            if (callPartnerId) selectDirect(callPartnerId)
            else if (call?.channel) selectChannel(call.channel)
            setCallFocused(true)
          }}
          onLeave={leaveCall}
          resolveUserId={resolveUserId}
          selfUserId={state.selfUserId}
        />
      )}

      {showMembers && <MembersPanel members={state.socialMembers} onlineIds={onlineIds}
        onMessage={selectDirect} onAction={socialAction} />}
      <ProfileEditor isOpen={editingProfile} profile={meuPerfil} avatarBase={avatarBase}
        onClose={() => setEditingProfile(false)}
        onSave={(mudanca) => connection.current?.send({ t: 'profile.update', ...mudanca })}
        onAvatar={enviarAvatar} />

      {ringing && <CallPanel userId={ringing.userId} username={ringing.username} direction={ringing.direction}
        onAccept={acceptCall} onDecline={dismissCall} />}
      {voice.current && (
        <VoiceSettings
          open={voiceSettingsOpen}
          transport={voice.current}
          snapshot={voiceSnapshot}
          onClose={() => setVoiceSettingsOpen(false)}
          onPreferencesChange={setVoicePreferences}
        />
      )}
    </div>
    </ProfileProvider>
  )
}
