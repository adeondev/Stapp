import { describe, expect, it } from 'vitest'
import { initialState, reduce } from './store'

const welcome = {
  t: 'welcome' as const,
  self_peer_id: 'peer-1',
  self_user_id: 'user-1',
  server_name: 'Teste',
  channels: [],
  users: [{ user_id: 'user-1', username: 'Daniel' }],
  voice: { backend: 'mesh' as const, ice_servers: [], max_peers: 4 },
  voice_peers: [],
  profiles: [],
  directory: [{ user_id: 'user-2', username: 'Alice' }],
}

describe('store com identidade persistente', () => {
  it('agrega presenca pelo user_id', () => {
    let state = reduce(initialState, welcome)
    state = reduce(state, {
      t: 'user.online',
      user: { user_id: 'user-1', username: 'Daniel' },
    })
    expect(state.users).toHaveLength(1)
  })

  it('mantem user_id e peer_id distintos na voz', () => {
    let state = reduce(initialState, welcome)
    state = reduce(state, { t: 'voice.roster', channel: 'sala', peers: [] })
    expect(state.voicePeers[0]).toMatchObject({
      peer_id: 'peer-1',
      user_id: 'user-1',
      username: 'Daniel',
    })
  })
})

describe('mensagens diretas', () => {
  const dm = (id: string, autor: string, texto: string, ts: number) => ({
    id,
    author_id: autor,
    author_username: autor === 'user-1' ? 'Daniel' : 'Alice',
    kind: 'text' as const,
    text: texto,
    ts,
  })

  it('conta as nao lidas que o servidor mandou e nomeia a conversa pelo diretorio', () => {
    let state = reduce(initialState, welcome)
    state = reduce(state, {
      t: 'dm.new',
      user_id: 'user-2',
      msg: dm('m1', 'user-2', 'oi', 100),
      unread: 1,
    })

    expect(state.conversations['user-2'].unread).toBe(1)
    expect(state.conversations['user-2'].username).toBe('Alice')
    expect(state.conversations['user-2'].last?.text).toBe('oi')
  })

  it('abrir a conversa zera as nao lidas e guarda o historico', () => {
    let state = reduce(initialState, welcome)
    state = reduce(state, {
      t: 'dm.new',
      user_id: 'user-2',
      msg: dm('m1', 'user-2', 'oi', 100),
      unread: 1,
    })
    state = reduce(state, {
      t: 'dm.history',
      user_id: 'user-2',
      msgs: [dm('m1', 'user-2', 'oi', 100)],
    })

    expect(state.conversations['user-2'].unread).toBe(0)
    expect(state.directMessages['user-2']).toHaveLength(1)
  })

  it('nao duplica quando a mesma mensagem chega duas vezes', () => {
    let state = reduce(initialState, welcome)
    state = reduce(state, { t: 'dm.history', user_id: 'user-2', msgs: [] })
    const chegada = {
      t: 'dm.new' as const,
      user_id: 'user-2',
      msg: dm('m1', 'user-2', 'oi', 100),
      unread: 1,
    }
    state = reduce(state, chegada)
    state = reduce(state, chegada)

    expect(state.directMessages['user-2']).toHaveLength(1)
  })

  it('quem criou conta depois entra no diretorio pelo user.online', () => {
    let state = reduce(initialState, welcome)
    expect(state.directory.map((entry) => entry.username)).toEqual(['Alice'])

    state = reduce(state, {
      t: 'user.online',
      user: { user_id: 'user-3', username: 'Bob' },
    })
    expect(state.directory.map((entry) => entry.username)).toEqual(['Alice', 'Bob'])
  })
})

describe('lista lateral de diretas', () => {
  it('mostra somente conversas reais, sem transformar o diretorio em DMs', async () => {
    const { directList } = await import('./store')
    let state = reduce(initialState, {
      ...welcome,
      directory: [
        { user_id: 'user-2', username: 'Alice' },
        { user_id: 'user-3', username: 'Bob' },
      ],
    })
    state = reduce(state, {
      t: 'dm.new',
      user_id: 'user-3',
      msg: {
        id: 'm1',
        author_id: 'user-3',
        author_username: 'Bob',
        kind: 'text',
        text: 'oi',
        ts: 500,
      },
      unread: 1,
    })

    const lista = directList(state)
    expect(lista.map((item) => item.username)).toEqual(['Bob'])
    expect(lista[0].unread).toBe(1)
  })

  it('aplica o snapshot social personalizado', () => {
    const state = reduce(initialState, {
      t: 'social.snapshot',
      allow_member_dms: false,
      members: [{
        user_id: 'user-2', username: 'Alice', relationship: 'incoming',
        can_start_dm: false, has_conversation: false,
      }],
    })
    expect(state.allowMemberDms).toBe(false)
    expect(state.socialMembers[0].relationship).toBe('incoming')
  })
})

describe('perfis', () => {
  const perfil = (id: string, nome: string, accent: 'blue' | 'green' = 'blue') => ({
    user_id: id,
    username: nome,
    display_name: nome,
    accent,
    bio: '',
    has_avatar: false,
    updated_at: 0,
  })

  it('o welcome indexa os perfis por user_id', () => {
    const state = reduce(initialState, {
      ...welcome,
      profiles: [perfil('user-1', 'Daniel'), perfil('user-2', 'Alice')],
    })
    expect(Object.keys(state.profiles).sort()).toEqual(['user-1', 'user-2'])
    expect(state.profiles['user-2'].username).toBe('Alice')
  })

  it('user.profile troca so o perfil que mudou', async () => {
    const { profileOf } = await import('./store')
    let state = reduce(initialState, {
      ...welcome,
      profiles: [perfil('user-1', 'Daniel'), perfil('user-2', 'Alice')],
    })
    state = reduce(state, {
      t: 'user.profile',
      profile: { ...perfil('user-2', 'Alice', 'green'), display_name: 'Alice da Silva', bio: 'oi' },
    })

    expect(profileOf(state, 'user-2').display_name).toBe('Alice da Silva')
    expect(profileOf(state, 'user-2').accent).toBe('green')
    // O username continua sendo o login dela.
    expect(profileOf(state, 'user-2').username).toBe('Alice')
    // E o do daniel nao foi tocado.
    expect(profileOf(state, 'user-1').display_name).toBe('Daniel')
  })

  it('perfil que ainda nao chegou vira um provisorio, nao um buraco', async () => {
    const { profileOf } = await import('./store')
    const state = reduce(initialState, { ...welcome, profiles: [] })

    const provisorio = profileOf(state, 'user-9', 'fulano')
    expect(provisorio.display_name).toBe('fulano')
    expect(provisorio.accent).toBe('blue')
    expect(provisorio.has_avatar).toBe(false)
  })
})
