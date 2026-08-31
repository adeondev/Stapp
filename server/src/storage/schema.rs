//! Versao do esquema e migracoes.
//!
//! O numero fica no `PRAGMA user_version` do proprio arquivo. Migracao nova =
//! mais um bloco aqui e `SCHEMA_VERSION` incrementado; nada muda nas consultas.

use std::path::{Path, PathBuf};

use anyhow::{Result, bail};
use rusqlite::Connection;
use uuid::Uuid;

pub const SCHEMA_VERSION: i64 = 5;

const V1: &str = "BEGIN IMMEDIATE;
     CREATE TABLE users (
         id            TEXT PRIMARY KEY,
         username      TEXT NOT NULL,
         username_key  TEXT NOT NULL UNIQUE,
         password_hash TEXT NOT NULL,
         created_at    INTEGER NOT NULL,
         disabled_at   INTEGER
     );
     CREATE TABLE messages (
         id              TEXT PRIMARY KEY,
         channel         TEXT NOT NULL,
         author_id       TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
         author_username TEXT NOT NULL,
         text            TEXT NOT NULL,
         ts              INTEGER NOT NULL
     );
     CREATE INDEX idx_messages_channel_ts ON messages (channel, ts);
     PRAGMA user_version = 1;
     COMMIT;";

/// Mensagens diretas. A conversa nao tem tabela propria: o par de contas ja e a
/// identidade dela (ver `storage::direct::conversation_id`).
///
/// `kind` existe desde ja para a chamada 1:1 poder deixar rastro na conversa
/// ("chamada perdida") sem precisar de outra migracao.
const V2: &str = "BEGIN IMMEDIATE;
     CREATE TABLE dm_messages (
         id              TEXT PRIMARY KEY,
         conversation_id TEXT NOT NULL,
         author_id       TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
         author_username TEXT NOT NULL,
         kind            TEXT NOT NULL DEFAULT 'text',
         text            TEXT NOT NULL,
         ts              INTEGER NOT NULL
     );
     CREATE INDEX idx_dm_messages_conversation_ts ON dm_messages (conversation_id, ts);
     CREATE TABLE dm_reads (
         user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
         conversation_id TEXT NOT NULL,
         last_read_ts    INTEGER NOT NULL,
         PRIMARY KEY (user_id, conversation_id)
     );
     PRAGMA user_version = 2;
     COMMIT;";

/// Sessoes persistentes e relacoes sociais locais ao servidor. A preferencia
/// de DM fica numa tabela separada para que contas antigas recebam o default
/// aberto sem reescrever `users`.
const V3: &str = "BEGIN IMMEDIATE;
     CREATE TABLE server_meta (
         key   TEXT PRIMARY KEY,
         value TEXT NOT NULL
     );
     CREATE TABLE auth_sessions (
         id                    TEXT PRIMARY KEY,
         user_id               TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
         token_hash            TEXT NOT NULL,
         previous_token_hash   TEXT,
         previous_valid_until  INTEGER,
         remember              INTEGER NOT NULL,
         created_at            INTEGER NOT NULL,
         last_used_at          INTEGER NOT NULL,
         expires_at            INTEGER NOT NULL,
         revoked_at            INTEGER
     );
     CREATE INDEX idx_auth_sessions_user ON auth_sessions (user_id);
     CREATE TABLE user_privacy (
         user_id           TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
         allow_member_dms  INTEGER NOT NULL DEFAULT 1
     );
     INSERT INTO user_privacy (user_id, allow_member_dms)
          SELECT id, 1 FROM users;
     CREATE TABLE friend_requests (
         requester_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
         addressee_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
         created_at   INTEGER NOT NULL,
         PRIMARY KEY (requester_id, addressee_id),
         CHECK (requester_id <> addressee_id)
     );
     CREATE TABLE friendships (
         user_a     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
         user_b     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
         created_at INTEGER NOT NULL,
         PRIMARY KEY (user_a, user_b),
         CHECK (user_a < user_b)
     );
     CREATE TABLE user_blocks (
         blocker_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
         blocked_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
         created_at INTEGER NOT NULL,
         PRIMARY KEY (blocker_id, blocked_id),
         CHECK (blocker_id <> blocked_id)
     );
     PRAGMA user_version = 3;
     COMMIT;";

/// Perfil publico da conta. Tabela separada de `users` pelo mesmo motivo de
/// `user_privacy`: conta que ja existe ganha o default sem reescrever nada.
///
/// `display_name` NULL de proposito — significa "usa o username", e nao "vazio".
/// `accent` guarda o NOME da cor, nao o hex: assim o tema manda no valor e trocar
/// os tokens nao quebra nenhuma linha do banco.
/// `avatar_ext` ja fica pronto para a imagem da etapa seguinte; NULL = avatar gerado.
const V4: &str = "BEGIN IMMEDIATE;
     CREATE TABLE user_profiles (
         user_id      TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
         display_name TEXT,
         accent       TEXT NOT NULL DEFAULT 'blue',
         bio          TEXT NOT NULL DEFAULT '',
         avatar_ext   TEXT,
         updated_at   INTEGER NOT NULL DEFAULT 0
     );
     INSERT INTO user_profiles (user_id, accent, bio, updated_at)
          SELECT id, 'blue', '', 0 FROM users;
     PRAGMA user_version = 4;
     COMMIT;";

const V5: &str = "BEGIN IMMEDIATE;
     CREATE TABLE attachments (
         id           TEXT PRIMARY KEY,
         message_id   TEXT,
         user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
         filename     TEXT NOT NULL,
         content_type TEXT NOT NULL,
         size_bytes   INTEGER NOT NULL,
         s3_key       TEXT NOT NULL,
         created_at   INTEGER NOT NULL
     );
     CREATE INDEX idx_attachments_message ON attachments (message_id);
     PRAGMA user_version = 5;
     COMMIT;";

pub fn migrate(conn: &Connection, path: &Path) -> Result<()> {
    let version: i64 = conn.pragma_query_value(None, "user_version", |row| row.get(0))?;

    // Banco do prototipo anterior, quando mensagem guardava apelido e nao conta.
    // Apagar sozinho seria perder conversa; entao paramos e deixamos a decisao
    // com quem administra.
    if version == 0 && has_any_stapp_table(conn)? {
        bail!(
            "o banco {} usa o esquema antigo sem contas; mova ou remova esse arquivo conscientemente e inicie o servidor novamente",
            absolute_path(path).display()
        );
    }
    if version > SCHEMA_VERSION {
        bail!("o banco usa o esquema {version}, mas este servidor conhece ate {SCHEMA_VERSION}");
    }

    // Cada passo roda em sequencia, entao um banco em v0 chega em v2 sozinho.
    if version < 1 {
        conn.execute_batch(V1)?;
    }
    if version < 2 {
        conn.execute_batch(V2)?;
    }
    if version < 3 {
        conn.execute_batch(V3)?;
    }
    if version < 4 {
        conn.execute_batch(V4)?;
    }
    if version < 5 {
        conn.execute_batch(V5)?;
    }

    ensure_server_id(conn)?;

    Ok(())
}

fn ensure_server_id(conn: &Connection) -> Result<()> {
    let exists: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM server_meta WHERE key = 'server_id')",
        [],
        |row| row.get(0),
    )?;
    if !exists {
        conn.execute(
            "INSERT INTO server_meta (key, value) VALUES ('server_id', ?1)",
            [Uuid::new_v4().to_string()],
        )?;
    }
    Ok(())
}

/// Aplica as migracoes ate a versao pedida. Existe para o teste conseguir
/// montar um banco de versao antiga de verdade, em vez de fingir um.
#[cfg(test)]
pub(super) fn migrate_to(conn: &Connection, version: i64) -> Result<()> {
    for (alvo, passo) in [(1, V1), (2, V2), (3, V3), (4, V4)] {
        if version >= alvo {
            conn.execute_batch(passo)?;
        }
    }
    Ok(())
}

fn has_any_stapp_table(conn: &Connection) -> Result<bool> {
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM sqlite_master
          WHERE type = 'table' AND name IN ('messages', 'users')",
        [],
        |row| row.get(0),
    )?;
    Ok(count > 0)
}

fn absolute_path(path: &Path) -> PathBuf {
    path.canonicalize().unwrap_or_else(|_| {
        std::env::current_dir()
            .map(|dir| dir.join(path))
            .unwrap_or_else(|_| path.to_path_buf())
    })
}
