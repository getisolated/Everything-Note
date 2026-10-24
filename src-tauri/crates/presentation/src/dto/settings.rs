//! Réglages.

use std::collections::BTreeMap;

use domain::settings::AppSettings;
use serde::Serialize;
use ts_rs::TS;

/// Position de l'overlay.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[ts(export)]
pub struct OverlayPositionDto {
    /// Abscisse.
    pub x: i32,
    /// Ordonnée.
    pub y: i32,
}

/// Réglages complets (même forme que `settings.json`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SettingsDto {
    /// Langue.
    #[ts(type = "'en' | 'fr'")]
    pub language: &'static str,
    /// Raccourci global.
    pub global_shortcut: String,
    /// Touche physique de la touche finale du raccourci global (`KeyA`…`KeyZ`,
    /// `Digit0`…`Digit9`), `null` si inconnue.
    pub global_shortcut_physical_key: Option<String>,
    /// Ce qu'ouvre le raccourci global.
    #[ts(type = "'overlay' | 'app'")]
    pub shortcut_mode: &'static str,
    /// Largeur de l'overlay.
    pub overlay_width: u32,
    /// Hauteur de l'overlay.
    pub overlay_height: u32,
    /// Entrée envoie.
    pub enter_to_send: bool,
    /// Lancement au démarrage.
    pub launch_at_startup: bool,
    /// Icône dans la barre de menus (macOS).
    pub show_menu_bar_icon: bool,
    /// Thème ou `system`.
    #[ts(type = "string")]
    pub theme: &'static str,
    /// Thème sombre de `system`.
    #[ts(type = "string")]
    pub preferred_dark_theme: &'static str,
    /// Thème clair de `system`.
    #[ts(type = "string")]
    pub preferred_light_theme: &'static str,
    /// Mises à jour automatiques.
    pub auto_update: bool,
    /// Raccourcis internes modifiés.
    pub app_shortcuts: BTreeMap<String, String>,
    /// Barre de mise en forme affichée.
    pub formatting_bar_enabled: bool,
    /// Taille de la barre.
    #[ts(type = "'full' | 'compact'")]
    pub formatting_bar_mode: &'static str,
    /// Style de la barre.
    #[ts(type = "'pinned' | 'floating'")]
    pub formatting_bar_style: &'static str,
    /// Position de la barre.
    #[ts(type = "'top' | 'bottom' | 'left' | 'right'")]
    pub formatting_bar_position: &'static str,
    /// Numéros de ligne.
    pub show_line_numbers: bool,
    /// Retour à la ligne.
    pub word_wrap: bool,
    /// Ligne vide finale.
    pub trailing_line: bool,
    /// Plan de la note.
    pub show_outline: bool,
    /// Fil d'Ariane en haut de la note.
    pub show_breadcrumbs: bool,
    /// Barre de défilement au survol.
    pub hide_scrollbar: bool,
    /// Ouverture en aperçu.
    pub open_in_preview: bool,
    /// Dossiers ignorés des collections.
    pub collections_exclude: Vec<String>,
    /// Position de l'overlay (gérée par le processus principal).
    pub overlay_position: Option<OverlayPositionDto>,
    /// Serveur MCP activé.
    pub mcp_enabled: bool,
    /// Port du serveur MCP.
    pub mcp_port: u16,
    /// Jeton du serveur MCP (généré par le processus principal), vide s'il n'a jamais été
    /// activé.
    pub mcp_token: String,
}

impl From<&AppSettings> for SettingsDto {
    fn from(settings: &AppSettings) -> Self {
        Self {
            language: settings.language.as_str(),
            global_shortcut: settings.global_shortcut.clone(),
            global_shortcut_physical_key: settings.global_shortcut_physical_key.clone(),
            shortcut_mode: settings.shortcut_mode.as_str(),
            overlay_width: settings.overlay_width,
            overlay_height: settings.overlay_height,
            enter_to_send: settings.enter_to_send,
            launch_at_startup: settings.launch_at_startup,
            show_menu_bar_icon: settings.show_menu_bar_icon,
            theme: settings.theme.as_str(),
            preferred_dark_theme: settings.preferred_dark_theme.as_str(),
            preferred_light_theme: settings.preferred_light_theme.as_str(),
            auto_update: settings.auto_update,
            app_shortcuts: settings.app_shortcuts.iter().cloned().collect(),
            formatting_bar_enabled: settings.formatting_bar_enabled,
            formatting_bar_mode: settings.formatting_bar_mode.as_str(),
            formatting_bar_style: settings.formatting_bar_style.as_str(),
            formatting_bar_position: settings.formatting_bar_position.as_str(),
            show_line_numbers: settings.show_line_numbers,
            word_wrap: settings.word_wrap,
            trailing_line: settings.trailing_line,
            show_outline: settings.show_outline,
            show_breadcrumbs: settings.show_breadcrumbs,
            hide_scrollbar: settings.hide_scrollbar,
            open_in_preview: settings.open_in_preview,
            collections_exclude: settings.collections_exclude.clone(),
            overlay_position: settings
                .overlay_position
                .map(|p| OverlayPositionDto { x: p.x, y: p.y }),
            mcp_enabled: settings.mcp_enabled,
            mcp_port: settings.mcp_port,
            mcp_token: settings.mcp_token.clone(),
        }
    }
}

/// Résultat d'une modification des réglages par le renderer.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[ts(export)]
pub struct SettingsUpdateResultDto {
    /// Modification appliquée.
    pub ok: bool,
    /// Raison du refus : le nouveau raccourci global est indisponible.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional, type = "'shortcut-unavailable'")]
    pub error: Option<&'static str>,
    /// Réglages en vigueur.
    pub settings: SettingsDto,
}

impl SettingsUpdateResultDto {
    /// Modification appliquée.
    pub fn applied(settings: &AppSettings) -> Self {
        Self {
            ok: true,
            error: None,
            settings: settings.into(),
        }
    }

    /// Refus : le raccourci demandé n'a pas pu être enregistré (déjà pris, invalide).
    pub fn shortcut_unavailable(settings: &AppSettings) -> Self {
        Self {
            ok: false,
            error: Some("shortcut-unavailable"),
            settings: settings.into(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn has_the_shape_of_settings_json() {
        let settings = AppSettings::default();
        let ipc = serde_json::to_value(SettingsDto::from(&settings)).unwrap();
        let file = app::settings::json::settings_to_json(&settings);

        assert_eq!(ipc, file);
    }

    #[test]
    fn omits_the_error_when_applied() {
        let applied =
            serde_json::to_value(SettingsUpdateResultDto::applied(&AppSettings::default()))
                .unwrap();
        assert_eq!(applied.get("error"), None);
    }
}
