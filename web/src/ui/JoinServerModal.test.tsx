// @vitest-environment jsdom

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { JoinServerModal } from './JoinServerModal'

const authenticateMock = vi.fn()

vi.mock('../net/auth', () => ({
  AuthApi: class {
    constructor(readonly serverUrl: string) {}
    authenticate = authenticateMock
  },
  AuthApiError: class extends Error {
    constructor(message: string, readonly code = 'invalid_credentials', readonly retryAfterMs?: number) {
      super(message)
    }
  },
}))

describe('JoinServerModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renderiza os campos corretamente e alterna entre login e cadastro', async () => {
    const user = userEvent.setup()
    render(<JoinServerModal open={true} onClose={vi.fn()} onSuccess={vi.fn()} />)

    expect(screen.getByRole('dialog', { name: 'Adicionar servidor' })).toBeTruthy()
    expect(screen.getByLabelText('Endereço do Servidor')).toBeTruthy()
    expect(screen.getByLabelText('Nome de usuário')).toBeTruthy()
    expect(screen.getByLabelText('Senha')).toBeTruthy()
    expect(screen.queryByLabelText('Confirmar senha')).toBeNull()

    // Switch to register mode
    await user.click(screen.getByRole('button', { name: 'Criar conta' }))
    expect(screen.getByLabelText('Confirmar senha')).toBeTruthy()
  })

  it('valida campos obrigatorios e erros de confirmacao de senha', async () => {
    const user = userEvent.setup()
    render(<JoinServerModal open={true} onClose={vi.fn()} onSuccess={vi.fn()} />)

    // Submit empty
    await user.click(screen.getByRole('button', { name: 'Conectar' }))
    expect(screen.getByText('Informe o endereço do servidor.')).toBeTruthy()

    // Invalid url
    await user.type(screen.getByLabelText('Endereço do Servidor'), 'http://invalid')
    await user.click(screen.getByRole('button', { name: 'Conectar' }))
    expect(screen.getByText('use um endereço ws:// ou wss://')).toBeTruthy()

    // Valid url, switch to register
    await user.clear(screen.getByLabelText('Endereço do Servidor'))
    await user.type(screen.getByLabelText('Endereço do Servidor'), 'ws://localhost:8787')
    await user.click(screen.getByRole('button', { name: 'Criar conta' }))
    await user.type(screen.getByLabelText('Nome de usuário'), 'novo_usuario')
    await user.type(screen.getByLabelText('Senha'), 'senha-curta')
    await user.type(screen.getByLabelText('Confirmar senha'), 'senha-diferente')

    await user.click(screen.getByRole('button', { name: 'Criar e Conectar' }))
    expect(screen.getByText('As senhas não conferem.')).toBeTruthy()
  })

  it('chama AuthApi e dispara onSuccess ao autenticar com sucesso', async () => {
    const user = userEvent.setup()
    const onSuccess = vi.fn()
    const onClose = vi.fn()

    authenticateMock.mockResolvedValueOnce({
      access_token: 'fake-token-123',
      user_id: 'user-new',
      username: 'novo_usuario',
    })

    render(<JoinServerModal open={true} onClose={onClose} onSuccess={onSuccess} />)

    await user.type(screen.getByLabelText('Endereço do Servidor'), 'ws://meuservidor.com:8000')
    await user.type(screen.getByLabelText('Nome de usuário'), 'novo_usuario')
    await user.type(screen.getByLabelText('Senha'), 'minhasenhaforte')

    await user.click(screen.getByRole('button', { name: 'Conectar' }))

    await waitFor(() => {
      expect(authenticateMock).toHaveBeenCalledWith(
        'login',
        'novo_usuario',
        'minhasenhaforte',
        true
      )
      expect(onSuccess).toHaveBeenCalledWith(
        expect.objectContaining({
          url: 'ws://meuservidor.com:8000/ws',
          username: 'novo_usuario',
        }),
        expect.objectContaining({ access_token: 'fake-token-123' })
      )
    })
  })
})
