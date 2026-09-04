import type { ServerMsg } from '../protocol'
import { usePresenceStore } from './presenceStore'
import { useVoiceStore } from './voiceStore'
import { useChatStore } from './chatStore'

export { usePresenceStore, type PresenceState } from './presenceStore'
export { useVoiceStore, type VoiceState, type CallState } from './voiceStore'
export { useChatStore, type ChatState } from './chatStore'

export function dispatchServerMessage(msg: ServerMsg | { t: 'app.reset' }): void {
  if (msg.t === 'app.reset') {
    usePresenceStore.getState().resetPresence()
    useVoiceStore.getState().resetVoice()
    useChatStore.getState().resetChat()
    return
  }

  usePresenceStore.getState().handlePresenceMessage(msg)
  useVoiceStore.getState().handleVoiceMessage(msg)
  useChatStore.getState().handleChatMessage(msg)
}

export function resetAllStores(): void {
  usePresenceStore.getState().resetPresence()
  useVoiceStore.getState().resetVoice()
  useChatStore.getState().resetChat()
}
