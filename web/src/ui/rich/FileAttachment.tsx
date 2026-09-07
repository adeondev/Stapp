import { useState } from 'react'
import {
  IconDownload, IconError, IconFile, IconFileAudio, IconFileCode, IconFileImage,
  IconFilePdf, IconFileText, IconFileVideo, IconFileZip,
} from '../Icons'
import './fileAttachment.css'

/**
 * O anexo que nao tem previa propria.
 *
 * Era um `<a>` com uma seta `↓` de texto ao lado do nome e do tamanho. Aqui
 * ganha icone por tipo, extensao visivel, truncamento no MEIO do nome — que e o
 * que preserva a extensao, a parte mais informativa — e estado de erro.
 *
 * O nome completo continua alcancavel pelo `title`, porque o truncamento sempre
 * esconde alguma coisa.
 */

interface TipoDeArquivo {
  icone: typeof IconFile
  rotulo: string
  className: string
}

/* A extensao vale mais que o `content_type` aqui: o servidor preserva o tipo
   declarado para audio e video, mas manda `application/octet-stream` para muita
   coisa que o `infer` nao reconhece. */
const POR_EXTENSAO: Record<string, TipoDeArquivo> = {}
const registrar = (exts: string[], tipo: TipoDeArquivo) => {
  for (const ext of exts) POR_EXTENSAO[ext] = tipo
}

registrar(['pdf'], { icone: IconFilePdf, rotulo: 'PDF', className: 'is-pdf' })
registrar(['zip', 'rar', '7z', 'tar', 'gz', 'xz', 'bz2'],
  { icone: IconFileZip, rotulo: 'Compactado', className: 'is-zip' })
registrar(['txt', 'md', 'rtf', 'log', 'csv'],
  { icone: IconFileText, rotulo: 'Texto', className: 'is-text' })
registrar(['doc', 'docx', 'odt'], { icone: IconFileText, rotulo: 'Documento', className: 'is-text' })
registrar(['xls', 'xlsx', 'ods'], { icone: IconFileText, rotulo: 'Planilha', className: 'is-text' })
registrar(['ppt', 'pptx', 'odp'], { icone: IconFileText, rotulo: 'Apresentação', className: 'is-text' })
registrar(['js', 'ts', 'tsx', 'jsx', 'json', 'html', 'css', 'py', 'rs', 'go', 'java', 'c', 'cpp', 'sh', 'toml', 'yml', 'yaml', 'xml'],
  { icone: IconFileCode, rotulo: 'Código', className: 'is-code' })
registrar(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'svg', 'bmp', 'ico'],
  { icone: IconFileImage, rotulo: 'Imagem', className: 'is-image' })
registrar(['mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v'],
  { icone: IconFileVideo, rotulo: 'Vídeo', className: 'is-video' })
registrar(['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac', 'opus'],
  { icone: IconFileAudio, rotulo: 'Áudio', className: 'is-audio' })

const GENERICO: TipoDeArquivo = { icone: IconFile, rotulo: 'Arquivo', className: 'is-generic' }

export function extensaoDe(filename: string): string {
  const ponto = filename.lastIndexOf('.')
  // Ponto no comeco e nome oculto, nao extensao.
  if (ponto <= 0 || ponto === filename.length - 1) return ''
  return filename.slice(ponto + 1).toLowerCase()
}

export function tipoDeArquivo(filename: string, contentType?: string): TipoDeArquivo {
  const porExtensao = POR_EXTENSAO[extensaoDe(filename)]
  if (porExtensao) return porExtensao
  if (contentType?.startsWith('image/')) return POR_EXTENSAO.png
  if (contentType?.startsWith('video/')) return POR_EXTENSAO.mp4
  if (contentType?.startsWith('audio/')) return POR_EXTENSAO.mp3
  if (contentType?.startsWith('text/')) return POR_EXTENSAO.txt
  return GENERICO
}

export function formatarBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const unidades = ['B', 'KB', 'MB', 'GB']
  const indice = Math.min(unidades.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  return `${Number((bytes / 1024 ** indice).toFixed(1))} ${unidades[indice]}`
}

/**
 * Corta no MEIO, preservando o fim.
 *
 * `text-overflow: ellipsis` corta o final, que e onde mora a extensao — e
 * "relatorio-final-consolidado-2…" nao diz se e PDF ou planilha.
 */
export function truncarNoMeio(nome: string, maximo = 34): string {
  if (nome.length <= maximo) return nome
  const fim = Math.min(12, Math.floor(maximo / 2))
  const inicio = maximo - fim - 1
  return `${nome.slice(0, inicio)}…${nome.slice(-fim)}`
}

export interface FileAttachmentProps {
  url: string
  filename: string
  sizeBytes: number
  contentType?: string
  description?: string
  /**
   * Falha vinda de fora — tipicamente o ticket de acesso expirando.
   *
   * Nao ha como o `<a download>` avisar que o download falhou: o navegador
   * assume o controle e nao devolve nada. Inventar um "baixado com sucesso"
   * seria mentira, entao o cartao so mostra erro quando alguem de fato soube
   * de um.
   */
  error?: string | null
}

export function FileAttachment({ url, filename, sizeBytes, contentType, description, error }: FileAttachmentProps) {
  const erro = error ?? null
  const [baixando, setBaixando] = useState(false)
  const tipo = tipoDeArquivo(filename, contentType)
  const Icone = tipo.icone
  const extensao = extensaoDe(filename)

  return (
    <div className={`file-attachment ${tipo.className}`}>
      <span className="file-attachment__icone" aria-hidden="true">
        <Icone size={24} filled />
        {extensao && <span className="file-attachment__ext">{extensao}</span>}
      </span>

      <span className="file-attachment__copy">
        <span className="file-attachment__nome" title={filename}>{truncarNoMeio(filename)}</span>
        <span className="file-attachment__meta">
          {tipo.rotulo} · {formatarBytes(sizeBytes)}
        </span>
        {description && <span className="file-attachment__descricao">{description}</span>}
        {erro && (
          <span className="file-attachment__erro" role="alert">
            <IconError size={16} filled /> {erro}
          </span>
        )}
      </span>

      {/* Ancora de verdade, e nao um `onClick`: assim vale o menu do botao
          direito, o "salvar como" e o clique do meio para abrir noutra aba. */}
      <a
        className="file-attachment__acao"
        href={url}
        download={filename}
        title={`Baixar ${filename}`}
        aria-label={`Baixar ${filename}`}
        onClick={() => {
          setBaixando(true)
          // O navegador assume daqui; o retorno visual e so o "iniciando".
          window.setTimeout(() => setBaixando(false), 1500)
        }}
      >
        <IconDownload size={20} />
      </a>
      {baixando && <span className="file-attachment__progresso" role="status">Iniciando o download…</span>}
    </div>
  )
}
