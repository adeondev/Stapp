//! Perfil publico da conta: nome de exibicao, cor e bio.
//!
//! O perfil e **publico dentro do servidor** — quem entrou ja pode ver o de todo
//! mundo. Por isso a edicao vai por broadcast: cada tela redesenha o nome e o
//! avatar na hora, sem ninguem precisar reconectar.

pub mod avatar;

use std::path::PathBuf;

use crate::protocol::{Profile, ServerMsg, UserId, now_ms};
use crate::session::AppState;

/// As cores que o tema conhece. Guardamos o nome, nao o hex, entao esta lista e
/// o unico lugar que precisa concordar com o `theme.css`.
pub const ACCENTS: [&str; 6] = ["blue", "green", "red", "amber", "purple", "cyan"];

const MAX_DISPLAY_NAME: usize = 32;
const MAX_BIO: usize = 190;

/// Todos os perfis, para o `welcome`.
pub async fn all(state: &AppState) -> Vec<Profile> {
    state.db.all_profiles().await.unwrap_or_else(|err| {
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
    ).await {
        tracing::error!(%err, "falha gravando o perfil");
        return refuse(state, peer_id, "nao consegui salvar o perfil");
    }

    announce(state, &me.user_id).await;
}

/// O que so aparece quando alguem ABRE um perfil.
///
/// Fica fora do `Profile` de proposito: o `welcome` manda o perfil de todo mundo
/// de uma vez, e amigos em comum e uma consulta por par de contas. Mandar isso
/// junto seria N consultas para preencher uma tela que quase ninguem abre.
pub async fn detail(state: &AppState, peer_id: &str, user_id: UserId) {
    let Some(me) = state.identity_of(peer_id).await else {
        return;
    };
    // Os dois lados da consulta saem da sessao e do pedido; o cliente nunca
    // escolhe quem e "eu".
    let mutual = if me.user_id == user_id {
        Vec::new()
    } else {
        state
            .db
            .mutual_friends(&me.user_id, &user_id)
            .await
            .unwrap_or_else(|err| {
                tracing::error!(%err, "falha lendo amigos em comum");
                Vec::new()
            })
    };
    state.send_to(
        peer_id,
        ServerMsg::ProfileDetail {
            user_id,
            mutual_friends: mutual,
        },
    );
}

/// Guarda a imagem e avisa todo mundo. Devolve o tamanho gravado.
pub async fn set_avatar(state: &AppState, user_id: &UserId, bytes: &[u8]) -> Result<usize, String> {
    let dir = avatar_dir(state);
    let tamanho = avatar::store(&dir, user_id, bytes).await.map_err(|erro| erro.to_string())?;

    if let Err(err) = state
        .db
        .set_avatar(user_id, Some(avatar::extensao()), now_ms())
        .await
    {
        tracing::error!(%err, "falha marcando o avatar no banco");
        // O arquivo sem a linha no banco seria lixo invisivel.
        avatar::remove(&dir, user_id).await;
        return Err("nao consegui salvar o avatar".into());
    }

    announce(state, user_id).await;
    Ok(tamanho)
}

/// Volta ao avatar gerado.
pub async fn clear_avatar(state: &AppState, user_id: &UserId) {
    if let Err(err) = state.db.set_avatar(user_id, None, now_ms()).await {
        tracing::error!(%err, "falha limpando o avatar");
        return;
    }
    avatar::remove(&avatar_dir(state), user_id).await;
    announce(state, user_id).await;
}

pub async fn read_avatar(state: &AppState, user_id: &UserId) -> Option<Vec<u8>> {
    avatar::read(&avatar_dir(state), user_id).await
}

/// O banner passa pelo mesmo processo do avatar; muda so a forma do corte.
pub async fn set_banner(state: &AppState, user_id: &UserId, bytes: &[u8]) -> Result<usize, String> {
    let dir = banner_dir(state);
    let tamanho = avatar::store_shape(&dir, user_id, bytes, avatar::Shape::Banner)
        .await
        .map_err(|erro| erro.to_string())?;

    if let Err(err) = state
        .db
        .set_banner(user_id, Some(avatar::extensao()), now_ms())
        .await
    {
        tracing::error!(%err, "falha marcando o banner no banco");
        // O arquivo sem a linha no banco seria lixo invisivel.
        avatar::remove(&dir, user_id).await;
        return Err("nao consegui salvar o banner".into());
    }

    announce(state, user_id).await;
    Ok(tamanho)
}

pub async fn clear_banner(state: &AppState, user_id: &UserId) {
    if let Err(err) = state.db.set_banner(user_id, None, now_ms()).await {
        tracing::error!(%err, "falha limpando o banner");
        return;
    }
    avatar::remove(&banner_dir(state), user_id).await;
    announce(state, user_id).await;
}

pub async fn read_banner(state: &AppState, user_id: &UserId) -> Option<Vec<u8>> {
    avatar::read(&banner_dir(state), user_id).await
}

fn avatar_dir(state: &AppState) -> PathBuf {
    state.config.avatar_dir()
}

fn banner_dir(state: &AppState) -> PathBuf {
    state.config.banner_dir()
}

/// Manda o perfil atual para todo mundo. Publico, entao broadcast mesmo.
pub async fn announce(state: &AppState, user_id: &UserId) {
    match state.db.profile_of(user_id).await {
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
