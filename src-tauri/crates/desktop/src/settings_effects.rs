//! Effets d'un changement de réglages hors du renderer.

use app::settings::SettingsChange;
use tauri::AppHandle;

use crate::state::desktop;
use crate::windows::overlay;
use crate::{mcp, startup, tray, updater};

/// Applique ce que le changement implique (le raccourci global est déjà enregistré par
/// l'appelant, avant d'accepter le changement).
pub fn apply(app: &AppHandle, change: &SettingsChange) {
    if change.overlay_size_changed() {
        overlay::apply_size(app, change);
    }
    if change.launch_at_startup_changed() {
        startup::apply(app, change.after.launch_at_startup);
    }
    #[cfg(target_os = "macos")]
    if change.menu_bar_icon_changed() {
        tray::set_visible(app, change.after.show_menu_bar_icon);
    }
    if change.language_changed() {
        tray::set_language(app, change.after.language);
        #[cfg(target_os = "macos")]
        crate::menu::set_language(app, change.after.language);
    }
    if change.auto_update_changed() {
        updater::on_auto_update_changed(app);
    }
    if change.mcp_changed() {
        mcp::sync(app);
    }
    if change.collections_exclude_changed() {
        desktop(app)
            .services
            .collections
            .set_excludes(&change.after.collections_exclude);
    }
}
