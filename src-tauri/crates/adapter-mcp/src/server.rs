//! Démarrage et arrêt du serveur HTTP.

use std::fmt;
use std::io;
use std::net::Ipv4Addr;
use std::sync::Arc;
use std::time::Duration;

use axum::Router;
use axum::middleware;
use rmcp::transport::streamable_http_server::session::local::LocalSessionManager;
use rmcp::transport::streamable_http_server::{StreamableHttpServerConfig, StreamableHttpService};
use tokio::net::TcpListener;
use tokio::task::JoinHandle;
use tokio_util::sync::CancellationToken;

use crate::guard;
use crate::handler::DaftrTools;
use crate::tools::McpServices;

/// Chemin du point d'accès MCP.
pub const MCP_PATH: &str = "/mcp";

/// Rappel après chaque écriture d'une IA (les fenêtres relisent les notes).
pub type ChangeListener = Arc<dyn Fn() + Send + Sync>;

/// Délai laissé aux connexions ouvertes (flux SSE) pour se fermer à l'arrêt.
const STOP_TIMEOUT: Duration = Duration::from_secs(3);

/// Configuration du serveur, tirée des réglages.
#[derive(Clone, PartialEq, Eq)]
pub struct McpConfig {
    /// Port sur `127.0.0.1` ; `0` laisse le système choisir (tests).
    pub port: u16,
    /// Jeton exigé de chaque requête.
    pub token: String,
}

impl fmt::Debug for McpConfig {
    // Le jeton ne doit jamais finir dans un journal
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("McpConfig")
            .field("port", &self.port)
            .finish_non_exhaustive()
    }
}

/// Échec du démarrage.
#[derive(Debug)]
pub enum McpStartError {
    /// Le port est déjà pris par un autre programme.
    PortInUse(u16),
    /// Pas de jeton : le serveur ne tourne jamais sans protection.
    MissingToken,
    /// Autre échec du système (port interdit…).
    Io(io::Error),
}

impl fmt::Display for McpStartError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::PortInUse(port) => write!(formatter, "port {port} is already in use"),
            Self::MissingToken => formatter.write_str("no access token"),
            Self::Io(error) => write!(formatter, "{error}"),
        }
    }
}

impl std::error::Error for McpStartError {}

/// Le serveur MCP.
pub struct McpServer;

impl McpServer {
    /// Écoute sur `127.0.0.1:port` et sert les outils en tâche de fond (à appeler depuis un
    /// runtime tokio) ; rend la main dès que le port est pris, ou l'erreur.
    pub async fn start(
        config: McpConfig,
        services: McpServices,
        on_change: ChangeListener,
    ) -> Result<McpServerHandle, McpStartError> {
        if config.token.is_empty() {
            return Err(McpStartError::MissingToken);
        }
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, config.port))
            .await
            .map_err(|error| match error.kind() {
                io::ErrorKind::AddrInUse => McpStartError::PortInUse(config.port),
                _ => McpStartError::Io(error),
            })?;
        let port = listener.local_addr().map_err(McpStartError::Io)?.port();

        let cancel = CancellationToken::new();
        let app = router(config.token, services, on_change, cancel.child_token());
        let shutdown = cancel.clone();
        let task = tokio::spawn(async move {
            let served = axum::serve(listener, app)
                .with_graceful_shutdown(shutdown.cancelled_owned())
                .await;
            if let Err(error) = served {
                tracing::error!(%error, "serveur MCP arrêté sur une erreur");
            }
        });

        tracing::info!(port, "serveur MCP démarré");
        Ok(McpServerHandle { port, cancel, task })
    }
}

/// Le serveur en marche ; l'abandonner l'arrête aussi (sans attendre).
pub struct McpServerHandle {
    port: u16,
    cancel: CancellationToken,
    task: JoinHandle<()>,
}

impl McpServerHandle {
    /// Port d'écoute.
    pub fn port(&self) -> u16 {
        self.port
    }

    /// Adresse du point d'accès, à donner aux clients MCP.
    pub fn url(&self) -> String {
        format!("http://127.0.0.1:{}{MCP_PATH}", self.port)
    }

    /// Arrête le serveur et attend que le port soit libéré (les connexions encore ouvertes
    /// après quelques secondes sont coupées).
    pub async fn stop(mut self) {
        self.cancel.cancel();
        if tokio::time::timeout(STOP_TIMEOUT, &mut self.task)
            .await
            .is_err()
        {
            self.task.abort();
            // Seule l'annulation peut revenir ici : elle libère le port
            let _ = (&mut self.task).await;
        }
        tracing::info!(port = self.port, "serveur MCP arrêté");
    }
}

impl Drop for McpServerHandle {
    fn drop(&mut self) {
        self.cancel.cancel();
    }
}

/// Le point d'accès MCP derrière le contrôle d'accès ; les autres chemins répondent 404.
fn router(
    token: String,
    services: McpServices,
    on_change: ChangeListener,
    cancel: CancellationToken,
) -> Router {
    // L'en-tête `Host` reste limité aux adresses locales (valeur par défaut de rmcp)
    let config = StreamableHttpServerConfig::default().with_cancellation_token(cancel);
    let service = StreamableHttpService::new(
        move || Ok(DaftrTools::new(services.clone(), on_change.clone())),
        Arc::new(LocalSessionManager::default()),
        config,
    );
    let token: Arc<str> = Arc::from(token);

    Router::new()
        .nest_service(MCP_PATH, service)
        .route_layer(middleware::from_fn_with_state(token, guard::require_token))
}
