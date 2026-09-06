import { create } from 'zustand'
import type { PeerId, ServerMsg, VoiceConfig, VoicePeer } from '../protocol'
import { emptySnapshot, type VoiceSnapshot } from '../voice/VoiceTransport'
import { usePresenceStore } from './presenceStore'

export interface CallState {
  channel: string
  muted: boolean
  deafened: boolean
}

export interface VoiceState {
  call: CallState | null
  muted: boolean
  deafened: boolean
  voiceSnapshot: VoiceSnapshot
  voiceConfig: VoiceConfig | null
  voicePeers: VoicePeer[]
  speakingPeers: ReadonlySet<PeerId>

  toggleMute: () => void
  toggleDeafen: () => void
  setMuted: (muted: boolean) => void
  setDeafened: (deafened: boolean) => void
  setSpeaking: (peerId: PeerId, isSpeaking: boolean) => void
  setCall: (callOrUpdater: CallState | null | ((prev: CallState | null) => CallState | null)) => void
  setVoiceSnapshot: (snapshot: VoiceSnapshot) => void
  setVoiceConfig: (config: VoiceConfig | null) => void
  setVoicePeers: (peers: VoicePeer[]) => void
  handleVoiceMessage: (msg: ServerMsg) => void
  resetVoice: () => void
}

const initialVoiceState = {
  call: null,
  muted: false,
  deafened: false,
  voiceSnapshot: emptySnapshot(),
  voiceConfig: null,
  voicePeers: [],
  speakingPeers: new Set<PeerId>() as ReadonlySet<PeerId>,
}

export const useVoiceStore = create<VoiceState>((set, get) => ({
  ...initialVoiceState,

  toggleMute: () => {
    set((state) => {
      const nextMuted = !state.muted
      // Desmutar enquanto ensurdecido tambem desfaz o ensurdecimento
      const nextDeafened = nextMuted ? state.deafened : false
      return {
        muted: nextMuted,
        deafened: nextDeafened,
        call: state.call ? { ...state.call, muted: nextMuted, deafened: nextDeafened } : null,
      }
    })
  },

  toggleDeafen: () => {
    set((state) => {
      const nextDeafened = !state.deafened
      // Invariante: ensurdecer forca mutar o microfone automaticamente
      const nextMuted = nextDeafened ? true : state.muted
      return {
        deafened: nextDeafened,
        muted: nextMuted,
        call: state.call ? { ...state.call, deafened: nextDeafened, muted: nextMuted } : null,
      }
    })
  },

  setMuted: (muted) => {
    set((state) => {
      const nextDeafened = muted ? state.deafened : false
      return {
        muted,
        deafened: nextDeafened,
        call: state.call ? { ...state.call, muted, deafened: nextDeafened } : null,
      }
    })
  },

  setDeafened: (deafened) => {
    set((state) => {
      const nextMuted = deafened ? true : state.muted
      return {
        deafened,
        muted: nextMuted,
        call: state.call ? { ...state.call, deafened, muted: nextMuted } : null,
      }
    })
  },

  setSpeaking: (peerId, isSpeaking) => {
    const current = get().speakingPeers
    if (current.has(peerId) === isSpeaking) return
    const next = new Set(current)
    if (isSpeaking) {
      next.add(peerId)
    } else {
      next.delete(peerId)
    }
    set({ speakingPeers: next })
  },

  setCall: (callOrUpdater) => {
    set((state) => {
      const nextCall = typeof callOrUpdater === 'function' ? callOrUpdater(state.call) : callOrUpdater
      return {
        call: nextCall,
        muted: nextCall ? nextCall.muted : state.muted,
        deafened: nextCall ? nextCall.deafened : state.deafened,
      }
    })
  },

  setVoiceSnapshot: (voiceSnapshot) => set({ voiceSnapshot }),
  setVoiceConfig: (voiceConfig) => set({ voiceConfig }),
  setVoicePeers: (voicePeers) => set({ voicePeers }),

  handleVoiceMessage: (msg: ServerMsg) => {
    switch (msg.t) {
      case 'welcome': {
        const peersByUserId = new Map<string, VoicePeer>()
        for (const peer of msg.voice_peers) {
          peersByUserId.set(peer.user_id, peer)
        }
        set({
          voiceConfig: msg.voice,
          voicePeers: Array.from(peersByUserId.values()),
          speakingPeers: new Set(),
        })
        break
      }

      case 'user.offline':
        set((state) => ({
          voicePeers: state.voicePeers.filter((peer) => peer.user_id !== msg.user_id),
        }))
        break

      case 'voice.roster': {
        const presence = usePresenceStore.getState()
        const rosterUserIds = new Set(msg.peers.map((p) => p.user_id))
        const others = get().voicePeers.filter(
          (peer) => peer.channel !== msg.channel && !rosterUserIds.has(peer.user_id),
        )
        const peersByUserId = new Map<string, VoicePeer>()
        for (const peer of others) {
          peersByUserId.set(peer.user_id, peer)
        }
        for (const peer of msg.peers) {
          peersByUserId.set(peer.user_id, peer)
        }
        if (
          get().callChannel === msg.channel &&
          presence.selfUserId &&
          presence.selfPeerId &&
          !peersByUserId.has(presence.selfUserId)
        ) {
          const me = presence.users.find((user) => user.user_id === presence.selfUserId)
          if (me) {
            peersByUserId.set(me.user_id, {
              peer_id: presence.selfPeerId,
              user_id: me.user_id,
              username: me.username,
              channel: msg.channel,
              muted: get().muted,
              deafened: get().deafened,
              camera_enabled: false,
              screen_sharing: false,
            })
          }
        }
        set({ voicePeers: Array.from(peersByUserId.values()) })
        break
      }

      case 'voice.joined':
        set((state) => ({
          voicePeers: [
            ...state.voicePeers.filter((peer) => peer.user_id !== msg.peer.user_id),
            msg.peer,
          ],
        }))
        break

      case 'voice.left':
        set((state) => ({
          voicePeers: state.voicePeers.filter((peer) => peer.peer_id !== msg.peer_id),
        }))
        break

      case 'voice.state':
        set((state) => ({
          voicePeers: state.voicePeers.map((peer) =>
            peer.peer_id === msg.peer_id
              ? { ...peer, muted: msg.muted, deafened: msg.deafened }
              : peer,
          ),
        }))
        break

      default:
        break
    }
  },

  resetVoice: () =>
    set((state) => ({
      ...initialVoiceState,
      muted: state.muted,
      deafened: state.deafened,
    })),
}))
