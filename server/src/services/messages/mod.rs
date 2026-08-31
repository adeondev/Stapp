//! O que vale para qualquer mensagem, seja de canal ou de conversa.
//!
//! Existe porque canal e conversa tratam a **mensagem** igual — o que muda
//! entre os dois e so a audiencia do evento. Deixar essas regras em
//! `services/chat` e `services/direct` foi o que produziu duas copias byte a
//! byte do `clean_text`; com o limite virando config, duas copias virariam duas
//! fontes da verdade para o mesmo numero.

pub mod mentions;

use std::sync::Arc;

use crate::protocol::{DirectMessageKind, Limits, ServerMsg, UserId, now_ms};
use crate::session::AppState;
use crate::storage::{MessageLocation, conversation_pair};

/// Traduz a config nos tetos que o cliente entende.
///
/// Mesmo caminho de `voice::client_config`: config -> protocolo -> `welcome`.
pub fn client_limits(state: &AppState) -> Limits {
    Limits {
        max_upload_bytes: state.config.limits.max_upload_bytes(),
        max_text_chars: state.config.limits.max_text_chars,
    }
}

/// Tira caracteres de controle e apara as pontas.
///
/// `None` quer dizer "nao sobrou texto" — quem chama decide se isso e um envio
/// vazio (que so vale com anexo) ou um erro.
pub fn clean_text(raw: &str) -> Option<String> {
    let text: String = raw
        .chars()
        .filter(|c| *c == '\n' || !c.is_control())
        .collect();
    let text = text.trim().to_string();
    (!text.is_empty()).then_some(text)
}

/// `true` se o texto cabe no teto do servidor.
///
/// Conta **caracteres**, nao bytes: quem escreve pensa em letras, e um emoji
/// ocupa quatro bytes sem ser quatro letras.
pub fn fits(text: &str, max_chars: usize) -> bool {
    text.chars().count() <= max_chars
}

/// Avisa quem mandou que o texto passou do teto.
///
/// Antes o servidor **cortava em silencio** nos 2000 caracteres: a pessoa via a
/// propria mensagem chegar truncada sem nenhum aviso, e nao havia como o
/// cliente saber que isso ia acontecer. Recusar e dizer o motivo e mais honesto
/// — e o cliente ja recebe o teto no `welcome` para nem deixar chegar aqui.
pub fn reject_too_long(state: &AppState, peer_id: &str, max_chars: usize) {
    state.send_to(
        peer_id,
        ServerMsg::Error {
            message: format!("a mensagem passa do limite de {max_chars} caracteres"),
        },
    );
}

/// Quem esta pedindo e onde a mensagem mora.
///
/// `None` cobre "nao existe" e "nao consegui identificar voce" com a mesma
/// resposta de proposito: confirmar que um id existe ja seria contar sobre a
/// conversa dos outros para quem esta chutando UUID.
async fn localizar(
    state: &AppState,
    peer_id: &str,
    message_id: &str,
) -> Option<(UserId, MessageLocation)> {
    let me = state.identity_of(peer_id).await?;
    let local = state.db.locate_message(message_id).ok().flatten()?;
    Some((me.user_id, local))
}

fn recusar(state: &AppState, peer_id: &str, motivo: &str) {
    state.send_to(
        peer_id,
        ServerMsg::Error {
            message: motivo.into(),
        },
    );
}

/// Quem pode ver esta mensagem.
///
/// **Regra dura:** evento de canal vai por broadcast; evento de conversa vai so
/// nas sessoes das duas contas, e cada lado recebe `user_id` = a outra pessoa.
/// Toda atualizacao passa por aqui — nao chame `state.broadcast` direto num
/// caminho que pode ser DM, senao o servidor inteiro fica sabendo quem conversa
/// com quem.
async fn publicar_atualizacao(state: &AppState, local: &MessageLocation, message_id: &str) {
    match local {
        MessageLocation::Channel { channel, .. } => {
            let Ok(Some(msg)) = state.db.message_by_id(message_id) else {
                return;
            };
            state.broadcast(ServerMsg::ChatUpdated {
                channel: channel.clone(),
                msg,
            });
        }
        MessageLocation::Direct {
            conversation_id, ..
        } => {
            let Ok(Some(msg)) = state.db.direct_by_id(message_id) else {
                return;
            };
            let Some((a, b)) = conversation_pair(conversation_id) else {
                return;
            };
            for (dono, contraparte) in [(&a, &b), (&b, &a)] {
                for peer in state.sessions_of(dono).await {
                    state.send_to(
                        &peer,
                        ServerMsg::DmUpdated {
                            user_id: contraparte.clone(),
                            msg: msg.clone(),
                        },
                    );
                }
            }
            atualizar_previa_lateral(state, &a, &b).await;
        }
    }
}

async fn publicar_remocao(state: &AppState, local: &MessageLocation, message_id: &str) {
    match local {
        MessageLocation::Channel { channel, .. } => {
            state.broadcast(ServerMsg::ChatDeleted {
                channel: channel.clone(),
                message_id: message_id.to_string(),
            });
        }
        MessageLocation::Direct {
            conversation_id, ..
        } => {
            let Some((a, b)) = conversation_pair(conversation_id) else {
                return;
            };
            for (dono, contraparte) in [(&a, &b), (&b, &a)] {
                // Apagar uma nao lida derruba a contagem; sem recalcular por
                // dono, o badge fica preso numa mensagem que nao existe mais.
                let unread = state
                    .db
                    .direct_unread(dono, conversation_id)
                    .unwrap_or_default();
                for peer in state.sessions_of(dono).await {
                    state.send_to(
                        &peer,
                        ServerMsg::DmDeleted {
                            user_id: contraparte.clone(),
                            message_id: message_id.to_string(),
                            unread,
                        },
                    );
                }
            }
            atualizar_previa_lateral(state, &a, &b).await;
        }
    }
}

/// A barra lateral mostra a ultima mensagem de cada conversa. Editar ou apagar
/// a ultima muda esse resumo, e sem reenviar a lista ele so se corrigiria na
/// proxima reconexao.
async fn atualizar_previa_lateral(state: &AppState, a: &UserId, b: &UserId) {
    for dono in [a, b] {
        for peer in state.sessions_of(dono).await {
            crate::services::direct::send_list(state, &peer).await;
        }
    }
}

pub async fn edit(state: &Arc<AppState>, peer_id: &str, message_id: String, raw_text: &str) {
    let Some((me, local)) = localizar(state, peer_id, &message_id).await else {
        return recusar(state, peer_id, "essa mensagem nao existe");
    };

    // O rastro de uma chamada perdida nao e conversa: nao se edita.
    if let MessageLocation::Direct { kind, .. } = &local {
        if *kind == DirectMessageKind::Call {
            return recusar(state, peer_id, "registro de chamada nao pode ser editado");
        }
    }

    let Some(texto) = clean_text(raw_text) else {
        // Editar para vazio nao e atalho para apagar: apagar e explicito.
        return recusar(state, peer_id, "mensagem editada nao pode ficar vazia");
    };
    if !fits(&texto, state.config.limits.max_text_chars) {
        return reject_too_long(state, peer_id, state.config.limits.max_text_chars);
    }

    let agora = now_ms();
    // Mencao segue o texto novo: tirar o `@` na edicao tira a citacao junto.
    let citadas = mentions::resolve(state, &texto);
    let alterou = match &local {
        MessageLocation::Channel { .. } => state.db.update_message_text(
            &message_id,
            &me,
            &texto,
            &citadas.user_ids,
            citadas.everyone,
            agora,
        ),
        MessageLocation::Direct { .. } => state.db.update_direct_text(
            &message_id,
            &me,
            &texto,
            &citadas.user_ids,
            citadas.everyone,
            agora,
        ),
    };

    match alterou {
        Ok(true) => publicar_atualizacao(state, &local, &message_id).await,
        // A autoria mora no `WHERE` do UPDATE, entao `false` ja quer dizer
        // "nao e sua" sem nenhum `if` aqui — e sem janela entre conferir e agir.
        Ok(false) => recusar(state, peer_id, "so da para editar a propria mensagem"),
        Err(err) => {
            tracing::error!(%err, "falha editando mensagem");
            recusar(state, peer_id, "nao consegui editar a mensagem");
        }
    }
}

pub async fn delete(state: &Arc<AppState>, peer_id: &str, message_id: String) {
    let Some((me, local)) = localizar(state, peer_id, &message_id).await else {
        return recusar(state, peer_id, "essa mensagem nao existe");
    };

    // O escopo foi lido ANTES do delete: depois do commit nao daria mais para
    // descobrir para quem anunciar.
    let chaves = match state.db.delete_message_cascade(&message_id, &me) {
        Ok(Some(chaves)) => chaves,
        Ok(None) => return recusar(state, peer_id, "so da para apagar a propria mensagem"),
        Err(err) => {
            tracing::error!(%err, "falha apagando mensagem");
            return recusar(state, peer_id, "nao consegui apagar a mensagem");
        }
    };

    // O aviso sai assim que o banco confirma, sem esperar o S3: para quem
    // apagou, a mensagem ja saiu da conversa.
    publicar_remocao(state, &local, &message_id).await;

    if chaves.is_empty() {
        return;
    }
    let dono = state.clone();
    tokio::spawn(async move {
        let Some(media) = &dono.media else { return };
        for chave in chaves {
            // Banco primeiro, S3 depois, e nao ao contrario: se o S3 saisse
            // primeiro e o banco falhasse, sobraria mensagem viva apontando
            // para arquivo inexistente — imagem quebrada no historico, para
            // sempre. Nesta ordem o pior caso e um objeto que ninguem mais
            // alcanca, porque o unico ponteiro para ele ja morreu.
            if let Err(err) = media.delete_object(&chave).await {
                tracing::warn!(%chave, %err, "anexo saiu do banco mas o objeto ficou no S3");
            }
        }
    });
}

/// Quantos caracteres um emoji de reacao pode ter.
///
/// PROTOTYPE: nao existe lista branca nem catalogo de emoji do servidor —
/// qualquer grafema curto passa. O teto so impede alguem usar o campo como
/// caixa de texto. FUTURE: com emoji custom, aqui vira a validacao contra o
/// catalogo.
const MAX_EMOJI_CHARS: usize = 8;

pub async fn react(state: &Arc<AppState>, peer_id: &str, message_id: String, emoji: String) {
    let Some((me, local)) = localizar(state, peer_id, &message_id).await else {
        return recusar(state, peer_id, "essa mensagem nao existe");
    };

    let emoji = emoji.trim().to_string();
    if emoji.is_empty() || emoji.chars().count() > MAX_EMOJI_CHARS {
        return recusar(state, peer_id, "reacao invalida");
    }

    // Reagir nao exige autoria — qualquer um da audiencia reage. Mas numa
    // conversa a audiencia sao duas contas, e sem esta guarda bastaria adivinhar
    // um UUID para reagir (e passar a receber os eventos) na conversa dos
    // outros. Responde igual a "nao existe" para nao confirmar o id.
    if let MessageLocation::Direct {
        conversation_id, ..
    } = &local
    {
        let dentro = conversation_pair(conversation_id).is_some_and(|(a, b)| a == me || b == me);
        if !dentro {
            return recusar(state, peer_id, "essa mensagem nao existe");
        }
    }

    match state.db.toggle_reaction(&message_id, &emoji, &me, now_ms()) {
        Ok(_) => publicar_atualizacao(state, &local, &message_id).await,
        Err(err) => {
            tracing::error!(%err, "falha reagindo a mensagem");
            recusar(state, peer_id, "nao consegui registrar a reacao");
        }
    }
}

#[cfg(test)]
mod tests;
