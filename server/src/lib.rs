//! Servidor do Stapp.
//!
//! As camadas, de fora para dentro:
//!
//! ```text
//! cli/       linha de comando (serve, user ...)
//! app/       monta o Router do axum e serve
//! ws/        transporte WebSocket: cano, autenticacao e roteamento
//! services/  regras de cada funcionalidade (chat, voz)
//! session/   estado vivo: quem esta conectado e em qual call
//! storage/   SQLite: contas e mensagens
//! ```
//!
//! Uma camada so conhece a de dentro. `protocol` e a fonte da verdade das
//! mensagens e e espelhado a mao em `web/src/protocol.ts` — mexeu num, mexe no
//! outro na mesma alteracao.

pub mod admin;
pub mod app;
pub mod cli;
pub mod config;
pub mod protocol;

mod auth;
mod http;
mod services;
mod session;
mod storage;
mod ws;

#[cfg(test)]
mod test_support;

pub use app::{build, serve};
pub use config::Config;
pub use storage::Db;
