// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Connect } from './Connect'

const profile = {
  url: 'wss://stapp.exemplo.com/ws',
  name: 'Stapp',
  username: '',
  lastUsed: 1,
}

const baseProps = {
  serverUrl: 'wss://stapp.exemplo.com/ws',
  serverProfile: profile,
  savedServers: [profile],
  status: 'connecting' as const,
  busy: false,
  error: null,
  onChooseServer: vi.fn(),
  onSelectServer: vi.fn(),
  onRemoveServer: vi.fn(),
  onAuthenticate: vi.fn(),
  onBack: vi.fn(),
}

const authInfo = {
  serverId: 'server-1',
  protocolVersion: 2,
  serverName: 'Privado',
  registrationEnabled: false,
  plaintextAuthAllowed: true,
}

describe('Connect', () => {
  beforeEach(() => {
    const values = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
      clear: () => values.clear(),
      key: (index: number) => [...values.keys()][index] ?? null,
      get length() {
        return values.size
      },
    })
    vi.clearAllMocks()
  })

  it('nao oferece cadastro quando o servidor esta fechado', () => {
    render(
      <Connect
        {...baseProps}
        authInfo={authInfo}
      />,
    )
    expect(screen.queryByText(/criar uma conta neste servidor/i)).toBeNull()
    expect(screen.getByRole('button', { name: /entrar/i })).toBeTruthy()
  })

  it('permite cancelar enquanto aguarda o servidor', async () => {
    const user = userEvent.setup()
    const onBack = vi.fn()
    render(<Connect {...baseProps} authInfo={null} onBack={onBack} />)

    expect(screen.getByText(/aguardando resposta/i)).toBeTruthy()
    await user.click(screen.getByRole('button', { name: /cancelar/i }))

    expect(onBack).toHaveBeenCalledOnce()
  })

  it('pede confirmacao no cadastro e nunca grava a senha digitada', async () => {
    const user = userEvent.setup()
    render(
      <Connect
        {...baseProps}
        authInfo={{ ...authInfo, serverName: 'Aberto', registrationEnabled: true }}
      />,
    )
    await user.click(screen.getByRole('button', { name: /criar uma conta neste servidor/i }))
    const username = screen.getByLabelText(/username/i) as HTMLInputElement
    const password = screen.getByLabelText(/^senha$/i) as HTMLInputElement
    const confirmation = screen.getByLabelText(/repita a senha/i) as HTMLInputElement
    await user.type(username, 'Daniel')
    await user.type(password, 'senha longa de teste')
    await user.type(confirmation, 'senha longa de teste')
    expect([username.value, password.value, confirmation.value]).toEqual([
      'Daniel',
      'senha longa de teste',
      'senha longa de teste',
    ])
    expect(screen.getByRole('button', { name: /criar e entrar/i })).toBeTruthy()
    expect(localStorage.length).toBe(0)
  })

  it('em ws:// liberado pelo servidor, pede a senha mas avisa que nao ha TLS', () => {
    render(
      <Connect
        {...baseProps}
        serverUrl="ws://26.220.166.121:8787/ws"
        authInfo={{ ...authInfo, serverName: 'Radmin', registrationEnabled: true }}
      />,
    )
    expect(screen.getByLabelText(/^senha$/i)).toBeTruthy()
    expect(screen.getByText(/sem HTTPS, esta sessão não será persistida/i)).toBeTruthy()
  })

  it('em ws:// que o servidor nao libera, nem mostra o formulario', () => {
    render(
      <Connect
        {...baseProps}
        serverUrl="ws://26.220.166.121:8787/ws"
        authInfo={{ ...authInfo, serverName: 'Fechado', registrationEnabled: true, plaintextAuthAllowed: false }}
      />,
    )
    expect(screen.queryByLabelText(/^senha$/i)).toBeNull()
    expect(screen.getByText(/exige HTTPS\/WSS/i)).toBeTruthy()
  })

  it('envia a preferência de lembrar sem armazenar credenciais', async () => {
    const user = userEvent.setup()
    render(<Connect {...baseProps} authInfo={authInfo} />)
    await user.type(screen.getByLabelText(/username/i), 'Deon')
    await user.type(screen.getByLabelText(/^senha$/i), 'uma senha segura')
    await user.click(screen.getByRole('button', { name: /entrar/i }))
    expect(baseProps.onAuthenticate).toHaveBeenCalledWith('login', 'Deon', 'uma senha segura', true)
    expect(localStorage.length).toBe(0)
  })
})
