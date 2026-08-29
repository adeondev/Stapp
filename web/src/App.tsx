import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { Connection, type ConnectionStatus } from './net/connection'
import type { PeerId } from './protocol'
import { initialState, reduce } from './store'
import { Chat } from './ui/Chat'
import { Connect, type Session } from './ui/Connect'
import { Sidebar } from './ui/Sidebar'
import { VoiceBar } from './ui/VoiceBar'
import { createVoiceTransport, type VoiceTransport } from './voice/VoiceTransport'
import './ui/app.css'

export default function App() {
  const [session, setSession] = useState<Session | null>(null)

  if (!session) return <Connect onConnect={setSession} />
  // A key remonta tudo quando o servidor ou o apelido mudam.
  return <Room key={`${session.url}|${session.nick}`} session={session} />
}

interface CallState {
  channel: string
  muted: boolean
  deafened: boolean
}

function Room({ session }: { session: Session }) {
  const [state, dispatch] = useReducer(reduce, initialState)
  const [status, setStatus] = useState<ConnectionStatus>('connecting')
  const [notice, setNotice] = useState<string | null>(null)
  const [speaking, setSpeaking] = useState<ReadonlySet<PeerId>>(() => new Set())
  const [activeChannel, setActiveChannel] = useState<string | null>(null)
  const [call, setCall] = useState<CallState | null>(null)

  const connection = useRef<Connection | null>(null)
  const voice = useRef<VoiceTransport | null>(null)

  useEffect(() => {
    const conn = new Connection(session.url, session.nick, {
      onMessage(msg) {
        if (msg.t === 'welcome') {
          // Tambem cai aqui depois de reconectar: os pares antigos morreram
          // junto com o socket, entao o transporte comeca do zero.
          voice.current?.destroy()
          setCall(null)
          setSpeaking(new Set())

          voice.current = createVoiceTransport(msg.voice, {
            selfId: msg.self_id,
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
            (current) => current ?? msg.channels.find((c) => c.kind === 'text')?.id ?? null,
          )
        }

        if (msg.t === 'error') setNotice(msg.message)

        dispatch(msg)
        voice.current?.handleServerMessage(msg)
      },
      onStatus(next, detail) {
        setStatus(next)
        if (next === 'reconnecting' && detail) setNotice(`conexao caiu — ${detail}`)
      },
    })

    connection.current = conn
    return () => {
      voice.current?.destroy()
      voice.current = null
      conn.close()
      connection.current = null
    }
  }, [session.url, session.nick])

  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(null), 6000)
    return () => clearTimeout(timer)
  }, [notice])

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

  const channel = state.channels.find((c) => c.id === activeChannel) ?? null
  const callChannel = call ? state.channels.find((c) => c.id === call.channel) : undefined

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
          call && (
            <VoiceBar
              channelName={callChannel?.name ?? call.channel}
              muted={call.muted}
              deafened={call.deafened}
              onToggleMute={toggleMute}
              onToggleDeafen={toggleDeafen}
              onLeave={leaveCall}
            />
          )
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
          <div className="placeholder">conectando em {session.url}</div>
        )}
      </main>
    </div>
  )
}
