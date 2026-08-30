//! Perfil publico da conta: nome de exibicao, cor e bio.
//!
//! O perfil e **publico dentro do servidor** — quem entrou ja pode ver o de todo
//! mundo. Por isso a edicao vai por broadcast: cada tela redesenha o nome e o
//! avatar na hora, sem ninguem precisar reconectar.

use crate::protocol::{Profile, ServerMsg, UserId, now_ms};
use crate::session::AppState;

/// As cores que o tema conhece. Guardamos o nome, nao o hex, entao esta lista e
/// o unico lugar que precisa concordar com o `theme.css`.
pub const ACCENTS: [&str; 6] = ["blue", "green", "red", "amber", "purple", "cyan"];

const MAX_DISPLAY_NAME: usize = 32;
const MAX_BIO: usize = 190;

/// Todos os perfis, para o `welcome`.
pub fn all(state: &AppState) -> Vec<Profile> {
    state.db.all_profiles().unwrap_or_else(|err| {
        tracing::error!(%err, "falha lendo os perfis");
        Vec::new()
    })
}

pub async fn update(
    state: &AppState,
    peer_id: &str,
    display_name: Option<String>,
    accent: Option<String>,
    bio: Option<String>,
) {
    let Some(me) = state.identity_of(peer_id).await else {
        return;
    };

    // Vazio nao e "nao mexe": e "apaga a escolha e volta pro username".
    let display_name = match display_name {
        Some(raw) => match limpar(&raw, MAX_DISPLAY_NAME) {
            Some(nome) => Some(nome),
            None if raw.trim().is_empty() => Some(String::new()),
            None => return refuse(state, peer_id, "esse nome de exibicao nao vale"),
        },
        None => None,
    };

    if let Some(cor) = accent.as_deref()
        && !ACCENTS.contains(&cor)
    {
        return refuse(state, peer_id, "essa cor nao existe");
    }

    let bio = match bio {
        Some(raw) => Some(limpar(&raw, MAX_BIO).unwrap_or_default()),
        None => None,
    };

    if let Err(err) = state.db.update_profile(
        &me.user_id,
        display_name.as_deref(),
        accent.as_deref(),
        bio.as_deref(),
        now_ms(),
    ) {
        tracing::error!(%err, "falha gravando o perfil");
        return refuse(state, peer_id, "nao consegui salvar o perfil");
    }

    announce(state, &me.user_id);
}

/// Manda o perfil atual para todo mundo. Publico, entao broadcast mesmo.
pub fn announce(state: &AppState, user_id: &UserId) {
    match state.db.profile_of(user_id) {
        Ok(Some(profile)) => state.broadcast(ServerMsg::UserProfile { profile }),
        Ok(None) => {}
        Err(err) => tracing::error!(%err, "falha lendo o perfil para anunciar"),
    }
}

/// Tira controle, corta no limite e apara as pontas. `None` quando nao sobrou nada.
fn limpar(raw: &str, limite: usize) -> Option<String> {
    let texto: String = raw
        .chars()
        .filter(|c| *c == '\n' || !c.is_control())
        .take(limite)
        .collect();
    let texto = texto.trim().to_string();
    (!texto.is_empty()).then_some(texto)
}

fn refuse(state: &AppState, peer_id: &str, message: &str) {
    state.send_to(
        peer_id,
        ServerMsg::Error {
            message: message.to_string(),
        },
    );
}

#[cfg(test)]
mod tests;
