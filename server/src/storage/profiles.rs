//! Consultas de perfil.

use anyhow::Result;
use super::Db;
use crate::protocol::{Profile, UserId};

// `created_at` ja existia em `users` desde a primeira migracao, so nunca tinha
// saido daqui. E o "Membro desde" do cartao de perfil — dado real, nao inventado.
const SELECT: &str = "SELECT u.id,
                             u.username,
                             COALESCE(NULLIF(p.display_name, ''), u.username) AS display_name,
                             COALESCE(p.accent, 'blue') AS accent,
                             COALESCE(p.bio, '') AS bio,
                             p.avatar_ext,
                             p.banner_ext,
                             u.created_at,
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
    banner_ext: Option<String>,
    created_at: i64,
    updated_at: i64,
}

impl From<RawProfile> for Profile {
    fn from(r: RawProfile) -> Self {
        let is_gif = r.avatar_ext.as_deref() == Some("gif");
        let has_avatar = r.avatar_ext.is_some();
        let avatar_static_url = if has_avatar {
            Some(format!("/avatars/{}?v={}&static=1", r.id, r.updated_at))
        } else {
            None
        };
        let avatar_gif_url = if is_gif {
            Some(format!("/avatars/{}?v={}&gif=1", r.id, r.updated_at))
        } else {
            None
        };
        let banner_url = if r.banner_ext.is_some() {
            Some(format!("/banners/{}?v={}", r.id, r.updated_at))
        } else {
            None
        };
        Self {
            user_id: r.id,
            username: r.username,
            display_name: r.display_name,
            accent: r.accent,
            bio: r.bio,
            has_avatar,
            avatar_gif: if is_gif { Some(true) } else { None },
            avatar_static_url,
            avatar_gif_url,
            has_banner: r.banner_ext.is_some(),
            banner_url,
            banner_color: None,
            created_at: r.created_at,
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

    pub async fn set_banner(&self, user_id: &UserId, ext: Option<&str>, now: i64) -> Result<()> {
        sqlx::query(
            "INSERT INTO user_profiles (user_id, banner_ext, updated_at)
             VALUES ($1, $2, $3)
             ON CONFLICT(user_id) DO UPDATE SET banner_ext = $2, updated_at = $3",
        )
        .bind(user_id)
        .bind(ext)
        .bind(now)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// Os amigos que duas contas tem em comum.
    ///
    /// `friendships` guarda o par ordenado (`user_a < user_b`), entao cada lado
    /// vira um `SELECT` que devolve "o outro" e a interseccao sai de um
    /// `INTERSECT`. Quem passa os dois ids e o servidor, a partir da identidade
    /// da sessao — nunca um id que o cliente disse ser "eu".
    pub async fn mutual_friends(&self, a: &UserId, b: &UserId) -> Result<Vec<UserId>> {
        const AMIGOS_DE: &str =
            "SELECT CASE WHEN user_a = ? THEN user_b ELSE user_a END AS amigo
               FROM friendships WHERE user_a = ? OR user_b = ?";
        let query = format!(
            "SELECT amigo FROM ({AMIGOS_DE}) INTERSECT SELECT amigo FROM ({AMIGOS_DE})"
        );
        let rows: Vec<(String,)> = sqlx::query_as(&query)
            .bind(a).bind(a).bind(a)
            .bind(b).bind(b).bind(b)
            .fetch_all(&self.pool)
            .await?;
        Ok(rows.into_iter().map(|(id,)| id).collect())
    }
}
