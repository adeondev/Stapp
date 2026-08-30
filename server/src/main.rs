use anyhow::Result;
use clap::Parser;
use stapp_server::cli::Cli;

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "stapp_server=info,tower_http=warn".into()),
        )
        .compact()
        .init();

    Cli::parse().run().await
}
