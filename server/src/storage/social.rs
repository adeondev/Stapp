//! Relacoes sociais e politica de mensagens diretas.

use anyhow::Result;

use super::Db;
use crate::protocol::now_ms;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Relationship {
    None,
    Incoming,
    Outgoing,
    Friend,
    Blocked,
    BlockedBy,
}

#[derive(Debug, Clone)]
pub struct SocialRecord {
    pub user_id: String,
    pub username: String,
    pub relationship: Relationship,
    pub can_start_dm: bool,
    pub has_conversation: bool,
}

impl Db {
    pub async fn allow_member_dms(&self, user_id: &str) -> Result<bool> {
        let row: (bool,) = sqlx::query_as(
            "SELECT COALESCE((SELECT allow_member_dms != 0 FROM user_privacy WHERE user_id = $1), 1)",
        )
        .bind(user_id)
        .fetch_one(&self.pool)
        .await?;
        Ok(row.0)
    }

    pub async fn set_allow_member_dms(&self, user_id: &str, allow: bool) -> Result<()> {
        sqlx::query(
            "INSERT INTO user_privacy (user_id, allow_member_dms) VALUES ($1, $2)
             ON CONFLICT(user_id) DO UPDATE SET allow_member_dms = excluded.allow_member_dms",
        )
        .bind(user_id)
        .bind(allow as i64)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn social_records(&self, me: &str) -> Result<Vec<SocialRecord>> {
        let accounts = self.list_accounts().await?;
        let mut records = Vec::new();
        for account in accounts {
            if account.id == me || account.disabled_at.is_some() {
                continue;
            }
            let relationship = self.relationship(me, &account.id).await?;
            let has_conversation = self.direct_conversation_exists(me, &account.id).await?;
            let target_open = self.allow_member_dms(&account.id).await?;
            let blocked = matches!(
                relationship,
                Relationship::Blocked | Relationship::BlockedBy
            );
            let can_start_dm = !blocked
                && (relationship == Relationship::Friend || target_open || has_conversation);
            records.push(SocialRecord {
                user_id: account.id,
                username: account.username,
                relationship,
                can_start_dm,
                has_conversation,
            });
        }
        records.sort_by_key(|record| record.username.to_ascii_lowercase());
        Ok(records)
    }

    pub async fn can_direct(&self, from: &str, to: &str) -> Result<bool> {
        if from == to || self.account_by_id(to).await?.is_none() {
            return Ok(false);
        }
        let relationship = self.relationship(from, to).await?;
        if matches!(
            relationship,
            Relationship::Blocked | Relationship::BlockedBy
        ) {
            return Ok(false);
        }
        Ok(relationship == Relationship::Friend
            || self.allow_member_dms(to).await?
            || self.direct_conversation_exists(from, to).await?)
    }

    pub async fn direct_conversation_exists(&self, a: &str, b: &str) -> Result<bool> {
        let conversation = super::conversation_id(a, b);
        let exists: (bool,) = sqlx::query_as(
            "SELECT EXISTS(SELECT 1 FROM dm_messages WHERE conversation_id = $1)",
        )
        .bind(conversation)
        .fetch_one(&self.pool)
        .await?;
        Ok(exists.0)
    }

    pub async fn request_friend(&self, from: &str, to: &str) -> Result<bool> {
        if from == to {
            return Ok(false);
        }
        let mut tx = self.pool.begin().await?;
        let blocked: (bool,) = sqlx::query_as(
            "SELECT EXISTS(SELECT 1 FROM user_blocks
              WHERE (blocker_id = $1 AND blocked_id = $2)
                 OR (blocker_id = $2 AND blocked_id = $1))",
        )
        .bind(from)
        .bind(to)
        .fetch_one(&mut *tx)
        .await?;
        if blocked.0 {
            return Ok(false);
        }
        let (a, b) = pair(from, to);
        let friends: (bool,) = sqlx::query_as(
            "SELECT EXISTS(SELECT 1 FROM friendships WHERE user_a = $1 AND user_b = $2)",
        )
        .bind(&a)
        .bind(&b)
        .fetch_one(&mut *tx)
        .await?;
        if friends.0 {
            return Ok(true);
        }
        let inverse: (bool,) = sqlx::query_as(
            "SELECT EXISTS(SELECT 1 FROM friend_requests WHERE requester_id = $1 AND addressee_id = $2)",
        )
        .bind(to)
        .bind(from)
        .fetch_one(&mut *tx)
        .await?;
        if inverse.0 {
            sqlx::query(
                "DELETE FROM friend_requests
                  WHERE (requester_id = $1 AND addressee_id = $2)
                     OR (requester_id = $2 AND addressee_id = $1)",
            )
            .bind(from)
            .bind(to)
            .execute(&mut *tx)
            .await?;
            sqlx::query(
                "INSERT OR IGNORE INTO friendships (user_a, user_b, created_at) VALUES ($1, $2, $3)",
            )
            .bind(&a)
            .bind(&b)
            .bind(now_ms())
            .execute(&mut *tx)
            .await?;
        } else {
            sqlx::query(
                "INSERT OR IGNORE INTO friend_requests (requester_id, addressee_id, created_at)
                 VALUES ($1, $2, $3)",
            )
            .bind(from)
            .bind(to)
            .bind(now_ms())
            .execute(&mut *tx)
            .await?;
        }
        tx.commit().await?;
        Ok(true)
    }

    pub async fn accept_friend(&self, me: &str, other: &str) -> Result<bool> {
        let mut tx = self.pool.begin().await?;
        let deleted = sqlx::query(
            "DELETE FROM friend_requests WHERE requester_id = $1 AND addressee_id = $2",
        )
        .bind(other)
        .bind(me)
        .execute(&mut *tx)
        .await?
        .rows_affected();

        if deleted == 0 {
            return Ok(false);
        }
        let (a, b) = pair(me, other);
        sqlx::query(
            "INSERT OR IGNORE INTO friendships (user_a, user_b, created_at) VALUES ($1, $2, $3)",
        )
        .bind(&a)
        .bind(&b)
        .bind(now_ms())
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        Ok(true)
    }

    pub async fn delete_friend_request(&self, requester: &str, addressee: &str) -> Result<bool> {
        let changed = sqlx::query(
            "DELETE FROM friend_requests WHERE requester_id = $1 AND addressee_id = $2",
        )
        .bind(requester)
        .bind(addressee)
        .execute(&self.pool)
        .await?
        .rows_affected();
        Ok(changed > 0)
    }

    pub async fn remove_friend(&self, a: &str, b: &str) -> Result<bool> {
        let (a, b) = pair(a, b);
        let changed = sqlx::query(
            "DELETE FROM friendships WHERE user_a = $1 AND user_b = $2",
        )
        .bind(&a)
        .bind(&b)
        .execute(&self.pool)
        .await?
        .rows_affected();
        Ok(changed > 0)
    }

    pub async fn block_user(&self, blocker: &str, blocked: &str) -> Result<bool> {
        if blocker == blocked {
            return Ok(false);
        }
        let mut tx = self.pool.begin().await?;
        sqlx::query(
            "DELETE FROM friend_requests
              WHERE (requester_id = $1 AND addressee_id = $2)
                 OR (requester_id = $2 AND addressee_id = $1)",
        )
        .bind(blocker)
        .bind(blocked)
        .execute(&mut *tx)
        .await?;
        let (a, b) = pair(blocker, blocked);
        sqlx::query(
            "DELETE FROM friendships WHERE user_a = $1 AND user_b = $2",
        )
        .bind(&a)
        .bind(&b)
        .execute(&mut *tx)
        .await?;
        let inserted = sqlx::query(
            "INSERT OR IGNORE INTO user_blocks (blocker_id, blocked_id, created_at)
             VALUES ($1, $2, $3)",
        )
        .bind(blocker)
        .bind(blocked)
        .bind(now_ms())
        .execute(&mut *tx)
        .await?
        .rows_affected();
        tx.commit().await?;
        Ok(inserted > 0)
    }

    pub async fn unblock_user(&self, blocker: &str, blocked: &str) -> Result<bool> {
        let changed = sqlx::query(
            "DELETE FROM user_blocks WHERE blocker_id = $1 AND blocked_id = $2",
        )
        .bind(blocker)
        .bind(blocked)
        .execute(&self.pool)
        .await?
        .rows_affected();
        Ok(changed > 0)
    }

    async fn relationship(&self, me: &str, other: &str) -> Result<Relationship> {
        let me_blocks: (bool,) = sqlx::query_as(
            "SELECT EXISTS(SELECT 1 FROM user_blocks WHERE blocker_id = $1 AND blocked_id = $2)",
        )
        .bind(me)
        .bind(other)
        .fetch_one(&self.pool)
        .await?;
        if me_blocks.0 {
            return Ok(Relationship::Blocked);
        }
        let blocks_me: (bool,) = sqlx::query_as(
            "SELECT EXISTS(SELECT 1 FROM user_blocks WHERE blocker_id = $1 AND blocked_id = $2)",
        )
        .bind(other)
        .bind(me)
        .fetch_one(&self.pool)
        .await?;
        if blocks_me.0 {
            return Ok(Relationship::BlockedBy);
        }
        let (a, b) = pair(me, other);
        let friends: (bool,) = sqlx::query_as(
            "SELECT EXISTS(SELECT 1 FROM friendships WHERE user_a = $1 AND user_b = $2)",
        )
        .bind(&a)
        .bind(&b)
        .fetch_one(&self.pool)
        .await?;
        if friends.0 {
            return Ok(Relationship::Friend);
        }
        let outgoing: (bool,) = sqlx::query_as(
            "SELECT EXISTS(SELECT 1 FROM friend_requests WHERE requester_id = $1 AND addressee_id = $2)",
        )
        .bind(me)
        .bind(other)
        .fetch_one(&self.pool)
        .await?;
        if outgoing.0 {
            return Ok(Relationship::Outgoing);
        }
        let incoming: (bool,) = sqlx::query_as(
            "SELECT EXISTS(SELECT 1 FROM friend_requests WHERE requester_id = $1 AND addressee_id = $2)",
        )
        .bind(other)
        .bind(me)
        .fetch_one(&self.pool)
        .await?;
        Ok(if incoming.0 {
            Relationship::Incoming
        } else {
            Relationship::None
        })
    }
}

fn pair(a: &str, b: &str) -> (String, String) {
    if a < b {
        (a.to_string(), b.to_string())
    } else {
        (b.to_string(), a.to_string())
    }
}
