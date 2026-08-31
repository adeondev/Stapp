// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AudioPlayer } from './AudioPlayer'

// Mock WaveSurfer
vi.mock('wavesurfer.js', () => {
  return {
    default: {
      create: vi.fn(() => ({
        on: vi.fn(),
        destroy: vi.fn(),
        getDuration: vi.fn(() => 42),
        getCurrentTime: vi.fn(() => 0),
        playPause: vi.fn(),
      })),
    },
  }
})

describe('AudioPlayer', () => {
  it('renderiza o player de áudio com botão de play e contador', () => {
    render(<AudioPlayer src="https://stapp.chat/audio.webm" filename="gravacao.webm" />)

    const btn = screen.getByTitle('Reproduzir')
    expect(btn).toBeTruthy()
    expect(screen.getByText('0:00 / 0:00')).toBeTruthy()
  })
})