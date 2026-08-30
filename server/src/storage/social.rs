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
    pub fn allow_member_dms(&self, user_id: &str) -> Result<bool> {
        let conn = self.conn.lock().unwrap();
        Ok(conn.query_row(
            "SELECT COALESCE((SELECT allow_member_dms FROM user_privacy WHERE user_id = ?1), 1)",
            [user_id],
            |row| row.get(0),
        )?)
    }

    pub fn set_allow_member_dms(&self, user_id: &str, allow: bool) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO user_privacy (user_id, allow_member_dms) VALUES (?1, ?2)
             ON CONFLICT(user_id) DO UPDATE SET allow_member_dms = excluded.allow_member_dms",
            (user_id, allow),
        )?;
        Ok(())
    }

    pub fn social_records(&self, me: &str) -> Result<Vec<SocialRecord>> {
        let accounts = self.list_accounts()?;
        let mut records = Vec::new();
        for account in accounts {
            if account.id == me || account.disabled_at.is_some() {
                continue;
            }
            let relationship = self.relationship(me, &account.id)?;
            let has_conversation = self.direct_conversation_exists(me, &account.id)?;
            let target_open = self.allow_member_dms(&account.id)?;
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

    pub fn can_direct(&self, from: &str, to: &str) -> Result<bool> {
        if from == to || self.account_by_id(to)?.is_none() {
            return Ok(false);
        }
        let relationship = self.relationship(from, to)?;
        if matches!(
            relationship,
            Relationship::Blocked | Relationship::BlockedBy
        ) {
            return Ok(false);
        }
        Ok(relationship == Relationship::Friend
            || self.allow_member_dms(to)?
            || self.direct_conversation_exists(from, to)?)
    }

    pub fn direct_conversation_exists(&self, a: &str, b: &str) -> Result<bool> {
        let conversation = super::conversation_id(a, b);
        let conn = self.conn.lock().unwrap();
        Ok(conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM dm_messages WHERE conversation_id = ?1)",
            [conversation],
            |row| row.get(0),
        )?)
    }

    pub fn request_friend(&self, from: &str, to: &str) -> Result<bool> {
        if from == to {
            return Ok(false);
        }
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction()?;
        let blocked: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM user_blocks
              WHERE (blocker_id = ?1 AND blocked_id = ?2)
                 OR (blocker_id = ?2 AND blocked_id = ?1))",
            (from, to),
            |row| row.get(0),
        )?;
        if blocked {
            return Ok(false);
        }
        let (a, b) = pair(from, to);
        let friends: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM friendships WHERE user_a = ?1 AND user_b = ?2)",
            (&a, &b),
            |row| row.get(0),
        )?;
        if friends {
            return Ok(true);
        }
        let inverse: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM friend_requests WHERE requester_id = ?1 AND addressee_id = ?2)",
            (to, from),
            |row| row.get(0),
        )?;
        if inverse {
            tx.execute(
                "DELETE FROM friend_requests
                  WHERE (requester_id = ?1 AND addressee_id = ?2)
                     OR (requester_id = ?2 AND addressee_id = ?1)",
                (from, to),
            )?;
            tx.execute(
                "INSERT OR IGNORE INTO friendships (user_a, user_b, created_at) VALUES (?1, ?2, ?3)",
                (&a, &b, now_ms()),
            )?;
        } else {
            tx.execute(
                "INSERT OR IGNORE INTO friend_requests (requester_id, addressee_id, created_at)
                 VALUES (?1, ?2, ?3)",
                (from, to, now_ms()),
            )?;
        }
        tx.commit()?;
        Ok(true)
    }

    pub fn accept_friend(&self, me: &str, other: &str) -> Result<bool> {
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction()?;
        let deleted = tx.execute(
            "DELETE FROM friend_requests WHERE requester_id = ?1 AND addressee_id = ?2",
            (other, me),
        )?;
        if deleted == 0 {
            return Ok(false);
        }
        let (a, b) = pair(me, other);
        tx.execute(
            "INSERT OR IGNORE INTO friendships (user_a, user_b, created_at) VALUES (?1, ?2, ?3)",
            (&a, &b, now_ms()),
        )?;
        tx.commit()?;
        Ok(true)
    }

    pub fn delete_friend_request(&self, requester: &str, addressee: &str) -> Result<bool> {
        let conn = self.conn.lock().unwrap();
        Ok(conn.execute(
            "DELETE FROM friend_requests WHERE requester_id = ?1 AND addressee_id = ?2",
            (requester, addressee),
        )? > 0)
    }

    pub fn remove_friend(&self, a: &str, b: &str) -> Result<bool> {
        let (a, b) = pair(a, b);
        let conn = self.conn.lock().unwrap();
        Ok(conn.execute(
            "DELETE FROM friendships WHERE user_a = ?1 AND user_b = ?2",
            (&a, &b),
        )? > 0)
    }

    pub fn block_user(&self, blocker: &str, blocked: &str) -> Result<bool> {
        if blocker == blocked {
            return Ok(false);
        }
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction()?;
        tx.execute(
            "DELETE FROM friend_requests
              WHERE (requester_id = ?1 AND addressee_id = ?2)
                 OR (requester_id = ?2 AND addressee_id = ?1)",
            (blocker, blocked),
        )?;
        let (a, b) = pair(blocker, blocked);
        tx.execute(
            "DELETE FROM friendships WHERE user_a = ?1 AND user_b = ?2",
            (&a, &b),
        )?;
        let inserted = tx.execute(
            "INSERT OR IGNORE INTO user_blocks (blocker_id, blocked_id, created_at)
             VALUES (?1, ?2, ?3)",
            (blocker, blocked, now_ms()),
        )?;
        tx.commit()?;
        Ok(inserted > 0)
    }

    pub fn unblock_user(&self, blocker: &str, blocked: &str) -> Result<bool> {
        let conn = self.conn.lock().unwrap();
        Ok(conn.execute(
            "DELETE FROM user_blocks WHERE blocker_id = ?1 AND blocked_id = ?2",
            (blocker, blocked),
        )? > 0)
    }

    fn relationship(&self, me: &str, other: &str) -> Result<Relationship> {
        let conn = self.conn.lock().unwrap();
        let me_blocks: bool = conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM user_blocks WHERE blocker_id = ?1 AND blocked_id = ?2)",
            (me, other),
            |row| row.get(0),
        )?;
        if me_blocks {
            return Ok(Relationship::Blocked);
        }
        let blocks_me: bool = conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM user_blocks WHERE blocker_id = ?1 AND blocked_id = ?2)",
            (other, me),
            |row| row.get(0),
        )?;
        if blocks_me {
            return Ok(Relationship::BlockedBy);
        }
        let (a, b) = pair(me, other);
        let friends: bool = conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM friendships WHERE user_a = ?1 AND user_b = ?2)",
            (&a, &b),
            |row| row.get(0),
        )?;
        if friends {
            return Ok(Relationship::Friend);
        }
        let outgoing: bool = conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM friend_requests WHERE requester_id = ?1 AND addressee_id = ?2)",
            (me, other),
            |row| row.get(0),
        )?;
        if outgoing {
            return Ok(Relationship::Outgoing);
        }
        let incoming: bool = conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM friend_requests WHERE requester_id = ?1 AND addressee_id = ?2)",
            (other, me),
            |row| row.get(0),
        )?;
        Ok(if incoming {
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
