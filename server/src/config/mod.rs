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
    #[serde(default)]
    pub limits: LimitsConfig,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AuthConfig {
    #[serde(default)]
    pub allow_registration: bool,
    #[serde(default = "default_max_sessions_per_user")]
    pub max_sessions_per_user: usize,
    /// Aceita autenticacao sem TLS em redes privadas (LAN RFC1918, CGNAT/Tailscale e VPNs).
    ///
    /// Ideal para servidores locais, de teste ou executados em VPNs entre amigos.
    /// Em servidores expostos diretamente a internet publica sem proxy reverso TLS,
    /// mantenha false.
    #[serde(default)]
    pub trust_private_networks: bool,
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
            || (self.trust_private_networks && is_private_or_vpn_ip(ip))
            || self
                .trusted_networks
                .iter()
                .any(|network| network.contains(&ip))
    }
}

/// Identifica se um IP pertence a faixas privadas locais, CGNAT ou VPNs conhecidas.
pub fn is_private_or_vpn_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ipv4) => {
            let octets = ipv4.octets();
            ipv4.is_loopback()
                || ipv4.is_private()
                || ipv4.is_link_local()
                // RFC 6598 Carrier-Grade NAT (100.64.0.0/10 - Tailscale & ISP CGNAT)
                || (octets[0] == 100 && (octets[1] & 0xC0) == 64)
                // Radmin VPN (26.0.0.0/8)
                || octets[0] == 26
        }
        IpAddr::V6(ipv6) => {
            let segments = ipv6.segments();
            ipv6.is_loopback()
                // Unique Local IPv6 (fc00::/7 - RFC 4193)
                || (segments[0] & 0xfe00) == 0xfc00
                // Link-local IPv6 (fe80::/10 - RFC 4291)
                || (segments[0] & 0xffc0) == 0xfe80
        }
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
    /// Versao minima exigida dos clientes (semver). Clientes com versao menor
    /// serao instruidos/bloqueados para atualizacao obrigatoria.
    #[serde(default)]
    pub min_client_version: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct VoiceSettings {
    #[serde(default = "default_backend")]
    pub backend: String,
    #[serde(default = "default_ice")]
    pub ice_servers: Vec<String>,
    #[serde(default = "default_max_peers")]
    pub max_peers: usize,
    /// URL WebSocket que os clientes usam para chegar ao SFU.
    #[serde(default)]
    pub public_url: Option<String>,
    /// URL HTTP usada somente pelo servidor Stapp para moderar salas.
    #[serde(default)]
    pub api_url: Option<String>,
    /// Nomes das variaveis de ambiente; os segredos nunca ficam no TOML.
    #[serde(default = "default_livekit_api_key_env")]
    pub api_key_env: String,
    #[serde(default = "default_livekit_api_secret_env")]
    pub api_secret_env: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct S3Config {
    #[serde(default = "default_s3_endpoint")]
    pub endpoint: String,
    #[serde(default = "default_s3_bucket")]
    pub bucket: String,
    #[serde(default = "default_s3_region")]
    pub region: String,
    #[serde(default = "default_s3_access_key")]
    pub access_key: String,
    #[serde(default = "default_s3_secret_key")]
    pub secret_key: String,
    #[serde(default = "default_s3_public_url")]
    pub public_url: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct StorageConfig {
    #[serde(default = "default_database")]
    pub database: PathBuf,
    #[serde(default = "default_history_limit")]
    pub history_limit: usize,
    /// Diretorio privado dos anexos. Caminhos relativos partem do stapp.toml.
    #[serde(default = "default_attachments_dir")]
    pub attachments_dir: PathBuf,
    #[serde(default)]
    pub s3: Option<S3Config>,
}

/// Tetos que o dono do servidor escolhe. O cliente recebe os dois no `welcome`
/// e barra antes de a pessoa perder o que escreveu, mas quem decide e o
/// servidor: `presign` e `clean_text` conferem de novo. E a mesma postura de
/// `plaintext_auth_allowed` — o cliente obedece, nao repete a regra.
#[derive(Debug, Clone, Deserialize)]
pub struct LimitsConfig {
    #[serde(default = "default_max_upload_mb")]
    pub max_upload_mb: usize,
    /// Em caracteres, nao bytes: um emoji conta como um.
    #[serde(default = "default_max_text_chars")]
    pub max_text_chars: usize,
    #[serde(default = "default_max_attachments_per_message")]
    pub max_attachments_per_message: usize,
}

impl LimitsConfig {
    /// O TOML fala em MB porque quem edita e gente; o protocolo fala em bytes
    /// porque quem compara do outro lado e `File.size`.
    pub fn max_upload_bytes(&self) -> usize {
        self.max_upload_mb * 1024 * 1024
    }
}

impl Config {
    /// Template de configuracao padrao do Stapp (stapp.toml) embutido no binario.
    pub const DEFAULT_CONFIG_TEMPLATE: &'static str = include_str!("../../stapp.toml");

    /// Le o stapp.toml ou gera a configuracao inicial padrao caso o arquivo nao exista.
    ///
    /// Garante que o arquivo de configuracao e as pastas de persistencia necessarias
    /// (`data/` e `data/attachments/`) existam antes de devolver a configuracao pronta.
    pub fn load_or_bootstrap(path: &Path) -> Result<Self> {
        if !path.exists() {
            if let Some(parent) = path.parent() {
                if !parent.as_os_str().is_empty() {
                    std::fs::create_dir_all(parent)
                        .with_context(|| format!("nao consegui criar o diretorio {}", parent.display()))?;
                }
            }
            std::fs::write(path, Self::DEFAULT_CONFIG_TEMPLATE)
                .with_context(|| format!("nao consegui gerar a configuracao padrao em {}", path.display()))?;
            tracing::info!(path = %path.display(), "Arquivo de configuracao padrao gerado com sucesso");
        }

        let cfg = Self::load(path)?;
        cfg.ensure_storage_dirs()?;
        Ok(cfg)
    }

    /// Garante que os diretorios necessarios de persistencia (banco e anexos) existam.
    pub fn ensure_storage_dirs(&self) -> Result<()> {
        if let Some(parent) = self.storage.database.parent() {
            if !parent.as_os_str().is_empty() {
                std::fs::create_dir_all(parent)
                    .with_context(|| format!("nao consegui criar o diretorio do banco {}", parent.display()))?;
            }
        }
        std::fs::create_dir_all(&self.storage.attachments_dir)
            .with_context(|| format!("nao consegui criar o diretorio de anexos {}", self.storage.attachments_dir.display()))?;
        Ok(())
    }

    /// Le o stapp.toml. Caminhos relativos dentro dele sao resolvidos a partir da
    /// pasta do proprio arquivo, entao `cargo run` de qualquer lugar se comporta igual.
    /// Variaveis de ambiente com prefixo `STAPP_` sobrescrevem as chaves do arquivo.
    pub fn load(path: &Path) -> Result<Self> {
        let raw = std::fs::read_to_string(path)
            .with_context(|| format!("nao consegui ler {}", path.display()))?;
        let mut cfg: Config = toml::from_str(&raw)
            .with_context(|| format!("{} nao e um TOML valido", path.display()))?;

        let base = path.parent().unwrap_or_else(|| Path::new("."));
        cfg.storage.database = base.join(&cfg.storage.database);
        cfg.storage.attachments_dir = base.join(&cfg.storage.attachments_dir);
        cfg.server.static_dir = cfg.server.static_dir.map(|d| base.join(d));

        cfg.apply_env_overrides();

        cfg.validate()?;
        Ok(cfg)
    }

    /// Aplica sobrescritas a partir de variaveis de ambiente com prefixo `STAPP_`.
    pub fn apply_env_overrides(&mut self) {
        if let Some(val) = env_var(&["STAPP_SERVER_NAME", "STAPP_NAME"]) {
            self.server.name = val;
        }
        if let Some(val) = parse_env_ip(&["STAPP_SERVER_BIND", "STAPP_BIND"]) {
            self.server.bind = val;
        }
        if let Some(val) = parse_env_u16(&["STAPP_SERVER_PORT", "STAPP_PORT"]) {
            self.server.port = val;
        }
        if let Some(val) = parse_env_usize(&["STAPP_SERVER_MAX_USERS", "STAPP_MAX_USERS"]) {
            self.server.max_users = val;
        }
        if let Some(val) = env_var(&["STAPP_SERVER_STATIC_DIR", "STAPP_STATIC_DIR"]) {
            self.server.static_dir = Some(PathBuf::from(val));
        }
        if let Some(val) = env_var(&["STAPP_SERVER_MIN_CLIENT_VERSION", "STAPP_MIN_CLIENT_VERSION"]) {
            self.server.min_client_version = Some(val);
        }

        if let Some(val) = parse_env_bool(&["STAPP_AUTH_ALLOW_REGISTRATION", "STAPP_ALLOW_REGISTRATION"]) {
            self.auth.allow_registration = val;
        }
        if let Some(val) = parse_env_usize(&["STAPP_AUTH_MAX_SESSIONS_PER_USER", "STAPP_MAX_SESSIONS_PER_USER"]) {
            self.auth.max_sessions_per_user = val;
        }
        if let Some(val) = parse_env_bool(&["STAPP_AUTH_TRUST_PRIVATE_NETWORKS", "STAPP_TRUST_PRIVATE_NETWORKS"]) {
            self.auth.trust_private_networks = val;
        }
        if let Some(val) = parse_env_networks(&["STAPP_AUTH_TRUSTED_NETWORKS", "STAPP_TRUSTED_NETWORKS"]) {
            self.auth.trusted_networks = val;
        }
        if let Some(val) = parse_env_list(&["STAPP_AUTH_ALLOWED_ORIGINS", "STAPP_ALLOWED_ORIGINS"]) {
            self.auth.allowed_origins = val;
        }

        if let Some(val) = env_var(&["STAPP_VOICE_BACKEND", "STAPP_BACKEND"]) {
            self.voice.backend = val;
        }
        if let Some(val) = parse_env_usize(&["STAPP_VOICE_MAX_PEERS", "STAPP_MAX_PEERS"]) {
            self.voice.max_peers = val;
        }
        if let Some(val) = env_var(&["STAPP_VOICE_PUBLIC_URL", "STAPP_PUBLIC_URL"]) {
            self.voice.public_url = Some(val);
        }
        if let Some(val) = env_var(&["STAPP_VOICE_API_URL", "STAPP_API_URL"]) {
            self.voice.api_url = Some(val);
        }
        if let Some(val) = parse_env_list(&["STAPP_VOICE_ICE_SERVERS", "STAPP_ICE_SERVERS"]) {
            self.voice.ice_servers = val;
        }
        if let Some(val) = env_var(&["STAPP_VOICE_API_KEY_ENV"]) {
            self.voice.api_key_env = val;
        }
        if let Some(val) = env_var(&["STAPP_VOICE_API_SECRET_ENV"]) {
            self.voice.api_secret_env = val;
        }

        if let Some(val) = env_var(&["STAPP_STORAGE_DATABASE", "STAPP_DATABASE"]) {
            self.storage.database = PathBuf::from(val);
        }
        if let Some(val) = parse_env_usize(&["STAPP_STORAGE_HISTORY_LIMIT", "STAPP_HISTORY_LIMIT"]) {
            self.storage.history_limit = val;
        }
        if let Some(val) = env_var(&["STAPP_STORAGE_ATTACHMENTS_DIR", "STAPP_ATTACHMENTS_DIR"]) {
            self.storage.attachments_dir = PathBuf::from(val);
        }

        if let Some(val) = parse_env_usize(&["STAPP_LIMITS_MAX_UPLOAD_MB", "STAPP_MAX_UPLOAD_MB"]) {
            self.limits.max_upload_mb = val;
        }
        if let Some(val) = parse_env_usize(&["STAPP_LIMITS_MAX_TEXT_CHARS", "STAPP_MAX_TEXT_CHARS"]) {
            self.limits.max_text_chars = val;
        }
        if let Some(val) = parse_env_usize(&["STAPP_LIMITS_MAX_ATTACHMENTS_PER_MESSAGE", "STAPP_MAX_ATTACHMENTS_PER_MESSAGE"]) {
            self.limits.max_attachments_per_message = val;
        }
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
            self.limits.max_upload_mb > 0,
            "limits.max_upload_mb precisa ser > 0"
        );
        anyhow::ensure!(
            self.limits.max_text_chars > 0,
            "limits.max_text_chars precisa ser > 0"
        );
        anyhow::ensure!(
            self.limits.max_attachments_per_message > 0,
            "limits.max_attachments_per_message precisa ser > 0"
        );
        anyhow::ensure!(
            matches!(self.voice.backend.as_str(), "mesh" | "livekit"),
            "voice.backend \"{}\" nao existe ainda — hoje so tem \"mesh\"",
            self.voice.backend
        );
        if self.voice.backend == "livekit" {
            let public_url = self.voice.public_url.as_deref().unwrap_or_default();
            let api_url = self.voice.api_url.as_deref().unwrap_or_default();
            anyhow::ensure!(
                public_url.starts_with("ws://") || public_url.starts_with("wss://"),
                "voice.public_url precisa comecar com ws:// ou wss://"
            );
            anyhow::ensure!(
                api_url.starts_with("http://") || api_url.starts_with("https://"),
                "voice.api_url precisa comecar com http:// ou https://"
            );
            anyhow::ensure!(
                !self.voice.api_key_env.trim().is_empty()
                    && !self.voice.api_secret_env.trim().is_empty(),
                "os nomes das variaveis de ambiente do LiveKit nao podem estar vazios"
            );
        }
        if let Some(min_ver) = &self.server.min_client_version {
            anyhow::ensure!(
                semver::Version::parse(min_ver.trim_start_matches('v')).is_ok(),
                "server.min_client_version \"{}\" nao e um semver valido (ex: 0.1.0)",
                min_ver
            );
        }
        Ok(())
    }

    pub fn addr(&self) -> SocketAddr {
        SocketAddr::new(self.server.bind, self.server.port)
    }

    /// Onde ficam os avatares: ao lado do banco, dentro de `data/`. Assim o
    /// backup do servidor continua sendo "copie a pasta data/".
    pub fn avatar_dir(&self) -> PathBuf {
        self.storage
            .database
            .parent()
            .unwrap_or_else(|| Path::new("."))
            .join("avatars")
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
            trust_private_networks: false,
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
            public_url: None,
            api_url: None,
            api_key_env: default_livekit_api_key_env(),
            api_secret_env: default_livekit_api_secret_env(),
        }
    }
}

impl Default for LimitsConfig {
    fn default() -> Self {
        Self {
            max_upload_mb: default_max_upload_mb(),
            max_text_chars: default_max_text_chars(),
            max_attachments_per_message: default_max_attachments_per_message(),
        }
    }
}

impl Default for StorageConfig {
    fn default() -> Self {
        Self {
            database: default_database(),
            history_limit: default_history_limit(),
            attachments_dir: default_attachments_dir(),
            s3: None,
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
fn default_livekit_api_key_env() -> String {
    "STAPP_LIVEKIT_API_KEY".into()
}
fn default_livekit_api_secret_env() -> String {
    "STAPP_LIVEKIT_API_SECRET".into()
}
fn default_database() -> PathBuf {
    PathBuf::from("data/stapp.db")
}
fn default_attachments_dir() -> PathBuf {
    PathBuf::from("data/attachments")
}
fn default_history_limit() -> usize {
    200
}
fn default_s3_endpoint() -> String {
    "http://127.0.0.1:9000".into()
}
fn default_s3_bucket() -> String {
    "stapp-media".into()
}
fn default_s3_region() -> String {
    "us-east-1".into()
}
fn default_s3_access_key() -> String {
    "minioadmin".into()
}
fn default_s3_secret_key() -> String {
    "minioadminpassword".into()
}
fn default_s3_public_url() -> Option<String> {
    None
}
fn default_max_upload_mb() -> usize {
    20
}
fn default_max_attachments_per_message() -> usize {
    10
}
fn default_max_text_chars() -> usize {
    4000
}

fn env_var(keys: &[&str]) -> Option<String> {
    for key in keys {
        if let Ok(val) = std::env::var(key) {
            let trimmed = val.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }
    }
    None
}

fn parse_env_bool(keys: &[&str]) -> Option<bool> {
    env_var(keys).and_then(|val| match val.to_ascii_lowercase().as_str() {
        "1" | "true" | "yes" | "on" => Some(true),
        "0" | "false" | "no" | "off" => Some(false),
        _ => None,
    })
}

fn parse_env_usize(keys: &[&str]) -> Option<usize> {
    env_var(keys).and_then(|val| val.parse::<usize>().ok())
}

fn parse_env_u16(keys: &[&str]) -> Option<u16> {
    env_var(keys).and_then(|val| val.parse::<u16>().ok())
}

fn parse_env_ip(keys: &[&str]) -> Option<IpAddr> {
    env_var(keys).and_then(|val| val.parse::<IpAddr>().ok())
}

fn parse_env_list(keys: &[&str]) -> Option<Vec<String>> {
    env_var(keys).map(|val| {
        val.split([',', ';'])
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string())
            .collect()
    })
}

fn parse_env_networks(keys: &[&str]) -> Option<Vec<IpNet>> {
    env_var(keys).map(|val| {
        val.split([',', ';'])
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .filter_map(|s| s.parse::<IpNet>().ok())
            .collect()
    })
}

#[cfg(test)]
mod tests;
