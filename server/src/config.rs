use std::net::{IpAddr, SocketAddr};
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use serde::Deserialize;

use crate::channel::{Channel, ChannelKind};

#[derive(Debug, Clone, Deserialize)]
pub struct Config {
    pub server: ServerConfig,
    #[serde(default)]
    pub channels: Vec<Channel>,
    #[serde(default)]
    pub voice: VoiceSettings,
    #[serde(default)]
    pub storage: StorageConfig,
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
        anyhow::ensure!(!self.channels.is_empty(), "stapp.toml nao declara nenhum canal");

        let mut seen = std::collections::HashSet::new();
        for ch in &self.channels {
            anyhow::ensure!(seen.insert(&ch.id), "canal duplicado: {}", ch.id);
        }
        anyhow::ensure!(
            self.channels.iter().any(|c| c.kind == ChannelKind::Text),
            "precisa de pelo menos um canal de texto"
        );
        anyhow::ensure!(self.server.max_users > 0, "max_users precisa ser > 0");
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

impl Default for VoiceSettings {
    fn default() -> Self {
        Self { backend: default_backend(), ice_servers: default_ice(), max_peers: default_max_peers() }
    }
}

impl Default for StorageConfig {
    fn default() -> Self {
        Self { database: default_database(), history_limit: default_history_limit() }
    }
}

fn default_name() -> String { "Stapp".into() }
fn default_bind() -> IpAddr { IpAddr::from([0, 0, 0, 0]) }
fn default_port() -> u16 { 8787 }
fn default_max_users() -> usize { 20 }
fn default_backend() -> String { "mesh".into() }
fn default_ice() -> Vec<String> { vec!["stun:stun.l.google.com:19302".into()] }
fn default_max_peers() -> usize { 6 }
fn default_database() -> PathBuf { PathBuf::from("data/stapp.db") }
fn default_history_limit() -> usize { 200 }

#[cfg(test)]
mod tests {
    use super::*;
    use crate::channel::ChannelKind;
    use crate::test_support::{TestDir, config as test_config};

    #[test]
    fn accepts_a_valid_configuration() {
        let config = test_config(PathBuf::from("test.db"), 20, 6);
        assert!(config.validate().is_ok());
    }

    #[test]
    fn rejects_duplicate_channels_and_missing_text_channel() {
        let mut duplicate = test_config(PathBuf::from("test.db"), 20, 6);
        duplicate.channels[1].id = duplicate.channels[0].id.clone();
        assert!(duplicate.validate().unwrap_err().to_string().contains("canal duplicado"));

        let mut voice_only = test_config(PathBuf::from("test.db"), 20, 6);
        for channel in &mut voice_only.channels {
            channel.kind = ChannelKind::Voice;
        }
        assert!(
            voice_only
                .validate()
                .unwrap_err()
                .to_string()
                .contains("pelo menos um canal de texto")
        );
    }

    #[test]
    fn rejects_invalid_limits_and_voice_backend() {
        let mut no_users = test_config(PathBuf::from("test.db"), 0, 6);
        assert!(no_users.validate().unwrap_err().to_string().contains("max_users"));

        no_users.server.max_users = 20;
        no_users.voice.max_peers = 0;
        assert!(no_users.validate().unwrap_err().to_string().contains("max_peers"));

        no_users.voice.max_peers = 6;
        no_users.voice.backend = "livekit".into();
        assert!(no_users.validate().unwrap_err().to_string().contains("nao existe ainda"));
    }

    #[test]
    fn resolves_paths_relative_to_the_config_file() {
        let dir = TestDir::new();
        let path = dir.path().join("stapp.toml");
        std::fs::write(
            &path,
            r#"
                [server]
                static_dir = "client"

                [[channels]]
                id = "geral"
                name = "Geral"
                kind = "text"

                [storage]
                database = "data/test.db"
            "#,
        )
        .unwrap();

        let config = Config::load(&path).unwrap();
        assert_eq!(config.storage.database, dir.path().join("data/test.db"));
        assert_eq!(config.server.static_dir, Some(dir.path().join("client")));
    }
}
