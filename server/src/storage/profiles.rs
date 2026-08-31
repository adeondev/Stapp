//! Consultas de perfil.
//!
//! A linha e criada na migracao para toda conta que ja existia, e o
//! `INSERT ... ON CONFLICT` cobre as contas novas — entao ler um perfil nunca
//! volta vazio por falta de linha.

use anyhow::Result;
use rusqlite::Row;

use super::Db;
use crate::protocol::{Profile, UserId};

/// Le o perfil junto do username, que mora em `users`. O `display_name` sai
/// daqui ja resolvido: quem nunca escolheu um aparece com o proprio username.
const SELECT: &str = "SELECT u.id,
                             u.username,
                             COALESCE(NULLIF(p.display_name, ''), u.username),
                             COALESCE(p.accent, 'blue'),
                             COALESCE(p.bio, ''),
                             p.avatar_ext,
                             COALESCE(p.updated_at, 0)
                        FROM users u
                        LEFT JOIN user_profiles p ON p.user_id = u.id";

impl Db {
    pub fn profile_of(&self, user_id: &UserId) -> Result<Option<Profile>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(&format!("{SELECT} WHERE u.id = ?1"))?;
        let mut rows = stmt.query([user_id])?;
        match rows.next()? {
            Some(row) => Ok(Some(ler_perfil(row)?)),
            None => Ok(None),
        }
    }

    /// Os perfis de todas as contas ativas. E o que vai no `welcome`.
    pub fn all_profiles(&self) -> Result<Vec<Profile>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(&format!(
            "{SELECT} WHERE u.disabled_at IS NULL ORDER BY u.username_key"
        ))?;
        let rows = stmt.query_map([], ler_perfil)?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    /// Grava so o que veio; `None` deixa o campo como esta. Um `display_name`
    /// vazio limpa a escolha e faz o perfil voltar a usar o username.
    pub fn update_profile(
        &self,
        user_id: &UserId,
        display_name: Option<&str>,
        accent: Option<&str>,
        bio: Option<&str>,
        now: i64,
    ) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO user_profiles (user_id, display_name, accent, bio, updated_at)
             VALUES (?1, ?2, COALESCE(?3, 'blue'), COALESCE(?4, ''), ?5)
             ON CONFLICT(user_id) DO UPDATE SET
                 display_name = COALESCE(?2, display_name),
                 accent       = COALESCE(?3, accent),
                 bio          = COALESCE(?4, bio),
                 updated_at   = ?5",
            (user_id, display_name, accent, bio, now),
        )?;
        Ok(())
    }
}

impl Db {
    /// `Some("webp")` quando existe imagem, `None` quando voltou ao gerado.
    /// Mexe no `updated_at` porque e ele que invalida o cache do navegador.
    pub fn set_avatar(&self, user_id: &UserId, ext: Option<&str>, now: i64) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO user_profiles (user_id, avatar_ext, updated_at)
             VALUES (?1, ?2, ?3)
             ON CONFLICT(user_id) DO UPDATE SET avatar_ext = ?2, updated_at = ?3",
            (user_id, ext, now),
        )?;
        Ok(())
    }
}

fn ler_perfil(row: &Row) -> rusqlite::Result<Profile> {
    let avatar_ext: Option<String> = row.get(5)?;
    Ok(Profile {
        user_id: row.get(0)?,
        username: row.get(1)?,
        display_name: row.get(2)?,
        accent: row.get(3)?,
        bio: row.get(4)?,
        has_avatar: avatar_ext.is_some(),
        updated_at: row.get(6)?,
    })
}
