//! Transporte HTTP. Credenciais e refresh passam aqui; o WebSocket recebe
//! somente um access token curto e continua dedicado aos eventos em tempo real.

pub mod assets;
pub mod attachments;
pub mod auth;
pub mod avatars;
