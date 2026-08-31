//! Armazenamento e operações com enquetes (polls).

use anyhow::{Result, bail};
use rusqlite::Connection;
use uuid::Uuid;

use crate::protocol::{Poll, PollOption, UserId};

pub fn insert_poll(
    conn: &Connection,
    message_id: &str,
    channel_id: Option<&str>,
    author_id: &UserId,
    question: &str,
    allow_mult: bool,
    options: &[String],
    ts: i64,
) -> Result<Poll> {
    if options.len() < 2 {
        bail!("enquetes precisam de no minimo 2 opcoes");
    }
    if options.len() > 10 {
        bail!("enquetes suportam no maximo 10 opcoes");
    }

    let poll_id = Uuid::new_v4().to_string();

    conn.execute(
        "INSERT INTO polls (id, message_id, channel_id, author_id, question, allow_mult, closed, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0, ?7)",
        (&poll_id, message_id, channel_id, author_id, question, allow_mult as i64, ts),
    )?;

    let mut poll_options = Vec::with_capacity(options.len());
    for (idx, opt_text) in options.iter().enumerate() {
        let opt_id = Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO poll_options (id, poll_id, text, order_idx)
             VALUES (?1, ?2, ?3, ?4)",
            (&opt_id, &poll_id, opt_text, idx as i64),
        )?;
        poll_options.push(PollOption {
            id: opt_id,
            text: opt_text.clone(),
            votes: 0,
            voted_by_me: Some(false),
        });
    }

    Ok(Poll {
        id: poll_id,
        message_id: message_id.to_string(),
        author_id: author_id.clone(),
        question: question.to_string(),
        allow_mult,
        closed: false,
        total_votes: 0,
        options: poll_options,
        created_at: ts,
    })
}

pub fn get_poll_by_id(conn: &Connection, poll_id: &str, current_user_id: Option<&UserId>) -> Result<Option<Poll>> {
    let row = conn.query_row(
        "SELECT id, message_id, author_id, question, allow_mult, closed, created_at
           FROM polls WHERE id = ?1",
        [poll_id],
        |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, i64>(4)? != 0,
                r.get::<_, i64>(5)? != 0,
                r.get::<_, i64>(6)?,
            ))
        },
    );

    let (id, message_id, author_id, question, allow_mult, closed, created_at) = match row {
        Ok(v) => v,
        Err(rusqlite::Error::QueryReturnedNoRows) => return Ok(None),
        Err(e) => return Err(e.into()),
    };

    let mut stmt = conn.prepare(
        "SELECT o.id, o.text,
                (SELECT COUNT(*) FROM poll_votes v WHERE v.option_id = o.id) AS vote_count
           FROM poll_options o
          WHERE o.poll_id = ?1
          ORDER BY o.order_idx ASC",
    )?;

    let mut options = Vec::new();
    let mut total_votes = 0;

    let rows = stmt.query_map([&id], |r| {
        Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, i64>(2)? as usize))
    })?;

    for item in rows {
        let (opt_id, opt_text, votes) = item?;
        total_votes += votes;

        let voted_by_me = if let Some(uid) = current_user_id {
            let voted: bool = conn.query_row(
                "SELECT EXISTS(SELECT 1 FROM poll_votes WHERE poll_id = ?1 AND option_id = ?2 AND user_id = ?3)",
                (&id, &opt_id, uid),
                |r| r.get(0),
            )?;
            Some(voted)
        } else {
            None
        };

        options.push(PollOption {
            id: opt_id,
            text: opt_text,
            votes,
            voted_by_me,
        });
    }

    Ok(Some(Poll {
        id,
        message_id,
        author_id,
        question,
        allow_mult,
        closed,
        total_votes,
        options,
        created_at,
    }))
}

pub fn get_poll_by_message(conn: &Connection, message_id: &str, current_user_id: Option<&UserId>) -> Result<Option<Poll>> {
    let poll_id: Option<String> = conn
        .query_row(
            "SELECT id FROM polls WHERE message_id = ?1",
            [message_id],
            |r| r.get(0),
        )
        .ok();

    match poll_id {
        Some(id) => get_poll_by_id(conn, &id, current_user_id),
        None => Ok(None),
    }
}

pub fn vote_poll(
    conn: &Connection,
    poll_id: &str,
    option_id: &str,
    user_id: &UserId,
    ts: i64,
) -> Result<Poll> {
    let (allow_mult, closed): (bool, bool) = conn.query_row(
        "SELECT allow_mult != 0, closed != 0 FROM polls WHERE id = ?1",
        [poll_id],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;

    if closed {
        bail!("esta enquete ja esta encerrada");
    }

    let option_exists: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM poll_options WHERE id = ?1 AND poll_id = ?2)",
        (option_id, poll_id),
        |r| r.get(0),
    )?;
    if !option_exists {
        bail!("opcao nao pertence a esta enquete");
    }

    let already_voted: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM poll_votes WHERE poll_id = ?1 AND option_id = ?2 AND user_id = ?3)",
        (poll_id, option_id, user_id),
        |r| r.get(0),
    )?;

    if already_voted {
        // Toggle: remove o voto
        conn.execute(
            "DELETE FROM poll_votes WHERE poll_id = ?1 AND option_id = ?2 AND user_id = ?3",
            (poll_id, option_id, user_id),
        )?;
    } else {
        // Se nao permite multiplas escolhas, remove votos anteriores do usuario nesta enquete
        if !allow_mult {
            conn.execute(
                "DELETE FROM poll_votes WHERE poll_id = ?1 AND user_id = ?2",
                (poll_id, user_id),
            )?;
        }
        conn.execute(
            "INSERT INTO poll_votes (poll_id, option_id, user_id, created_at)
             VALUES (?1, ?2, ?3, ?4)",
            (poll_id, option_id, user_id, ts),
        )?;
    }

    get_poll_by_id(conn, poll_id, Some(user_id))?.ok_or_else(|| anyhow::anyhow!("enquete nao encontrada"))
}

pub fn close_poll(conn: &Connection, poll_id: &str, user_id: &UserId) -> Result<Poll> {
    let author_id: String = conn.query_row(
        "SELECT author_id FROM polls WHERE id = ?1",
        [poll_id],
        |r| r.get(0),
    )?;

    if &author_id != user_id {
        bail!("somente o autor pode encerrar a enquete");
    }

    conn.execute(
        "UPDATE polls SET closed = 1 WHERE id = ?1",
        [poll_id],
    )?;

    get_poll_by_id(conn, poll_id, Some(user_id))?.ok_or_else(|| anyhow::anyhow!("enquete nao encontrada"))
}