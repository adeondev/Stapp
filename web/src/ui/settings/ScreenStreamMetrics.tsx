import { useEffect, useRef, useState } from 'react'
import type { DiagnosticReport, VoiceSnapshot, VoiceTransport } from '../../voice/VoiceTransport'
import { SettingsGroup } from './primitives'
import './screenStreamMetrics.css'

/**
 * Onde o quadro gasta o tempo dele, ao vivo.
 *
 * PROTOTYPE: este painel existe para a auditoria de performance da transmissao
 * e mostra numero cru, sem suavizar nada — e o instrumento, nao a vitrine. O
 * invariante e que ler nao pode custar quadro: o laco de captura publica um
 * retrato por segundo por conta propria e aqui so se le o ultimo que chegou;
 * nada aqui pede medicao sob demanda.
 * FUTURE: quando o pipeline virar WGC + encoder por hardware, as linhas mudam
 * de nome (a de JPEG vira a do encoder), mas a leitura continua a mesma.
 */

/** Etapas do laco nativo, na ordem em que o quadro passa por elas. */
const ETAPAS_NATIVAS = [
  { chave: 'screenCaptureMs', rotulo: 'Capturar a tela' },
  { chave: 'screenCursorMs', rotulo: 'Desenhar o cursor' },
  { chave: 'screenResizeMs', rotulo: 'Redimensionar' },
  { chave: 'screenEncodeMs', rotulo: 'Comprimir (JPEG)' },
  { chave: 'screenDispatchMs', rotulo: 'Enviar pelo IPC' },
] as const satisfies readonly { chave: keyof DiagnosticReport; rotulo: string }[]

/** O que acontece depois do IPC, ja dentro do WebView. */
const ETAPAS_INGESTAO = [
  { chave: 'screenIngestDecodeMs', rotulo: 'Decodificar (JPEG)' },
  { chave: 'screenIngestDrawMs', rotulo: 'Desenhar no canvas' },
] as const satisfies readonly { chave: keyof DiagnosticReport; rotulo: string }[]

export interface ScreenStreamMetricsProps {
  transport: VoiceTransport
  snapshot: VoiceSnapshot
}

export function ScreenStreamMetrics({ transport, snapshot }: ScreenStreamMetricsProps) {
  const [report, setReport] = useState<DiagnosticReport | null>(null)
  const lendo = useRef(false)
  const transmitindo = snapshot.screenSharing

  /* Uma leitura por segundo, e so enquanto a transmissao existe. O `lendo`
     evita empilhar chamadas quando o relatorio demora mais que o intervalo —
     sem ele, uma coleta lenta viraria uma fila que nunca esvazia. */
  useEffect(() => {
    if (!transmitindo) {
      setReport(null)
      return
    }
    let vivo = true
    const ler = () => {
      if (lendo.current) return
      lendo.current = true
      void transport.diagnosticReport()
        .then((proximo) => { if (vivo) setReport(proximo) })
        .catch(() => undefined)
        .finally(() => { lendo.current = false })
    }
    ler()
    const timer = window.setInterval(ler, 1_000)
    return () => {
      vivo = false
      window.clearInterval(timer)
    }
  }, [transport, transmitindo])

  if (!transmitindo) {
    return (
      <SettingsGroup title="Transmissão de tela"
        description="Comece a transmitir para ver quanto tempo cada etapa custa por quadro.">
        {null}
      </SettingsGroup>
    )
  }

  const alvo = report?.screenCaptureTargetFps ?? 0
  const orcamento = alvo > 0 ? 1_000 / alvo : 0
  const quadroMs = report?.screenFrameMs ?? 0
  const estourou = orcamento > 0 && quadroMs > orcamento

  return (
    <SettingsGroup title="Transmissão de tela"
      description={orcamento > 0
        ? `Orçamento de ${orcamento.toFixed(1)} ms por quadro para ${alvo} FPS.`
        : 'Aguardando a primeira janela de medição…'}>
      <div className="streammetrics">
        <div className="streammetrics__topo">
          <Destaque rotulo="FPS produzido" valor={report?.screenCaptureFps} alvo={alvo} />
          <Destaque rotulo="FPS desenhado" valor={report?.screenIngestDrawnFps} alvo={alvo} />
          <Destaque rotulo="Quadros perdidos" valor={report?.screenIngestDroppedFrames} tom="perda" />
        </div>

        <p className="streammetrics__titulo">No aplicativo</p>
        {ETAPAS_NATIVAS.map((etapa) => (
          <Linha key={etapa.chave} rotulo={etapa.rotulo}
            ms={numero(report?.[etapa.chave])} orcamento={orcamento} />
        ))}
        <Linha rotulo="Total por quadro" ms={quadroMs} orcamento={orcamento} forte estourou={estourou} />
        <Linha rotulo="Ocioso (sobra do orçamento)" ms={numero(report?.screenIdleMs)}
          orcamento={orcamento} discreto />

        <p className="streammetrics__titulo">No WebView</p>
        {ETAPAS_INGESTAO.map((etapa) => (
          <Linha key={etapa.chave} rotulo={etapa.rotulo}
            ms={numero(report?.[etapa.chave])} orcamento={orcamento} />
        ))}

        <dl className="streammetrics__rodape">
          <Rodape rotulo="Resolução" valor={report?.screenCaptureResolution ?? '—'} />
          <Rodape rotulo="IPC" valor={report?.screenCaptureKbps ? `${report.screenCaptureKbps} kbps` : '—'} />
          <Rodape rotulo="Recebidos/s" valor={formata(report?.screenIngestReceivedFps)} />
          <Rodape rotulo="Descartados/s" valor={formata(report?.screenIngestDroppedFps)} />
          <Rodape rotulo="Falhas de captura" valor={formata(report?.screenCaptureFailures)} />
          <Rodape rotulo="Codec de saída" valor={report?.codec ?? '—'} />
        </dl>
      </div>
    </SettingsGroup>
  )
}

/** Numero grande. Fica em `--warning` quando fica abaixo de 90% do alvo. */
function Destaque({ rotulo, valor, alvo, tom }: {
  rotulo: string
  valor: number | undefined
  alvo?: number
  tom?: 'perda'
}) {
  const abaixo = tom !== 'perda' && alvo !== undefined && alvo > 0
    && valor !== undefined && valor < alvo * 0.9
  const perdendo = tom === 'perda' && (valor ?? 0) > 0
  const classe = ['streammetrics__valor',
    abaixo ? 'is-abaixo' : '', perdendo ? 'is-perda' : ''].filter(Boolean).join(' ')
  return (
    <div className="streammetrics__destaque">
      <span className={classe}>{formata(valor)}</span>
      <span className="streammetrics__rotulo">{rotulo}</span>
    </div>
  )
}

/** Uma etapa: rotulo, barra proporcional ao orcamento do quadro, e o valor. */
function Linha({ rotulo, ms, orcamento, forte, discreto, estourou }: {
  rotulo: string
  ms: number
  orcamento: number
  forte?: boolean
  discreto?: boolean
  estourou?: boolean
}) {
  const proporcao = orcamento > 0 ? Math.min(100, (ms / orcamento) * 100) : 0
  const classe = ['streammetrics__linha',
    forte ? 'is-forte' : '', discreto ? 'is-discreto' : '',
    estourou ? 'is-estourado' : ''].filter(Boolean).join(' ')
  return (
    <div className={classe}>
      <span className="streammetrics__linha-rotulo">{rotulo}</span>
      <span className="streammetrics__barra"><span style={{ width: `${proporcao}%` }} /></span>
      <span className="streammetrics__linha-valor">{ms.toFixed(2)} ms</span>
    </div>
  )
}

function Rodape({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="streammetrics__rodape-item">
      <dt>{rotulo}</dt>
      <dd>{valor}</dd>
    </div>
  )
}

function numero(valor: DiagnosticReport[keyof DiagnosticReport]) {
  return typeof valor === 'number' ? valor : 0
}

function formata(valor: number | undefined) {
  return valor === undefined ? '—' : String(valor)
}
