import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  IconChevronLeft, IconChevronRight, IconDownload, IconExternal,
  IconFitScreen, IconMinus, IconPlus, IconX, IconZoomIn,
} from '../Icons'
import { IconButton } from '../IconButton'
import './mediaViewer.css'

/**
 * O visualizador de imagem.
 *
 * O que existia era uma `<div>` que fechava no clique, com um `×` de texto no
 * canto e uma `<img>` limitada a `90vw`/`85vh`. Sem Escape, sem zoom, sem
 * arrastar, sem baixar, sem navegar entre as imagens da mesma mensagem, e sem
 * armadilha de foco.
 *
 * Duas decisoes de desempenho que valem para imagem grande:
 *
 * - **O zoom e o arrasto sao `transform`.** Nunca `width`/`height`: mexer em
 *   tamanho refaz o layout a cada quadro, e uma foto de 6000px trava a interface.
 *   Com `translate3d` + `scale` o trabalho fica na GPU.
 * - **O zoom por roda foca no cursor.** Ampliar sempre pelo centro obriga a
 *   arrastar de volta ate o ponto que se queria ver.
 */

export interface MediaViewerItem {
  id: string
  url: string
  filename: string
  /** Bytes, para a legenda. */
  size?: number
  width?: number
  height?: number
}

const ZOOM_MIN = 0.2
const ZOOM_MAX = 8

function tamanhoLegivel(bytes?: number): string | null {
  if (!bytes && bytes !== 0) return null
  if (bytes === 0) return '0 B'
  const unidades = ['B', 'KB', 'MB', 'GB']
  const indice = Math.min(unidades.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  return `${Number((bytes / 1024 ** indice).toFixed(1))} ${unidades[indice]}`
}

export function MediaViewer({ items, startIndex = 0, onClose }: {
  items: MediaViewerItem[]
  startIndex?: number
  onClose(): void
}) {
  const [indice, setIndice] = useState(startIndex)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [arrastando, setArrastando] = useState(false)
  const [carregada, setCarregada] = useState(false)
  const [erro, setErro] = useState(false)
  const palco = useRef<HTMLDivElement>(null)
  const inicio = useRef({ x: 0, y: 0, panX: 0, panY: 0 })
  const devolverFoco = useRef<HTMLElement | null>(null)

  const atual = items[indice]
  const podeNavegar = items.length > 1

  const reiniciar = useCallback(() => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }, [])

  // Trocar de imagem zera o enquadramento: manter o zoom da anterior deixa a
  // proxima entrando cortada, sem que ninguem tenha pedido isso.
  useEffect(() => {
    reiniciar()
    setCarregada(false)
    setErro(false)
  }, [indice, reiniciar])

  const irPara = useCallback((delta: number) => {
    if (!podeNavegar) return
    setIndice((atual) => (atual + delta + items.length) % items.length)
  }, [items.length, podeNavegar])

  const aplicarZoom = useCallback((proximo: number, foco?: { x: number; y: number }) => {
    const limitado = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, proximo))
    setZoom((anterior) => {
      if (limitado === anterior) return anterior
      const caixa = palco.current?.getBoundingClientRect()
      if (foco && caixa) {
        /* Mantem sob o cursor o mesmo ponto da imagem: desloca o pan na razao
           entre as escalas, medindo a partir do centro do palco. */
        const dx = foco.x - (caixa.left + caixa.width / 2)
        const dy = foco.y - (caixa.top + caixa.height / 2)
        const razao = limitado / anterior
        setPan((p) => ({
          x: dx - (dx - p.x) * razao,
          y: dy - (dy - p.y) * razao,
        }))
      }
      if (limitado === 1) setPan({ x: 0, y: 0 })
      return limitado
    })
  }, [])

  useEffect(() => {
    devolverFoco.current = document.activeElement as HTMLElement | null
    palco.current?.focus()
    return () => {
      const anterior = devolverFoco.current
      if (anterior?.isConnected) anterior.focus()
    }
  }, [])

  useEffect(() => {
    const aoTeclar = (event: KeyboardEvent) => {
      const acoes: Record<string, () => void> = {
        Escape: onClose,
        ArrowRight: () => irPara(1),
        ArrowLeft: () => irPara(-1),
        '+': () => aplicarZoom(zoom * 1.25),
        '=': () => aplicarZoom(zoom * 1.25),
        '-': () => aplicarZoom(zoom / 1.25),
        '0': reiniciar,
      }
      const acao = acoes[event.key]
      if (!acao) return
      event.preventDefault()
      event.stopPropagation()
      acao()
    }
    window.addEventListener('keydown', aoTeclar, true)
    return () => window.removeEventListener('keydown', aoTeclar, true)
  }, [onClose, irPara, aplicarZoom, zoom, reiniciar])

  if (!atual) return null

  const dimensoes = atual.width && atual.height ? `${atual.width} × ${atual.height}` : null
  const peso = tamanhoLegivel(atual.size)

  return createPortal(
    <div className="media-viewer" role="dialog" aria-modal="true" aria-label={`Imagem: ${atual.filename}`}>
      {/* O fundo fecha; a imagem e a barra nao. Assim arrastar a imagem para
          fora nao fecha a janela no meio do gesto. */}
      <div className="media-viewer__fundo" onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }} />

      <header className="media-viewer__barra">
        <div className="media-viewer__info">
          <strong title={atual.filename}>{atual.filename}</strong>
          <span>
            {[dimensoes, peso].filter(Boolean).join(' · ')}
            {podeNavegar && ` · ${indice + 1} de ${items.length}`}
          </span>
        </div>
        <div className="media-viewer__acoes">
          <IconButton label="Diminuir zoom" icon={<IconMinus size={18} />} onClick={() => aplicarZoom(zoom / 1.25)} />
          <span className="media-viewer__zoom" aria-live="polite">{Math.round(zoom * 100)}%</span>
          <IconButton label="Aumentar zoom" icon={<IconPlus size={18} />} onClick={() => aplicarZoom(zoom * 1.25)} />
          <IconButton label="Ajustar à tela" icon={<IconFitScreen size={18} />} onClick={reiniciar} />
          <IconButton label="Tamanho real" icon={<IconZoomIn size={18} />} onClick={() => { setPan({ x: 0, y: 0 }); setZoom(1); requestAnimationFrame(() => aplicarZoom(tamanhoReal(atual, palco.current))) }} />
          <a className="media-viewer__link" href={atual.url} download={atual.filename} title="Baixar">
            <IconDownload size={18} />
            <span className="media-viewer__sr">Baixar</span>
          </a>
          <a className="media-viewer__link" href={atual.url} target="_blank" rel="noopener noreferrer" title="Abrir original">
            <IconExternal size={18} />
            <span className="media-viewer__sr">Abrir original</span>
          </a>
          <IconButton label="Fechar" icon={<IconX size={18} />} onClick={onClose} />
        </div>
      </header>

      <div
        ref={palco}
        className={`media-viewer__palco ${arrastando ? 'is-dragging' : ''} ${zoom > 1 ? 'is-zoomed' : ''}`}
        tabIndex={-1}
        onWheel={(event) => {
          event.preventDefault()
          aplicarZoom(zoom * (event.deltaY < 0 ? 1.12 : 1 / 1.12), { x: event.clientX, y: event.clientY })
        }}
        onDoubleClick={(event) => {
          if (zoom > 1) reiniciar()
          else aplicarZoom(2, { x: event.clientX, y: event.clientY })
        }}
        onPointerDown={(event) => {
          if (zoom <= 1) return
          event.currentTarget.setPointerCapture(event.pointerId)
          inicio.current = { x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y }
          setArrastando(true)
        }}
        onPointerMove={(event) => {
          if (!arrastando) return
          setPan({
            x: inicio.current.panX + (event.clientX - inicio.current.x),
            y: inicio.current.panY + (event.clientY - inicio.current.y),
          })
        }}
        onPointerUp={() => setArrastando(false)}
        onPointerCancel={() => setArrastando(false)}
      >
        {erro ? (
          <p className="media-viewer__erro" role="alert">
            Não consegui carregar esta imagem. O arquivo pode ter sido removido.
          </p>
        ) : (
          <img
            className={`media-viewer__img ${carregada ? 'is-ready' : ''}`}
            src={atual.url}
            alt={atual.filename}
            draggable={false}
            style={{ transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})` }}
            onLoad={() => setCarregada(true)}
            onError={() => setErro(true)}
          />
        )}
      </div>

      {podeNavegar && (
        <>
          <IconButton className="media-viewer__nav is-prev" size="lg" label="Imagem anterior"
            icon={<IconChevronLeft size={24} />} onClick={() => irPara(-1)} />
          <IconButton className="media-viewer__nav is-next" size="lg" label="Próxima imagem"
            icon={<IconChevronRight size={24} />} onClick={() => irPara(1)} />
        </>
      )}
    </div>,
    document.body,
  )
}

/**
 * Quanto de zoom leva a imagem ao tamanho real de pixel.
 *
 * Sem as dimensoes conhecidas nao da para calcular, e `1` (ajustada a tela) e a
 * resposta honesta — melhor do que chutar um numero.
 */
function tamanhoReal(item: MediaViewerItem, palco: HTMLElement | null): number {
  if (!item.width || !item.height || !palco) return 1
  const caixa = palco.getBoundingClientRect()
  const escalaExibida = Math.min(caixa.width / item.width, caixa.height / item.height, 1)
  return escalaExibida > 0 ? 1 / escalaExibida : 1
}
