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
fn a_definicao_da_cli_e_valida() {
    use clap::CommandFactory;
    Cli::command().debug_assert();
}
