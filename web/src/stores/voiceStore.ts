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
  voiceSnapshot: VoiceSnapshot
  voiceConfig: VoiceConfig | null
  voicePeers: VoicePeer[]
  speakingPeers: ReadonlySet<PeerId>

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
  voiceSnapshot: emptySnapshot(),
  voiceConfig: null,
  voicePeers: [],
  speakingPeers: new Set<PeerId>() as ReadonlySet<PeerId>,
}

export const useVoiceStore = create<VoiceState>((set, get) => ({
  ...initialVoiceState,

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
    set((state) => ({
      call: typeof callOrUpdater === 'function' ? callOrUpdater(state.call) : callOrUpdater,
    }))
  },

  setVoiceSnapshot: (voiceSnapshot) => set({ voiceSnapshot }),
  setVoiceConfig: (voiceConfig) => set({ voiceConfig }),
  setVoicePeers: (voicePeers) => set({ voicePeers }),

  handleVoiceMessage: (msg: ServerMsg) => {
    switch (msg.t) {
      case 'welcome':
        set({
          voiceConfig: msg.voice,
          voicePeers: msg.voice_peers,
          speakingPeers: new Set(),
        })
        break

      case 'user.offline':
        set((state) => ({
          voicePeers: state.voicePeers.filter((peer) => peer.user_id !== msg.user_id),
        }))
        break

      case 'voice.roster': {
        const presence = usePresenceStore.getState()
        const me = presence.users.find((user) => user.user_id === presence.selfUserId)
        const self: VoicePeer[] =
          me && presence.selfPeerId
            ? [
                {
                  peer_id: presence.selfPeerId,
                  user_id: me.user_id,
                  username: me.username,
                  channel: msg.channel,
                  muted: false,
                  deafened: false,
                  camera_enabled: false,
                  screen_sharing: false,
                },
              ]
            : []
        const others = get().voicePeers.filter(
          (peer) => peer.channel !== msg.channel && peer.peer_id !== presence.selfPeerId,
        )
        set({ voicePeers: [...others, ...msg.peers, ...self] })
        break
      }

      case 'voice.joined':
        set((state) => ({
          voicePeers: [
            ...state.voicePeers.filter((peer) => peer.peer_id !== msg.peer.peer_id),
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

  resetVoice: () => set(initialVoiceState),
}))
