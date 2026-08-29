use std::path::{Path, PathBuf};
use std::sync::Arc;

use uuid::Uuid;

use crate::channel::{Channel, ChannelKind};
use crate::config::{Config, ServerConfig, StorageConfig, VoiceSettings};
use crate::db::Db;
use crate::state::AppState;

pub struct TestDir {
    path: PathBuf,
}

impl TestDir {
    pub fn new() -> Self {
        let path = std::env::temp_dir().join(format!("stapp-test-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&path).expect("criar diretorio temporario");
        Self { path }
    }

    pub fn path(&self) -> &Path {
        &self.path
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

pub struct TestServer {
    pub state: Arc<AppState>,
    _dir: TestDir,
}

impl TestServer {
    pub fn new(max_users: usize, max_peers: usize) -> Self {
        let dir = TestDir::new();
        let config = config(dir.database(), max_users, max_peers);
        let db = Db::open(&config.storage.database).expect("abrir banco temporario");
        let state = AppState::new(config, db);
        Self { state, _dir: dir }
    }
}

pub fn config(database: PathBuf, max_users: usize, max_peers: usize) -> Config {
    Config {
        server: ServerConfig {
            name: "Stapp de teste".into(),
            bind: "127.0.0.1".parse().unwrap(),
            port: 0,
            max_users,
            static_dir: None,
        },
        channels: vec![
            Channel {
                id: "geral".into(),
                name: "Geral".into(),
                kind: ChannelKind::Text,
            },
            Channel {
                id: "voz-a".into(),
                name: "Voz A".into(),
                kind: ChannelKind::Voice,
            },
            Channel {
                id: "voz-b".into(),
                name: "Voz B".into(),
                kind: ChannelKind::Voice,
            },
        ],
        voice: VoiceSettings {
            backend: "mesh".into(),
            ice_servers: vec![],
            max_peers,
        },
        storage: StorageConfig {
            database,
            history_limit: 20,
        },
    }
}
