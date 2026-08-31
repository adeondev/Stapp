// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { PollCard } from './PollCard'
import type { Poll } from '../../protocol'

describe('PollCard', () => {
  const mockPoll: Poll = {
    id: 'poll-1',
    message_id: 'msg-1',
    author_id: 'user-alice',
    question: 'Qual o melhor editor?',
    allow_mult: false,
    closed: false,
    total_votes: 10,
    options: [
      { id: 'opt-1', text: 'Neovim', votes: 6, voted_by_me: true },
      { id: 'opt-2', text: 'VSCode', votes: 4, voted_by_me: false },
    ],
    created_at: 1000,
  }

  it('renderiza a pergunta, opções, porcentagens e permite votar', () => {
    const onVote = vi.fn()
    render(<PollCard poll={mockPoll} selfUserId="user-bob" onVote={onVote} />)

    expect(screen.getByText('Qual o melhor editor?')).toBeTruthy()
    expect(screen.getByText('60% (6)')).toBeTruthy()
    expect(screen.getByText('40% (4)')).toBeTruthy()
    expect(screen.getByText('10 votos no total')).toBeTruthy()

    fireEvent.click(screen.getByText('VSCode'))
    expect(onVote).toHaveBeenCalledWith('poll-1', 'opt-2')
  })

  it('mostra botão de encerrar apenas para o autor da enquete', () => {
    const onClose = vi.fn()
    const { rerender } = render(
      <PollCard poll={mockPoll} selfUserId="user-bob" onVote={vi.fn()} onClosePoll={onClose} />
    )
    expect(screen.queryByText('Encerrar enquete')).toBeNull()

    rerender(
      <PollCard poll={mockPoll} selfUserId="user-alice" onVote={vi.fn()} onClosePoll={onClose} />
    )
    const closeBtn = screen.getByText('Encerrar enquete')
    expect(closeBtn).toBeTruthy()
    fireEvent.click(closeBtn)
    expect(onClose).toHaveBeenCalledWith('poll-1')
  })
})