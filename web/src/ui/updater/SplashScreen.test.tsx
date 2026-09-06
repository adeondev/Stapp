// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { SplashScreen } from './SplashScreen'
import type { AvailableUpdate } from '../../platform/updater/types'

const mockUpdate: AvailableUpdate = {
  version: '0.2.0',
  currentVersion: '0.1.0',
  body: 'Notas de lançamento da nova versão',
}

describe('SplashScreen', () => {
  it('exibe o logo do Stapp e o indicador sutil com o texto procurando atualizacoes', () => {
    render(<SplashScreen />)

    expect(screen.getByRole('status')).toBeTruthy()
    expect(screen.getByRole('heading', { level: 1, name: 'Stapp' })).toBeTruthy()
    expect(screen.getByText('Procurando atualizações...')).toBeTruthy()
  })

  it('nao exibe o UpdateModal quando nenhuma atualizacao estiver disponivel', () => {
    render(<SplashScreen isModalOpen={false} update={null} />)

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByText('Atualização Disponível')).toBeNull()
  })

  it('monta o UpdateModal diretamente sobre o splash quando houver atualizacao aberta', () => {
    render(<SplashScreen isModalOpen={true} update={mockUpdate} />)

    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(screen.getByText('Atualização Disponível')).toBeTruthy()
    expect(screen.getByText('Notas de lançamento da nova versão')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Atualizar agora' })).toBeTruthy()
  })

  it('propaga acoes do modal como fechar e atualizar', async () => {
    const user = userEvent.setup()
    const handleClose = vi.fn()
    const handleStartUpdate = vi.fn()

    render(
      <SplashScreen
        isModalOpen={true}
        update={mockUpdate}
        onClose={handleClose}
        onStartUpdate={handleStartUpdate}
      />
    )

    await user.click(screen.getByRole('button', { name: 'Lembrar mais tarde' }))
    expect(handleClose).toHaveBeenCalledOnce()

    await user.click(screen.getByRole('button', { name: 'Atualizar agora' }))
    expect(handleStartUpdate).toHaveBeenCalledOnce()
  })

  it('permite renderizar conteudo customizado como children', () => {
    render(
      <SplashScreen>
        <div data-testid="custom-child">Conteúdo extra</div>
      </SplashScreen>
    )

    expect(screen.getByTestId('custom-child')).toBeTruthy()
    expect(screen.getByText('Conteúdo extra')).toBeTruthy()
  })
})
