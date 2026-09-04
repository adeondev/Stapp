//! Testes das colunas e tabelas que a V7 trouxe: resposta, edicao e reacao.
//!
//! Ficam num arquivo separado do `tests.rs` porque aquele cobre o esquema
//! antigo inteiro e ja e grande; misturar deixaria os dois assuntos embolados.

use super::*;
use crate::protocol::{DirectMessage, DirectMessageKind, Message};
use crate::test_support::TestDir;

async fn conta(db: &Db, username: &str) -> Account {
    db.create_account(
        username.into(),
        username.to_ascii_lowercase(),
        "$argon2id$test".into(),
    )
    .await
    .unwrap()
}

fn mensagem(autor: &Account, id: &str, texto: &str, ts: i64) -> Message {
    Message {
        id: id.into(),
        channel: "geral".into(),
        author_id: autor.id.clone(),
        author_username: autor.username.clone(),
        text: texto.into(),
        ts,
        attachments: Vec::new(),
        poll: None,
        reply_to: None,
        edited_at: None,
        reactions: Vec::new(),
        mentions: Vec::new(),
        mentions_everyone: false,
    }
}

/// O caso de quem ja roda o servidor: oito `ALTER TABLE` de uma vez nao podem
/// levar o historico junto.
#[tokio::test]
async fn migracao_v6_para_v7_preserva_o_historico() {
    let dir = TestDir::new();
    let path = dir.database();
    {
        let options = sqlx::sqlite::SqliteConnectOptions::new()
            .filename(&path)
            .create_if_missing(true);
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .connect_with(options)
            .await
            .unwrap();
        super::schema::migrate_to(&pool, 6).await.unwrap();
        sqlx::query(
            "INSERT INTO users (id, username, username_key, password_hash, created_at)
             VALUES ('u1', 'Daniel', 'daniel', '$argon2id$x', 100)",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO messages (id, channel, author_id, author_username, text, ts)
             VALUES ('m1', 'geral', 'u1', 'Daniel', 'mensagem antiga', 200)",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query("PRAGMA user_version = 6").execute(&pool).await.unwrap();
        let (versao,): (i64,) = sqlx::query_as("PRAGMA user_version")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(versao, 6, "o banco tinha que estar em v6 antes");
        pool.close().await;
    }

    let db = Db::open(&path).await.unwrap();
    let historico = db.history("geral", 10).await.unwrap();

    assert_eq!(historico.len(), 1);
    assert_eq!(historico[0].text, "mensagem antiga");
    // Os campos novos nascem neutros, sem inventar valor para mensagem velha.
    assert!(historico[0].reply_to.is_none());
    assert!(historico[0].edited_at.is_none());
    assert!(historico[0].reactions.is_empty());
    assert!(historico[0].mentions.is_empty());
    assert!(!historico[0].mentions_everyone);
}

#[tokio::test]
async fn localiza_mensagem_de_canal_e_de_conversa_pelo_id() {
    let dir = TestDir::new();
    let db = Db::open(&dir.database()).await.unwrap();
    let daniel = conta(&db, "daniel").await;
    let alice = conta(&db, "alice").await;

    db.insert(&mensagem(&daniel, "m1", "no canal", 100))
        .await
        .unwrap();
    let conversa = conversation_id(&daniel.id, &alice.id);
    db.insert_direct(
        &conversa,
        &DirectMessage {
            id: "d1".into(),
            author_id: daniel.id.clone(),
            author_username: daniel.username.clone(),
            kind: DirectMessageKind::Text,
            text: "na conversa".into(),
            ts: 100,
            attachments: Vec::new(),
            poll: None,
            reply_to: None,
            edited_at: None,
            reactions: Vec::new(),
            mentions: Vec::new(),
            mentions_everyone: false,
        },
    )
    .await
    .unwrap();

    match db.locate_message("m1").await.unwrap().unwrap() {
        MessageLocation::Channel { channel, author_id } => {
            assert_eq!(channel, "geral");
            assert_eq!(author_id, daniel.id);
        }
        outro => panic!("esperava canal, veio {outro:?}"),
    }
    match db.locate_message("d1").await.unwrap().unwrap() {
        MessageLocation::Direct {
            conversation_id, ..
        } => assert_eq!(conversation_id, conversa),
        outro => panic!("esperava conversa, veio {outro:?}"),
    }
    assert!(db.locate_message("nao-existe").await.unwrap().is_none());
}

#[tokio::test]
async fn reagir_duas_vezes_no_mesmo_emoji_desfaz() {
    let dir = TestDir::new();
    let db = Db::open(&dir.database()).await.unwrap();
    let daniel = conta(&db, "daniel").await;
    let alice = conta(&db, "alice").await;
    db.insert(&mensagem(&daniel, "m1", "oi", 100)).await.unwrap();

    assert!(db.toggle_reaction("m1", "👍", &daniel.id, 1).await.unwrap());
    assert!(db.toggle_reaction("m1", "👍", &alice.id, 2).await.unwrap());
    let reacoes = db.reactions_of_message("m1").await.unwrap();
    assert_eq!(reacoes.len(), 1);
    assert_eq!(reacoes[0].emoji, "👍");
    // Ordem de chegada: quem reagiu primeiro aparece primeiro.
    assert_eq!(reacoes[0].users, vec![daniel.id.clone(), alice.id.clone()]);

    assert!(!db.toggle_reaction("m1", "👍", &daniel.id, 3).await.unwrap());
    let reacoes = db.reactions_of_message("m1").await.unwrap();
    assert_eq!(reacoes[0].users, vec![alice.id.clone()]);

    // A ultima reacao saindo tira o emoji da lista, em vez de deixar um zero.
    assert!(!db.toggle_reaction("m1", "👍", &alice.id, 4).await.unwrap());
    assert!(db.reactions_of_message("m1").await.unwrap().is_empty());
}

#[tokio::test]
async fn o_historico_traz_reacao_de_todas_as_mensagens_do_lote() {
    let dir = TestDir::new();
    let db = Db::open(&dir.database()).await.unwrap();
    let daniel = conta(&db, "daniel").await;

    for i in 0..30 {
        db.insert(&mensagem(&daniel, &format!("m{i}"), "oi", 100 + i))
            .await
            .unwrap();
    }
    db.toggle_reaction("m0", "🔥", &daniel.id, 1).await.unwrap();
    db.toggle_reaction("m29", "👍", &daniel.id, 2).await.unwrap();

    let historico = db.history("geral", 50).await.unwrap();
    let com_reacao: Vec<_> = historico
        .iter()
        .filter(|m| !m.reactions.is_empty())
        .collect();
    assert_eq!(com_reacao.len(), 2);
    assert_eq!(historico[0].reactions[0].emoji, "🔥");
    assert_eq!(historico[29].reactions[0].emoji, "👍");
}

/// Com hard delete, a resposta a uma mensagem que sumiu precisa continuar
/// legivel. Alvo ausente vira previa so com o id — e assim que o cliente sabe
/// que deve desenhar "mensagem apagada" em vez de sumir com a citacao.
#[tokio::test]
async fn responder_mensagem_apagada_deixa_a_previa_sem_autor() {
    let dir = TestDir::new();
    let db = Db::open(&dir.database()).await.unwrap();
    let daniel = conta(&db, "daniel").await;
    let alice = conta(&db, "alice").await;

    db.insert(&mensagem(&daniel, "alvo", "pergunta original", 100))
        .await
        .unwrap();
    let mut resposta = mensagem(&alice, "resposta", "respondendo", 200);
    resposta.reply_to = Some(crate::protocol::ReplyRef {
        message_id: "alvo".into(),
        author_id: None,
        author_username: None,
        excerpt: None,
    });
    db.insert(&resposta).await.unwrap();

    // Com o alvo vivo, a previa vem resolvida.
    let historico = db.history("geral", 10).await.unwrap();
    let previa = historico[1].reply_to.as_ref().unwrap();
    assert_eq!(previa.message_id, "alvo");
    assert_eq!(previa.author_id.as_deref(), Some(daniel.id.as_str()));
    assert_eq!(previa.excerpt.as_deref(), Some("pergunta original"));

    db.delete_message_cascade("alvo", &daniel.id)
        .await
        .unwrap()
        .unwrap();

    let historico = db.history("geral", 10).await.unwrap();
    assert_eq!(historico.len(), 1, "a resposta continua, o alvo nao");
    let previa = historico[0].reply_to.as_ref().unwrap();
    assert_eq!(previa.message_id, "alvo");
    assert!(previa.author_id.is_none());
    assert!(previa.excerpt.is_none());
}

/// PROTOTYPE: a autoria mora no `WHERE` do SQL. Este teste e o que segura essa
/// concessao — se um dia aparecer moderador, ele muda de propósito, nao por
/// acidente.
#[tokio::test]
async fn so_o_autor_edita_e_apaga_a_propria_mensagem() {
    let dir = TestDir::new();
    let db = Db::open(&dir.database()).await.unwrap();
    let daniel = conta(&db, "daniel").await;
    let alice = conta(&db, "alice").await;
    db.insert(&mensagem(&daniel, "m1", "original", 100))
        .await
        .unwrap();

    assert!(
        !db.update_message_text("m1", &alice.id, "invadido", &[], false, 200)
            .await
            .unwrap()
    );
    assert!(
        db.delete_message_cascade("m1", &alice.id)
            .await
            .unwrap()
            .is_none()
    );
    assert_eq!(db.history("geral", 10).await.unwrap()[0].text, "original");

    assert!(
        db.update_message_text("m1", &daniel.id, "corrigido", &[], false, 200)
            .await
            .unwrap()
    );
    let msg = &db.history("geral", 10).await.unwrap()[0];
    assert_eq!(msg.text, "corrigido");
    assert_eq!(msg.edited_at, Some(200));
}

#[tokio::test]
async fn apagar_mensagem_leva_junto_anexo_reacao_e_enquete() {
    let dir = TestDir::new();
    let db = Db::open(&dir.database()).await.unwrap();
    let daniel = conta(&db, "daniel").await;
    db.insert(&mensagem(&daniel, "m1", "com tudo", 100))
        .await
        .unwrap();

    db.insert_attachment(
        "a1",
        &daniel.id,
        "foto.png",
        "image/png",
        10,
        "uploads/a1",
        1,
    )
    .await
    .unwrap();
    db.bind_attachments("m1", &["a1".to_string()]).await.unwrap();
    db.toggle_reaction("m1", "👍", &daniel.id, 1).await.unwrap();
    db.insert_poll(
        "m1",
        Some("geral"),
        &daniel.id,
        "vamos?",
        false,
        &["sim".into(), "nao".into()],
        1,
    )
    .await
    .unwrap();

    let chaves = db
        .delete_message_cascade("m1", &daniel.id)
        .await
        .unwrap()
        .unwrap();

    // As chaves voltam para o servico limpar o objeto no S3 depois do commit.
    assert_eq!(chaves, vec!["uploads/a1".to_string()]);
    assert!(db.history("geral", 10).await.unwrap().is_empty());
    assert!(db.list_attachments("m1", None).await.unwrap().is_empty());
    assert!(db.reactions_of_message("m1").await.unwrap().is_empty());
    assert!(db.get_poll_by_message("m1", None).await.unwrap().is_none());
}
