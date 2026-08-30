import {
  IconHeadphones,
  IconHeadphonesOff,
  IconLeave,
  IconMic,
  IconMicOff,
  IconSignal,
} from './Icons'
import './voicebar.css'

interface Props {
  channelName: string
  muted: boolean
  deafened: boolean
  onToggleMute(): void
  onToggleDeafen(): void
  onLeave(): void
  onOpen(): void
}

export function VoiceBar({
  channelName,
  muted,
  deafened,
  onToggleMute,
  onToggleDeafen,
  onLeave,
  onOpen,
}: Props) {
  // Ensurdecer tambem corta o microfone, entao o botao de mudo reflete os dois.
  const micOff = muted || deafened

  return (
    <div className="voicebar">
      <button className="voicebar__where" onClick={onOpen} title="abrir chamada">
        <span className="voicebar__label">
          <IconSignal size={12} className="voicebar__signal" />
          Voz Conectada
        </span>
        <span className="voicebar__channel">{channelName}</span>
      </button>

      <div className="voicebar__actions">
        <button
          className={`voicebar__btn ${micOff ? 'is-off' : ''}`}
          onClick={onToggleMute}
          disabled={deafened}
          title={micOff ? 'ligar microfone' : 'desligar microfone'}
          aria-label={micOff ? 'ligar microfone' : 'desligar microfone'}
        >
          {micOff ? <IconMicOff /> : <IconMic />}
        </button>

        <button
          className={`voicebar__btn ${deafened ? 'is-off' : ''}`}
          onClick={onToggleDeafen}
          title={deafened ? 'voltar a ouvir' : 'nao ouvir ninguem'}
          aria-label={deafened ? 'voltar a ouvir' : 'nao ouvir ninguem'}
        >
          {deafened ? <IconHeadphonesOff /> : <IconHeadphones />}
        </button>

        <button
          className="voicebar__btn voicebar__btn--leave"
          onClick={onLeave}
          title="desconectar"
          aria-label="desconectar"
        >
          <IconLeave />
        </button>
      </div>
    </div>
  )
}
