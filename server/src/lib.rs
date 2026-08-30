pub mod admin;
pub mod app;
pub mod channel;
pub mod config;

mod auth;
mod chat;
mod db;
mod protocol;
mod state;
mod voice;
mod ws;

#[cfg(test)]
mod test_support;

pub use app::serve;
pub use config::Config;

pub fn open_database(config: &Config) -> anyhow::Result<db::Db> {
    db::Db::open(&config.storage.database)
}
