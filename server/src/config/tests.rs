use super::*;
use crate::config::ChannelKind;
use crate::test_support::{TestDir, config as test_config};

static ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

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
            .contains("nao e suportado")
    );
}

#[test]
fn resolves_paths_relative_to_the_config_file() {
    let _guard = ENV_LOCK.lock().unwrap();
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
    let _guard = ENV_LOCK.lock().unwrap();
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
    let _guard = ENV_LOCK.lock().unwrap();
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
    assert_eq!(config.limits.max_upload_mb, 20);
    assert_eq!(config.limits.max_text_chars, 4000);
    assert_eq!(config.limits.max_upload_bytes(), 20 * 1024 * 1024);
}

#[test]
fn limites_sao_lidos_do_toml_e_zero_e_recusado() {
    let _guard = ENV_LOCK.lock().unwrap();
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

#[test]
fn identifica_ips_privados_e_de_vpn_corretamente() {
    // Loopback
    assert!(is_private_or_vpn_ip("127.0.0.1".parse().unwrap()));
    assert!(is_private_or_vpn_ip("::1".parse().unwrap()));

    // RFC 1918 (LAN)
    assert!(is_private_or_vpn_ip("10.0.0.1".parse().unwrap()));
    assert!(is_private_or_vpn_ip("10.255.255.254".parse().unwrap()));
    assert!(is_private_or_vpn_ip("172.16.0.1".parse().unwrap()));
    assert!(is_private_or_vpn_ip("172.31.255.254".parse().unwrap()));
    assert!(is_private_or_vpn_ip("192.168.0.1".parse().unwrap()));
    assert!(is_private_or_vpn_ip("192.168.1.100".parse().unwrap()));

    // CGNAT / Tailscale (100.64.0.0/10)
    assert!(is_private_or_vpn_ip("100.64.0.1".parse().unwrap()));
    assert!(is_private_or_vpn_ip("100.100.50.25".parse().unwrap()));
    assert!(is_private_or_vpn_ip("100.127.255.254".parse().unwrap()));

    // Radmin VPN (26.0.0.0/8)
    assert!(is_private_or_vpn_ip("26.0.0.1".parse().unwrap()));
    assert!(is_private_or_vpn_ip("26.220.166.121".parse().unwrap()));

    // Link-local
    assert!(is_private_or_vpn_ip("169.254.1.1".parse().unwrap()));
    assert!(is_private_or_vpn_ip("fe80::1".parse().unwrap()));

    // IPv6 Unique Local (fc00::/7)
    assert!(is_private_or_vpn_ip("fc00::1".parse().unwrap()));
    assert!(is_private_or_vpn_ip("fd12:3456:789a::1".parse().unwrap()));

    // IPs Publicos de WAN (devem ser falsos)
    assert!(!is_private_or_vpn_ip("8.8.8.8".parse().unwrap()));
    assert!(!is_private_or_vpn_ip("1.1.1.1".parse().unwrap()));
    assert!(!is_private_or_vpn_ip("100.128.0.1".parse().unwrap())); // Fora do CGNAT (100.64.0.0/10)
    assert!(!is_private_or_vpn_ip("27.0.0.1".parse().unwrap()));
    assert!(!is_private_or_vpn_ip("2001:4860:4860::8888".parse().unwrap()));
}

#[test]
fn trust_private_networks_libera_lan_tailscale_e_radmin() {
    let auth = crate::config::AuthConfig {
        trust_private_networks: true,
        ..Default::default()
    };

    // Todas as faixas locais/privadas devem passar
    assert!(auth.allows_plaintext_from("127.0.0.1".parse().unwrap()));
    assert!(auth.allows_plaintext_from("::1".parse().unwrap()));
    assert!(auth.allows_plaintext_from("192.168.1.50".parse().unwrap()));
    assert!(auth.allows_plaintext_from("10.0.0.5".parse().unwrap()));
    assert!(auth.allows_plaintext_from("172.16.1.1".parse().unwrap()));
    assert!(auth.allows_plaintext_from("100.64.0.1".parse().unwrap()));
    assert!(auth.allows_plaintext_from("26.220.166.121".parse().unwrap()));
    assert!(auth.allows_plaintext_from("fe80::1".parse().unwrap()));
    assert!(auth.allows_plaintext_from("fd00::1".parse().unwrap()));

    // WAN publica continua bloqueada
    assert!(!auth.allows_plaintext_from("8.8.8.8".parse().unwrap()));
    assert!(!auth.allows_plaintext_from("1.1.1.1".parse().unwrap()));
}

#[test]
fn sobrescritas_por_variaveis_de_ambiente_funcionam() {
    let _guard = ENV_LOCK.lock().unwrap();
    // Usamos chaves com prefixo STAPP_TEST_ENV_ para nao colidir com o ambiente
    let mut config = test_config(PathBuf::from("test.db"), 20, 6);

    // Definimos variaveis de teste
    unsafe {
        std::env::set_var("STAPP_SERVER_NAME", "Servidor Customizado");
        std::env::set_var("STAPP_SERVER_PORT", "9999");
        std::env::set_var("STAPP_SERVER_BIND", "127.0.0.2");
        std::env::set_var("STAPP_AUTH_ALLOW_REGISTRATION", "true");
        std::env::set_var("STAPP_AUTH_TRUST_PRIVATE_NETWORKS", "1");
        std::env::set_var("STAPP_AUTH_ALLOWED_ORIGINS", "http://app.local:3000, https://app.com");
        std::env::set_var("STAPP_VOICE_PUBLIC_URL", "ws://192.168.1.50:7880");
        std::env::set_var("STAPP_LIMITS_MAX_UPLOAD_MB", "50");
    }

    config.apply_env_overrides();

    assert_eq!(config.server.name, "Servidor Customizado");
    assert_eq!(config.server.port, 9999);
    assert_eq!(config.server.bind, "127.0.0.2".parse::<IpAddr>().unwrap());
    assert!(config.auth.allow_registration);
    assert!(config.auth.trust_private_networks);
    assert_eq!(
        config.auth.allowed_origins,
        vec!["http://app.local:3000", "https://app.com"]
    );
    assert_eq!(
        config.voice.public_url.as_deref(),
        Some("ws://192.168.1.50:7880")
    );
    assert_eq!(config.limits.max_upload_mb, 50);
    assert_eq!(config.limits.max_upload_bytes(), 50 * 1024 * 1024);

    // Limpamos as variaveis
    unsafe {
        std::env::remove_var("STAPP_SERVER_NAME");
        std::env::remove_var("STAPP_SERVER_PORT");
        std::env::remove_var("STAPP_SERVER_BIND");
        std::env::remove_var("STAPP_AUTH_ALLOW_REGISTRATION");
        std::env::remove_var("STAPP_AUTH_TRUST_PRIVATE_NETWORKS");
        std::env::remove_var("STAPP_AUTH_ALLOWED_ORIGINS");
        std::env::remove_var("STAPP_VOICE_PUBLIC_URL");
        std::env::remove_var("STAPP_LIMITS_MAX_UPLOAD_MB");
    }
}

#[test]
fn validates_min_client_version() {
    let mut config = test_config(PathBuf::from("test.db"), 20, 6);
    config.server.min_client_version = Some("0.2.0".into());
    assert!(config.validate().is_ok());

    config.server.min_client_version = Some("v1.0.0-rc.1".into());
    assert!(config.validate().is_ok());

    config.server.min_client_version = Some("invalido".into());
    assert!(config.validate().is_err());
}

#[test]
fn bootstrap_cria_arquivo_e_diretorios_quando_ausente() {
    let dir = TestDir::new();
    let config_path = dir.path().join("subpasta").join("stapp.toml");
    assert!(!config_path.exists());

    let config = Config::load_or_bootstrap(&config_path).expect("bootstrapping bem-sucedido");
    assert!(config_path.exists(), "stapp.toml deve ter sido gerado");

    // Valida configuracao padrao
    assert_eq!(config.server.port, 8787);
    assert_eq!(config.server.max_users, 20);

    // Valida criacao dos diretorios de persistencia
    assert!(
        config.storage.database.parent().unwrap().exists(),
        "diretorio do banco deve existir"
    );
    assert!(
        config.storage.attachments_dir.exists(),
        "diretorio de anexos deve existir"
    );
}

#[test]
fn bootstrap_preserva_arquivo_existente_sem_sobrescrever() {
    let dir = TestDir::new();
    let config_path = dir.path().join("stapp.toml");

    let custom_toml = r#"
[server]
name = "Servidor Customizado"
bind = "127.0.0.1"
port = 9999

[storage]
database = "custom_data/banco.db"
attachments_dir = "custom_data/anexos"

[[channels]]
id = "chat"
name = "Chat"
kind = "text"
"#;
    std::fs::write(&config_path, custom_toml).unwrap();

    let config = Config::load_or_bootstrap(&config_path).expect("carregar existente");
    assert_eq!(config.server.name, "Servidor Customizado");
    assert_eq!(config.server.port, 9999);

    // Garante que as pastas customizadas foram criadas
    assert!(config.storage.database.parent().unwrap().exists());
    assert!(config.storage.attachments_dir.exists());

    // Confirma que o conteudo original do arquivo nao foi substituido
    let content = std::fs::read_to_string(&config_path).unwrap();
    assert!(content.contains("Servidor Customizado"));
}

#[test]
fn tls_desativado_por_padrao() {
    let config = test_config(PathBuf::from("test.db"), 20, 6);
    assert!(!config.tls.enabled);
    assert_eq!(config.tls.port, 443);
    assert!(config.tls.domains.is_empty());
    assert_eq!(config.tls_addr().port(), 443);
    assert_eq!(config.http_redirect_addr(), None);
}

#[test]
fn rejeita_tls_sem_dominios_nem_certificados() {
    let mut config = test_config(PathBuf::from("test.db"), 20, 6);
    config.tls.enabled = true;
    let err = config.validate().unwrap_err().to_string();
    assert!(err.contains("ao menos um dominio"), "{err}");

    config.tls.domains = vec!["   ".into()];
    let err = config.validate().unwrap_err().to_string();
    assert!(err.contains("nao podem ser vazios"), "{err}");
}

#[test]
fn rejeita_tls_manual_incompleto() {
    let mut config = test_config(PathBuf::from("test.db"), 20, 6);
    config.tls.enabled = true;
    config.tls.cert_file = Some(PathBuf::from("cert.pem"));
    config.tls.key_file = None;
    let err = config.validate().unwrap_err().to_string();
    assert!(err.contains("informados juntos"), "{err}");
}

#[test]
fn rejeita_porta_de_redirecionamento_conflitante() {
    let mut config = test_config(PathBuf::from("test.db"), 20, 6);
    config.tls.enabled = true;
    config.tls.domains = vec!["stapp.exemplo.com".into()];
    config.tls.port = 443;
    config.tls.http_redirect_port = Some(443);
    let err = config.validate().unwrap_err().to_string();
    assert!(err.contains("nao pode ser igual a tls.port"), "{err}");
}

#[test]
fn aceita_tls_acme_e_manual_validos() {
    let mut acme = test_config(PathBuf::from("test.db"), 20, 6);
    acme.tls.enabled = true;
    acme.tls.domains = vec!["chat.exemplo.com".into()];
    acme.tls.email = "admin@exemplo.com".into();
    acme.tls.http_redirect_port = Some(80);
    assert!(acme.validate().is_ok());
    assert_eq!(acme.http_redirect_addr().unwrap().port(), 80);

    let mut manual = test_config(PathBuf::from("test.db"), 20, 6);
    manual.tls.enabled = true;
    manual.tls.cert_file = Some(PathBuf::from("cert.pem"));
    manual.tls.key_file = Some(PathBuf::from("key.pem"));
    assert!(manual.validate().is_ok());
}

#[test]
fn tls_env_overrides() {
    let _guard = ENV_LOCK.lock().unwrap();
    let mut config = test_config(PathBuf::from("test.db"), 20, 6);

    unsafe {
        std::env::set_var("STAPP_TLS_ENABLED", "true");
        std::env::set_var("STAPP_TLS_PORT", "8443");
        std::env::set_var("STAPP_TLS_DOMAINS", "app.local, chat.local");
        std::env::set_var("STAPP_TLS_EMAIL", "ops@exemplo.com");
        std::env::set_var("STAPP_TLS_HTTP_REDIRECT_PORT", "8080");
        std::env::set_var("STAPP_TLS_PRODUCTION", "true");
    }

    config.apply_env_overrides();

    unsafe {
        std::env::remove_var("STAPP_TLS_ENABLED");
        std::env::remove_var("STAPP_TLS_PORT");
        std::env::remove_var("STAPP_TLS_DOMAINS");
        std::env::remove_var("STAPP_TLS_EMAIL");
        std::env::remove_var("STAPP_TLS_HTTP_REDIRECT_PORT");
        std::env::remove_var("STAPP_TLS_PRODUCTION");
    }

    assert!(config.tls.enabled);
    assert_eq!(config.tls.port, 8443);
    assert_eq!(config.tls.domains, vec!["app.local", "chat.local"]);
    assert_eq!(config.tls.email, "ops@exemplo.com");
    assert_eq!(config.tls.http_redirect_port, Some(8080));
    assert!(config.tls.production);
    assert!(config.validate().is_ok());
}
