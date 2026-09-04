//! Versão do esquema e migrações estruturadas via SQLx.

use std::path::{Path, PathBuf};

use anyhow::{Result, bail};
use sqlx::SqlitePool;
use uuid::Uuid;

pub const SCHEMA_VERSION: i64 = 8;
pub static MIGRATOR: sqlx::migrate::Migrator = sqlx::migrate!("./migrations");

pub async fn migrate(pool: &SqlitePool, path: &Path) -> Result<()> {
    let version_row: Option<(i64,)> = sqlx::query_as("PRAGMA user_version")
        .fetch_optional(pool)
        .await?;
    let version = version_row.map(|r| r.0).unwrap_or(0);

    if version > SCHEMA_VERSION {
        bail!(
            "o banco {} usa o esquema da versao {version}, mas este servidor so conhece ate {SCHEMA_VERSION}",
            absolute_path(path).display()
        );
    }

    let has_migrations_table: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = '_sqlx_migrations'",
    )
    .fetch_one(pool)
    .await?;

    if has_migrations_table.0 == 0 && version == 0 && has_any_stapp_table(pool).await? {
        bail!(
            "o banco {} usa o esquema antigo sem contas; mova ou remova esse arquivo conscientemente e inicie o servidor novamente",
            absolute_path(path).display()
        );
    }

    if has_migrations_table.0 == 0 && version > 0 {
        sqlx::query(
            "CREATE TABLE IF NOT EXISTS _sqlx_migrations (
                version BIGINT PRIMARY KEY,
                description TEXT NOT NULL,
                installed_on TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                success BOOLEAN NOT NULL,
                checksum BLOB NOT NULL,
                execution_time BIGINT NOT NULL
            )",
        )
        .execute(pool)
        .await?;

        for m in MIGRATOR.iter() {
            if m.version <= version {
                sqlx::query(
                    "INSERT INTO _sqlx_migrations (version, description, success, checksum, execution_time)
                     VALUES ($1, $2, TRUE, $3, 0)",
                )
                .bind(m.version)
                .bind(&*m.description)
                .bind(&*m.checksum)
                .execute(pool)
                .await?;
            }
        }
    }

    MIGRATOR.run(pool).await?;

    sqlx::query(&format!("PRAGMA user_version = {SCHEMA_VERSION}"))
        .execute(pool)
        .await?;

    ensure_server_id(pool).await?;

    Ok(())
}

async fn ensure_server_id(pool: &SqlitePool) -> Result<()> {
    let exists: (bool,) = sqlx::query_as(
        "SELECT EXISTS(SELECT 1 FROM server_meta WHERE key = 'server_id')",
    )
    .fetch_one(pool)
    .await?;
    if !exists.0 {
        sqlx::query("INSERT INTO server_meta (key, value) VALUES ('server_id', $1)")
            .bind(Uuid::new_v4().to_string())
            .execute(pool)
            .await?;
    }
    Ok(())
}

async fn has_any_stapp_table(pool: &SqlitePool) -> Result<bool> {
    let count: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM sqlite_master
          WHERE type = 'table' AND name IN ('messages', 'users')",
    )
    .fetch_one(pool)
    .await?;
    Ok(count.0 > 0)
}

fn absolute_path(path: &Path) -> PathBuf {
    path.canonicalize().unwrap_or_else(|_| {
        std::env::current_dir()
            .map(|dir| dir.join(path))
            .unwrap_or_else(|_| path.to_path_buf())
    })
}

#[cfg(test)]
pub(super) async fn migrate_to(pool: &SqlitePool, version: i64) -> Result<()> {
    for m in MIGRATOR.iter() {
        if m.version <= version {
            sqlx::raw_sql(&m.sql).execute(pool).await?;
        }
    }
    sqlx::query(&format!("PRAGMA user_version = {version}"))
        .execute(pool)
        .await?;
    Ok(())
}
