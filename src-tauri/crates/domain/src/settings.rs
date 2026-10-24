//! Réglages de l'application (`settings.json`), leurs valeurs par défaut et leur validation.
//!
//! Toute valeur venant du disque ou du renderer passe par [`RawSettings`] puis
//! [`sanitize_settings`] : le reste de l'application ne voit que des réglages valides.

mod options;
mod raw;
mod sanitize;
mod theme;

pub use options::{FormattingBarMode, FormattingBarPosition, FormattingBarStyle, ShortcutMode};
pub use raw::{RawPosition, RawSettings};
pub use sanitize::sanitize_settings;
pub use theme::{ThemeId, ThemeKind, ThemePreference};

use crate::collection::DEFAULT_COLLECTION_EXCLUDES;
use crate::i18n::{DEFAULT_LANGUAGE, Language};
use crate::overlay::{Position, Size};

/// Largeur minimale de l'overlay.
pub const OVERLAY_MIN_WIDTH: u32 = 200;
/// Largeur maximale de l'overlay.
pub const OVERLAY_MAX_WIDTH: u32 = 800;
/// Hauteur minimale de l'overlay.
pub const OVERLAY_MIN_HEIGHT: u32 = 200;
/// Hauteur maximale de l'overlay.
pub const OVERLAY_MAX_HEIGHT: u32 = 1200;
/// Port par défaut du serveur MCP (choisi loin des ports usuels).
pub const DEFAULT_MCP_PORT: u16 = 38427;
/// Plus petit port accepté pour le serveur MCP (hors des ports réservés au système).
pub const MCP_MIN_PORT: u16 = 1024;
/// Plus grand port accepté pour le serveur MCP.
pub const MCP_MAX_PORT: u16 = 65535;
/// Longueur du jeton du serveur MCP : 32 octets aléatoires en hexadécimal minuscule.
pub const MCP_TOKEN_LENGTH: usize = 64;

/// Réglages complets et valides.
#[derive(Debug, Clone, PartialEq)]
pub struct AppSettings {
    /// Langue de l'interface ; choisie d'après la locale de l'OS au premier lancement.
    pub language: Language,
    /// Raccourci global (format accélérateur, ex. `CommandOrControl+Alt+Q`).
    pub global_shortcut: String,
    /// Touche physique de la touche finale du raccourci global (`KeyboardEvent.code` :
    /// `KeyA`…`KeyZ`, `Digit0`…`Digit9`), `None` si inconnue. Sur macOS le raccourci global
    /// s'enregistre par code de touche physique : la lettre de `global_shortcut` suit la
    /// disposition (sur AZERTY la touche « Q » est la touche physique `KeyA`).
    pub global_shortcut_physical_key: Option<String>,
    /// Ce qu'ouvre le raccourci global.
    pub shortcut_mode: ShortcutMode,
    /// Largeur de l'overlay.
    pub overlay_width: u32,
    /// Hauteur de l'overlay.
    pub overlay_height: u32,
    /// `true` : Entrée envoie (Maj+Entrée = nouvelle ligne) ; `false` : Ctrl+Entrée envoie.
    pub enter_to_send: bool,
    /// Lancement au démarrage de Windows (dans le tray).
    pub launch_at_startup: bool,
    /// Icône dans la barre de menus (macOS seulement) ; masquée, l'app reste active en
    /// arrière-plan et le Dock rouvre la fenêtre. Ignoré sous Windows : l'app vit dans le tray.
    pub show_menu_bar_icon: bool,
    /// Thème, ou `system` pour suivre l'OS.
    pub theme: ThemePreference,
    /// Thème de `system` quand l'OS est en mode sombre.
    pub preferred_dark_theme: ThemeId,
    /// Thème de `system` quand l'OS est en mode clair.
    pub preferred_light_theme: ThemeId,
    /// `true` : les mises à jour se téléchargent seules et s'installent à la fermeture.
    pub auto_update: bool,
    /// Raccourcis internes modifiés par l'utilisateur (id → accélérateur), dans l'ordre.
    pub app_shortcuts: Vec<(String, String)>,
    /// Barre de mise en forme affichée.
    pub formatting_bar_enabled: bool,
    /// Taille de la barre de mise en forme.
    pub formatting_bar_mode: FormattingBarMode,
    /// Style de la barre de mise en forme.
    pub formatting_bar_style: FormattingBarStyle,
    /// Position de la barre de mise en forme.
    pub formatting_bar_position: FormattingBarPosition,
    /// Numéros de ligne de l'éditeur.
    pub show_line_numbers: bool,
    /// Retour à la ligne automatique.
    pub word_wrap: bool,
    /// La note finit toujours par une ligne vide.
    pub trailing_line: bool,
    /// Plan h1/h2/h3 à droite de la note.
    pub show_outline: bool,
    /// Fil d'Ariane (collection ou notes, dossiers, fichier) en haut de la note.
    pub show_breadcrumbs: bool,
    /// Barre de défilement de l'éditeur visible seulement au survol.
    pub hide_scrollbar: bool,
    /// Les notes s'ouvrent rendues (lecture seule) plutôt qu'en source.
    pub open_in_preview: bool,
    /// Dossiers jamais listés dans les collections (les dossiers cachés sont toujours ignorés).
    pub collections_exclude: Vec<String>,
    /// Dernière position choisie pour l'overlay ; `None` tant qu'il n'a pas été déplacé.
    pub overlay_position: Option<Position>,
    /// Serveur MCP local (accès des IA aux notes) démarré.
    pub mcp_enabled: bool,
    /// Port du serveur MCP, sur `127.0.0.1` seulement.
    pub mcp_port: u16,
    /// Jeton exigé par le serveur MCP (`Authorization: Bearer …`) ; vide tant que le
    /// serveur n'a jamais été activé. Seul le processus principal le génère.
    pub mcp_token: String,
}

impl AppSettings {
    /// Taille de l'overlay.
    pub fn overlay_size(&self) -> Size {
        Size {
            width: self.overlay_width,
            height: self.overlay_height,
        }
    }

    /// Même raccourci global : même accélérateur et même touche physique.
    pub fn same_global_shortcut(&self, other: &Self) -> bool {
        self.global_shortcut == other.global_shortcut
            && self.global_shortcut_physical_key == other.global_shortcut_physical_key
    }

    /// Le serveur MCP est activé sans jeton : il faut en générer un avant de le démarrer.
    pub fn needs_mcp_token(&self) -> bool {
        self.mcp_enabled && self.mcp_token.is_empty()
    }
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            language: DEFAULT_LANGUAGE,
            global_shortcut: "CommandOrControl+Alt+Q".to_owned(),
            global_shortcut_physical_key: None,
            shortcut_mode: ShortcutMode::Overlay,
            overlay_width: 250,
            overlay_height: 350,
            enter_to_send: true,
            launch_at_startup: false,
            show_menu_bar_icon: true,
            theme: ThemePreference::Theme(ThemeId::Dark),
            preferred_dark_theme: ThemeId::Dark,
            preferred_light_theme: ThemeId::Light,
            auto_update: false,
            app_shortcuts: Vec::new(),
            formatting_bar_enabled: true,
            formatting_bar_mode: FormattingBarMode::Full,
            formatting_bar_style: FormattingBarStyle::Floating,
            formatting_bar_position: FormattingBarPosition::Top,
            show_line_numbers: false,
            word_wrap: true,
            trailing_line: false,
            show_outline: false,
            show_breadcrumbs: true,
            hide_scrollbar: false,
            open_in_preview: false,
            collections_exclude: DEFAULT_COLLECTION_EXCLUDES.map(str::to_owned).to_vec(),
            overlay_position: None,
            mcp_enabled: false,
            mcp_port: DEFAULT_MCP_PORT,
            mcp_token: String::new(),
        }
    }
}

/// Jeton MCP bien formé : vide (jamais généré) ou [`MCP_TOKEN_LENGTH`] chiffres
/// hexadécimaux minuscules.
///
/// ```
/// assert!(domain::settings::is_mcp_token(""));
/// assert!(domain::settings::is_mcp_token(&"a1".repeat(32)));
/// assert!(!domain::settings::is_mcp_token("secret"));
/// ```
pub fn is_mcp_token(token: &str) -> bool {
    let hex = |byte: &u8| byte.is_ascii_digit() || (b'a'..=b'f').contains(byte);
    token.is_empty() || (token.len() == MCP_TOKEN_LENGTH && token.as_bytes().iter().all(hex))
}

#[cfg(test)]
mod tests;
