import { useCallback, useEffect, useRef, useState } from 'react'
import {
  IconError, IconExpand, IconMinimize, IconPause, IconPictureInPicture,
  IconPlay, IconReplay, IconSpeaker, IconSpeed, IconVolumeOff,
} from '../Icons'
import { IconButton } from '../IconButton'
import './videoPlayer.css'

/**
 * O player de video do Stapp.
 *
 * Antes o anexo de video era `<video controls>` cru: a barra era a do navegador,
 * diferente em cada sistema, e o container media `max-width: 440px` com
 * `max-height: 320px` **sem `aspect-ratio` nenhum**. Duas consequencias:
 *
 * - **video vertical ficava espremido** dentro de uma caixa pensada para 16:9;
 * - a lista de mensagens **dava salto**, porque ate o `loadedmetadata` chegar o
 *   elemento tem altura 0 e depois estica.
 *
 * Aqui a proporcao vem do metadado (`width`/`height` do anexo, agora preenchidos
 * no envio) e entra como `aspect-ratio` **antes** de baixar qualquer byte. Sem
 * metadado — anexos antigos — o player mede no `loadedmetadata` e aplica.
 *
 * O elemento continua sendo o `<video>` nativo: o que se constroi aqui e a
 * interface e o comportamento, nao um motor de midia. E **nao se faz `fetch`**
 * dos bytes: `/attachments/.../content` manda `cross-origin-resource-policy` mas
 * nao `access-control-allow-origin`, entao `fetch` falha onde `<video src>`
 * funciona. Isso ja derrubou o player de audio uma vez.
 */

const VELOCIDADES = [0.5, 0.75, 1, 1.25, 1.5, 2] as const

/* Os limites sao em PIXEL, e nunca em proporcao.
   Limitar a proporcao parecia razoavel e estava errado: com teto de 1.6 um
   video 9:16 — que e o formato de qualquer celular — saia como 1:1.6 e ganhava
   tarja preta. A proporcao e sagrada; o que se limita e o tamanho da caixa. */
const LARGURA_MAXIMA = 440
const ALTURA_MAXIMA = 420

const CHAVE_VOLUME = 'stapp:volume-video'

function carregarVolume(): number {
  try {
    const bruto = localStorage.getItem(CHAVE_VOLUME)
    const valor = bruto === null ? 1 : Number(bruto)
    return Number.isFinite(valor) ? Math.min(1, Math.max(0, valor)) : 1
  } catch {
    return 1
  }
}

function gravarVolume(valor: number) {
  try {
    localStorage.setItem(CHAVE_VOLUME, String(valor))
  } catch {
    // Armazenamento bloqueado: o volume vale so para esta sessao.
  }
}

function tempo(segundos: number): string {
  if (!Number.isFinite(segundos) || segundos < 0) return '0:00'
  const total = Math.floor(segundos)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const doisDigitos = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${doisDigitos(m)}:${doisDigitos(s)}` : `${m}:${doisDigitos(s)}`
}

export interface VideoPlayerProps {
  src: string
  filename: string
  /** Dimensoes conhecidas do anexo. Evitam o salto de layout. */
  width?: number
  height?: number
  /** Duracao conhecida, em ms. Mostrada antes de o arquivo carregar. */
  durationMs?: number
  poster?: string
}

export function VideoPlayer({ src, filename, width, height, durationMs, poster }: VideoPlayerProps) {
  const video = useRef<HTMLVideoElement>(null)
  const caixa = useRef<HTMLDivElement>(null)
  const ocultar = useRef<number>(0)

  const [tocando, setTocando] = useState(false)
  const [atual, setAtual] = useState(0)
  const [duracao, setDuracao] = useState(durationMs ? durationMs / 1000 : 0)
  const [volume, setVolume] = useState(carregarVolume)
  const [mudo, setMudo] = useState(false)
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [terminou, setTerminou] = useState(false)
  const [cheia, setCheia] = useState(false)
  const [controlesVisiveis, setControles] = useState(true)
  const [velocidade, setVelocidade] = useState(1)
  const [menuVelocidade, setMenuVelocidade] = useState(false)
  const [semAudio, setSemAudio] = useState(false)
  const [proporcao, setProporcao] = useState<number | null>(
    width && height ? width / height : null,
  )

  const volumeAnterior = useRef(volume)

  /* A caixa tem a proporcao EXATA da midia; o que a impede de invadir a conversa
     e um teto de largura e um de altura, ambos em pixel. Com a altura limitada,
     a largura de um video em pe sai da propria proporcao — e por isso um 9:16
     fica estreito e alto, sem tarja e sem esticar.
     `aspect-ratio` fica no container, e nao no `<video>`, porque e ele que
     precisa reservar o espaco antes de existir qualquer imagem. */
  const proporcaoUsada = proporcao ?? 16 / 9
  const larguraMaxima = Math.max(160, Math.min(LARGURA_MAXIMA, Math.round(ALTURA_MAXIMA * proporcaoUsada)))

  const alternar = useCallback(() => {
    const elemento = video.current
    if (!elemento || erro) return
    if (!elemento.paused) {
      elemento.pause()
      return
    }
    // Depois do fim, "reproduzir" quer dizer "de novo". Sem isto o navegador
    // as vezes retoma no ultimo quadro e parece que o botao nao fez nada.
    if (elemento.ended || (elemento.duration > 0 && elemento.currentTime >= elemento.duration)) {
      elemento.currentTime = 0
      setTerminou(false)
    }
    void elemento.play().catch(() => setErro('Não consegui reproduzir este vídeo.'))
  }, [erro])

  const buscar = (segundos: number) => {
    const elemento = video.current
    if (!elemento || !Number.isFinite(elemento.duration)) return
    elemento.currentTime = Math.min(Math.max(0, segundos), elemento.duration)
    setTerminou(false)
  }

  const aplicarVolume = (valor: number) => {
    const limitado = Math.min(1, Math.max(0, valor))
    setVolume(limitado)
    setMudo(limitado === 0)
    gravarVolume(limitado)
    if (video.current) {
      video.current.volume = limitado
      video.current.muted = limitado === 0
    }
  }

  const alternarMudo = () => {
    if (mudo || volume === 0) aplicarVolume(volumeAnterior.current || 1)
    else {
      volumeAnterior.current = volume
      aplicarVolume(0)
    }
  }

  const alternarTelaCheia = useCallback(() => {
    const alvo = caixa.current
    if (!alvo) return
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined)
    else void alvo.requestFullscreen?.().catch(() => undefined)
  }, [])

  useEffect(() => {
    const aoMudar = () => setCheia(document.fullscreenElement === caixa.current)
    document.addEventListener('fullscreenchange', aoMudar)
    return () => document.removeEventListener('fullscreenchange', aoMudar)
  }, [])

  // O volume guardado precisa alcancar o elemento assim que ele existe.
  useEffect(() => {
    const elemento = video.current
    if (!elemento) return
    elemento.volume = volume
    elemento.muted = volume === 0
    // Roda uma vez por montagem; depois quem manda e `aplicarVolume`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* Os controles somem enquanto o video toca e o ponteiro esta parado. Com o
     video pausado eles ficam: sumir num video parado nao esconde nada util e so
     obriga a mexer o mouse para achar o play. */
  const acordarControles = useCallback(() => {
    setControles(true)
    window.clearTimeout(ocultar.current)
    if (!tocando) return
    ocultar.current = window.setTimeout(() => setControles(false), 2200)
  }, [tocando])

  useEffect(() => {
    acordarControles()
    return () => window.clearTimeout(ocultar.current)
  }, [acordarControles])

  const atalhos = (event: React.KeyboardEvent) => {
    // Setas e espaco dentro do deslizante sao dele; interceptar aqui roubaria
    // a navegacao por teclado da propria barra de progresso.
    if ((event.target as HTMLElement).tagName === 'INPUT') return
    const elemento = video.current
    if (!elemento) return
    const teclas: Record<string, () => void> = {
      ' ': alternar,
      k: alternar,
      ArrowRight: () => buscar(elemento.currentTime + 5),
      ArrowLeft: () => buscar(elemento.currentTime - 5),
      ArrowUp: () => aplicarVolume(volume + 0.1),
      ArrowDown: () => aplicarVolume(volume - 0.1),
      m: alternarMudo,
      f: alternarTelaCheia,
    }
    const acao = teclas[event.key]
    if (!acao) return
    event.preventDefault()
    acordarControles()
    acao()
  }

  const podePip = typeof document !== 'undefined'
    && 'pictureInPictureEnabled' in document
    && (document as Document & { pictureInPictureEnabled?: boolean }).pictureInPictureEnabled === true

  const progresso = duracao > 0 ? (atual / duracao) * 100 : 0

  return (
    <div
      ref={caixa}
      className={`video-player ${cheia ? 'is-fullscreen' : ''} ${controlesVisiveis ? '' : 'is-idle'} ${erro ? 'is-error' : ''}`}
      style={{ aspectRatio: String(proporcaoUsada), maxWidth: cheia ? undefined : larguraMaxima }}
      onMouseMove={acordarControles}
      onMouseLeave={() => tocando && setControles(false)}
      onKeyDown={atalhos}
      tabIndex={0}
      role="group"
      aria-label={`Vídeo: ${filename}`}
    >
      <video
        ref={video}
        className="video-player__media"
        src={src}
        poster={poster}
        preload="metadata"
        playsInline
        onClick={alternar}
        onDoubleClick={alternarTelaCheia}
        onLoadedMetadata={(event) => {
          const elemento = event.currentTarget
          if (Number.isFinite(elemento.duration)) setDuracao(elemento.duration)
          // Anexos antigos nao trazem dimensao; aqui e o fallback.
          if (!proporcao && elemento.videoWidth && elemento.videoHeight) {
            setProporcao(elemento.videoWidth / elemento.videoHeight)
          }
          /* `mozHasAudio`/`webkitAudioDecodedByteCount` sao as unicas pistas de
             faixa de audio disponiveis; sem elas nao afirmamos nada. */
          const comPistas = elemento as HTMLVideoElement & {
            mozHasAudio?: boolean
            webkitAudioDecodedByteCount?: number
          }
          if (comPistas.mozHasAudio === false) setSemAudio(true)
        }}
        onTimeUpdate={(event) => setAtual(event.currentTarget.currentTime)}
        onDurationChange={(event) => {
          if (Number.isFinite(event.currentTarget.duration)) setDuracao(event.currentTarget.duration)
        }}
        onPlay={() => { setTocando(true); setTerminou(false) }}
        onPause={() => { setTocando(false); setControles(true) }}
        onWaiting={() => setCarregando(true)}
        onPlaying={() => setCarregando(false)}
        onCanPlay={() => setCarregando(false)}
        onEnded={() => { setTocando(false); setTerminou(true); setControles(true) }}
        onError={() => setErro('Não consegui carregar este vídeo. O arquivo pode ter sido removido ou o formato não é suportado.')}
      />

      {erro && (
        <div className="video-player__erro" role="alert">
          <IconError size={24} filled />
          <p>{erro}</p>
        </div>
      )}

      {!erro && carregando && <div className="video-player__buffer" role="status" aria-label="Carregando vídeo" />}

      {/* Play grande no centro: alvo obvio antes de comecar, e "de novo" no fim. */}
      {!erro && !tocando && (
        <button
          type="button"
          className="video-player__central"
          onClick={alternar}
          /* Alvo grande de mouse, nao um segundo controle: quem tem nome para o
             leitor de tela e o botao da barra. Dois "Reproduzir" na mesma
             regiao so fazem a pessoa escolher entre dois iguais. */
          aria-hidden="true"
          tabIndex={-1}
        >
          {terminou ? <IconReplay size={24} filled /> : <IconPlay size={24} filled />}
        </button>
      )}

      {!erro && (
        <div className="video-player__controles">
          <input
            className="video-player__seek"
            type="range"
            min={0}
            max={duracao || 0}
            step={0.1}
            value={Math.min(atual, duracao || 0)}
            style={{ ['--progresso' as string]: `${progresso}%` }}
            aria-label="Posição do vídeo"
            aria-valuetext={`${tempo(atual)} de ${tempo(duracao)}`}
            onChange={(event) => buscar(Number(event.target.value))}
          />

          <div className="video-player__linha">
            <IconButton
              size="sm"
              label={tocando ? 'Pausar' : terminou ? 'Assistir de novo' : 'Reproduzir'}
              icon={tocando
                ? <IconPause size={16} filled />
                : terminou ? <IconReplay size={16} filled /> : <IconPlay size={16} filled />}
              onClick={alternar}
            />

            <span className="video-player__volume">
              <IconButton
                size="sm"
                label={mudo || volume === 0 ? 'Ativar som' : 'Silenciar'}
                icon={mudo || volume === 0 ? <IconVolumeOff size={16} /> : <IconSpeaker size={16} />}
                onClick={alternarMudo}
              />
              <input
                className="video-player__volume-slider"
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={mudo ? 0 : volume}
                style={{ ['--progresso' as string]: `${(mudo ? 0 : volume) * 100}%` }}
                aria-label="Volume"
                onChange={(event) => aplicarVolume(Number(event.target.value))}
              />
            </span>

            <span className="video-player__tempo">
              {tempo(atual)} <span aria-hidden="true">/</span> {duracao > 0 ? tempo(duracao) : '--:--'}
            </span>

            {semAudio && <span className="video-player__marca">sem áudio</span>}

            <span className="video-player__espaco" />

            <span className="video-player__velocidade">
              <IconButton
                size="sm"
                label="Velocidade de reprodução"
                icon={<IconSpeed size={16} />}
                aria-expanded={menuVelocidade}
                aria-haspopup="menu"
                onClick={() => setMenuVelocidade((v) => !v)}
              />
              {velocidade !== 1 && <span className="video-player__marca">{velocidade}×</span>}
              {menuVelocidade && (
                <div className="video-player__menu" role="menu">
                  {VELOCIDADES.map((valor) => (
                    <button
                      key={valor}
                      type="button"
                      role="menuitemradio"
                      aria-checked={valor === velocidade}
                      className={valor === velocidade ? 'is-active' : ''}
                      onClick={() => {
                        setVelocidade(valor)
                        if (video.current) video.current.playbackRate = valor
                        setMenuVelocidade(false)
                      }}
                    >
                      {valor === 1 ? 'Normal' : `${valor}×`}
                    </button>
                  ))}
                </div>
              )}
            </span>

            {podePip && (
              <IconButton
                size="sm"
                label="Picture-in-picture"
                icon={<IconPictureInPicture size={16} />}
                onClick={() => {
                  const elemento = video.current as (HTMLVideoElement & {
                    requestPictureInPicture?(): Promise<unknown>
                  }) | null
                  void elemento?.requestPictureInPicture?.().catch(() => undefined)
                }}
              />
            )}

            <IconButton
              size="sm"
              label={cheia ? 'Sair da tela cheia' : 'Tela cheia'}
              icon={cheia ? <IconMinimize size={16} /> : <IconExpand size={16} />}
              onClick={alternarTelaCheia}
            />
          </div>
        </div>
      )}
    </div>
  )
}
