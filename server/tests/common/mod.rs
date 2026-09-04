//! Apoio dos testes de integracao.
//!
//! Diferente de `src/test_support.rs`, que ajuda os testes unitarios de dentro
//! do crate, este modulo so enxerga a API publica — do mesmo jeito que quem for
//! embutir o servidor em outro programa.

use std::net::SocketAddr;
use std::path::PathBuf;

use futures_util::{SinkExt, StreamExt};
use serde_json::Value;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::{MaybeTlsStream, WebSocketStream};

use stapp_server::config::{
    AuthConfig, Channel, ChannelKind, Config, LimitsConfig, ServerConfig, StorageConfig, TlsConfig,
    VoiceSettings,
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
            min_client_version: None,
        },
        auth: AuthConfig {
            allow_registration,
            max_sessions_per_user: 3,
            trust_private_networks: false,
            trusted_networks: Vec::new(),
            allowed_origins: Vec::new(),
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
            public_url: None,
            api_url: None,
            api_key: None,
            api_secret: None,
            api_key_env: "STAPP_TEST_LIVEKIT_KEY".into(),
            api_secret_env: "STAPP_TEST_LIVEKIT_SECRET".into(),
        },
        storage: StorageConfig {
            attachments_dir: database.parent().unwrap().join("attachments"),
            database,
            history_limit: 50,
            s3: None,
        },
        limits: LimitsConfig {
            max_upload_mb: 15,
            max_text_chars: 4000,
            max_attachments_per_message: 10,
        },
        tls: TlsConfig::default(),
    }
}

/// Sobe o servidor numa porta efemera e devolve o endereco.
pub async fn start(config: Config) -> SocketAddr {
    let app = stapp_server::build(config).await.expect("montar a aplicacao");
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

pub struct AuthResponse {
    pub status: u16,
    pub body: Value,
    pub cookie: Option<String>,
    pub set_cookie: Option<String>,
}

pub async fn auth(
    addr: SocketAddr,
    action: &str,
    username: &str,
    password: &str,
    remember: bool,
) -> AuthResponse {
    let body = serde_json::json!({
        "username": username,
        "password": password,
        "remember": remember,
    })
    .to_string();
    http_post(addr, &format!("/auth/{action}"), &body, None).await
}

pub async fn refresh(addr: SocketAddr, cookie: &str) -> AuthResponse {
    http_post(addr, "/auth/refresh", "", Some(cookie)).await
}

pub async fn logout(addr: SocketAddr, cookie: &str) -> AuthResponse {
    http_post(addr, "/auth/logout", "", Some(cookie)).await
}

pub async fn auth_from_origin(
    addr: SocketAddr,
    action: &str,
    username: &str,
    password: &str,
    remember: bool,
    origin: &str,
) -> AuthResponse {
    let body = serde_json::json!({
        "username": username,
        "password": password,
        "remember": remember,
    })
    .to_string();
    http_post_with_origin(addr, &format!("/auth/{action}"), &body, None, Some(origin)).await
}

pub async fn preflight(addr: SocketAddr, path: &str, origin: &str) -> u16 {
    let mut stream = TcpStream::connect(addr).await.expect("conectar HTTP");
    let request = format!(
        "OPTIONS {path} HTTP/1.1\r\nHost: {addr}\r\nConnection: close\r\nOrigin: {origin}\r\nAccess-Control-Request-Method: POST\r\nAccess-Control-Request-Headers: content-type,x-stapp-client\r\nContent-Length: 0\r\n\r\n"
    );
    stream.write_all(request.as_bytes()).await.unwrap();
    let mut raw = String::new();
    stream.read_to_string(&mut raw).await.unwrap();
    raw.lines()
        .next()
        .unwrap()
        .split_whitespace()
        .nth(1)
        .unwrap()
        .parse()
        .unwrap()
}

async fn http_post(addr: SocketAddr, path: &str, body: &str, cookie: Option<&str>) -> AuthResponse {
    http_post_with_origin(addr, path, body, cookie, None).await
}

async fn http_post_with_origin(
    addr: SocketAddr,
    path: &str,
    body: &str,
    cookie: Option<&str>,
    origin: Option<&str>,
) -> AuthResponse {
    let mut stream = TcpStream::connect(addr).await.expect("conectar HTTP");
    let cookie_header = cookie
        .map(|value| format!("Cookie: {value}\r\n"))
        .unwrap_or_default();
    let origin_header = origin
        .map(|value| format!("Origin: {value}\r\n"))
        .unwrap_or_default();
    let request = format!(
        "POST {path} HTTP/1.1\r\nHost: {addr}\r\nConnection: close\r\nContent-Type: application/json\r\nX-Stapp-Client: stapp-web-v2\r\n{origin_header}{cookie_header}Content-Length: {}\r\n\r\n{body}",
        body.len(),
    );
    stream.write_all(request.as_bytes()).await.unwrap();
    let mut raw = String::new();
    stream.read_to_string(&mut raw).await.unwrap();
    let (head, body) = raw.split_once("\r\n\r\n").unwrap();
    let status = head
        .lines()
        .next()
        .unwrap()
        .split_whitespace()
        .nth(1)
        .unwrap()
        .parse()
        .unwrap();
    let set_cookie = head.lines().find_map(|line| {
        line.strip_prefix("set-cookie: ")
            .or_else(|| line.strip_prefix("Set-Cookie: "))
            .map(str::to_string)
    });
    let cookie = set_cookie
        .as_deref()
        .map(|value| value.split(';').next().unwrap().to_string());
    AuthResponse {
        status,
        body: if body.is_empty() {
            Value::Null
        } else {
            serde_json::from_str(body).expect("json HTTP")
        },
        cookie,
        set_cookie,
    }
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

    pub async fn authenticate(&mut self, access_token: &str) {
        self.send(serde_json::json!({ "t": "auth.access", "access_token": access_token }))
            .await;
    }

    /// Espera ate chegar uma mensagem com este `t`, descartando as do meio.
    pub async fn wait_for(&mut self, t: &str) -> Value {
        self.wait_for_matching(t, |_| true).await
    }

    pub async fn wait_for_matching<F>(&mut self, t: &str, mut predicate: F) -> Value
    where
        F: FnMut(&Value) -> bool,
    {
        let prazo = tokio::time::Instant::now() + std::time::Duration::from_secs(5);
        loop {
            let proximo = tokio::time::timeout_at(prazo, self.socket.next())
                .await
                .unwrap_or_else(|_| panic!("timeout esperando \"{t}\""));

            match proximo {
                Some(Ok(Message::Text(text))) => {
                    let value: Value = serde_json::from_str(&text).expect("json valido");
                    if value["t"] == t && predicate(&value) {
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

// ------------------------------------------------------------------ avatares
//
// Os helpers acima trabalham com String; imagem e binaria, entao estes leem e
// escrevem bytes.

pub async fn avatar_upload(addr: SocketAddr, token: &str, bytes: &[u8]) -> u16 {
    let mut cabecalho = format!(
        "POST /avatars HTTP/1.1\r\nHost: {addr}\r\nConnection: close\r\nContent-Type: application/octet-stream\r\nAuthorization: Bearer {token}\r\nContent-Length: {}\r\n\r\n",
        bytes.len()
    )
    .into_bytes();
    cabecalho.extend_from_slice(bytes);
    status_de(&requisicao_binaria(addr, &cabecalho).await)
}

pub async fn avatar_upload_sem_token(addr: SocketAddr, bytes: &[u8]) -> u16 {
    let mut cabecalho = format!(
        "POST /avatars HTTP/1.1\r\nHost: {addr}\r\nConnection: close\r\nContent-Length: {}\r\n\r\n",
        bytes.len()
    )
    .into_bytes();
    cabecalho.extend_from_slice(bytes);
    status_de(&requisicao_binaria(addr, &cabecalho).await)
}

pub async fn avatar_delete(addr: SocketAddr, token: &str) -> u16 {
    let pedido = format!(
        "DELETE /avatars HTTP/1.1\r\nHost: {addr}\r\nConnection: close\r\nAuthorization: Bearer {token}\r\nContent-Length: 0\r\n\r\n"
    );
    status_de(&requisicao_binaria(addr, pedido.as_bytes()).await)
}

/// Status, corpo cru e cabecalhos em minusculas — da para conferir que veio
/// WebP e que a imagem pode ser embutida a partir de outra origem.
pub async fn avatar_get(addr: SocketAddr, user_id: &str) -> (u16, Vec<u8>, String) {
    let pedido =
        format!("GET /avatars/{user_id} HTTP/1.1\r\nHost: {addr}\r\nConnection: close\r\n\r\n");
    let resposta = requisicao_binaria(addr, pedido.as_bytes()).await;
    let corte = encontrar(&resposta, b"\r\n\r\n");
    let cabecalhos = match corte {
        Some(i) => String::from_utf8_lossy(&resposta[..i]).to_lowercase(),
        None => String::new(),
    };
    let corpo = match corte {
        Some(i) => resposta[i + 4..].to_vec(),
        None => Vec::new(),
    };
    (status_de(&resposta), corpo, cabecalhos)
}

async fn requisicao_binaria(addr: SocketAddr, pedido: &[u8]) -> Vec<u8> {
    let mut stream = TcpStream::connect(addr).await.expect("conectar HTTP");
    stream.write_all(pedido).await.unwrap();
    let mut resposta = Vec::new();
    stream.read_to_end(&mut resposta).await.unwrap();
    resposta
}

fn status_de(resposta: &[u8]) -> u16 {
    let primeira = resposta.split(|b| *b == b'\n').next().unwrap_or_default();
    String::from_utf8_lossy(primeira)
        .split_whitespace()
        .nth(1)
        .and_then(|codigo| codigo.parse().ok())
        .unwrap_or(0)
}

fn encontrar(agulha: &[u8], marca: &[u8]) -> Option<usize> {
    agulha
        .windows(marca.len())
        .position(|janela| janela == marca)
}
