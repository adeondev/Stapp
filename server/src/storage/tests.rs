use sqlx::{Connection, SqliteConnection};

use super::*;
use crate::protocol::Message;
use crate::test_support::TestDir;

async fn account(db: &Db, username: &str) -> Account {
    db.create_account(
        username.into(),
        username.to_ascii_lowercase(),
        "$argon2id$test".into(),
    )
    .await
    .unwrap()
}

fn message(author: &Account, id: &str, ts: i64) -> Message {
    Message {
        id: id.into(),
        channel: "geral".into(),
        author_id: author.id.clone(),
        author_username: author.username.clone(),
        text: id.into(),
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

#[tokio::test]
async fn history_returns_latest_messages_in_chronological_order() {
    let dir = TestDir::new();
    let db = Db::open(&dir.database()).await.unwrap();
    let author = account(&db, "Daniel").await;

    db.insert(&message(&author, "old", 100)).await.unwrap();
    db.insert(&message(&author, "tie-first", 200)).await.unwrap();
    db.insert(&message(&author, "tie-second", 200)).await.unwrap();

    let history = db.history("geral", 2).await.unwrap();
    let ids: Vec<_> = history.iter().map(|message| message.id.as_str()).collect();
    assert_eq!(ids, ["tie-first", "tie-second"]);
    assert_eq!(history[0].author_id, author.id);
}

#[tokio::test]
async fn refuses_the_unversioned_nickname_schema() {
    let dir = TestDir::new();
    let path = dir.database();
    let options = sqlx::sqlite::SqliteConnectOptions::new()
        .filename(&path)
        .create_if_missing(true);
    let mut conn = SqliteConnection::connect_with(&options).await.unwrap();
    sqlx::raw_sql("CREATE TABLE messages (id TEXT PRIMARY KEY, nick TEXT NOT NULL);")
        .execute(&mut conn)
        .await
        .unwrap();
    conn.close().await.unwrap();

    let error = Db::open(&path).await.err().unwrap().to_string();
    assert!(error.contains("esquema antigo"));
    assert!(error.contains("stapp.db"));
}

#[tokio::test]
async fn refuses_a_schema_from_the_future() {
    let dir = TestDir::new();
    let path = dir.database();
    let options = sqlx::sqlite::SqliteConnectOptions::new()
        .filename(&path)
        .create_if_missing(true);
    let mut conn = SqliteConnection::connect_with(&options).await.unwrap();
    sqlx::raw_sql(&format!(
        "PRAGMA user_version = {};",
        super::schema::SCHEMA_VERSION + 1
    ))
    .execute(&mut conn)
    .await
    .unwrap();
    conn.close().await.unwrap();

    let error = Db::open(&path).await.err().unwrap().to_string();
    assert!(error.contains("conhece ate"));
}

#[tokio::test]
async fn migrates_v2_without_losing_accounts_channel_messages_or_dms() {
    let dir = TestDir::new();
    let path = dir.database();
    let options = sqlx::sqlite::SqliteConnectOptions::new()
        .filename(&path)
        .create_if_missing(true);
    let mut conn = SqliteConnection::connect_with(&options).await.unwrap();
    sqlx::raw_sql(
        "CREATE TABLE users (
            id TEXT PRIMARY KEY, username TEXT NOT NULL, username_key TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL, created_at INTEGER NOT NULL, disabled_at INTEGER
         );
         CREATE TABLE messages (
            id TEXT PRIMARY KEY, channel TEXT NOT NULL, author_id TEXT NOT NULL REFERENCES users(id),
            author_username TEXT NOT NULL, text TEXT NOT NULL, ts INTEGER NOT NULL
         );
         CREATE INDEX idx_messages_channel_ts ON messages (channel, ts);
         CREATE TABLE dm_messages (
            id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL,
            author_id TEXT NOT NULL REFERENCES users(id), author_username TEXT NOT NULL,
            kind TEXT NOT NULL DEFAULT 'text', text TEXT NOT NULL, ts INTEGER NOT NULL
         );
         CREATE INDEX idx_dm_messages_conversation_ts ON dm_messages (conversation_id, ts);
         CREATE TABLE dm_reads (
            user_id TEXT NOT NULL REFERENCES users(id), conversation_id TEXT NOT NULL,
            last_read_ts INTEGER NOT NULL, PRIMARY KEY (user_id, conversation_id)
         );
         INSERT INTO users VALUES ('u1', 'Daniel', 'daniel', 'hash1', 1, NULL);
         INSERT INTO users VALUES ('u2', 'Alice', 'alice', 'hash2', 2, NULL);
         INSERT INTO messages VALUES ('m1', 'geral', 'u1', 'Daniel', 'mensagem antiga', 10);
         INSERT INTO dm_messages VALUES ('d1', 'u1:u2', 'u2', 'Alice', 'text', 'dm antiga', 11);
         PRAGMA user_version = 2;",
    )
    .execute(&mut conn)
    .await
    .unwrap();
    conn.close().await.unwrap();

    let db = Db::open(&path).await.unwrap();
    assert_eq!(db.account_by_id("u1").await.unwrap().unwrap().username, "Daniel");
    assert_eq!(db.history("geral", 10).await.unwrap()[0].text, "mensagem antiga");
    assert_eq!(db.direct_history("u1:u2", 10).await.unwrap()[0].text, "dm antiga");
    assert!(db.allow_member_dms("u1").await.unwrap());
    let server_id = db.server_id().unwrap();
    drop(db);
    assert_eq!(Db::open(&path).await.unwrap().server_id().unwrap(), server_id);
}

#[tokio::test]
async fn username_key_is_unique_and_accounts_can_be_disabled() {
    let dir = TestDir::new();
    let db = Db::open(&dir.database()).await.unwrap();
    account(&db, "Daniel").await;
    let duplicate = db.create_account("daniel".into(), "daniel".into(), "hash".into()).await;
    assert!(matches!(duplicate, Err(CreateAccountError::UsernameTaken)));

    assert!(db.set_disabled("daniel", true).await.unwrap());
    assert!(
        db.account_by_key("daniel")
            .await
            .unwrap()
            .unwrap()
            .disabled_at
            .is_some()
    );
    assert!(db.set_disabled("daniel", false).await.unwrap());
    assert!(
        db.account_by_key("daniel")
            .await
            .unwrap()
            .unwrap()
            .disabled_at
            .is_none()
    );
}

#[tokio::test]
async fn a_migracao_v3_para_v4_preserva_a_conta_e_da_perfil_padrao() {
    let dir = TestDir::new();
    let path = dir.database();

    // Um banco na versao anterior, com uma conta ja criada — o caso de quem ja
    {
        let options = sqlx::sqlite::SqliteConnectOptions::new()
            .filename(&path)
            .create_if_missing(true);
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .connect_with(options)
            .await
            .unwrap();
        super::schema::migrate_to(&pool, 3).await.unwrap();
        sqlx::query(
            "INSERT INTO users (id, username, username_key, password_hash, created_at)
             VALUES ('u1', 'Daniel', 'daniel', '$argon2id$x', 100)",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query("PRAGMA user_version = 3").execute(&pool).await.unwrap();
        let (versao,): (i64,) = sqlx::query_as("PRAGMA user_version")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(versao, 3, "o banco tinha que estar em v3 antes");
        pool.close().await;
    }

    // Abrir com o servidor de hoje sobe para v4 sozinho.
    let db = Db::open(&path).await.unwrap();

    let conta = db.account_by_key("daniel").await.unwrap().unwrap();
    assert_eq!(conta.username, "Daniel", "a conta nao pode se perder");

    let perfil = db.profile_of(&conta.id).await.unwrap().unwrap();
    assert_eq!(perfil.display_name, "Daniel", "sem escolha, usa o username");
    assert_eq!(perfil.accent, "blue");
    assert_eq!(perfil.bio, "");
    assert!(!perfil.has_avatar);
}

#[tokio::test]
async fn perfil_editado_sobrevive_a_reabertura_do_banco() {
    let dir = TestDir::new();
    let path = dir.database();
    let id = {
        let db = Db::open(&path).await.unwrap();
        let conta = db
            .create_account("Daniel".into(), "daniel".into(), "hash".into())
            .await
            .unwrap();
        db.update_profile(&conta.id, Some("Deon"), Some("purple"), Some("oi"), 777)
            .await
            .unwrap();
        conta.id
    };

    let db = Db::open(&path).await.unwrap();
    let perfil = db.profile_of(&id).await.unwrap().unwrap();
    assert_eq!(perfil.display_name, "Deon");
    assert_eq!(perfil.accent, "purple");
    assert_eq!(perfil.updated_at, 777);
}

#[tokio::test]
async fn vincula_e_lista_anexos_de_mensagem() {
    let dir = TestDir::new();
    let db = Db::open(&dir.database()).await.unwrap();
    let author = account(&db, "Alice").await;

    let att_id = "anexo-uuid-1";
    db.insert_attachment(
        att_id,
        &author.id,
        "screenshot.png",
        "image/png",
        2048,
        "uploads/alice/screenshot.png",
        1000,
    )
    .await
    .unwrap();

    let msg = message(&author, "msg-com-anexo", 1005);
    db.insert(&msg).await.unwrap();
    db.bind_attachments(&msg.id, &[att_id.to_string()]).await.unwrap();

    let history = db.history("geral", 10).await.unwrap();
    assert_eq!(history.len(), 1);
    assert_eq!(history[0].attachments.len(), 1);
    assert_eq!(history[0].attachments[0].id, att_id);
    assert_eq!(history[0].attachments[0].filename, "screenshot.png");
    assert_eq!(history[0].attachments[0].content_type, "image/png");
    assert_eq!(history[0].attachments[0].size_bytes, 2048);
}

#[tokio::test]
async fn anexo_local_guarda_metadados_e_expira_se_continuar_orfao() {
    let dir = TestDir::new();
    let db = Db::open(&dir.database()).await.unwrap();
    let author = account(&db, "Alice").await;
    db.insert_ready_attachment(&attachments::NewAttachment {
        id: "voice-local",
        user_id: &author.id,
        filename: "voz.webm",
        content_type: "audio/webm",
        size_bytes: 512,
        storage_key: "voice-local",
        checksum_sha256: "abc123",
        backend: "local",
        created_at: 10,
        expires_at: 100,
        scope_kind: "channel",
        scope_id: "geral",
    })
    .await
    .unwrap();

    assert!(
        db.update_attachment_metadata(
            "voice-local",
            &author.id,
            None,
            true,
            Some("nota de voz"),
            Some(1_250),
            Some(&[10, 50, 90]),
            None,
            None,
        )
        .await
        .unwrap()
    );
    let attachment = db.attachment("voice-local").await.unwrap().unwrap();
    assert_eq!(attachment.backend, "local");
    assert_eq!(attachment.duration_ms, Some(1_250));
    assert_eq!(attachment.waveform, Some(vec![10, 50, 90]));
    assert_eq!(attachment.description.as_deref(), Some("nota de voz"));

    assert_eq!(
        db.expired_orphan_attachments(101).await.unwrap(),
        vec![("voice-local".into(), "voice-local".into())]
    );
    assert!(
        db.delete_expired_orphan_attachment("voice-local", 101)
            .await
            .unwrap()
    );
    assert!(db.attachment("voice-local").await.unwrap().is_none());
}

#[tokio::test]
async fn cria_vota_e_encerra_enquete() {
    let dir = TestDir::new();
    let db = Db::open(&dir.database()).await.unwrap();
    let author = account(&db, "daniel").await;

    let msg = message(&author, "msg-enquete", 2000);
    db.insert(&msg).await.unwrap();

    let options = vec!["Opcao A".to_string(), "Opcao B".to_string()];
    let poll = db
        .insert_poll(
            &msg.id,
            Some("geral"),
            &author.id,
            "Qual a melhor opção?",
            false,
            &options,
            2000,
        )
        .await
        .unwrap();

    assert_eq!(poll.question, "Qual a melhor opção?");
    assert_eq!(poll.options.len(), 2);
    assert_eq!(poll.total_votes, 0);

    let opt_a_id = &poll.options[0].id;
    let updated = db.vote_poll(&poll.id, opt_a_id, &author.id, 2005).await.unwrap();
    assert_eq!(updated.total_votes, 1);
    assert_eq!(updated.options[0].votes, 1);
    assert_eq!(updated.options[0].voted_by_me, Some(true));

    let closed = db.close_poll(&poll.id, &author.id).await.unwrap();
    assert!(closed.closed);
}
