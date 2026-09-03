// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAutoUpdater } from './useAutoUpdater'
import { updaterService } from './index'
import type { AvailableUpdate } from './types'

vi.mock('./index', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./index')>()
  return {
    ...actual,
    updaterService: {
      isDesktop: true,
      getChannel: vi.fn(() => 'beta'),
      setChannel: vi.fn(),
      getCurrentVersion: vi.fn(async () => '0.1.0'),
      checkForUpdate: vi.fn(async () => null),
      downloadAndInstall: vi.fn(async () => {}),
      relaunch: vi.fn(async () => {}),
    },
  }
})

const mockUpdate: AvailableUpdate = {
  version: '0.2.0',
  currentVersion: '0.1.0',
  body: 'Notas de lancamento',
}

describe('useAutoUpdater', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('inicializa com a versao do aplicativo e canal', async () => {
    const { result } = renderHook(() => useAutoUpdater())
    await act(async () => {})

    expect(result.current.currentVersion).toBe('0.1.0')
    expect(result.current.isDesktop).toBe(true)
    expect(result.current.channel).toBe('beta')
    expect(result.current.mandatoryRequirement).toBeNull()

    act(() => {
      result.current.setChannel('stable')
    })
    expect(updaterService.setChannel).toHaveBeenCalledWith('stable')
    expect(result.current.channel).toBe('stable')
  })

  it('ativa bloqueio obrigatorio quando enforceMandatoryVersion recebe versao superior', async () => {
    const { result } = renderHook(() => useAutoUpdater())
    await act(async () => {})

    act(() => {
      result.current.enforceMandatoryVersion('0.2.0', 'Servidor Alpha')
    })

    expect(result.current.mandatoryRequirement).toEqual({
      minVersion: '0.2.0',
      serverName: 'Servidor Alpha',
    })

    // Se receber versao compativel, nao bloqueia
    act(() => {
      result.current.enforceMandatoryVersion('0.1.0', 'Servidor Alpha')
    })
  })

  it('busca atualizacoes e abre modal quando disponivel', async () => {
    vi.mocked(updaterService.checkForUpdate).mockResolvedValueOnce(mockUpdate)
    const { result } = renderHook(() => useAutoUpdater())
    await act(async () => {})

    let res: AvailableUpdate | null = null
    await act(async () => {
      res = await result.current.checkForUpdates(true)
    })

    expect(res).toEqual(mockUpdate)
    expect(result.current.isModalOpen).toBe(true)
    expect(result.current.availableUpdate).toEqual(mockUpdate)
  })

  it('executa download e atualiza estado para pronto para reiniciar', async () => {
    vi.mocked(updaterService.checkForUpdate).mockResolvedValueOnce(mockUpdate)
    const { result } = renderHook(() => useAutoUpdater())
    await act(async () => {})

    await act(async () => {
      await result.current.checkForUpdates(true)
    })

    await act(async () => {
      await result.current.startUpdate()
    })

    expect(updaterService.downloadAndInstall).toHaveBeenCalledOnce()
    expect(result.current.isReadyToRelaunch).toBe(true)
    expect(result.current.isDownloading).toBe(false)
  })

  it('chama relaunch ao solicitar reinicio', async () => {
    const { result } = renderHook(() => useAutoUpdater())
    await act(async () => {})

    await act(async () => {
      await result.current.relaunch()
    })

    expect(updaterService.relaunch).toHaveBeenCalledOnce()
  })
})
