//! Serveur MCP (accès des IA aux notes) : démarré, arrêté ou redémarré selon les réglages ;
//! son état est poussé aux réglages du renderer.

use std::sync::{Arc, Mutex};

use adapter_mcp::{McpConfig, McpServer, McpServerHandle, McpServices, McpStartError};
use domain::settings::DEFAULT_MCP_PORT;
use platform::sync::lock;
use presentation::dto::McpStatusDto;
use presentation::events::{MCP_STATUS, NOTES_CHANGED};
use tauri::AppHandle;
use tauri::async_runtime;

use crate::events::{emit_all, emit_to};
use crate::state::desktop;
use crate::windows::main_window::MAIN;

/// Serveur en marche et état montré dans les réglages.
pub struct McpState {
    /// Serveur en marche avec sa configuration ; le verrou (asynchrone) sérialise les
    /// démarrages et arrêts.
    server: async_runtime::Mutex<Option<(McpConfig, McpServerHandle)>>,
    /// Dernier état connu.
    status: Mutex<McpStatusDto>,
}

impl Default for McpState {
    fn default() -> Self {
        Self {
            server: async_runtime::Mutex::new(None),
            status: Mutex::new(McpStatusDto::stopped(DEFAULT_MCP_PORT)),
        }
    }
}

/// État courant du serveur.
pub fn status(app: &AppHandle) -> McpStatusDto {
    lock(&desktop(app).mcp.status).clone()
}

/// Met le serveur en accord avec les réglages courants, en tâche de fond (au lancement et
/// à chaque changement de l'activation, du port ou du jeton).
pub fn sync(app: &AppHandle) {
    let app = app.clone();
    async_runtime::spawn(async move { reconcile(&app).await });
}

/// Arrête le serveur qui ne correspond plus aux réglages et démarre celui qu'ils demandent.
/// Les réglages sont relus sous le verrou : quel que soit l'ordre des tâches, la dernière
/// applique les réglages en vigueur.
async fn reconcile(app: &AppHandle) {
    let state = desktop(app);
    let mut server = state.mcp.server.lock().await;
    let settings = state.services.settings.current();
    let wanted = settings.mcp_enabled.then(|| McpConfig {
        port: settings.mcp_port,
        token: settings.mcp_token.clone(),
    });

    if let (Some((running, _)), Some(wanted)) = (server.as_ref(), wanted.as_ref())
        && running == wanted
    {
        return;
    }
    if let Some((_, handle)) = server.take() {
        handle.stop().await;
    }
    let status = match wanted {
        None => McpStatusDto::stopped(settings.mcp_port),
        Some(config) => match McpServer::start(config.clone(), services(app), on_change(app)).await
        {
            Ok(handle) => {
                let running = McpStatusDto::running(handle.port(), handle.url());
                *server = Some((config, handle));
                running
            }
            Err(McpStartError::PortInUse(port)) => {
                tracing::warn!(port, "serveur MCP : port déjà pris");
                McpStatusDto::port_in_use(port)
            }
            Err(error) => {
                tracing::error!(%error, "serveur MCP non démarré");
                McpStatusDto::failed(settings.mcp_port, error.to_string())
            }
        },
    };
    *lock(&state.mcp.status) = status.clone();
    emit_to(app, MAIN, MCP_STATUS, status);
}

fn services(app: &AppHandle) -> McpServices {
    let services = &desktop(app).services;
    McpServices {
        notes: services.notes.clone(),
        folders: services.folders.clone(),
    }
}

/// Après une écriture d'une IA, les fenêtres relisent notes et dossiers (l'overlay aussi :
/// les notes rapides peuvent avoir changé).
fn on_change(app: &AppHandle) -> Arc<dyn Fn() + Send + Sync> {
    let app = app.clone();
    Arc::new(move || emit_all(&app, NOTES_CHANGED, ()))
}
