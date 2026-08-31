import { memo } from 'react'
import type { Poll, UserId } from '../../protocol'
import './poll.css'

interface Props {
  poll: Poll
  selfUserId?: UserId
  onVote(pollId: string, optionId: string): void
  onClosePoll?(pollId: string): void
}

export const PollCard = memo(function PollCard({ poll, selfUserId, onVote, onClosePoll }: Props) {
  const isAuthor = Boolean(selfUserId && selfUserId === poll.author_id)
  const total = poll.total_votes

  return (
    <div className="stapp-poll-card">
      <div className="stapp-poll-header">
        <span className="stapp-poll-question">{poll.question}</span>
        <span className="stapp-poll-badge">
          {poll.closed ? 'Encerrada' : poll.allow_mult ? 'Múltipla escolha' : 'Escolha única'}
        </span>
      </div>

      <div className="stapp-poll-options">
        {poll.options.map((opt) => {
          const percent = total > 0 ? Math.round((opt.votes / total) * 100) : 0
          const isVoted = Boolean(opt.voted_by_me)

          return (
            <button
              key={opt.id}
              type="button"
              className={`stapp-poll-option-btn ${isVoted ? 'is-voted' : ''}`}
              disabled={poll.closed}
              onClick={() => onVote(poll.id, opt.id)}
              title={poll.closed ? 'Enquete encerrada' : opt.text}
            >
              <div
                className="stapp-poll-option-bar"
                style={{ width: `${percent}%` }}
              />
              <div className="stapp-poll-option-text">
                {isVoted && (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
                <span>{opt.text}</span>
              </div>
              <div className="stapp-poll-option-stats">
                {percent}% ({opt.votes})
              </div>
            </button>
          )
        })}
      </div>

      <div className="stapp-poll-footer">
        <span>{total} {total === 1 ? 'voto' : 'votos'} no total</span>
        {!poll.closed && isAuthor && onClosePoll && (
          <button
            type="button"
            className="text-[var(--text-dim)] hover:text-[var(--text)] transition-colors cursor-pointer text-xs"
            onClick={() => onClosePoll(poll.id)}
            title="Encerrar enquete agora"
          >
            Encerrar enquete
          </button>
        )}
      </div>
    </div>
  )
})