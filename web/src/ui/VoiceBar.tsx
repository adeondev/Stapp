import {
  IconHeadphones,
  IconHeadphonesOff,
  IconLeave,
  IconMic,
  IconMicOff,
} from './Icons'
import './voicebar.css'

interface Props {
  channelName: string
  muted: boolean
  deafened: boolean
  onToggleMute(): void
  onToggleDeafen(): void
  onLeave(): void
}

export function VoiceBar({
  channelName,
  muted,
  deafened,
  onToggleMute,
  onToggleDeafen,
  onLeave,
}: Props) {
  // Ensurdecer tambem corta o microfone, entao o botao de mudo reflete os dois.
  const micOff = muted || deafened

  return (
    <div className="voicebar">
      <div className="voicebar__where">
        <span className="voicebar__label">na call</span>
        <span className="voicebar__channel">{channelName}</span>
      </div>

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
          title="sair da call"
          aria-label="sair da call"
        >
          <IconLeave />
        </button>
      </div>
    </div>
  )
}
