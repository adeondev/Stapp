import { createContext, useContext, useState } from 'react'
import type { PeerId, SocialMember, UserId } from '../protocol'
import type { VoiceTransport } from '../voice/VoiceTransport'
import type { AvailableUpdate, UpdateChannel } from '../platform/updater/types'
import type { SocialAction } from './FriendsHome'
import {
  IconChat, IconEye, IconGrid, IconMicOff, IconPhone, IconScreen,
  IconSettings, IconShield, IconUser, IconX,
} from './Icons'
import { MenuDivider, MenuHost, MenuItem, MenuLabel, MenuSlider, type MenuPosition, useMenuHost } from './Menu'

export interface CallMenuControls {
  peerId: PeerId
  transport: VoiceTransport
  local: boolean
  focused: boolean
  onFocus(): void
  kind?: 'person' | 'screen'
  publicationId?: string
}

export interface UserMenuUpdater {
  isDesktop: boolean
  channel: UpdateChannel
  setChannel(channel: UpdateChannel): void
  checkForUpdates(interactive?: boolean): Promise<AvailableUpdate | null>
}

export interface UserMenuRequest {
  userId?: UserId
  name: string
  call?: CallMenuControls
}

interface UserMenuValue {
  open(event: React.MouseEvent | MenuPosition, request: UserMenuRequest): void
}

const UserMenuContext = createContext<UserMenuValue>({ open() {} })

interface Props {
  children: React.ReactNode
  members: SocialMember[]
  selfUserId: UserId | null
  onMessage(userId: UserId): void
  onCall(userId: UserId, username: string): void
  onAction(action: SocialAction, userId: UserId): void
  onEditSelf(): void
  updater?: UserMenuUpdater
}

export function UserMenuProvider(props: Props) {
  return <MenuHost><UserMenuProviderInner {...props} /></MenuHost>
}

function UserMenuProviderInner({ children, members, selfUserId, onMessage, onCall, onAction, onEditSelf, updater }: Props) {
  const host = useMenuHost()
  const open = (event: React.MouseEvent | MenuPosition, request: UserMenuRequest) => {
    let position: MenuPosition
    if ('clientX' in event) {
      event.preventDefault()
      event.stopPropagation()
      position = { x: event.clientX, y: event.clientY }
    } else {
      position = event
    }
    host.open(position, `Opções de ${request.name}`, (close) => <UserMenuContent
      request={request} member={members.find((item) => item.user_id === request.userId)}
      self={Boolean(request.userId && request.userId === selfUserId)} close={close}
      onMessage={onMessage} onCall={onCall} onAction={onAction} onEditSelf={onEditSelf}
      updater={updater} />)
  }
  return <UserMenuContext.Provider value={{ open }}>{children}</UserMenuContext.Provider>
}

function UserMenuContent({ request, member, self, close, onMessage, onCall, onAction, onEditSelf, updater }: {
  request: UserMenuRequest
  member?: SocialMember
  self: boolean
  close(): void
  onMessage(userId: UserId): void
  onCall(userId: UserId, username: string): void
  onAction(action: SocialAction, userId: UserId): void
  onEditSelf(): void
  updater?: UserMenuUpdater
}) {
  const call = request.call
  const [voiceVolume, setVoiceVolume] = useState(() => call
    ? call.transport.getVoiceVolume(call.peerId) : 100)
  const [streamVolume, setStreamVolume] = useState(() => call
    ? call.transport.getScreenShareVolume(call.peerId) : 100)
  const run = (action: () => void) => { action(); close() }
  const id = request.userId
  const social = id && !self
  const screen = call?.kind === 'screen'

  return <>
    <MenuLabel>{request.name}</MenuLabel>
    {!screen && self && <MenuItem icon={<IconSettings />} onClick={() => run(onEditSelf)}>Editar perfil</MenuItem>}
    {!screen && self && updater?.isDesktop && <>
      <MenuDivider />
      <MenuItem
        checked={updater.channel === 'beta'}
        onClick={() => {
          updater.setChannel(updater.channel === 'beta' ? 'stable' : 'beta')
        }}
      >
        Receber versões beta
      </MenuItem>
      <MenuItem onClick={() => run(() => void updater.checkForUpdates(true))}>
        Verificar atualizações
      </MenuItem>
    </>}
    {!screen && social && member?.can_start_dm && <MenuItem icon={<IconChat />} onClick={() => run(() => onMessage(id))}>Mensagem</MenuItem>}
    {!screen && social && member?.can_start_dm && <MenuItem icon={<IconPhone />} onClick={() => run(() => onCall(id, request.name))}>Ligar</MenuItem>}

    {call && <>
      {!screen && (self || member || !id) && <MenuDivider />}
      <MenuItem icon={call.focused ? <IconGrid /> : <IconEye />} onClick={() => run(call.onFocus)}>
        {call.focused ? 'Voltar para a grade' : 'Focar'}
      </MenuItem>
      {!call.local && call.kind !== 'screen' && <>
        <MenuItem icon={<IconMicOff />} checked={voiceVolume === 0} onClick={() => {
          call.transport.setVoiceMuted(call.peerId, voiceVolume !== 0)
          setVoiceVolume(call.transport.getVoiceVolume(call.peerId))
        }}>Silenciar</MenuItem>
        <MenuSlider label="Volume da voz" value={voiceVolume} onChange={(value) => {
          setVoiceVolume(value)
          call.transport.setVoiceVolume(call.peerId, value)
        }} />
      </>}
      {!call.local && call.kind === 'screen' && call.publicationId && <>
        <MenuItem icon={<IconScreen />} checked={streamVolume === 0} onClick={() => {
          call.transport.setScreenShareMuted(call.peerId, streamVolume !== 0)
          setStreamVolume(call.transport.getScreenShareVolume(call.peerId))
        }}>Silenciar transmissão</MenuItem>
        <MenuSlider label="Volume da transmissão" value={streamVolume} onChange={(value) => {
          setStreamVolume(value)
          call.transport.setScreenShareVolume(call.peerId, value)
        }} />
        <MenuItem icon={<IconX />} onClick={() => run(() => call.transport.setPublicationSubscribed(call.publicationId!, false))}>
          Parar de assistir
        </MenuItem>
      </>}
    </>}

    {!screen && social && member && <>
      <MenuDivider />
      {member.relationship === 'none' && <MenuItem icon={<IconUser />} onClick={() => run(() => onAction('request', id))}>Adicionar amigo</MenuItem>}
      {member.relationship === 'incoming' && <>
        <MenuItem icon={<IconUser />} onClick={() => run(() => onAction('accept', id))}>Aceitar pedido</MenuItem>
        <MenuItem icon={<IconX />} danger onClick={() => run(() => onAction('decline', id))}>Recusar pedido</MenuItem>
      </>}
      {member.relationship === 'outgoing' && <MenuItem icon={<IconX />} onClick={() => run(() => onAction('cancel', id))}>Cancelar pedido</MenuItem>}
      {member.relationship === 'friend' && <MenuItem icon={<IconX />} danger onClick={() => run(() => onAction('remove', id))}>Remover amizade</MenuItem>}
      {member.relationship === 'blocked'
        ? <MenuItem icon={<IconShield />} onClick={() => run(() => onAction('unblock', id))}>Desbloquear</MenuItem>
        : <MenuItem icon={<IconShield />} danger onClick={() => run(() => onAction('block', id))}>Bloquear</MenuItem>}
    </>}
  </>
}

export function useUserMenu() { return useContext(UserMenuContext) }
