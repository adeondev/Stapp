//! Persistencia SQLite.
//!
//! `mod.rs` guarda so a conexao e a abertura do banco. O esquema e as migracoes
//! ficam em [`schema`], e cada assunto tem o proprio arquivo de consultas —
//! contas em [`accounts`], mensagens em [`messages`]. Uma tabela nova amanha
//! entra como um arquivo novo, nao como mais 80 linhas aqui.

mod accounts;
mod auth_sessions;
mod direct;
mod messages;
mod schema;
mod social;

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use anyhow::{Context, Result};
use rusqlite::Connection;

pub use accounts::{Account, CreateAccountError};
pub use direct::conversation_id;
pub use social::Relationship;

/// Um `Mutex<Connection>` basta: o volume aqui e de um grupo de amigos, nao
/// justifica pool nem `spawn_blocking`.
pub struct Db {
    conn: Mutex<Connection>,
    path: PathBuf,
}

impl Db {
    pub fn open(path: &Path) -> Result<Self> {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir)
                .with_context(|| format!("nao consegui criar {}", dir.display()))?;
        }

        let conn = Connection::open(path)
            .with_context(|| format!("nao consegui abrir o banco {}", path.display()))?;

        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "synchronous", "NORMAL")?;
        conn.pragma_update(None, "foreign_keys", "ON")?;

        schema::migrate(&conn, path)?;

        Ok(Self {
            conn: Mutex::new(conn),
            path: path.to_path_buf(),
        })
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn server_id(&self) -> Result<String> {
        let conn = self.conn.lock().unwrap();
        Ok(conn.query_row(
            "SELECT value FROM server_meta WHERE key = 'server_id'",
            [],
            |row| row.get(0),
        )?)
    }
}

#[cfg(test)]
mod tests;
