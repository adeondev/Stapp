use std::net::{IpAddr, SocketAddr};
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use ipnet::IpNet;
use serde::Deserialize;

pub mod channel;

pub use channel::{Channel, ChannelKind};

#[derive(Debug, Clone, Deserialize)]
pub struct Config {
    pub server: ServerConfig,
    #[serde(default)]
    pub auth: AuthConfig,
    #[serde(default)]
    pub channels: Vec<Channel>,
    #[serde(default)]
    pub voice: VoiceSettings,
    #[serde(default)]
    pub storage: StorageConfig,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AuthConfig {
    #[serde(default)]
    pub allow_registration: bool,
    #[serde(default = "default_max_sessions_per_user")]
    pub max_sessions_per_user: usize,
    /// Redes onde a autenticacao sem TLS e aceita, alem do loopback.
    ///
    /// A senha viaja no endpoint HTTP de autenticacao. Sem TLS, so entra aqui
    /// rede que voce controla — uma VPN entre amigos ou LAN atras de firewall.
    /// Vazio por padrao: sem TLS, so a propria maquina autentica. Mesmo numa
    /// rede confiavel, cookies persistentes continuam indisponiveis sem HTTPS.
    #[serde(default)]
    pub trusted_networks: Vec<IpNet>,
    /// Origens web adicionais autorizadas a usar os endpoints HTTP de auth.
    /// Mesmo host, Tauri e localhost de desenvolvimento sao tratados pelo
    /// servidor; esta lista existe para clientes hospedados separadamente.
    #[serde(default)]
    pub allowed_origins: Vec<String>,
}

impl AuthConfig {
    /// O loopback sempre passa: e por ele que chega o trafego de um proxy TLS
    /// rodando no mesmo host.
    pub fn allows_plaintext_from(&self, ip: IpAddr) -> bool {
        ip.is_loopback()
            || self
                .trusted_networks
                .iter()
                .any(|network| network.contains(&ip))
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct ServerConfig {
    #[serde(default = "default_name")]
    pub name: String,
    #[serde(default = "default_bind")]
    pub bind: IpAddr,
    #[serde(default = "default_port")]
    pub port: u16,
    #[serde(default = "default_max_users")]
    pub max_users: usize,
    /// Diretorio com o cliente ja buildado. Quando presente, o servidor entrega
    /// o app na mesma origem — e o que usamos em producao.
    #[serde(default)]
    pub static_dir: Option<PathBuf>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct VoiceSettings {
    #[serde(default = "default_backend")]
    pub backend: String,
    #[serde(default = "default_ice")]
    pub ice_servers: Vec<String>,
    #[serde(default = "default_max_peers")]
    pub max_peers: usize,
}

#[derive(Debug, Clone, Deserialize)]
pub struct StorageConfig {
    #[serde(default = "default_database")]
    pub database: PathBuf,
    #[serde(default = "default_history_limit")]
    pub history_limit: usize,
}

impl Config {
    /// Le o stapp.toml. Caminhos relativos dentro dele sao resolvidos a partir da
    /// pasta do proprio arquivo, entao `cargo run` de qualquer lugar se comporta igual.
    pub fn load(path: &Path) -> Result<Self> {
        let raw = std::fs::read_to_string(path)
            .with_context(|| format!("nao consegui ler {}", path.display()))?;
        let mut cfg: Config = toml::from_str(&raw)
            .with_context(|| format!("{} nao e um TOML valido", path.display()))?;

        let base = path.parent().unwrap_or_else(|| Path::new("."));
        cfg.storage.database = base.join(&cfg.storage.database);
        cfg.server.static_dir = cfg.server.static_dir.map(|d| base.join(d));

        cfg.validate()?;
        Ok(cfg)
    }

    fn validate(&self) -> Result<()> {
        anyhow::ensure!(
            !self.channels.is_empty(),
            "stapp.toml nao declara nenhum canal"
        );

        let mut seen = std::collections::HashSet::new();
        for ch in &self.channels {
            anyhow::ensure!(seen.insert(&ch.id), "canal duplicado: {}", ch.id);
        }
        anyhow::ensure!(
            self.channels.iter().any(|c| c.kind == ChannelKind::Text),
            "precisa de pelo menos um canal de texto"
        );
        anyhow::ensure!(self.server.max_users > 0, "max_users precisa ser > 0");
        anyhow::ensure!(
            self.auth.max_sessions_per_user > 0,
            "auth.max_sessions_per_user precisa ser > 0"
        );
        anyhow::ensure!(self.voice.max_peers > 0, "voice.max_peers precisa ser > 0");
        anyhow::ensure!(
            self.voice.backend == "mesh",
            "voice.backend \"{}\" nao existe ainda — hoje so tem \"mesh\"",
            self.voice.backend
        );
        Ok(())
    }

    pub fn addr(&self) -> SocketAddr {
        SocketAddr::new(self.server.bind, self.server.port)
    }

    pub fn channel(&self, id: &str) -> Option<&Channel> {
        self.channels.iter().find(|c| c.id == id)
    }

    pub fn text_channels(&self) -> impl Iterator<Item = &Channel> {
        self.channels.iter().filter(|c| c.kind == ChannelKind::Text)
    }
}

impl Default for AuthConfig {
    fn default() -> Self {
        Self {
            allow_registration: false,
            max_sessions_per_user: default_max_sessions_per_user(),
            trusted_networks: Vec::new(),
            allowed_origins: Vec::new(),
        }
    }
}

impl Default for VoiceSettings {
    fn default() -> Self {
        Self {
            backend: default_backend(),
            ice_servers: default_ice(),
            max_peers: default_max_peers(),
        }
    }
}

impl Default for StorageConfig {
    fn default() -> Self {
        Self {
            database: default_database(),
            history_limit: default_history_limit(),
        }
    }
}

fn default_name() -> String {
    "Stapp".into()
}
fn default_bind() -> IpAddr {
    IpAddr::from([0, 0, 0, 0])
}
fn default_port() -> u16 {
    8787
}
fn default_max_users() -> usize {
    20
}
fn default_max_sessions_per_user() -> usize {
    3
}
fn default_backend() -> String {
    "mesh".into()
}
fn default_ice() -> Vec<String> {
    vec!["stun:stun.l.google.com:19302".into()]
}
fn default_max_peers() -> usize {
    6
}
fn default_database() -> PathBuf {
    PathBuf::from("data/stapp.db")
}
fn default_history_limit() -> usize {
    200
}

#[cfg(test)]
mod tests;
