//! Consultas de perfil.

use anyhow::Result;
use super::Db;
use crate::protocol::{Profile, UserId};

const SELECT: &str = "SELECT u.id,
                             u.username,
                             COALESCE(NULLIF(p.display_name, ''), u.username) AS display_name,
                             COALESCE(p.accent, 'blue') AS accent,
                             COALESCE(p.bio, '') AS bio,
                             p.avatar_ext,
                             COALESCE(p.updated_at, 0) AS updated_at
                        FROM users u
                        LEFT JOIN user_profiles p ON p.user_id = u.id";

#[derive(sqlx::FromRow)]
struct RawProfile {
    id: String,
    username: String,
    display_name: String,
    accent: String,
    bio: String,
    avatar_ext: Option<String>,
    updated_at: i64,
}

impl From<RawProfile> for Profile {
    fn from(r: RawProfile) -> Self {
        Self {
            user_id: r.id,
            username: r.username,
            display_name: r.display_name,
            accent: r.accent,
            bio: r.bio,
            has_avatar: r.avatar_ext.is_some(),
            updated_at: r.updated_at,
        }
    }
}

impl Db {
    pub async fn profile_of(&self, user_id: &UserId) -> Result<Option<Profile>> {
        let query = format!("{SELECT} WHERE u.id = $1");
        let row: Option<RawProfile> = sqlx::query_as(&query)
            .bind(user_id)
            .fetch_optional(&self.pool)
            .await?;
        Ok(row.map(Into::into))
    }

    pub async fn all_profiles(&self) -> Result<Vec<Profile>> {
        let query = format!("{SELECT} WHERE u.disabled_at IS NULL ORDER BY u.username_key");
        let rows: Vec<RawProfile> = sqlx::query_as(&query)
            .fetch_all(&self.pool)
            .await?;
        Ok(rows.into_iter().map(Into::into).collect())
    }

    pub async fn update_profile(
        &self,
        user_id: &UserId,
        display_name: Option<&str>,
        accent: Option<&str>,
        bio: Option<&str>,
        now: i64,
    ) -> Result<()> {
        sqlx::query(
            "INSERT INTO user_profiles (user_id, display_name, accent, bio, updated_at)
             VALUES ($1, $2, COALESCE($3, 'blue'), COALESCE($4, ''), $5)
             ON CONFLICT(user_id) DO UPDATE SET
                 display_name = COALESCE($2, display_name),
                 accent       = COALESCE($3, accent),
                 bio          = COALESCE($4, bio),
                 updated_at   = $5",
        )
        .bind(user_id)
        .bind(display_name)
        .bind(accent)
        .bind(bio)
        .bind(now)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn set_avatar(&self, user_id: &UserId, ext: Option<&str>, now: i64) -> Result<()> {
        sqlx::query(
            "INSERT INTO user_profiles (user_id, avatar_ext, updated_at)
             VALUES ($1, $2, $3)
             ON CONFLICT(user_id) DO UPDATE SET avatar_ext = $2, updated_at = $3",
        )
        .bind(user_id)
        .bind(ext)
        .bind(now)
        .execute(&self.pool)
        .await?;
        Ok(())
    }
}
