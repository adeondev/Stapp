use super::*;
use crate::config::ChannelKind;
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
    assert!(
        duplicate
            .validate()
            .unwrap_err()
            .to_string()
            .contains("canal duplicado")
    );

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
    assert!(
        no_users
            .validate()
            .unwrap_err()
            .to_string()
            .contains("max_users")
    );

    no_users.server.max_users = 20;
    no_users.auth.max_sessions_per_user = 0;
    assert!(
        no_users
            .validate()
            .unwrap_err()
            .to_string()
            .contains("max_sessions_per_user")
    );

    no_users.auth.max_sessions_per_user = 3;
    no_users.voice.max_peers = 0;
    assert!(
        no_users
            .validate()
            .unwrap_err()
            .to_string()
            .contains("max_peers")
    );

    no_users.voice.max_peers = 6;
    no_users.voice.backend = "peer_to_peer_magico".into();
    assert!(
        no_users
            .validate()
            .unwrap_err()
            .to_string()
            .contains("nao existe ainda")
    );
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

#[test]
fn sem_redes_confiaveis_so_o_loopback_autentica_em_texto_claro() {
    let auth = crate::config::AuthConfig::default();
    assert!(auth.allows_plaintext_from("127.0.0.1".parse().unwrap()));
    assert!(auth.allows_plaintext_from("::1".parse().unwrap()));
    assert!(!auth.allows_plaintext_from("26.220.166.121".parse().unwrap()));
    assert!(!auth.allows_plaintext_from("192.168.1.9".parse().unwrap()));
}

#[test]
fn uma_rede_confiavel_libera_so_a_propria_faixa() {
    let auth = crate::config::AuthConfig {
        trusted_networks: vec!["26.0.0.0/8".parse().unwrap()],
        ..Default::default()
    };
    assert!(auth.allows_plaintext_from("26.220.166.121".parse().unwrap()));
    assert!(auth.allows_plaintext_from("26.0.0.1".parse().unwrap()));
    // O loopback continua passando, e o resto da internet continua barrado.
    assert!(auth.allows_plaintext_from("127.0.0.1".parse().unwrap()));
    assert!(!auth.allows_plaintext_from("192.168.1.9".parse().unwrap()));
    assert!(!auth.allows_plaintext_from("8.8.8.8".parse().unwrap()));
}

#[test]
fn redes_confiaveis_sao_lidas_do_toml() {
    let dir = TestDir::new();
    let path = dir.path().join("stapp.toml");
    std::fs::write(
        &path,
        r#"
[server]
name = "Stapp"
[auth]
trusted_networks = ["26.0.0.0/8", "192.168.0.0/16"]
[[channels]]
id = "geral"
name = "geral"
kind = "text"
"#,
    )
    .unwrap();

    let config = Config::load(&path).unwrap();
    assert_eq!(config.auth.trusted_networks.len(), 2);
    assert!(
        config
            .auth
            .allows_plaintext_from("26.220.166.121".parse().unwrap())
    );
}

#[test]
fn limites_tem_default_quando_a_secao_falta() {
    let dir = TestDir::new();
    let path = dir.path().join("stapp.toml");
    std::fs::write(
        &path,
        r#"
[server]
name = "Stapp"
[[channels]]
id = "geral"
name = "geral"
kind = "text"
"#,
    )
    .unwrap();

    // Quem ja tem um stapp.toml antigo nao precisa mexer em nada para atualizar.
    let config = Config::load(&path).unwrap();
    assert_eq!(config.limits.max_upload_mb, 15);
    assert_eq!(config.limits.max_text_chars, 4000);
    assert_eq!(config.limits.max_upload_bytes(), 15 * 1024 * 1024);
}

#[test]
fn limites_sao_lidos_do_toml_e_zero_e_recusado() {
    let dir = TestDir::new();
    let path = dir.path().join("stapp.toml");
    std::fs::write(
        &path,
        r#"
[server]
name = "Stapp"
[limits]
max_upload_mb = 50
max_text_chars = 120
[[channels]]
id = "geral"
name = "geral"
kind = "text"
"#,
    )
    .unwrap();

    let config = Config::load(&path).unwrap();
    assert_eq!(config.limits.max_upload_mb, 50);
    assert_eq!(config.limits.max_text_chars, 120);

    let mut zerado = test_config(PathBuf::from("test.db"), 20, 6);
    zerado.limits.max_upload_mb = 0;
    assert!(
        zerado
            .validate()
            .unwrap_err()
            .to_string()
            .contains("max_upload_mb")
    );

    let mut sem_texto = test_config(PathBuf::from("test.db"), 20, 6);
    sem_texto.limits.max_text_chars = 0;
    assert!(
        sem_texto
            .validate()
            .unwrap_err()
            .to_string()
            .contains("max_text_chars")
    );
}
