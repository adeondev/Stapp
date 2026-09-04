import { create } from 'zustand'
import type {
  Channel,
  DirectoryEntry,
  Limits,
  OnlineUser,
  PeerId,
  Profile,
  ServerMsg,
  SocialMember,
  UserId,
} from '../protocol'
import { LIMITES_PADRAO } from '../store'

export const byUsername = (a: { username: string }, b: { username: string }) =>
  a.username.localeCompare(b.username, 'pt-BR', { sensitivity: 'base' })

export interface PresenceState {
  selfPeerId: PeerId | null
  selfUserId: UserId | null
  serverName: string
  channels: Channel[]
  users: OnlineUser[]
  directory: DirectoryEntry[]
  allowMemberDms: boolean
  socialMembers: SocialMember[]
  profiles: Record<UserId, Profile>
  limits: Limits

  handlePresenceMessage: (msg: ServerMsg) => void
  setProfiles: (profiles: Record<UserId, Profile>) => void
  updateProfile: (profile: Profile) => void
  resetPresence: () => void
}

const initialPresenceState = {
  selfPeerId: null,
  selfUserId: null,
  serverName: 'Stapp',
  channels: [],
  users: [],
  directory: [],
  allowMemberDms: true,
  socialMembers: [],
  profiles: {},
  limits: LIMITES_PADRAO,
}

export const usePresenceStore = create<PresenceState>((set) => ({
  ...initialPresenceState,

  handlePresenceMessage: (msg: ServerMsg) => {
    switch (msg.t) {
      case 'welcome':
        set({
          selfPeerId: msg.self_peer_id,
          selfUserId: msg.self_user_id,
          serverName: msg.server_name,
          channels: msg.channels,
          users: [...msg.users].sort(byUsername),
          directory: [...msg.directory].sort(byUsername),
          profiles: Object.fromEntries(msg.profiles.map((profile) => [profile.user_id, profile])),
          limits: msg.limits,
        })
        break

      case 'user.profile':
        set((state) => ({
          profiles: { ...state.profiles, [msg.profile.user_id]: msg.profile },
        }))
        break

      case 'user.online':
        set((state) => {
          const directory = state.directory.some((entry) => entry.user_id === msg.user.user_id)
            ? state.directory
            : [...state.directory, msg.user].sort(byUsername)

          if (state.users.some((user) => user.user_id === msg.user.user_id)) {
            return { directory }
          }
          return {
            directory,
            users: [...state.users, msg.user].sort(byUsername),
          }
        })
        break

      case 'user.offline':
        set((state) => ({
          users: state.users.filter((user) => user.user_id !== msg.user_id),
        }))
        break

      case 'social.snapshot':
        set({
          allowMemberDms: msg.allow_member_dms,
          socialMembers: [...msg.members].sort(byUsername),
        })
        break

      default:
        break
    }
  },

  setProfiles: (profiles) => set({ profiles }),
  updateProfile: (profile) =>
    set((state) => ({
      profiles: { ...state.profiles, [profile.user_id]: profile },
    })),
  resetPresence: () => set(initialPresenceState),
}))
