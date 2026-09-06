import {
  type RemixiconComponentType,
  RiAccountCircleFill, RiAccountCircleLine, RiAddLine, RiAlertFill, RiAlertLine,
  RiArrowDownSFill, RiArrowDownSLine, RiArrowLeftSFill, RiArrowLeftSLine,
  RiArrowRightSFill, RiArrowRightSLine, RiArrowUpSFill, RiArrowUpSLine,
  RiAspectRatioFill, RiAspectRatioLine, RiAtFill, RiAtLine,
  RiBarChartBoxFill, RiBarChartBoxLine, RiChat1Fill, RiChat1Line, RiCheckLine,
  RiCloseLine, RiCollapseDiagonalFill, RiCollapseDiagonalLine, RiComputerFill, RiComputerLine,
  RiDeleteBinFill, RiDeleteBinLine, RiDownloadFill, RiDownloadLine,
  RiEditFill, RiEditLine, RiEmotionFill, RiEmotionLine, RiEqualizerFill, RiEqualizerLine,
  RiErrorWarningFill, RiErrorWarningLine, RiExpandDiagonalFill, RiExpandDiagonalLine,
  RiExternalLinkFill, RiExternalLinkLine, RiEyeFill, RiEyeLine, RiEyeOffFill, RiEyeOffLine,
  RiFileCodeFill, RiFileCodeLine, RiFileFill, RiFileGifFill, RiFileGifLine, RiFileLine,
  RiFilePdfFill, RiFilePdfLine, RiFileTextFill, RiFileTextLine,
  RiFileUnknowFill, RiFileUnknowLine, RiFileZipFill, RiFileZipLine,
  RiFilmFill, RiFilmLine, RiFullscreenFill, RiFullscreenLine,
  RiGroupFill, RiGroupLine, RiHashtag, RiHeadphoneFill, RiHeadphoneLine,
  RiHomeFill, RiHomeLine, RiImageFill, RiImageLine, RiInformationFill, RiInformationLine,
  RiLayoutGridFill, RiLayoutGridLine, RiLayoutRightFill, RiLayoutRightLine,
  RiLoader4Line, RiLockFill, RiLockLine, RiLogoutBoxRFill, RiLogoutBoxRLine,
  RiMicFill, RiMicLine, RiMicOffFill, RiMicOffLine, RiMoreFill, RiMoreLine,
  RiMusicFill, RiMusicLine, RiPaletteFill, RiPaletteLine, RiPauseFill, RiPauseLine,
  RiPhoneFill, RiPhoneLine, RiPictureInPictureFill, RiPictureInPictureLine,
  RiPlayFill, RiPlayLine, RiPushpinFill, RiPushpinLine, RiQuestionFill, RiQuestionLine,
  RiRefreshFill, RiRefreshLine, RiReplyFill, RiReplyLine, RiRestartFill, RiRestartLine,
  RiSearchFill, RiSearchLine, RiSendPlane2Fill, RiSendPlane2Line,
  RiServerFill, RiServerLine, RiSettings3Fill, RiSettings3Line,
  RiShieldFill, RiShieldLine, RiSignalTowerFill, RiSignalTowerLine,
  RiSpeedFill, RiSpeedLine, RiSubtractLine, RiTimeFill, RiTimeLine,
  RiUploadCloud2Fill, RiUploadCloud2Line, RiUserFill, RiUserLine, RiVidiconFill, RiVidiconLine,
  RiVideoOffFill, RiVideoOffLine, RiVolumeDownFill, RiVolumeDownLine,
  RiVolumeMuteFill, RiVolumeMuteLine, RiVolumeUpFill, RiVolumeUpLine,
  RiZoomInLine, RiZoomOutLine,
} from '@remixicon/react'

/**
 * A iconografia do Stapp, em um lugar so.
 *
 * Antes daqui saiam tres familias ao mesmo tempo — `hugeicons-react`, SVG a mao
 * com traco 2, e SVG a mao com traco 1.8/2.5/2.8 — em 18 tamanhos diferentes, e
 * ainda sobravam `✕`, `×`, `‹`, `›` e `!` espalhados como se fossem icone. Agora
 * existe uma fonte so, o Remix Icon, que traz o par `-line`/`-fill` de todo desenho.
 *
 * ## A convencao do app
 *
 * - `outlined` (padrao) — acao inativa, secundaria ou neutra;
 * - `filled` — acao selecionada, ativa, ou que precisa de mais peso visual;
 * - **destrutivo nao se marca com preenchimento**, e sim com a cor `--danger`.
 *   Preencher e sinal de "ligado", nao de "perigoso"; confundir os dois foi o que
 *   fez a camera *desligada* parecer um erro na barra de chamada.
 *
 * O tamanho e um dos cinco degraus e nada mais. `IconSize` e uma uniao fechada
 * de proposito: um `size={17}` solto nao compila, entao a barra de ferramentas
 * nao volta a ter cinco glifos de alturas diferentes.
 */
export type IconSize =
  /** dentro de texto, item de lista, chip */
  | 16
  /** barra de acao da mensagem, botao pequeno */
  | 18
  /** toolbar, dock de chamada, player */
  | 20
  /** destaque, cabecalho, tile de chamada */
  | 24
  /** ilustracao de estado vazio — nao e botao, e desenho */
  | 32

export interface IconProps {
  size?: IconSize
  /** `true` = variante preenchida. Ver a convencao no topo do arquivo. */
  filled?: boolean
  className?: string
  /**
   * So quando o icone E o rotulo — ou seja, quando quem o envolve nao tem texto
   * nem `aria-label`. Com titulo ele vira `role="img"`; sem titulo ele some para
   * o leitor de tela, que e o certo quando o botao ao redor ja se nomeia.
   */
  title?: string
}

/** Junta o par outlined/filled num componente so, com a API do app. */
function par(nome: string, Line: RemixiconComponentType, Fill: RemixiconComponentType) {
  function Icone({ size = 16, filled = false, className, title }: IconProps) {
    const Desenho = filled ? Fill : Line
    return (
      <Desenho
        size={size}
        className={className}
        role={title ? 'img' : undefined}
        aria-label={title}
        aria-hidden={title ? undefined : true}
        focusable="false"
      />
    )
  }
  Icone.displayName = nome
  return Icone
}

/* ── Navegacao e estrutura ─────────────────────────────────────────────── */
export const IconHash = par('IconHash', RiHashtag, RiHashtag)
export const IconAt = par('IconAt', RiAtLine, RiAtFill)
export const IconHome = par('IconHome', RiHomeLine, RiHomeFill)
export const IconServer = par('IconServer', RiServerLine, RiServerFill)
export const IconUsers = par('IconUsers', RiGroupLine, RiGroupFill)
export const IconUser = par('IconUser', RiUserLine, RiUserFill)
export const IconAccount = par('IconAccount', RiAccountCircleLine, RiAccountCircleFill)
/**
 * Abre e fecha a coluna de membros. E o painel da direita, nao a silhueta de
 * pessoa: com a silhueta ele viraria o mesmo icone do menu de perfil. Preenchido
 * quando a coluna esta aberta — assim o par outlined/filled ja diz o estado.
 */
export const IconMembers = par('IconMembers', RiLayoutRightLine, RiLayoutRightFill)
export const IconSearch = par('IconSearch', RiSearchLine, RiSearchFill)
export const IconSettings = par('IconSettings', RiSettings3Line, RiSettings3Fill)
export const IconHelp = par('IconHelp', RiQuestionLine, RiQuestionFill)
export const IconInfo = par('IconInfo', RiInformationLine, RiInformationFill)
export const IconShield = par('IconShield', RiShieldLine, RiShieldFill)
export const IconLock = par('IconLock', RiLockLine, RiLockFill)
export const IconLogout = par('IconLogout', RiLogoutBoxRLine, RiLogoutBoxRFill)
export const IconPalette = par('IconPalette', RiPaletteLine, RiPaletteFill)
export const IconTime = par('IconTime', RiTimeLine, RiTimeFill)

/* ── Setas e controles genericos ───────────────────────────────────────── */
export const IconChevronDown = par('IconChevronDown', RiArrowDownSLine, RiArrowDownSFill)
export const IconChevronUp = par('IconChevronUp', RiArrowUpSLine, RiArrowUpSFill)
export const IconChevronLeft = par('IconChevronLeft', RiArrowLeftSLine, RiArrowLeftSFill)
export const IconChevronRight = par('IconChevronRight', RiArrowRightSLine, RiArrowRightSFill)
export const IconArrowRight = par('IconArrowRight', RiArrowRightSLine, RiArrowRightSFill)
export const IconPlus = par('IconPlus', RiAddLine, RiAddLine)
export const IconMinus = par('IconMinus', RiSubtractLine, RiSubtractLine)
export const IconX = par('IconX', RiCloseLine, RiCloseLine)
export const IconCheck = par('IconCheck', RiCheckLine, RiCheckLine)
export const IconMore = par('IconMore', RiMoreLine, RiMoreFill)
export const IconRefresh = par('IconRefresh', RiRefreshLine, RiRefreshFill)
export const IconAlert = par('IconAlert', RiAlertLine, RiAlertFill)
export const IconError = par('IconError', RiErrorWarningLine, RiErrorWarningFill)
export const IconSpinner = par('IconSpinner', RiLoader4Line, RiLoader4Line)
export const IconExternal = par('IconExternal', RiExternalLinkLine, RiExternalLinkFill)
export const IconDownload = par('IconDownload', RiDownloadLine, RiDownloadFill)
export const IconUpload = par('IconUpload', RiUploadCloud2Line, RiUploadCloud2Fill)

/* ── Conversa ──────────────────────────────────────────────────────────── */
export const IconChat = par('IconChat', RiChat1Line, RiChat1Fill)
export const IconReply = par('IconReply', RiReplyLine, RiReplyFill)
export const IconEdit = par('IconEdit', RiEditLine, RiEditFill)
export const IconTrash = par('IconTrash', RiDeleteBinLine, RiDeleteBinFill)
export const IconReaction = par('IconReaction', RiEmotionLine, RiEmotionFill)
export const IconSend = par('IconSend', RiSendPlane2Line, RiSendPlane2Fill)
export const IconGif = par('IconGif', RiFileGifLine, RiFileGifFill)
export const IconPin = par('IconPin', RiPushpinLine, RiPushpinFill)
export const IconPoll = par('IconPoll', RiBarChartBoxLine, RiBarChartBoxFill)

/* ── Voz, video e chamada ──────────────────────────────────────────────── */
export const IconMic = par('IconMic', RiMicLine, RiMicFill)
export const IconMicOff = par('IconMicOff', RiMicOffLine, RiMicOffFill)
export const IconHeadphones = par('IconHeadphones', RiHeadphoneLine, RiHeadphoneFill)
/** Ensurdecido: nao e o fone que sumiu, e o som que parou de sair. */
export const IconHeadphonesOff = par('IconHeadphonesOff', RiVolumeMuteLine, RiVolumeMuteFill)
export const IconSpeaker = par('IconSpeaker', RiVolumeUpLine, RiVolumeUpFill)
export const IconVolumeLow = par('IconVolumeLow', RiVolumeDownLine, RiVolumeDownFill)
export const IconVolumeOff = par('IconVolumeOff', RiVolumeMuteLine, RiVolumeMuteFill)
export const IconPhone = par('IconPhone', RiPhoneLine, RiPhoneFill)
export const IconCamera = par('IconCamera', RiVidiconLine, RiVidiconFill)
export const IconCameraOff = par('IconCameraOff', RiVideoOffLine, RiVideoOffFill)
export const IconScreen = par('IconScreen', RiComputerLine, RiComputerFill)
export const IconSignal = par('IconSignal', RiSignalTowerLine, RiSignalTowerFill)
export const IconGrid = par('IconGrid', RiLayoutGridLine, RiLayoutGridFill)
export const IconEqualizer = par('IconEqualizer', RiEqualizerLine, RiEqualizerFill)

/* ── Midia ─────────────────────────────────────────────────────────────── */
export const IconPlay = par('IconPlay', RiPlayLine, RiPlayFill)
export const IconPause = par('IconPause', RiPauseLine, RiPauseFill)
export const IconReplay = par('IconReplay', RiRestartLine, RiRestartFill)
export const IconSpeed = par('IconSpeed', RiSpeedLine, RiSpeedFill)
export const IconFullscreen = par('IconFullscreen', RiFullscreenLine, RiFullscreenFill)
export const IconMinimize = par('IconMinimize', RiCollapseDiagonalLine, RiCollapseDiagonalFill)
export const IconExpand = par('IconExpand', RiExpandDiagonalLine, RiExpandDiagonalFill)
export const IconPictureInPicture = par('IconPictureInPicture', RiPictureInPictureLine, RiPictureInPictureFill)
export const IconFitScreen = par('IconFitScreen', RiAspectRatioLine, RiAspectRatioFill)
export const IconZoomIn = par('IconZoomIn', RiZoomInLine, RiZoomInLine)
export const IconZoomOut = par('IconZoomOut', RiZoomOutLine, RiZoomOutLine)
export const IconEye = par('IconEye', RiEyeLine, RiEyeFill)
export const IconEyeOff = par('IconEyeOff', RiEyeOffLine, RiEyeOffFill)

/* ── Tipos de arquivo ──────────────────────────────────────────────────── */
export const IconFile = par('IconFile', RiFileLine, RiFileFill)
export const IconFileImage = par('IconFileImage', RiImageLine, RiImageFill)
export const IconFileVideo = par('IconFileVideo', RiFilmLine, RiFilmFill)
export const IconFileAudio = par('IconFileAudio', RiMusicLine, RiMusicFill)
export const IconFileText = par('IconFileText', RiFileTextLine, RiFileTextFill)
export const IconFilePdf = par('IconFilePdf', RiFilePdfLine, RiFilePdfFill)
export const IconFileZip = par('IconFileZip', RiFileZipLine, RiFileZipFill)
export const IconFileCode = par('IconFileCode', RiFileCodeLine, RiFileCodeFill)
export const IconFileUnknown = par('IconFileUnknown', RiFileUnknowLine, RiFileUnknowFill)

/**
 * Desligar / recusar chamada.
 *
 * O Remix nao tem "telefone no gancho", e o desenho universal disso e o proprio
 * fone girado 135 graus. Girar aqui e mais honesto do que escolher um icone de
 * porta ou de X, que diriam outra coisa — e mantem o par com `IconPhone`, que e
 * o mesmo desenho em pe.
 */
export function IconLeave({ size = 16, filled = true, className, title }: IconProps) {
  const Desenho = filled ? RiPhoneFill : RiPhoneLine
  return (
    <Desenho
      size={size}
      className={className}
      style={{ transform: 'rotate(135deg)' }}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
    />
  )
}

/** A marca. Nao vem de biblioteca nenhuma e nao tem variante preenchida. */
export function IconStappLogo({ size = 48, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={Math.round(size * (220 / 239))}
      viewBox="0 0 239 220"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <path d="M126.31 0C-30.1899 0 -28.6903 219.5 62.3097 219.5C153.31 219.5 161.31 102.5 126.31 102.5C91.3096 102.5 95.9784 131.704 65.81 127C35.6415 122.295 64.8985 45.7406 132.31 53.4998C214.31 70.4998 154.31 191 197.31 191C258.31 191 263.31 0 126.31 0Z" />
    </svg>
  )
}
