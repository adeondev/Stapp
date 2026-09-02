// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { UpdateModal } from './UpdateModal'
import type { AvailableUpdate } from '../../platform/updater/types'

const sampleUpdate: AvailableUpdate = {
  version: '0.2.0',
  currentVersion: '0.1.0',
  body: 'Melhorias de desempenho e correcao de bugs.',
}

describe('UpdateModal', () => {
  it('nao renderiza nada quando isOpen e falso', () => {
    const { container } = render(
      <UpdateModal
        isOpen={false}
        update={sampleUpdate}
        isDownloading={false}
        progress={null}
        onClose={vi.fn()}
        onStartUpdate={vi.fn()}
      />
    )
    expect(container.firstChild).toBeNull()
  })

  it('exibe informacoes da versao e notas de lancamento', () => {
    render(
      <UpdateModal
        isOpen={true}
        update={sampleUpdate}
        isDownloading={false}
        progress={null}
        onClose={vi.fn()}
        onStartUpdate={vi.fn()}
      />
    )

    expect(screen.getByText('Atualização Disponível')).toBeTruthy()
    expect(screen.getByText(/v0.1.0/)).toBeTruthy()
    expect(screen.getByText(/v0.2.0/)).toBeTruthy()
    expect(screen.getByText('Melhorias de desempenho e correcao de bugs.')).toBeTruthy()
  })

  it('permite fechar via botao de fechar ou tecla Escape', () => {
    const onClose = vi.fn()
    render(
      <UpdateModal
        isOpen={true}
        update={sampleUpdate}
        isDownloading={false}
        progress={null}
        onClose={onClose}
        onStartUpdate={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Fechar' }))
    expect(onClose).toHaveBeenCalledOnce()

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('dispara onStartUpdate ao clicar em Atualizar agora', () => {
    const onStartUpdate = vi.fn()
    render(
      <UpdateModal
        isOpen={true}
        update={sampleUpdate}
        isDownloading={false}
        progress={null}
        onClose={vi.fn()}
        onStartUpdate={onStartUpdate}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Atualizar agora' }))
    expect(onStartUpdate).toHaveBeenCalledOnce()
  })

  it('exibe barra de progresso durante o download', () => {
    render(
      <UpdateModal
        isOpen={true}
        update={sampleUpdate}
        isDownloading={true}
        progress={{
          chunkLength: 1024,
          downloadedBytes: 5242880,
          totalBytes: 10485760,
          percentage: 50,
        }}
        onClose={vi.fn()}
        onStartUpdate={vi.fn()}
      />
    )

    expect(screen.getByText('50%')).toBeTruthy()
    expect(screen.getByText('5 MB de 10 MB')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Baixando \(50%\)/ })).toBeTruthy()
    // Botao de fechar deve estar oculto durante o download
    expect(screen.queryByRole('button', { name: 'Fechar' })).toBeNull()
  })

  it('exibe botao de reiniciar quando pronto', () => {
    const onRelaunch = vi.fn()
    render(
      <UpdateModal
        isOpen={true}
        update={sampleUpdate}
        isDownloading={false}
        isReadyToRelaunch={true}
        progress={null}
        onClose={vi.fn()}
        onStartUpdate={vi.fn()}
        onRelaunch={onRelaunch}
      />
    )

    expect(screen.getByText('Download concluído!')).toBeTruthy()
    const relaunchBtn = screen.getByRole('button', { name: 'Reiniciar e aplicar' })
    expect(relaunchBtn).toBeTruthy()
    fireEvent.click(relaunchBtn)
    expect(onRelaunch).toHaveBeenCalledOnce()
  })
})
