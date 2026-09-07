import { memo, useRef, useState } from 'react'
import { IconPlus, IconX } from '../Icons'
import { IconButton } from '../IconButton'
import { Modal, ModalBody, ModalFooter, ModalHeader, useModalTitleId } from '../Overlay'
import './poll.css'

/**
 * Criar enquete.
 *
 * Era o unico dialogo do app sem ARIA nenhuma — sem `role`, sem `aria-modal`,
 * sem titulo associado — e o unico escrito em utilitarios do Tailwind, com
 * `text-white` e `hover:text-red-400` fora da paleta. Tambem era o unico que
 * fechava no `onClick` do fundo, o que derrubava o formulario inteiro quando
 * alguem selecionava texto de dentro para fora.
 *
 * Agora usa o `<Modal>` compartilhado: Escape, armadilha de foco, devolucao de
 * foco e fechamento por `mousedown` vem de graca, e o CSS e do proprio projeto.
 */

const MIN_OPCOES = 2
const MAX_OPCOES = 10

interface Props {
  isOpen: boolean
  onClose(): void
  onCreatePoll(question: string, options: string[], allowMult: boolean): void
}

export const PollCreatorModal = memo(function PollCreatorModal({ isOpen, onClose, onCreatePoll }: Props) {
  const [question, setQuestion] = useState('')
  const [options, setOptions] = useState<string[]>(['', ''])
  const [allowMult, setAllowMult] = useState(false)
  const primeiroCampo = useRef<HTMLInputElement>(null)
  const tituloId = useModalTitleId()

  const validas = options.map((o) => o.trim()).filter(Boolean)
  const podeCriar = Boolean(question.trim()) && validas.length >= MIN_OPCOES

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (!podeCriar) return
    onCreatePoll(question.trim(), validas, allowMult)
    setQuestion('')
    setOptions(['', ''])
    setAllowMult(false)
    onClose()
  }

  return (
    <Modal
      open={isOpen}
      onClose={onClose}
      size="sm"
      labelledBy={tituloId}
      initialFocus={primeiroCampo}
      className="poll-creator"
    >
      <ModalHeader title="Criar enquete" titleId={tituloId} onClose={onClose} />
      <form onSubmit={handleSubmit} className="poll-creator__form">
        <ModalBody className="poll-creator__body">
          <label className="poll-creator__campo">
            <span className="poll-creator__rotulo">Pergunta</span>
            <input
              ref={primeiroCampo}
              type="text"
              className="stapp-poll-input"
              placeholder="Sobre o que você quer perguntar?"
              value={question}
              maxLength={200}
              onChange={(event) => setQuestion(event.target.value)}
            />
          </label>

          <div className="poll-creator__campo">
            <span className="poll-creator__rotulo">
              Opções <small>mínimo {MIN_OPCOES}, máximo {MAX_OPCOES}</small>
            </span>
            {options.map((opt, idx) => (
              <div key={idx} className="poll-creator__opcao">
                <input
                  type="text"
                  className="stapp-poll-input"
                  placeholder={`Opção ${idx + 1}`}
                  value={opt}
                  maxLength={100}
                  aria-label={`Opção ${idx + 1}`}
                  onChange={(event) => {
                    const next = [...options]
                    next[idx] = event.target.value
                    setOptions(next)
                  }}
                />
                {options.length > MIN_OPCOES && (
                  <IconButton
                    size="sm"
                    label={`Remover opção ${idx + 1}`}
                    icon={<IconX size={16} />}
                    onClick={() => setOptions(options.filter((_, i) => i !== idx))}
                  />
                )}
              </div>
            ))}

            {options.length < MAX_OPCOES && (
              <button type="button" className="poll-creator__adicionar" onClick={() => setOptions([...options, ''])}>
                <IconPlus size={16} /> Adicionar outra opção
              </button>
            )}
          </div>

          <label className="poll-creator__multipla">
            <input
              type="checkbox"
              checked={allowMult}
              onChange={(event) => setAllowMult(event.target.checked)}
            />
            <span>Permitir múltipla escolha</span>
          </label>
        </ModalBody>

        <ModalFooter>
          <button type="button" className="poll-creator__botao" onClick={onClose}>Cancelar</button>
          <button type="submit" className="poll-creator__botao is-primary" disabled={!podeCriar}>
            Criar enquete
          </button>
        </ModalFooter>
      </form>
    </Modal>
  )
})
