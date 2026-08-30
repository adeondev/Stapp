use std::path::{Path, PathBuf};
use std::sync::Arc;

use uuid::Uuid;

use crate::auth::hash_password_sync;
use crate::config::{AuthConfig, Config, ServerConfig, StorageConfig, VoiceSettings};
use crate::config::{Channel, ChannelKind};
use crate::session::AppState;
use crate::storage::{Account, Db};

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
        let state = AppState::new(config, db).unwrap();
        Self { state, _dir: dir }
    }

    pub fn account(&self, username: &str) -> Account {
        self.state
            .db
            .create_account(
                username.into(),
                username.to_ascii_lowercase(),
                hash_password_sync("senha de teste segura").unwrap(),
            )
            .unwrap()
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
        auth: AuthConfig {
            allow_registration: false,
            max_sessions_per_user: 3,
            trusted_networks: Vec::new(),
            allowed_origins: Vec::new(),
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
            public_url: None,
            api_url: None,
            api_key_env: "STAPP_TEST_LIVEKIT_KEY".into(),
            api_secret_env: "STAPP_TEST_LIVEKIT_SECRET".into(),
        },
        storage: StorageConfig {
            database,
            history_limit: 20,
        },
    }
}
