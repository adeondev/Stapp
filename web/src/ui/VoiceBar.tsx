import { IconLeave, IconSignal } from './Icons'
import './voicebar.css'

interface Props {
  channelName: string
  onLeave(): void
  onOpen(): void
}

/* Microfone e fone saíram daqui de propósito: eles vivem no painel de conta,
   logo abaixo, e continuam no mesmo lugar da tela esteja você em call ou não.
   Ter os mesmos dois botões em duas barras vizinhas era o que fazia o rodapé
   parecer duplicado. */
export function VoiceBar({ channelName, onLeave, onOpen }: Props) {
  return (
    <div className="voicebar">
      <button className="voicebar__where" type="button" onClick={onOpen} title="Abrir chamada">
        <span className="voicebar__label">
          <IconSignal size={14} className="voicebar__signal" />
          Voz conectada
        </span>
        <span className="voicebar__channel">{channelName}</span>
      </button>

      <button className="voicebar__btn" type="button" onClick={onLeave}
        title="Desconectar" aria-label="Desconectar da voz">
        <IconLeave size={18} />
      </button>
    </div>
  )
}
