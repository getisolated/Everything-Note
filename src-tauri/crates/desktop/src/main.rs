//! Point d'entrée de l'application de bureau : assemble les adaptateurs, les fenêtres, le
//! tray (et le menu d'application sur macOS) et les commandes IPC.

// Pas de console derrière la fenêtre en release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod data_dir;
mod events;
mod file_protocol;
mod lifecycle;
mod mcp;
#[cfg(target_os = "macos")]
mod menu;
mod open_args;
mod settings_effects;
mod setup;
mod shortcut;
mod startup;
mod state;
mod tray;
mod updater;
mod windows;

use tauri_plugin_autostart::MacosLauncher;

fn main() -> anyhow::Result<()> {
    platform::logging::init_logging("info").map_err(|error| anyhow::anyhow!(error))?;

    let app = tauri::Builder::default()
        // En premier : un second lancement ne doit rien initialiser
        .plugin(tauri_plugin_single_instance::init(
            open_args::on_second_instance,
        ))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec![startup::HIDDEN_ARG]),
        ))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .register_asynchronous_uri_scheme_protocol(file_protocol::SCHEME, file_protocol::handle)
        .setup(|app| setup::run(app).map_err(Into::into))
        .invoke_handler(commands::handler())
        .build(tauri::generate_context!())?;

    app.run(lifecycle::on_run_event);
    Ok(())
}
