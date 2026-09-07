import { useEffect, useRef, useState } from 'react'
import { Modal, ModalBody, ModalFooter, ModalHeader, useModalTitleId } from '../Overlay'
import { IconZoomIn, IconZoomOut } from '../Icons'
import { SettingsButton } from './primitives'
import './imageCropper.css'

/**
 * Enquadramento de avatar e banner antes do envio.
 *
 * O servidor sempre cortou **pelo centro** (`services/profile/avatar.rs`): 1:1
 * para o avatar, 8:3 para o banner. Numa foto que ja e mais ou menos quadrada
 * isso passa despercebido; num retrato de celular ou numa imagem larga o corte
 * comia justamente o rosto, e nao havia nada a fazer a respeito.
 *
 * A escolha aqui e deliberada: **quem enquadra e o cliente**, entregando ao
 * servidor uma imagem que ja esta na proporcao final. O corte central continua
 * existindo la e vira uma operacao sem efeito — nenhum protocolo novo, nenhum
 * campo novo, e o servidor continua sendo quem decide o tamanho e o formato de
 * gravacao.
 *
 * PROTOTYPE: GIF nao passa por aqui. Recortar quadro a quadro no navegador
 * exigiria decodificar e recodificar a animacao inteira, e o avatar animado —
 * que o servidor guarda no formato original de proposito — viraria uma imagem
 * parada. O invariante que nao pode quebrar: **arquivo animado sobe intacto**.
 * FUTURE: se um dia o recorte de GIF valer a pena, ele entra como um caminho
 * separado (WebCodecs), nunca reaproveitando o canvas de imagem parada daqui.
 */

/** Passo do zoom pelo teclado. */
const PASSO_ZOOM = 0.1
const ZOOM_MAX = 4

export interface Recorte {
  sx: number
  sy: number
  sw: number
  sh: number
}

/** A escala em que a imagem cobre a moldura inteira — o zoom 1. */
export function escalaBase(
  natural: { width: number; height: number },
  moldura: { width: number; height: number },
): number {
  if (!natural.width || !natural.height) return 1
  return Math.max(moldura.width / natural.width, moldura.height / natural.height)
}

/**
 * O retangulo da imagem original que cabe dentro da moldura.
 *
 * Fica separado da interface porque e o unico pedaco com aritmetica de verdade,
 * e porque teste de geometria nao precisa de canvas nem de DOM.
 *
 * Sistema de coordenadas: a origem e o CENTRO da moldura; `offset` e onde esta
 * o centro da imagem em relacao a ele, em pixels de tela.
 */
export function calcularRecorte(
  natural: { width: number; height: number },
  moldura: { width: number; height: number },
  zoom: number,
  offset: { x: number; y: number },
): Recorte {
  const escala = escalaBase(natural, moldura) * zoom
  return {
    sx: (-moldura.width / 2 - offset.x) / escala + natural.width / 2,
    sy: (-moldura.height / 2 - offset.y) / escala + natural.height / 2,
    sw: moldura.width / escala,
    sh: moldura.height / escala,
  }
}

/**
 * Prende o deslocamento para a moldura nunca mostrar vazio.
 *
 * Sem isto da para arrastar a foto para fora e salvar uma faixa transparente —
 * que no avatar vira um pedaco da cor de fundo, exatamente o defeito que o
 * enquadramento deveria resolver.
 */
export function limitarDeslocamento(
  natural: { width: number; height: number },
  moldura: { width: number; height: number },
  zoom: number,
  offset: { x: number; y: number },
): { x: number; y: number } {
  const escala = escalaBase(natural, moldura) * zoom
  const folgaX = Math.max(0, (natural.width * escala - moldura.width) / 2)
  const folgaY = Math.max(0, (natural.height * escala - moldura.height) / 2)
  return {
    x: Math.min(folgaX, Math.max(-folgaX, offset.x)),
    y: Math.min(folgaY, Math.max(-folgaY, offset.y)),
  }
}

/**
 * Animacao sobe intacta: recortar no canvas devolveria um unico quadro.
 * Ver o comentario PROTOTYPE no topo.
 */
export function precisaDeEnquadramento(file: File): boolean {
  return file.type !== 'image/gif'
}

export interface ImageCropperProps {
  open: boolean
  file: File | null
  /** Largura dividida pela altura do resultado. 1 no avatar, 8/3 no banner. */
  aspect: number
  /** Largura final em pixels. O servidor reduz de novo; isto so evita subir demais. */
  outputWidth: number
  title: string
  description?: string
  /** Moldura redonda — so a mascara na tela; o arquivo continua retangular. */
  round?: boolean
  onCancel(): void
  onConfirm(file: File): void
}

export function ImageCropper({
  open, file, aspect, outputWidth, title, description, round = false, onCancel, onConfirm,
}: ImageCropperProps) {
  const tituloId = useModalTitleId()
  const [fonte, setFonte] = useState<string | null>(null)
  const [natural, setNatural] = useState({ width: 0, height: 0 })
  const [zoom, setZoom] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [erro, setErro] = useState<string | null>(null)
  const arrasto = useRef<{ x: number; y: number } | null>(null)
  const imagem = useRef<HTMLImageElement>(null)
  const palco = useRef<HTMLDivElement>(null)
  const [moldura, setMoldura] = useState({ width: 320, height: 320 })

  // Object URL: sem revogar, cada arquivo escolhido vaza um blob na memoria.
  useEffect(() => {
    if (!file || !open) {
      setFonte(null)
      return
    }
    const url = URL.createObjectURL(file)
    setFonte(url)
    setZoom(1)
    setOffset({ x: 0, y: 0 })
    setErro(null)
    return () => URL.revokeObjectURL(url)
  }, [file, open])

  // A moldura acompanha a largura disponivel; a altura sai da proporcao de saida.
  useEffect(() => {
    if (!open) return
    const medir = () => {
      const largura = Math.min(palco.current?.clientWidth || 320, 420)
      setMoldura({ width: largura, height: Math.round(largura / aspect) })
    }
    medir()
    window.addEventListener('resize', medir)
    return () => window.removeEventListener('resize', medir)
  }, [open, aspect])

  // Fechar o zoom prende o deslocamento de novo: reduzir com a foto no canto
  // deixaria uma borda vazia aparecendo.
  useEffect(() => {
    setOffset((atual) => limitarDeslocamento(natural, moldura, zoom, atual))
  }, [zoom, natural, moldura])

  const escala = escalaBase(natural, moldura) * zoom

  const mover = (dx: number, dy: number) => {
    setOffset((atual) => limitarDeslocamento(natural, moldura, zoom, {
      x: atual.x + dx,
      y: atual.y + dy,
    }))
  }

  const confirmar = () => {
    const el = imagem.current
    if (!el || !file) return
    const recorte = calcularRecorte(natural, moldura, zoom, offset)
    const canvas = document.createElement('canvas')
    canvas.width = outputWidth
    canvas.height = Math.round(outputWidth / aspect)
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      // Sem canvas nao da para recortar: sobe o arquivo como veio, e o servidor
      // corta pelo centro como sempre fez. Melhor do que travar o envio.
      onConfirm(file)
      return
    }
    ctx.drawImage(el, recorte.sx, recorte.sy, recorte.sw, recorte.sh, 0, 0, canvas.width, canvas.height)
    canvas.toBlob((blob) => {
      if (!blob) {
        setErro('Não consegui recortar a imagem. Ela vai subir inteira.')
        onConfirm(file)
        return
      }
      const nome = file.name.replace(/\.[^.]+$/, '') || 'imagem'
      onConfirm(new File([blob], `${nome}.webp`, { type: 'image/webp' }))
    }, 'image/webp', 0.92)
  }

  return (
    <Modal open={open} onClose={onCancel} size="md" labelledBy={tituloId} className="cropper-modal">
      <ModalHeader title={title} titleId={tituloId} onClose={onCancel} />
      <ModalBody className="cropper">
        {description && <p className="cropper__hint">{description}</p>}
        <div className="cropper__palco" ref={palco}>
          <div
            className={`cropper__moldura ${round ? 'is-round' : ''}`}
            style={{ width: moldura.width, height: moldura.height }}
            role="application"
            aria-label="Arraste para reposicionar a imagem"
            tabIndex={0}
            onPointerDown={(event) => {
              arrasto.current = { x: event.clientX, y: event.clientY }
              event.currentTarget.setPointerCapture?.(event.pointerId)
            }}
            onPointerMove={(event) => {
              const inicio = arrasto.current
              if (!inicio) return
              mover(event.clientX - inicio.x, event.clientY - inicio.y)
              arrasto.current = { x: event.clientX, y: event.clientY }
            }}
            onPointerUp={() => { arrasto.current = null }}
            onPointerCancel={() => { arrasto.current = null }}
            onKeyDown={(event) => {
              const passo = event.shiftKey ? 20 : 5
              if (event.key === 'ArrowLeft') { event.preventDefault(); mover(passo, 0) }
              if (event.key === 'ArrowRight') { event.preventDefault(); mover(-passo, 0) }
              if (event.key === 'ArrowUp') { event.preventDefault(); mover(0, passo) }
              if (event.key === 'ArrowDown') { event.preventDefault(); mover(0, -passo) }
              if (event.key === '+' || event.key === '=') { event.preventDefault(); setZoom((z) => Math.min(ZOOM_MAX, z + PASSO_ZOOM)) }
              if (event.key === '-') { event.preventDefault(); setZoom((z) => Math.max(1, z - PASSO_ZOOM)) }
            }}
          >
            {fonte && (
              <img
                ref={imagem}
                src={fonte}
                alt=""
                draggable={false}
                className="cropper__img"
                style={{
                  width: natural.width * escala,
                  height: natural.height * escala,
                  transform: `translate(-50%, -50%) translate(${offset.x}px, ${offset.y}px)`,
                }}
                onLoad={(event) => {
                  const alvo = event.currentTarget
                  setNatural({ width: alvo.naturalWidth, height: alvo.naturalHeight })
                }}
              />
            )}
          </div>
        </div>

        <label className="cropper__zoom">
          <IconZoomOut size={16} />
          <input
            type="range"
            min={1}
            max={ZOOM_MAX}
            step={0.01}
            value={zoom}
            aria-label="Aproximação"
            onChange={(event) => setZoom(Number(event.target.value))}
          />
          <IconZoomIn size={16} />
        </label>
        {erro && <p className="cropper__erro" role="status">{erro}</p>}
      </ModalBody>
      <ModalFooter>
        <SettingsButton onClick={onCancel}>Cancelar</SettingsButton>
        <SettingsButton tone="primary" onClick={confirmar}>Usar este enquadramento</SettingsButton>
      </ModalFooter>
    </Modal>
  )
}
