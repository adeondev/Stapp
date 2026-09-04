//! Assistente interativo de primeiro boot para configuracao guiada do Stapp.
//!
//! Caso nenhum arquivo de configuracao exista e o processo esteja rodando em um
//! terminal interativo (stdin e stdout sao terminais TTY), apresenta um menu
//! moderno permitindo inicio rapido com valores padrao ou configuracao personalizada.
//! Em ambientes nao-interativos (Docker, systemd, CI/CD) ou sob a flag `--non-interactive`,
//! adota automaticamente os valores padrao com seguranca.

use std::io::{self, IsTerminal, Write};
use std::net::IpAddr;
use std::path::Path;

use anyhow::{Context, Result};

use crate::config::Config;

/// Verifica se o ambiente e verdadeiramente interativo (TTY em stdin E stdout).
pub fn is_interactive() -> bool {
    io::stdin().is_terminal() && io::stdout().is_terminal()
}

/// Executa o assistente de primeiro boot ou cai no fallback nao-interativo com defaults.
pub fn run_first_boot(path: &Path, non_interactive: bool) -> Result<Config> {
    if non_interactive || !is_interactive() {
        return bootstrap_default(path);
    }

    run_interactive_wizard(path)
}

/// Gera o arquivo stapp.toml padrao em disco criando todos os diretorios pais necessarios.
pub fn bootstrap_default(path: &Path) -> Result<Config> {
    ensure_parent_dirs(path)?;
    std::fs::write(path, Config::DEFAULT_CONFIG_TEMPLATE)
        .with_context(|| format!("nao consegui gerar configuracao padrao em {}", path.display()))?;
    tracing::info!(path = %path.display(), "Arquivo de configuracao padrao gerado com sucesso");
    Config::load(path)
}

/// Garante que todos os diretorios pais do caminho informado existam em disco.
pub fn ensure_parent_dirs(path: &Path) -> Result<()> {
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent)
                .with_context(|| format!("nao consegui criar diretorio pai {}", parent.display()))?;
        }
    }
    Ok(())
}

fn run_interactive_wizard(path: &Path) -> Result<Config> {
    println!("\n==================================================================");
    println!("              Bem-vindo ao Stapp — Servidor Portatil              ");
    println!("==================================================================");
    println!(" Nenhum arquivo de configuracao foi encontrado em: {}", path.display());
    println!();
    println!(" [1] Inicio Rapido (Recomendado)");
    println!("     - Gera stapp.toml com valores padrao de desenvolvimento");
    println!("     - Servidor na porta 8787 e armazenamento em data/");
    println!("     - Suporte nativo ao LiveKit (devkey/secret pre-configurados)");
    println!();
    println!(" [2] Configuracao Personalizada (Avancado)");
    println!("     - Escolha nome do servidor, porta e endereco de bind");
    println!("     - Configure chaves customizadas de voz (LiveKit) ou desative");
    println!("     - Personalize os diretorios de dados e anexos");
    println!();

    let choice = prompt_string("Escolha uma opcao [1/2]", "1");

    if choice.trim() == "2" {
        run_custom_setup(path)
    } else {
        println!("-> Gerando configuracao padrao...");
        bootstrap_default(path)
    }
}

fn run_custom_setup(path: &Path) -> Result<Config> {
    println!("\n--- [Configuracao Personalizada] ---");
    let name = prompt_string("Nome do servidor", "Stapp");
    let port = prompt_u16("Porta HTTP / WebSocket", 8787);
    let bind = prompt_ip("Endereco de rede (bind)", "0.0.0.0");
    let enable_voice = prompt_bool("Deseja habilitar chamadas de voz e video (LiveKit)?", true);

    let (voice_backend, public_url, api_url, api_key, api_secret) = if enable_voice {
        let p_url = prompt_string("URL Publica do LiveKit", "ws://127.0.0.1:7880");
        let a_url = prompt_string("URL da API do LiveKit", "http://127.0.0.1:7880");
        let key = prompt_string("LiveKit API Key", "devkey");
        let secret = prompt_string("LiveKit API Secret", "secret");
        ("livekit", p_url, a_url, key, secret)
    } else {
        ("disabled", "ws://127.0.0.1:7880".into(), "http://127.0.0.1:7880".into(), String::new(), String::new())
    };

    let data_dir = prompt_string("Diretorio de dados (banco e anexos)", "data");
    let db_path = format!("{}/stapp.db", data_dir.trim_end_matches(['/', '\\']));
    let attachments_dir = format!("{}/attachments", data_dir.trim_end_matches(['/', '\\']));

    let toml_content = format!(
r#"# Config do servidor Stapp gerada pelo assistente interativo.

[server]
name      = "{name}"
bind      = "{bind}"
port      = {port}
max_users = 20

[auth]
allow_registration = true
max_sessions_per_user = 3
trust_private_networks = true
trusted_networks = []
allowed_origins = [
  "http://localhost:5173",
]

[[channels]]
id   = "geral"
name = "geral"
kind = "text"

[[channels]]
id   = "random"
name = "random"
kind = "text"

[[channels]]
id   = "sala"
name = "Sala de voz"
kind = "voice"

[voice]
backend     = "{voice_backend}"
ice_servers = ["stun:stun.l.google.com:19302"]
max_peers   = 6
public_url  = "{public_url}"
api_url     = "{api_url}"
api_key     = "{api_key}"
api_secret  = "{api_secret}"
api_key_env = "STAPP_LIVEKIT_API_KEY"
api_secret_env = "STAPP_LIVEKIT_API_SECRET"

[limits]
max_upload_mb  = 20
max_text_chars = 4000
max_attachments_per_message = 10

[storage]
database      = "{db_path}"
history_limit = 200
attachments_dir = "{attachments_dir}"

[tls]
enabled = false
port = 443
domains = []
email = ""
cache_dir = "data/acme"
production = false
"#);

    ensure_parent_dirs(path)?;
    std::fs::write(path, toml_content)
        .with_context(|| format!("nao consegui salvar configuracao personalizada em {}", path.display()))?;
    println!("-> Configuracao personalizada salva com sucesso em: {}", path.display());
    println!("-> Inicializando aplicacao...");
    Config::load(path)
}

fn prompt_string(label: &str, default: &str) -> String {
    print!("{} [{}]: ", label, default);
    let _ = io::stdout().flush();
    let mut input = String::new();
    if io::stdin().read_line(&mut input).is_ok() {
        let trimmed = input.trim();
        if !trimmed.is_empty() {
            return trimmed.to_string();
        }
    }
    default.to_string()
}

fn prompt_u16(label: &str, default: u16) -> u16 {
    loop {
        let val = prompt_string(label, &default.to_string());
        if let Ok(num) = val.parse::<u16>() {
            if num > 0 {
                return num;
            }
        }
        println!("Valor invalido. Digite um numero de porta valido (1-65535).");
    }
}

fn prompt_ip(label: &str, default: &str) -> IpAddr {
    loop {
        let val = prompt_string(label, default);
        if let Ok(ip) = val.parse::<IpAddr>() {
            return ip;
        }
        println!("Endereco IP invalido. Exemplo: 0.0.0.0 ou 127.0.0.1");
    }
}

fn prompt_bool(label: &str, default: bool) -> bool {
    let hint = if default { "S/n" } else { "s/N" };
    loop {
        print!("{} [{}]: ", label, hint);
        let _ = io::stdout().flush();
        let mut input = String::new();
        if io::stdin().read_line(&mut input).is_ok() {
            let trimmed = input.trim().to_lowercase();
            if trimmed.is_empty() {
                return default;
            }
            if trimmed == "s" || trimmed == "sim" || trimmed == "y" || trimmed == "yes" {
                return true;
            }
            if trimmed == "n" || trimmed == "nao" || trimmed == "não" || trimmed == "no" {
                return false;
            }
        }
        println!("Resposta invalida. Digite 's' para sim ou 'n' para nao.");
    }
}
