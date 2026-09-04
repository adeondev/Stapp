use clap::Parser;

use super::{Cli, Command};

#[test]
fn sem_subcomando_o_padrao_e_servir() {
    let cli = Cli::parse_from(["stapp-server"]);
    assert!(cli.command.is_none());
    assert_eq!(cli.config, std::path::Path::new("stapp.toml"));
}

#[test]
fn aceita_config_por_flag_e_pela_forma_antiga() {
    let por_flag = Cli::parse_from(["stapp-server", "--config", "outro.toml"]);
    assert_eq!(por_flag.config, std::path::Path::new("outro.toml"));
    assert!(por_flag.legacy_config.is_none());

    let posicional = Cli::parse_from(["stapp-server", "antigo.toml"]);
    assert_eq!(
        posicional.legacy_config.as_deref(),
        Some(std::path::Path::new("antigo.toml"))
    );
}

#[test]
fn user_e_um_subcomando_com_subcomandos_proprios() {
    let cli = Cli::parse_from(["stapp-server", "user", "list"]);
    assert!(matches!(cli.command, Some(Command::User { .. })));
}

#[test]
fn init_e_um_subcomando_reconhecido() {
    let cli = Cli::parse_from(["stapp-server", "init"]);
    assert!(matches!(cli.command, Some(Command::Init)));

    let cli_custom = Cli::parse_from(["stapp-server", "--config", "custom.toml", "init"]);
    assert!(matches!(cli_custom.command, Some(Command::Init)));
    assert_eq!(cli_custom.config, std::path::Path::new("custom.toml"));
}

#[tokio::test]
async fn cli_run_init_gera_arquivos_sem_iniciar_servidor() {
    let dir = crate::test_support::TestDir::new();
    let config_path = dir.path().join("bootstrapped.toml");
    assert!(!config_path.exists());

    let cli = Cli::parse_from([
        "stapp-server",
        "--config",
        config_path.to_str().unwrap(),
        "init",
    ]);

    cli.run().await.expect("cli init executou com sucesso");
    assert!(config_path.exists());
    assert!(dir.path().join("data").join("attachments").exists());
}

#[test]
fn a_definicao_da_cli_e_valida() {
    use clap::CommandFactory;
    Cli::command().debug_assert();
}
