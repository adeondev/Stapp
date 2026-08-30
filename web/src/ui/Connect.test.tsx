// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Connect } from './Connect'

const baseProps = {
  serverUrl: 'wss://stapp.exemplo.com/ws',
  status: 'connecting' as const,
  busy: false,
  error: null,
  onChooseServer: vi.fn(),
  onAuthenticate: vi.fn(),
  onBack: vi.fn(),
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
        authInfo={{ serverName: 'Privado', registrationEnabled: false }}
      />,
    )
    expect(screen.queryByText('criar uma conta neste servidor')).toBeNull()
    expect(screen.getByRole('button', { name: 'entrar' })).toBeTruthy()
  })

  it('pede confirmacao no cadastro e nunca grava a senha digitada', async () => {
    const user = userEvent.setup()
    render(
      <Connect
        {...baseProps}
        authInfo={{ serverName: 'Aberto', registrationEnabled: true }}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'criar uma conta neste servidor' }))
    const username = screen.getByLabelText('username') as HTMLInputElement
    const password = screen.getByLabelText('senha') as HTMLInputElement
    const confirmation = screen.getByLabelText('repita a senha') as HTMLInputElement
    await user.type(username, 'Daniel')
    await user.type(password, 'senha longa de teste')
    await user.type(confirmation, 'senha longa de teste')
    expect([username.value, password.value, confirmation.value]).toEqual([
      'Daniel',
      'senha longa de teste',
      'senha longa de teste',
    ])
    expect(screen.getByRole('button', { name: 'criar e entrar' })).toBeTruthy()
    expect(localStorage.length).toBe(0)
  })
})
