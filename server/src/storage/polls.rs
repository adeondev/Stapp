//! Armazenamento e operações com enquetes (polls).

use anyhow::{Result, bail};
use sqlx::SqlitePool;
use uuid::Uuid;

use crate::protocol::{Poll, PollOption, UserId};

pub async fn insert_poll(
    pool: &SqlitePool,
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

    sqlx::query(
        "INSERT INTO polls (id, message_id, channel_id, author_id, question, allow_mult, closed, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, 0, $7)",
    )
    .bind(&poll_id)
    .bind(message_id)
    .bind(channel_id)
    .bind(author_id)
    .bind(question)
    .bind(allow_mult as i64)
    .bind(ts)
    .execute(pool)
    .await?;

    let mut poll_options = Vec::with_capacity(options.len());
    for (idx, opt_text) in options.iter().enumerate() {
        let opt_id = Uuid::new_v4().to_string();
        sqlx::query(
            "INSERT INTO poll_options (id, poll_id, text, order_idx)
             VALUES ($1, $2, $3, $4)",
        )
        .bind(&opt_id)
        .bind(&poll_id)
        .bind(opt_text)
        .bind(idx as i64)
        .execute(pool)
        .await?;

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

pub async fn get_poll_by_id(
    pool: &SqlitePool,
    poll_id: &str,
    current_user_id: Option<&UserId>,
) -> Result<Option<Poll>> {
    let row: Option<(String, String, String, String, bool, bool, i64)> = sqlx::query_as(
        "SELECT id, message_id, author_id, question, allow_mult != 0, closed != 0, created_at
           FROM polls WHERE id = $1",
    )
    .bind(poll_id)
    .fetch_optional(pool)
    .await?;

    let Some((id, message_id, author_id, question, allow_mult, closed, created_at)) = row else {
        return Ok(None);
    };

    let opt_rows: Vec<(String, String, i64)> = sqlx::query_as(
        "SELECT o.id, o.text,
                (SELECT COUNT(*) FROM poll_votes v WHERE v.option_id = o.id) AS vote_count
           FROM poll_options o
          WHERE o.poll_id = $1
          ORDER BY o.order_idx ASC",
    )
    .bind(&id)
    .fetch_all(pool)
    .await?;

    let mut options = Vec::new();
    let mut total_votes = 0;

    for (opt_id, opt_text, vote_count) in opt_rows {
        let votes = vote_count as usize;
        total_votes += votes;

        let voted_by_me = if let Some(uid) = current_user_id {
            let voted: (bool,) = sqlx::query_as(
                "SELECT EXISTS(SELECT 1 FROM poll_votes WHERE poll_id = $1 AND option_id = $2 AND user_id = $3)",
            )
            .bind(&id)
            .bind(&opt_id)
            .bind(uid)
            .fetch_one(pool)
            .await?;
            Some(voted.0)
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

pub async fn get_poll_by_message(
    pool: &SqlitePool,
    message_id: &str,
    current_user_id: Option<&UserId>,
) -> Result<Option<Poll>> {
    let poll_id: Option<(String,)> = sqlx::query_as(
        "SELECT id FROM polls WHERE message_id = $1",
    )
    .bind(message_id)
    .fetch_optional(pool)
    .await?;

    match poll_id {
        Some((id,)) => get_poll_by_id(pool, &id, current_user_id).await,
        None => Ok(None),
    }
}

pub async fn vote_poll(
    pool: &SqlitePool,
    poll_id: &str,
    option_id: &str,
    user_id: &UserId,
    ts: i64,
) -> Result<Poll> {
    let poll_row: Option<(bool, bool)> = sqlx::query_as(
        "SELECT allow_mult != 0, closed != 0 FROM polls WHERE id = $1",
    )
    .bind(poll_id)
    .fetch_optional(pool)
    .await?;

    let Some((allow_mult, closed)) = poll_row else {
        bail!("enquete nao encontrada");
    };

    if closed {
        bail!("esta enquete ja esta encerrada");
    }

    let option_exists: (bool,) = sqlx::query_as(
        "SELECT EXISTS(SELECT 1 FROM poll_options WHERE id = $1 AND poll_id = $2)",
    )
    .bind(option_id)
    .bind(poll_id)
    .fetch_one(pool)
    .await?;

    if !option_exists.0 {
        bail!("opcao nao pertence a esta enquete");
    }

    let already_voted: (bool,) = sqlx::query_as(
        "SELECT EXISTS(SELECT 1 FROM poll_votes WHERE poll_id = $1 AND option_id = $2 AND user_id = $3)",
    )
    .bind(poll_id)
    .bind(option_id)
    .bind(user_id)
    .fetch_one(pool)
    .await?;

    if already_voted.0 {
        sqlx::query("DELETE FROM poll_votes WHERE poll_id = $1 AND option_id = $2 AND user_id = $3")
            .bind(poll_id)
            .bind(option_id)
            .bind(user_id)
            .execute(pool)
            .await?;
    } else {
        if !allow_mult {
            sqlx::query("DELETE FROM poll_votes WHERE poll_id = $1 AND user_id = $2")
                .bind(poll_id)
                .bind(user_id)
                .execute(pool)
                .await?;
        }
        sqlx::query(
            "INSERT INTO poll_votes (poll_id, option_id, user_id, created_at)
             VALUES ($1, $2, $3, $4)",
        )
        .bind(poll_id)
        .bind(option_id)
        .bind(user_id)
        .bind(ts)
        .execute(pool)
        .await?;
    }

    get_poll_by_id(pool, poll_id, Some(user_id))
        .await?
        .ok_or_else(|| anyhow::anyhow!("enquete nao encontrada"))
}

pub async fn close_poll(pool: &SqlitePool, poll_id: &str, user_id: &UserId) -> Result<Poll> {
    let author_id: (String,) = sqlx::query_as(
        "SELECT author_id FROM polls WHERE id = $1",
    )
    .bind(poll_id)
    .fetch_one(pool)
    .await?;

    if &author_id.0 != user_id {
        bail!("somente o autor pode encerrar a enquete");
    }

    sqlx::query("UPDATE polls SET closed = 1 WHERE id = $1")
        .bind(poll_id)
        .execute(pool)
        .await?;

    get_poll_by_id(pool, poll_id, Some(user_id))
        .await?
        .ok_or_else(|| anyhow::anyhow!("enquete nao encontrada"))
}
