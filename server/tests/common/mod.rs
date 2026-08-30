//! Apoio dos testes de integracao.
//!
//! Diferente de `src/test_support.rs`, que ajuda os testes unitarios de dentro
//! do crate, este modulo so enxerga a API publica — do mesmo jeito que quem for
//! embutir o servidor em outro programa.

use std::net::SocketAddr;
use std::path::PathBuf;

use futures_util::{SinkExt, StreamExt};
use serde_json::Value;
use tokio::net::TcpStream;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::{MaybeTlsStream, WebSocketStream};

use stapp_server::config::{
    AuthConfig, Channel, ChannelKind, Config, ServerConfig, StorageConfig, VoiceSettings,
};

/// Diretorio temporario que se apaga sozinho no fim do teste.
pub struct TestDir {
    path: PathBuf,
}

impl TestDir {
    pub fn new() -> Self {
        let path = std::env::temp_dir().join(format!("stapp-it-{}", uuid_simples()));
        std::fs::create_dir_all(&path).expect("criar diretorio temporario");
        Self { path }
    }

    pub fn database(&self) -> PathBuf {
        self.path.join("stapp.db")
    }
}

impl Drop for TestDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

fn uuid_simples() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    format!("{nanos}-{:?}", std::thread::current().id())
        .replace(['(', ')', ' '], "")
        .replace("ThreadId", "t")
}

pub fn config(database: PathBuf, allow_registration: bool) -> Config {
    Config {
        server: ServerConfig {
            name: "Stapp de teste".into(),
            bind: "127.0.0.1".parse().unwrap(),
            port: 0,
            max_users: 10,
            static_dir: None,
        },
        auth: AuthConfig {
            allow_registration,
            max_sessions_per_user: 3,
        },
        channels: vec![
            Channel {
                id: "geral".into(),
                name: "geral".into(),
                kind: ChannelKind::Text,
            },
            Channel {
                id: "sala".into(),
                name: "Sala de voz".into(),
                kind: ChannelKind::Voice,
            },
        ],
        voice: VoiceSettings {
            backend: "mesh".into(),
            ice_servers: vec!["stun:exemplo:3478".into()],
            max_peers: 4,
        },
        storage: StorageConfig {
            database,
            history_limit: 50,
        },
    }
}

/// Sobe o servidor numa porta efemera e devolve o endereco.
pub async fn start(config: Config) -> SocketAddr {
    let app = stapp_server::build(config).expect("montar a aplicacao");
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("porta efemera");
    let addr = listener.local_addr().unwrap();

    tokio::spawn(async move {
        let _ = axum::serve(
            listener,
            app.into_make_service_with_connect_info::<SocketAddr>(),
        )
        .await;
    });

    addr
}

pub struct Client {
    socket: WebSocketStream<MaybeTlsStream<TcpStream>>,
}

impl Client {
    pub async fn connect(addr: SocketAddr) -> Self {
        let (socket, _) = tokio_tungstenite::connect_async(format!("ws://{addr}/ws"))
            .await
            .expect("abrir websocket");
        Self { socket }
    }

    pub async fn send(&mut self, msg: Value) {
        self.socket
            .send(Message::Text(msg.to_string().into()))
            .await
            .expect("enviar");
    }

    /// Espera ate chegar uma mensagem com este `t`, descartando as do meio.
    pub async fn wait_for(&mut self, t: &str) -> Value {
        let prazo = tokio::time::Instant::now() + std::time::Duration::from_secs(5);
        loop {
            let proximo = tokio::time::timeout_at(prazo, self.socket.next())
                .await
                .unwrap_or_else(|_| panic!("timeout esperando \"{t}\""));

            match proximo {
                Some(Ok(Message::Text(text))) => {
                    let value: Value = serde_json::from_str(&text).expect("json valido");
                    if value["t"] == t {
                        return value;
                    }
                }
                Some(Ok(_)) => continue,
                other => panic!("conexao terminou esperando \"{t}\": {other:?}"),
            }
        }
    }

    pub async fn close(mut self) {
        let _ = self.socket.close(None).await;
    }
}
