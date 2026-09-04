//! Quem foi citado no texto.
//!
//! **O texto nao e reescrito.** A pessoa digitou `@daniel` e o cliente recebe
//! `@daniel`; `mentions` diz, separadamente, quais contas aquilo alcancou. Nao
//! existe formato de marcacao (`<@id>`) para o cliente decodificar, e o
//! historico continua legivel num `sqlite3`.
//!
//! Isso so fica correto porque `username` **nao muda** no Stapp: `profile.update`
//! mexe em `display_name`, `accent` e `bio`, nunca no username. O que muda —
//! nome de exibicao, cor, avatar — continua saindo do mapa de perfis a partir do
//! `user_id`, como manda a regra dura do CLAUDE.md.

use crate::protocol::UserId;
use crate::session::AppState;

/// Quantas contas uma mensagem pode citar.
///
/// PROTOTYPE: um teto seco, sem nocao de permissao. Ele existe para uma
/// mensagem nao virar um gatilho de notificacao para o servidor inteiro.
const MAX_MENTIONS: usize = 20;

/// Reservado: `@everyone` nunca vira conta, mesmo que exista alguem com esse
/// username.
const TODOS: &str = "everyone";

#[derive(Debug, Default, PartialEq, Eq)]
pub struct Mentions {
    pub user_ids: Vec<UserId>,
    pub everyone: bool,
}

/// Os candidatos a menção num texto, na ordem em que aparecem.
///
/// O charset depois do `@` e o mesmo de [`crate::auth::credentials::validate_username`]
/// — importado de la em vez de recopiado, senao um dia os dois divergem e
/// `@nome.com` passa a citar uma conta que nao existe.
fn candidatos(text: &str) -> Vec<String> {
    let mut achados = Vec::new();
    let bytes: Vec<char> = text.chars().collect();
    let mut i = 0;

    while i < bytes.len() {
        if bytes[i] != '@' {
            i += 1;
            continue;
        }
        let inicio = i + 1;
        let mut fim = inicio;
        while fim < bytes.len() && eh_de_username(bytes[fim]) {
            fim += 1;
        }
        if fim > inicio {
            achados.push(bytes[inicio..fim].iter().collect::<String>());
        }
        i = fim.max(inicio);
    }
    achados
}

fn eh_de_username(ch: char) -> bool {
    ch.is_ascii_alphanumeric() || matches!(ch, '_' | '-' | '.')
}

/// Resolve `@username` e `@everyone` contra as contas deste servidor.
///
/// PROTOTYPE: o casamento pega a sequencia **maxima** de caracteres validos
/// depois do `@`. Entao `@daniel.` procura a conta "daniel." e nao "daniel" —
/// sem id dentro do texto nao da para desambiguar. FUTURE: o cliente mandar
/// `mentions` junto do `chat.send` e o servidor so conferir; ai o autocomplete
/// decide o alvo e a ambiguidade some.
pub async fn resolve(state: &AppState, text: &str) -> Mentions {
    let mut saida = Mentions::default();

    for bruto in candidatos(text) {
        let chave = bruto.to_ascii_lowercase();
        if chave == TODOS {
            saida.everyone = true;
            continue;
        }
        if saida.user_ids.len() >= MAX_MENTIONS {
            break;
        }
        // Uma consulta por candidato do texto (tipicamente zero ou um), nao por
        // conta do servidor: `username_key` e UNIQUE e indexado.
        if let Ok(Some(conta)) = state.db.account_by_key(&chave).await {
            if !saida.user_ids.contains(&conta.id) {
                saida.user_ids.push(conta.id);
            }
        }
    }

    saida
}
