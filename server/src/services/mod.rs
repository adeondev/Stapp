//! Servicos de dominio: as regras de cada funcionalidade do Stapp.
//!
//! Um servico recebe o [`crate::session::AppState`], decide o que acontece e
//! publica os eventos. Ele nao sabe de WebSocket nem de SQL — quem entrega o
//! frame e o [`crate::ws`], quem grava e o [`crate::storage`].
//!
//! **Funcionalidade nova entra aqui**, como um arquivo novo, e ganha uma linha
//! em `ws::dispatch`.

pub mod call;
pub mod chat;
pub mod direct;
pub mod media;
pub mod messages;
pub mod polls;
pub mod preview;
pub mod profile;
pub mod social;
pub mod voice;
