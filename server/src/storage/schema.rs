//! Versao do esquema e migracoes.
//!
//! O numero fica no `PRAGMA user_version` do proprio arquivo. Migracao nova =
//! mais um bloco aqui e `SCHEMA_VERSION` incrementado; nada muda nas consultas.

use std::path::{Path, PathBuf};

use anyhow::{Result, bail};
use rusqlite::Connection;

pub const SCHEMA_VERSION: i64 = 1;

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

    if version == 0 {
        conn.execute_batch(V1)?;
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
