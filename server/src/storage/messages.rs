//! Consultas de mensagem.

use anyhow::Result;
use rusqlite::{Connection, OptionalExtension, Row, params_from_iter};

use super::Db;
use crate::protocol::{Message, REPLY_EXCERPT_CHARS, ReplyRef, UserId};

const COLUNAS: &str = "id, channel, author_id, author_username, text, ts, reply_to, edited_at, mentions, \
     mentions_everyone";

impl Db {
    pub fn insert(&self, msg: &Message) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO messages
                (id, channel, author_id, author_username, text, ts,
                 reply_to, mentions, mentions_everyone)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            (
                &msg.id,
                &msg.channel,
                &msg.author_id,
                &msg.author_username,
                &msg.text,
                msg.ts,
                msg.reply_to.as_ref().map(|r| r.message_id.clone()),
                super::mentions_para_json(&msg.mentions),
                msg.mentions_everyone,
            ),
        )?;
        Ok(())
    }

    /// As `limit` mensagens mais recentes do canal, ja em ordem cronologica.
    pub fn history(&self, channel: &str, limit: usize) -> Result<Vec<Message>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(&format!(
            "SELECT {COLUNAS} FROM messages
              WHERE channel = ?1
              ORDER BY ts DESC, rowid DESC
              LIMIT ?2"
        ))?;

        let rows = stmt.query_map((channel, limit as i64), ler_mensagem)?;
        let mut msgs = rows.collect::<rusqlite::Result<Vec<_>>>()?;
        hidratar(&conn, &mut msgs)?;
        msgs.reverse();
        Ok(msgs)
    }

    /// Uma mensagem de canal, ja com anexo, enquete, reacao e resposta.
    /// E o que os eventos de atualizacao reenviam.
    pub fn message_by_id(&self, id: &str) -> Result<Option<Message>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(&format!("SELECT {COLUNAS} FROM messages WHERE id = ?1"))?;
        let Some(msg) = stmt.query_row([id], ler_mensagem).optional()? else {
            return Ok(None);
        };
        let mut msgs = vec![msg];
        hidratar(&conn, &mut msgs)?;
        Ok(msgs.pop())
    }

    /// `Ok(false)` = a mensagem nao existe **ou** nao e sua.
    ///
    /// A autoria e clausula do SQL, nunca um `if` no servico: entre o `if` e o
    /// `UPDATE` cabe outra operacao mexendo na mesma linha.
    pub fn update_message_text(
        &self,
        id: &str,
        author_id: &UserId,
        text: &str,
        mentions: &[UserId],
        mentions_everyone: bool,
        edited_at: i64,
    ) -> Result<bool> {
        let conn = self.conn.lock().unwrap();
        let alteradas = conn.execute(
            "UPDATE messages
                SET text = ?3, mentions = ?4, mentions_everyone = ?5, edited_at = ?6
              WHERE id = ?1 AND author_id = ?2",
            (
                id,
                author_id,
                text,
                super::mentions_para_json(mentions),
                mentions_everyone,
                edited_at,
            ),
        )?;
        Ok(alteradas > 0)
    }
}

/// Anexo, enquete, reacao e previa da resposta de um lote inteiro.
///
/// Reacao e resposta saem em **uma** consulta cada, independente do tamanho do
/// lote. Anexo e enquete continuam um por mensagem — divida antiga da V5 e da
/// V6, nao piorada aqui.
/// FUTURE: os dois cabem no mesmo padrao `IN (...)` quando incomodar.
pub(super) fn hidratar(conn: &Connection, msgs: &mut [Message]) -> Result<()> {
    for msg in msgs.iter_mut() {
        if let Ok(atts) = super::attachments::list_for_message(conn, &msg.id, None) {
            msg.attachments = atts;
        }
        if let Ok(poll) = super::polls::get_poll_by_message(conn, &msg.id, None) {
            msg.poll = poll;
        }
    }

    let ids: Vec<String> = msgs.iter().map(|m| m.id.clone()).collect();
    let mut reacoes = super::reactions::list_for_messages(conn, &ids)?;
    let mut respostas = previas_de_resposta(conn, &ids)?;
    for msg in msgs.iter_mut() {
        if let Some(lista) = reacoes.remove(&msg.id) {
            msg.reactions = lista;
        }
        if let Some(previa) = respostas.remove(&msg.id) {
            msg.reply_to = Some(previa);
        }
    }
    Ok(())
}

/// A previa de cada resposta do lote, resolvida contra o alvo atual.
///
/// O LEFT JOIN e o que faz "alvo apagado" cair sozinho: sem linha do lado do
/// alvo, o `ReplyRef` sai so com o id e o cliente desenha "mensagem apagada".
fn previas_de_resposta(
    conn: &Connection,
    ids: &[String],
) -> Result<std::collections::HashMap<String, ReplyRef>> {
    let mut mapa = std::collections::HashMap::new();
    if ids.is_empty() {
        return Ok(mapa);
    }

    let marcadores = vec!["?"; ids.len()].join(",");
    let mut stmt = conn.prepare(&format!(
        "SELECT origem.id, origem.reply_to, alvo.author_id, alvo.author_username, alvo.text
           FROM messages origem
           LEFT JOIN messages alvo ON alvo.id = origem.reply_to
          WHERE origem.id IN ({marcadores}) AND origem.reply_to IS NOT NULL"
    ))?;

    let linhas = stmt.query_map(params_from_iter(ids), |row| {
        Ok((
            row.get::<_, String>(0)?,
            super::montar_reply_ref(
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, Option<String>>(3)?,
                row.get::<_, Option<String>>(4)?,
            ),
        ))
    })?;

    for linha in linhas {
        let (origem, previa) = linha?;
        mapa.insert(origem, previa);
    }
    Ok(mapa)
}

fn ler_mensagem(row: &Row) -> rusqlite::Result<Message> {
    Ok(Message {
        id: row.get(0)?,
        channel: row.get(1)?,
        author_id: row.get(2)?,
        author_username: row.get(3)?,
        text: row.get(4)?,
        ts: row.get(5)?,
        attachments: Vec::new(),
        poll: None,
        reactions: Vec::new(),
        // A previa vem do lote em `hidratar`; aqui so sabemos que existe.
        reply_to: row.get::<_, Option<String>>(6)?.map(|id| ReplyRef {
            message_id: id,
            author_id: None,
            author_username: None,
            excerpt: None,
        }),
        edited_at: row.get(7)?,
        mentions: super::mentions_de_json(row.get::<_, String>(8)?),
        mentions_everyone: row.get(9)?,
    })
}

/// Corta o texto do alvo no tamanho da previa, sem partir um emoji ao meio.
pub(super) fn recortar(texto: &str) -> String {
    let mut recorte: String = texto.chars().take(REPLY_EXCERPT_CHARS).collect();
    if recorte.chars().count() < texto.chars().count() {
        recorte.push('…');
    }
    recorte
}
