/**
 * O que pode chegar como notificacao nativa do sistema operacional.
 *
 * As notificacoes nativas ja existiam e disparavam sempre — nao havia nenhum
 * lugar para deslig ar uma delas. Este modulo e o interruptor, e vive fora do
 * componente de configuracoes de proposito: quem dispara e o `App`, na chegada
 * da mensagem, e ele nao deve depender de nenhuma tela estar montada.
 *
 * A preferencia e **local**, como o tema e as opcoes de voz: e a escolha deste
 * aparelho, nao da conta. O mesmo login num celular e num desktop nao deve
 * herdar a decisao um do outro.
 */

export interface NotificationPreferences {
  /** Chamada recebida (1:1 e convite para sala). */
  calls: boolean
  /** Mensagem direta nova. */
  directMessages: boolean
  /** Citacao por `@` num canal, e `@everyone`. */
  mentions: boolean
}

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  calls: true,
  directMessages: true,
  mentions: true,
}

const CHAVE = 'stapp.notifications.v1'

export function loadNotificationPreferences(): NotificationPreferences {
  try {
    const bruto = localStorage.getItem(CHAVE)
    if (!bruto) return { ...DEFAULT_NOTIFICATION_PREFERENCES }
    const valor = JSON.parse(bruto) as Partial<NotificationPreferences>
    return {
      calls: valor.calls ?? DEFAULT_NOTIFICATION_PREFERENCES.calls,
      directMessages: valor.directMessages ?? DEFAULT_NOTIFICATION_PREFERENCES.directMessages,
      mentions: valor.mentions ?? DEFAULT_NOTIFICATION_PREFERENCES.mentions,
    }
  } catch {
    // Aba anonima ou armazenamento bloqueado: tudo ligado, como no primeiro uso.
    return { ...DEFAULT_NOTIFICATION_PREFERENCES }
  }
}

export function saveNotificationPreferences(preferences: NotificationPreferences) {
  try {
    localStorage.setItem(CHAVE, JSON.stringify(preferences))
  } catch {
    // Sem armazenamento a escolha vale so para esta sessao — melhor do que nada.
  }
}

/**
 * A leitura que o `App` faz na hora de notificar.
 *
 * E uma funcao, e nao um valor guardado no modulo, porque a preferencia pode
 * mudar com o app aberto: ler no momento do disparo evita ter que propagar o
 * estado das configuracoes ate o tratamento de mensagens.
 */
export function notificationAllowed(kind: keyof NotificationPreferences): boolean {
  return loadNotificationPreferences()[kind]
}
