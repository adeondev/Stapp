import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { Connection, type ConnectionStatus } from './net/connection'
import type { AuthMode, PeerId } from './protocol'
import { initialState, reduce } from './store'
import { AccountBar } from './ui/AccountBar'
import { Chat } from './ui/Chat'
import { Connect, rememberUsername, type AuthInfo } from './ui/Connect'
import { Sidebar } from './ui/Sidebar'
import { VoiceBar } from './ui/VoiceBar'
import { createVoiceTransport, type VoiceTransport } from './voice/VoiceTransport'
import './ui/app.css'

interface CallState {
  channel: string
  muted: boolean
  deafened: boolean
}

export default function App() {
  const [serverUrl, setServerUrl] = useState<string | null>(null)
  const [authInfo, setAuthInfo] = useState<AuthInfo | null>(null)
  const [authError, setAuthError] = useState<string | null>(null)
  const [authBusy, setAuthBusy] = useState(false)
  const [authenticated, setAuthenticated] = useState(false)
  const attemptedUsername = useRef('')

  const [state, dispatch] = useReducer(reduce, initialState)
  const [status, setStatus] = useState<ConnectionStatus>('offline')
  const [notice, setNotice] = useState<string | null>(null)
  const [speaking, setSpeaking] = useState<ReadonlySet<PeerId>>(() => new Set())
  const [activeChannel, setActiveChannel] = useState<string | null>(null)
  const [call, setCall] = useState<CallState | null>(null)

  const connection = useRef<Connection | null>(null)
  const voice = useRef<VoiceTransport | null>(null)

  const resetRoom = useCallback(() => {
    voice.current?.destroy()
    voice.current = null
    dispatch({ t: 'app.reset' })
    setAuthenticated(false)
    setActiveChannel(null)
    setCall(null)
    setSpeaking(new Set())
    setNotice(null)
  }, [])

  useEffect(() => {
    if (!serverUrl) return
    setAuthInfo(null)
    setAuthError(null)
    setAuthBusy(false)
    setStatus('connecting')

    const conn = new Connection(serverUrl, {
      onMessage(msg) {
        if (msg.t === 'auth.required') {
          setAuthInfo({
            serverName: msg.server_name,
            registrationEnabled: msg.registration_enabled,
          })
          return
        }

        if (msg.t === 'auth.error') {
          resetRoom()
          setAuthBusy(false)
          setAuthError(
            msg.retry_after_ms
              ? `${msg.message} — tente novamente em ${Math.max(1, Math.ceil(msg.retry_after_ms / 1000))}s`
              : msg.message,
          )
          return
        }

        if (msg.t === 'welcome') {
          voice.current?.destroy()
          setCall(null)
          setSpeaking(new Set())
          setAuthBusy(false)
          setAuthError(null)
          setAuthenticated(true)
          if (attemptedUsername.current) {
            rememberUsername(serverUrl, attemptedUsername.current)
          }

          voice.current = createVoiceTransport(msg.voice, {
            selfPeerId: msg.self_peer_id,
            send: (out) => connection.current?.send(out),
            onSpeaking(peerId, isSpeaking) {
              setSpeaking((previous) => {
                if (previous.has(peerId) === isSpeaking) return previous
                const next = new Set(previous)
                if (isSpeaking) next.add(peerId)
                else next.delete(peerId)
                return next
              })
            },
            onError: setNotice,
          })

          setActiveChannel(
            (current) => current ?? msg.channels.find((channel) => channel.kind === 'text')?.id ?? null,
          )
        }

        if (msg.t === 'error') setNotice(msg.message)
        dispatch(msg)
        voice.current?.handleServerMessage(msg)
      },
      onStatus(next, detail) {
        setStatus(next)
        if (next === 'reconnecting' && detail) setNotice(`conexao caiu — ${detail}`)
        if (next === 'offline' && detail) setAuthError(detail)
      },
    })

    connection.current = conn
    return () => {
      voice.current?.destroy()
      voice.current = null
      conn.close()
      if (connection.current === conn) connection.current = null
    }
  }, [resetRoom, serverUrl])

  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(null), 6000)
    return () => clearTimeout(timer)
  }, [notice])

  const authenticate = useCallback((mode: AuthMode, username: string, password: string) => {
    attemptedUsername.current = username
    setAuthBusy(true)
    setAuthError(null)
    connection.current?.authenticate(mode, username, password)
  }, [])

  const leaveServer = useCallback(() => {
    connection.current?.clearCredentials()
    resetRoom()
    setAuthInfo(null)
    setAuthError(null)
    setAuthBusy(false)
    setServerUrl(null)
  }, [resetRoom])

  const sendMessage = useCallback(
    (text: string) => {
      if (!activeChannel) return
      connection.current?.send({ t: 'chat.send', channel: activeChannel, text })
    },
    [activeChannel],
  )

  const joinCall = useCallback(async (channelId: string) => {
    const started = await voice.current?.join(channelId)
    if (started) setCall({ channel: channelId, muted: false, deafened: false })
  }, [])

  const leaveCall = useCallback(() => {
    voice.current?.leave()
    setCall(null)
  }, [])

  const toggleMute = useCallback(() => {
    setCall((current) => {
      if (!current) return current
      voice.current?.setMuted(!current.muted)
      return { ...current, muted: !current.muted }
    })
  }, [])

  const toggleDeafen = useCallback(() => {
    setCall((current) => {
      if (!current) return current
      voice.current?.setDeafened(!current.deafened)
      return { ...current, deafened: !current.deafened }
    })
  }, [])

  if (!serverUrl || !authenticated) {
    return (
      <Connect
        serverUrl={serverUrl}
        authInfo={authInfo}
        status={status}
        busy={authBusy}
        error={authError}
        onChooseServer={setServerUrl}
        onAuthenticate={authenticate}
        onBack={leaveServer}
      />
    )
  }

  const channel = state.channels.find((item) => item.id === activeChannel) ?? null
  const callChannel = call ? state.channels.find((item) => item.id === call.channel) : undefined
  const self = state.users.find((user) => user.user_id === state.selfUserId)

  return (
    <div className="app">
      <Sidebar
        state={state}
        status={status}
        activeChannel={activeChannel}
        onSelectChannel={setActiveChannel}
        callChannel={call?.channel ?? null}
        onJoinCall={joinCall}
        speaking={speaking}
        footer={
          <div className="sidebar__footer-stack">
            {call && (
              <VoiceBar
                channelName={callChannel?.name ?? call.channel}
                muted={call.muted}
                deafened={call.deafened}
                onToggleMute={toggleMute}
                onToggleDeafen={toggleDeafen}
                onLeave={leaveCall}
              />
            )}
            <AccountBar username={self?.username ?? attemptedUsername.current} onLogout={leaveServer} />
          </div>
        }
      />

      <main className="main">
        {notice && <div className="notice">{notice}</div>}
        {channel ? (
          <Chat
            channel={channel}
            messages={state.messages[channel.id] ?? []}
            canSend={status === 'online'}
            onSend={sendMessage}
          />
        ) : (
          <div className="placeholder">conectando em {serverUrl}</div>
        )}
      </main>
    </div>
  )
}
