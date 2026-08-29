import type { ClientMsg, PeerId, ServerMsg, VoiceConfig } from '../protocol'
import { MeshTransport } from './MeshTransport'

/**
 * O contrato de audio. **A UI so conhece esta interface** — nenhum componente
 * importa RTCPeerConnection nem SDK de SFU. Trocar mesh por LiveKit amanha e
 * escrever um `LiveKitTransport` ao lado e adicionar um case na fabrica abaixo.
 *
 * O que NAO e responsabilidade daqui: saber quem esta na call. Esse roster vem
 * do servidor (`voice.roster` / `voice.joined` / `voice.left`) e vive no estado
 * do app, igual para qualquer backend.
 */
export interface VoiceTransport {
  /** `false` quando o audio nao pode comecar (microfone negado, etc). */
  join(channel: string): Promise<boolean>
  leave(): void
  setMuted(muted: boolean): void
  setDeafened(deafened: boolean): void
  /** Eventos do servidor que interessam ao audio. Um SFU ignora quase todos. */
  handleServerMessage(msg: ServerMsg): void
  destroy(): void
}

export interface VoiceTransportOptions {
  selfId: PeerId
  send(msg: ClientMsg): void
  onSpeaking(peerId: PeerId, speaking: boolean): void
  onError(message: string): void
}

export function createVoiceTransport(
  config: VoiceConfig,
  options: VoiceTransportOptions,
): VoiceTransport {
  switch (config.backend) {
    case 'mesh':
      return new MeshTransport(config, options)
    default:
      throw new Error(
        'backend de voz desconhecido: ' + String((config as { backend: string }).backend),
      )
  }
}
