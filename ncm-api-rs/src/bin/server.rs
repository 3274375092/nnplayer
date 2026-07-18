use ncm_api::server::{start_server, ServerConfig};

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "ncm_api=info".into()),
        )
        .init();

    let config = ServerConfig::from_env();
    start_server(config).await;
}
