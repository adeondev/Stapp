//! Persistencia SQLite.
//!
//! `mod.rs` guarda so a conexao e a abertura do banco. O esquema e as migracoes
//! ficam em [`schema`], e cada assunto tem o proprio arquivo de consultas —
//! contas em [`accounts`], mensagens em [`messages`]. Uma tabela nova amanha
//! entra como um arquivo novo, nao como mais 80 linhas aqui.

mod accounts;
pub mod attachments;
mod auth_sessions;
mod direct;
pub mod lookup;
mod messages;
pub mod polls;
pub mod reactions;
mod profiles;
mod schema;
mod social;

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use anyhow::{Context, Result};
use rusqlite::Connection;

pub use accounts::{Account, CreateAccountError};
pub use direct::{conversation_id, conversation_pair};
pub use lookup::MessageLocation;
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

    pub fn insert_attachment(
        &self,
        id: &str,
        user_id: &str,
        filename: &str,
        content_type: &str,
        size_bytes: usize,
        s3_key: &str,
        created_at: i64,
    ) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        attachments::insert_attachment(&conn, id, user_id, filename, content_type, size_bytes, s3_key, created_at)
    }

    pub fn bind_attachments(&self, message_id: &str, attachment_ids: &[String]) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        attachments::bind_attachments(&conn, message_id, attachment_ids)
    }

    pub fn list_attachments(&self, message_id: &str, public_base: Option<&str>) -> Result<Vec<crate::protocol::Attachment>> {
        let conn = self.conn.lock().unwrap();
        attachments::list_for_message(&conn, message_id, public_base)
    }

    pub fn insert_poll(
        &self,
        message_id: &str,
        channel_id: Option<&str>,
        author_id: &crate::protocol::UserId,
        question: &str,
        allow_mult: bool,
        options: &[String],
        ts: i64,
    ) -> Result<crate::protocol::Poll> {
        let conn = self.conn.lock().unwrap();
        polls::insert_poll(&conn, message_id, channel_id, author_id, question, allow_mult, options, ts)
    }

    pub fn get_poll_by_id(&self, poll_id: &str, current_user_id: Option<&crate::protocol::UserId>) -> Result<Option<crate::protocol::Poll>> {
        let conn = self.conn.lock().unwrap();
        polls::get_poll_by_id(&conn, poll_id, current_user_id)
    }

    pub fn get_poll_by_message(&self, message_id: &str, current_user_id: Option<&crate::protocol::UserId>) -> Result<Option<crate::protocol::Poll>> {
        let conn = self.conn.lock().unwrap();
        polls::get_poll_by_message(&conn, message_id, current_user_id)
    }

    pub fn vote_poll(
        &self,
        poll_id: &str,
        option_id: &str,
        user_id: &crate::protocol::UserId,
        ts: i64,
    ) -> Result<crate::protocol::Poll> {
        let conn = self.conn.lock().unwrap();
        polls::vote_poll(&conn, poll_id, option_id, user_id, ts)
    }

    pub fn close_poll(&self, poll_id: &str, user_id: &crate::protocol::UserId) -> Result<crate::protocol::Poll> {
        let conn = self.conn.lock().unwrap();
        polls::close_poll(&conn, poll_id, user_id)
    }

    /// Apaga a mensagem e tudo que pendura nela, numa transacao so, e devolve as
    /// chaves S3 dos anexos para o servico limpar o objeto **depois** do commit.
    /// `Ok(None)` = a mensagem nao existe ou nao e sua.
    ///
    /// PROTOTYPE: so o proprio autor apaga, e apagar e definitivo — nao existe
    /// papel de moderador neste servidor hoje, entao nao ha "apagar mensagem dos
    /// outros" nem lapide "mensagem removida". O invariante que nao pode cair: a
    /// autoria mora no `WHERE` daqui, nunca num `if` do servico. Quando aparecer
    /// moderacao, este metodo ganha quem autorizou e o servico decide quem pode
    /// chamar — a assinatura muda aqui, nao no protocolo.
    pub fn delete_message_cascade(
        &self,
        message_id: &str,
        author_id: &crate::protocol::UserId,
    ) -> Result<Option<Vec<String>>> {
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction()?;

        // Antes de qualquer DELETE: depois do commit a linha some e o objeto
        // ficaria orfao no S3 sem ninguem saber que existiu.
        let chaves = attachments::keys_for_message(&tx, message_id)?;

        reactions::delete_for_message(&tx, message_id)?;
        attachments::delete_for_message(&tx, message_id)?;
        // As FKs da V6 cascateiam opcoes e votos. Sem isto, apagar a mensagem de
        // uma enquete deixaria a enquete orfa para sempre.
        tx.execute("DELETE FROM polls WHERE message_id = ?1", [message_id])?;

        let mut apagadas = tx.execute(
            "DELETE FROM messages WHERE id = ?1 AND author_id = ?2",
            (message_id, author_id),
        )?;
        if apagadas == 0 {
            apagadas = tx.execute(
                "DELETE FROM dm_messages WHERE id = ?1 AND author_id = ?2",
                (message_id, author_id),
            )?;
        }

        if apagadas == 0 {
            tx.rollback()?;
            return Ok(None);
        }
        tx.commit()?;
        Ok(Some(chaves))
    }
}

/// Mencoes viram um array JSON na propria linha. Elas so sao lidas junto com a
/// mensagem, entao vem de graca no mesmo SELECT em vez de custar uma tabela e
/// mais uma consulta por lote.
pub(crate) fn mentions_para_json(mentions: &[crate::protocol::UserId]) -> String {
    serde_json::to_string(mentions).unwrap_or_else(|_| "[]".into())
}

pub(crate) fn mentions_de_json(bruto: String) -> Vec<crate::protocol::UserId> {
    serde_json::from_str(&bruto).unwrap_or_default()
}

/// Monta a previa de uma resposta a partir do LEFT JOIN com o alvo.
///
/// Alvo ausente (apagado) devolve so o id: e assim que o cliente sabe que a
/// mensagem original nao existe mais.
pub(crate) fn montar_reply_ref(
    message_id: String,
    author_id: Option<String>,
    author_username: Option<String>,
    texto: Option<String>,
) -> crate::protocol::ReplyRef {
    crate::protocol::ReplyRef {
        message_id,
        author_id,
        author_username,
        excerpt: texto.map(|t| messages::recortar(&t)),
    }
}

#[cfg(test)]
mod tests;
#[cfg(test)]
mod tests_v7;
