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
    vi.mocked(updaterService.checkForUpdate).mockResolvedValue(mockUpdate)
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
    vi.mocked(updaterService.checkForUpdate).mockResolvedValue(mockUpdate)
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
    expect(result.current.relaunchFailed).toBe(false)
  })

  it('libera o boot quando o relaunch falha, em vez de prender na splash', async () => {
    vi.mocked(updaterService.checkForUpdate).mockResolvedValue(mockUpdate)
    vi.mocked(updaterService.relaunch).mockRejectedValueOnce(new Error('instalador em uso'))
    const { result } = renderHook(() => useAutoUpdater())
    await act(async () => {})

    // Com atualizacao encontrada o boot fica retido de proposito sob o modal.
    expect(result.current.bootPhase).toBe('checking')

    await act(async () => {
      await result.current.startUpdate()
    })
    expect(result.current.isReadyToRelaunch).toBe(true)

    // Antes da correcao, dismissModal era no-op daqui em diante e a unica saida
    // era um relaunch que acabara de falhar.
    await act(async () => {
      await result.current.relaunch()
    })
    expect(result.current.relaunchFailed).toBe(true)
    expect(result.current.error).toBe('instalador em uso')

    act(() => {
      result.current.dismissModal()
    })
    expect(result.current.isModalOpen).toBe(false)
    expect(result.current.bootPhase).toBe('ready')
  })

  it('inicia em checking no desktop e transiciona para ready ao resolver sem atualizacao', async () => {
    let resolveCheck: (value: AvailableUpdate | null) => void
    const checkPromise = new Promise<AvailableUpdate | null>((resolve) => {
      resolveCheck = resolve
    })
    vi.mocked(updaterService.checkForUpdate).mockReturnValueOnce(checkPromise)

    const { result } = renderHook(() => useAutoUpdater())
    expect(result.current.bootPhase).toBe('checking')

    await act(async () => {
      resolveCheck!(null)
    })

    expect(result.current.bootPhase).toBe('ready')
    expect(result.current.isModalOpen).toBe(false)
  })

  it('mantem bootPhase em checking quando atualizacao e detectada e transiciona ao fechar o modal', async () => {
    vi.mocked(updaterService.checkForUpdate).mockResolvedValueOnce(mockUpdate)

    const { result } = renderHook(() => useAutoUpdater())
    await act(async () => {})

    expect(result.current.bootPhase).toBe('checking')
    expect(result.current.isModalOpen).toBe(true)
    expect(result.current.availableUpdate).toEqual(mockUpdate)

    act(() => {
      result.current.dismissModal()
    })

    expect(result.current.isModalOpen).toBe(false)
    expect(result.current.bootPhase).toBe('ready')
  })

  it('libera o boot para ready apos o timeout de seguranca de 5 segundos caso a checagem demore', async () => {
    vi.useFakeTimers()
    try {
      // Promise que nao resolve dentro de 5 segundos
      vi.mocked(updaterService.checkForUpdate).mockReturnValueOnce(new Promise(() => {}))

      const { result } = renderHook(() => useAutoUpdater())
      expect(result.current.bootPhase).toBe('checking')

      act(() => {
        vi.advanceTimersByTime(4999)
      })
      expect(result.current.bootPhase).toBe('checking')

      act(() => {
        vi.advanceTimersByTime(1)
      })
      expect(result.current.bootPhase).toBe('ready')
    } finally {
      vi.useRealTimers()
    }
  })

  it('inicia imediatamente como ready quando fora do desktop (web)', async () => {
    const origDesktop = updaterService.isDesktop
    try {
      // @ts-expect-error mutando para testar ambiente web
      updaterService.isDesktop = false

      const { result } = renderHook(() => useAutoUpdater())
      expect(result.current.bootPhase).toBe('ready')
      expect(result.current.isDesktop).toBe(false)
    } finally {
      // @ts-expect-error restaurando estado original
      updaterService.isDesktop = origDesktop
    }
  })
})
