import { memo, useState } from 'react'
import './poll.css'

interface Props {
  isOpen: boolean
  onClose(): void
  onCreatePoll(question: string, options: string[], allowMult: boolean): void
}

export const PollCreatorModal = memo(function PollCreatorModal({ isOpen, onClose, onCreatePoll }: Props) {
  const [question, setQuestion] = useState('')
  const [options, setOptions] = useState<string[]>(['', ''])
  const [allowMult, setAllowMult] = useState(false)

  if (!isOpen) return null

  function addOption() {
    if (options.length < 10) {
      setOptions([...options, ''])
    }
  }

  function removeOption(index: number) {
    if (options.length > 2) {
      setOptions(options.filter((_, i) => i !== index))
    }
  }

  function handleOptionChange(index: number, val: string) {
    const next = [...options]
    next[index] = val
    setOptions(next)
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const q = question.trim()
    const validOptions = options.map((o) => o.trim()).filter(Boolean)

    if (!q || validOptions.length < 2) return

    onCreatePoll(q, validOptions, allowMult)
    setQuestion('')
    setOptions(['', ''])
    setAllowMult(false)
    onClose()
  }

  return (
    <div className="stapp-poll-modal" onClick={onClose}>
      <div className="stapp-poll-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-[var(--text)]">Criar Enquete</h3>
          <button
            type="button"
            className="text-[var(--text-dim)] hover:text-[var(--text)] text-sm cursor-pointer p-1"
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div>
            <label className="block text-xs font-semibold text-[var(--text-dim)] mb-1">
              PERGUNTA
            </label>
            <input
              type="text"
              className="stapp-poll-input"
              placeholder="Sobre o que você quer perguntar?"
              value={question}
              autoFocus
              onChange={(e) => setQuestion(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-2">
            <label className="block text-xs font-semibold text-[var(--text-dim)]">
              OPÇÕES (MÍNIMO 2, MÁXIMO 10)
            </label>
            {options.map((opt, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <input
                  type="text"
                  className="stapp-poll-input"
                  placeholder={`Opção ${idx + 1}`}
                  value={opt}
                  onChange={(e) => handleOptionChange(idx, e.target.value)}
                />
                {options.length > 2 && (
                  <button
                    type="button"
                    className="text-[var(--text-dim)] hover:text-red-400 p-1 cursor-pointer text-xs"
                    onClick={() => removeOption(idx)}
                    title="Remover opção"
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}

            {options.length < 10 && (
              <button
                type="button"
                className="text-xs text-[var(--accent)] hover:underline self-start mt-1 cursor-pointer"
                onClick={addOption}
              >
                + Adicionar outra opção
              </button>
            )}
          </div>

          <label className="flex items-center gap-2 text-xs text-[var(--text)] cursor-pointer mt-1 select-none">
            <input
              type="checkbox"
              checked={allowMult}
              onChange={(e) => setAllowMult(e.target.checked)}
              className="rounded accent-[var(--accent)]"
            />
            <span>Permitir múltipla escolha</span>
          </label>

          <div className="flex justify-end gap-2 mt-4">
            <button
              type="button"
              className="px-3 py-1.5 rounded-[var(--radius-sm)] text-xs text-[var(--text-dim)] hover:text-[var(--text)] cursor-pointer"
              onClick={onClose}
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={!question.trim() || options.filter((o) => o.trim()).length < 2}
              className="px-4 py-1.5 rounded-[var(--radius-sm)] text-xs font-semibold bg-[var(--accent)] text-white hover:opacity-90 disabled:opacity-40 cursor-pointer"
            >
              Criar Enquete
            </button>
          </div>
        </form>
      </div>
    </div>
  )
})