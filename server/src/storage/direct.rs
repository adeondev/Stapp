//! Consultas de mensagem direta.
//!
//! A conversa nao tem tabela: o par de contas ja e a identidade dela, e o id sai
//! de [`conversation_id`]. Sem linha de conversa para criar, mandar a primeira
//! mensagem para alguem e igual a mandar a centesima.

use anyhow::Result;
use rusqlite::{OptionalExtension, Row};

use super::Db;
use crate::protocol::{DirectMessage, DirectMessageKind, ReplyRef, UserId};

/// Id deterministico da conversa entre duas contas: os dois ids em ordem.
/// Os dois lados calculam o mesmo valor sem combinar nada.
pub fn conversation_id(a: &str, b: &str) -> String {
    if a <= b {
        format!("{a}:{b}")
    } else {
        format!("{b}:{a}")
    }
}

const COLUNAS: &str = "id, author_id, author_username, kind, text, ts, reply_to, edited_at, mentions, mentions_everyone";

impl Db {
    pub fn insert_direct(&self, conversation: &str, msg: &DirectMessage) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        insert_on(&conn, conversation, msg, None)
    }

    pub fn direct_id_for_nonce(
        &self,
        author_id: &UserId,
        conversation: &str,
        nonce: &str,
    ) -> Result<Option<String>> {
        let conn = self.conn.lock().unwrap();
        Ok(conn.query_row(
            "SELECT id FROM dm_messages WHERE author_id = ?1 AND conversation_id = ?2 AND client_nonce = ?3",
            (author_id, conversation, nonce),
            |row| row.get(0),
        ).optional()?)
    }
}

pub(super) fn insert_on(
    conn: &rusqlite::Connection,
    conversation: &str,
    msg: &DirectMessage,
    client_nonce: Option<&str>,
) -> Result<()> {
    conn.execute(
        "INSERT INTO dm_messages
                (id, conversation_id, author_id, author_username, kind, text, ts,
                 reply_to, mentions, mentions_everyone, client_nonce)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        (
            &msg.id,
            conversation,
            &msg.author_id,
            &msg.author_username,
            kind_para_texto(msg.kind),
            &msg.text,
            msg.ts,
            msg.reply_to.as_ref().map(|r| r.message_id.clone()),
            super::mentions_para_json(&msg.mentions),
            msg.mentions_everyone,
            client_nonce,
        ),
    )?;
    Ok(())
}

impl Db {
    /// As `limit` mensagens mais recentes, ja em ordem cronologica.
    pub fn direct_history(&self, conversation: &str, limit: usize) -> Result<Vec<DirectMessage>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(&format!(
            "SELECT {COLUNAS} FROM dm_messages
              WHERE conversation_id = ?1
              ORDER BY ts DESC, rowid DESC
              LIMIT ?2"
        ))?;
        let rows = stmt.query_map((conversation, limit as i64), ler_mensagem)?;
        let mut msgs = rows.collect::<rusqlite::Result<Vec<_>>>()?;
        hidratar(&conn, &mut msgs)?;
        msgs.reverse();
        Ok(msgs)
    }

    pub fn direct_last(&self, conversation: &str) -> Result<Option<DirectMessage>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(&format!(
            "SELECT {COLUNAS} FROM dm_messages
              WHERE conversation_id = ?1
              ORDER BY ts DESC, rowid DESC
              LIMIT 1"
        ))?;
        let mut rows = stmt.query([conversation])?;
        match rows.next()? {
            Some(row) => {
                let mut msgs = vec![ler_mensagem(row)?];
                hidratar(&conn, &mut msgs)?;
                Ok(msgs.pop())
            }
            None => Ok(None),
        }
    }

    /// Uma mensagem de conversa, ja hidratada. E o que os eventos de
    /// atualizacao de DM reenviam.
    pub fn direct_by_id(&self, id: &str) -> Result<Option<DirectMessage>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(&format!("SELECT {COLUNAS} FROM dm_messages WHERE id = ?1"))?;
        let Some(msg) = stmt.query_row([id], ler_mensagem).optional()? else {
            return Ok(None);
        };
        let mut msgs = vec![msg];
        hidratar(&conn, &mut msgs)?;
        Ok(msgs.pop())
    }

    /// `Ok(false)` = nao existe ou nao e sua. Autoria no `WHERE`, como no canal.
    pub fn update_direct_text(
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
            "UPDATE dm_messages
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

    /// Quantas mensagens da outra pessoa chegaram depois da ultima leitura.
    /// O que voce mesmo escreveu nunca conta como nao lido.
    pub fn direct_unread(&self, reader: &UserId, conversation: &str) -> Result<usize> {
        let conn = self.conn.lock().unwrap();
        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM dm_messages
              WHERE conversation_id = ?1
                AND author_id <> ?2
                AND ts > COALESCE(
                      (SELECT last_read_ts FROM dm_reads
                        WHERE user_id = ?2 AND conversation_id = ?1),
                      0)",
            (conversation, reader),
            |row| row.get(0),
        )?;
        Ok(count as usize)
    }

    pub fn mark_direct_read(&self, reader: &UserId, conversation: &str, ts: i64) -> Result<()> {
        self.mark_direct_read_message(reader, conversation, ts, None)
            .map(|_| ())
    }

    pub fn mark_direct_read_message(
        &self,
        reader: &UserId,
        conversation: &str,
        ts: i64,
        message_id: Option<&str>,
    ) -> Result<bool> {
        let conn = self.conn.lock().unwrap();
        let read_ts = if let Some(message_id) = message_id {
            let message_ts = conn
                .query_row(
                    "SELECT ts FROM dm_messages WHERE id = ?1 AND conversation_id = ?2",
                    (message_id, conversation),
                    |row| row.get::<_, i64>(0),
                )
                .optional()?;
            let Some(message_ts) = message_ts else {
                return Ok(false);
            };
            message_ts
        } else {
            ts
        };
        // MAX evita que uma marcacao atrasada "desleia" o que ja tinha sido lido.
        conn.execute(
            "INSERT INTO dm_reads (user_id, conversation_id, last_read_ts, last_message_id)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT (user_id, conversation_id)
             DO UPDATE SET
                last_read_ts = MAX(last_read_ts, excluded.last_read_ts),
                last_message_id = CASE
                    WHEN excluded.last_read_ts >= last_read_ts THEN excluded.last_message_id
                    ELSE last_message_id
                END",
            (reader, conversation, read_ts, message_id),
        )?;
        Ok(true)
    }

    /// Com quem esta conta ja trocou mensagem, mais recente primeiro.
    pub fn direct_partners(&self, user_id: &UserId) -> Result<Vec<UserId>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT conversation_id, MAX(ts) AS ultima
               FROM dm_messages
              WHERE conversation_id LIKE ?1 || ':%'
                 OR conversation_id LIKE '%:' || ?1
              GROUP BY conversation_id
              ORDER BY ultima DESC",
        )?;
        let rows = stmt.query_map([user_id], |row| row.get::<_, String>(0))?;

        let mut parceiros = Vec::new();
        for conversa in rows {
            let conversa = conversa?;
            if let Some(outro) = outro_lado(&conversa, user_id) {
                parceiros.push(outro);
            }
        }
        Ok(parceiros)
    }
}

/// Igual ao do canal, sobre `dm_messages`: anexo e enquete um a um (divida
/// antiga), reacao e previa de resposta em uma consulta cada.
fn hidratar(conn: &rusqlite::Connection, msgs: &mut [DirectMessage]) -> Result<()> {
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

/// Mesmo LEFT JOIN do canal: alvo ausente vira previa so com o id, e o cliente
/// desenha "mensagem apagada".
fn previas_de_resposta(
    conn: &rusqlite::Connection,
    ids: &[String],
) -> Result<std::collections::HashMap<String, ReplyRef>> {
    let mut mapa = std::collections::HashMap::new();
    if ids.is_empty() {
        return Ok(mapa);
    }

    let marcadores = vec!["?"; ids.len()].join(",");
    let mut stmt = conn.prepare(&format!(
        "SELECT origem.id, origem.reply_to, alvo.author_id, alvo.author_username, alvo.text
           FROM dm_messages origem
           LEFT JOIN dm_messages alvo ON alvo.id = origem.reply_to
          WHERE origem.id IN ({marcadores}) AND origem.reply_to IS NOT NULL"
    ))?;

    let linhas = stmt.query_map(rusqlite::params_from_iter(ids), |row| {
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

/// Extrai a outra ponta de um `conversation_id`.
fn outro_lado(conversation: &str, eu: &str) -> Option<UserId> {
    let (a, b) = conversation.split_once(':')?;
    if a == eu {
        Some(b.to_string())
    } else if b == eu {
        Some(a.to_string())
    } else {
        None
    }
}

fn kind_para_texto(kind: DirectMessageKind) -> &'static str {
    match kind {
        DirectMessageKind::Text => "text",
        DirectMessageKind::Call => "call",
    }
}

fn ler_mensagem(row: &Row) -> rusqlite::Result<DirectMessage> {
    let kind: String = row.get(3)?;
    Ok(DirectMessage {
        id: row.get(0)?,
        author_id: row.get(1)?,
        author_username: row.get(2)?,
        kind: match kind.as_str() {
            "call" => DirectMessageKind::Call,
            _ => DirectMessageKind::Text,
        },
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

/// As duas pontas de um `conversation_id`. E o inverso de [`conversation_id`],
/// e e o que deixa um evento escolher a audiencia a partir da mensagem sozinha.
pub fn conversation_pair(conversation: &str) -> Option<(UserId, UserId)> {
    let (a, b) = conversation.split_once(':')?;
    Some((a.to_string(), b.to_string()))
}
