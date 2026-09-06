import { IconServer, IconShield, IconUser } from './Icons'
import { Modal, ModalHeader, useModalTitleId } from './Overlay'
import './helpmodal.css'

interface HelpModalProps {
  isOpen: boolean
  onClose: () => void
  type: 'connection' | 'auth'
  serverName?: string
}

/* O scrim, o Escape, a armadilha de foco e o fechamento por clique de fundo vem
   do `<Modal>`. O `useEffect` de Escape que morava aqui era a quarta copia
   literal do mesmo bloco no projeto. */
export function HelpModal({ isOpen, onClose, type, serverName }: HelpModalProps) {
  const tituloId = useModalTitleId()

  return (
    <Modal open={isOpen} onClose={onClose} size="md" labelledBy={tituloId} className="help-modal__dialog">
      <>
        <ModalHeader
          titleId={tituloId}
          onClose={onClose}
          title={type === 'connection' ? 'Dificuldade para conectar?' : 'Ajuda com a conta'}
          overline={type === 'connection'
            ? 'Instruções para estabelecer conexão com o servidor Stapp.'
            : `Orientações de acesso para o servidor ${serverName ? `"${serverName}"` : 'atual'}.`}
        />

        <div className="help-modal__list">
          {type === 'connection' ? (
            <>
              <div className="help-modal__row">
                <div className="help-modal__row-icon" aria-hidden="true">
                  <IconServer size={16} />
                </div>
                <div className="help-modal__row-content">
                  <span className="help-modal__row-title">Formato do endereço</span>
                  <p className="help-modal__row-text">
                    Use <code>ws://</code> para rede local ou <code>wss://</code> para internet segura. Exemplo:{' '}
                    <code>ws://127.0.0.1:8787/ws</code>
                  </p>
                </div>
              </div>

              <div className="help-modal__row">
                <div className="help-modal__row-icon" aria-hidden="true">
                  <IconShield size={16} />
                </div>
                <div className="help-modal__row-content">
                  <span className="help-modal__row-title">Servidor em execução</span>
                  <p className="help-modal__row-text">
                    Confirme se o executável <code>stapp-server</code> está rodando na máquina de destino na porta{' '}
                    <code>8787</code>.
                  </p>
                </div>
              </div>

              <div className="help-modal__row">
                <div className="help-modal__row-icon" aria-hidden="true">
                  <IconShield size={16} />
                </div>
                <div className="help-modal__row-content">
                  <span className="help-modal__row-title">Firewall e portas</span>
                  <p className="help-modal__row-text">
                    Verifique se a porta 8787 não está bloqueada pelo firewall do roteador ou do sistema operacional.
                  </p>
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="help-modal__row">
                <div className="help-modal__row-icon" aria-hidden="true">
                  <IconUser size={16} />
                </div>
                <div className="help-modal__row-content">
                  <span className="help-modal__row-title">Conta exclusiva deste servidor</span>
                  <p className="help-modal__row-text">
                    Não existe conta centralizada no Stapp. Seus dados e seu login pertencem somente a este servidor.
                  </p>
                </div>
              </div>

              <div className="help-modal__row">
                <div className="help-modal__row-icon" aria-hidden="true">
                  <IconShield size={16} />
                </div>
                <div className="help-modal__row-content">
                  <span className="help-modal__row-title">Esqueceu sua senha?</span>
                  <p className="help-modal__row-text">
                    Por segurança, o Stapp não armazena e-mails. Peça ao administrador do servidor para redefinir a credencial.
                  </p>
                </div>
              </div>
            </>
          )}
        </div>

        <footer className="help-modal__actions">
          <button type="button" className="help-modal__btn-primary" onClick={onClose}>
            Entendi
          </button>
        </footer>
      </>
    </Modal>
  )
}
