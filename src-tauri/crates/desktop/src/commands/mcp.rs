//! Commandes du serveur MCP.

use presentation::IpcResult;
use presentation::dto::{McpStatusDto, SettingsDto};
use presentation::events::SETTINGS_CHANGED;
use tauri::{AppHandle, WebviewWindow};

use crate::events::emit_except;
use crate::settings_effects;
use crate::state::desktop;

/// État du serveur (en marche, arrêté, port pris…).
#[tauri::command]
pub async fn mcp_status(app: AppHandle) -> McpStatusDto {
    crate::mcp::status(&app)
}

/// Nouveau jeton : les clients configurés avec l'ancien sont refusés, le serveur redémarre.
#[tauri::command]
pub async fn mcp_regenerate_token(app: AppHandle, window: WebviewWindow) -> IpcResult<SettingsDto> {
    let change = desktop(&app).services.settings.regenerate_mcp_token()?;

    settings_effects::apply(&app, &change);
    emit_except(
        &app,
        window.label(),
        SETTINGS_CHANGED,
        SettingsDto::from(&change.after),
    );
    Ok(SettingsDto::from(&change.after))
}
