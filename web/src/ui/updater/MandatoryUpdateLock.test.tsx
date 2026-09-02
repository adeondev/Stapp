// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MandatoryUpdateLock } from './MandatoryUpdateLock'

describe('MandatoryUpdateLock', () => {
  it('renderiza a tela de bloqueio com as versoes corretas', () => {
    render(
      <MandatoryUpdateLock
        currentVersion="0.1.0"
        requiredVersion="0.2.0"
        serverName="Servidor dos Amigos"
        isDesktop={true}
        isDownloading={false}
        progress={null}
        onStartUpdate={vi.fn()}
      />
    )

    expect(screen.getByText('Atualização Obrigatória')).toBeTruthy()
    expect(screen.getByText(/Servidor dos Amigos/)).toBeTruthy()
    expect(screen.getAllByText(/v0\.1\.0/).length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText(/v0\.2\.0/).length).toBeGreaterThanOrEqual(1)
    expect(screen.getByRole('button', { name: 'Baixar e Atualizar Agora' })).toBeTruthy()
  })

  it('nao fecha nem reage ao pressionar Escape', () => {
    render(
      <MandatoryUpdateLock
        currentVersion="0.1.0"
        requiredVersion="0.2.0"
        isDesktop={true}
        isDownloading={false}
        progress={null}
        onStartUpdate={vi.fn()}
      />
    )

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.getByText('Atualização Obrigatória')).toBeTruthy()
  })

  it('dispara onStartUpdate no cliente desktop', () => {
    const onStartUpdate = vi.fn()
    render(
      <MandatoryUpdateLock
        currentVersion="0.1.0"
        requiredVersion="0.2.0"
        isDesktop={true}
        isDownloading={false}
        progress={null}
        onStartUpdate={onStartUpdate}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Baixar e Atualizar Agora' }))
    expect(onStartUpdate).toHaveBeenCalledOnce()
  })

  it('renderiza acao de recarregar no navegador web', () => {
    const onWebReload = vi.fn()
    render(
      <MandatoryUpdateLock
        currentVersion="0.1.0"
        requiredVersion="0.2.0"
        isDesktop={false}
        isDownloading={false}
        progress={null}
        onStartUpdate={vi.fn()}
        onWebReload={onWebReload}
      />
    )

    const reloadBtn = screen.getByRole('button', { name: 'Recarregar Página' })
    expect(reloadBtn).toBeTruthy()
    fireEvent.click(reloadBtn)
    expect(onWebReload).toHaveBeenCalledOnce()
  })

  it('exibe progresso de download e botao de reinicializacao', () => {
    const onRelaunch = vi.fn()
    const { rerender } = render(
      <MandatoryUpdateLock
        currentVersion="0.1.0"
        requiredVersion="0.2.0"
        isDesktop={true}
        isDownloading={true}
        progress={{
          chunkLength: 2048,
          downloadedBytes: 15728640,
          totalBytes: 20971520,
          percentage: 75,
        }}
        onStartUpdate={vi.fn()}
      />
    )

    expect(screen.getByText('75%')).toBeTruthy()
    expect(screen.getByText('15 MB de 20 MB')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Instalando atualização \(75%\)/ })).toBeTruthy()

    rerender(
      <MandatoryUpdateLock
        currentVersion="0.1.0"
        requiredVersion="0.2.0"
        isDesktop={true}
        isDownloading={false}
        isReadyToRelaunch={true}
        progress={null}
        onStartUpdate={vi.fn()}
        onRelaunch={onRelaunch}
      />
    )

    expect(screen.getByText('Download concluído com sucesso!')).toBeTruthy()
    const restartBtn = screen.getByRole('button', { name: 'Reiniciar Aplicativo' })
    expect(restartBtn).toBeTruthy()
    fireEvent.click(restartBtn)
    expect(onRelaunch).toHaveBeenCalledOnce()
  })

  it('exibe erro e link de download manual quando a atualizacao falha', () => {
    render(
      <MandatoryUpdateLock
        currentVersion="0.1.0"
        requiredVersion="0.2.0"
        isDesktop={true}
        isDownloading={false}
        progress={null}
        error="Falha na verificacao da assinatura digital."
        onStartUpdate={vi.fn()}
      />
    )

    expect(screen.getByText('Falha na verificacao da assinatura digital.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Baixar Manualmente no GitHub' })).toBeTruthy()
  })
})
