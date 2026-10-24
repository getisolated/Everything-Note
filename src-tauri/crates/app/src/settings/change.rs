//! Avant/après d'un changement de réglages.

use domain::settings::AppSettings;

/// Réglages avant et après un changement ; l'appelant en déduit les effets à appliquer.
#[derive(Debug, Clone, PartialEq)]
pub struct SettingsChange {
    /// Réglages avant.
    pub before: AppSettings,
    /// Réglages après.
    pub after: AppSettings,
}

impl SettingsChange {
    /// Le raccourci global a changé, ou seulement sa touche physique (même libellé, autre
    /// touche : sur macOS il faut le réenregistrer).
    pub fn shortcut_changed(&self) -> bool {
        !self.before.same_global_shortcut(&self.after)
    }

    /// La taille de l'overlay a changé.
    pub fn overlay_size_changed(&self) -> bool {
        self.before.overlay_size() != self.after.overlay_size()
    }

    /// Le lancement au démarrage a changé.
    pub fn launch_at_startup_changed(&self) -> bool {
        self.before.launch_at_startup != self.after.launch_at_startup
    }

    /// L'affichage de l'icône dans la barre de menus a changé.
    pub fn menu_bar_icon_changed(&self) -> bool {
        self.before.show_menu_bar_icon != self.after.show_menu_bar_icon
    }

    /// La langue a changé.
    pub fn language_changed(&self) -> bool {
        self.before.language != self.after.language
    }

    /// Les mises à jour automatiques ont changé.
    pub fn auto_update_changed(&self) -> bool {
        self.before.auto_update != self.after.auto_update
    }

    /// Le serveur MCP doit redémarrer (ou s'arrêter) : activation, port ou jeton changé.
    pub fn mcp_changed(&self) -> bool {
        let server = |settings: &AppSettings| {
            (
                settings.mcp_enabled,
                settings.mcp_port,
                settings.mcp_token.clone(),
            )
        };
        server(&self.before) != server(&self.after)
    }

    /// Les dossiers ignorés des collections ont changé.
    pub fn collections_exclude_changed(&self) -> bool {
        self.before.collections_exclude != self.after.collections_exclude
    }
}
