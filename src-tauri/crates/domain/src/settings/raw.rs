//! Réglages non fiables, tels que lus du disque ou reçus du renderer.

use super::AppSettings;

/// Position de l'overlay non fiable.
#[derive(Debug, Default, Clone, Copy, PartialEq)]
pub enum RawPosition {
    /// Champ absent : la position actuelle est gardée.
    #[default]
    Absent,
    /// Champ présent mais inutilisable (`null`, mauvais type) : plus de position.
    Invalid,
    /// Coordonnées numériques, encore à valider (finies) et arrondir.
    At {
        /// Abscisse.
        x: f64,
        /// Ordonnée.
        y: f64,
    },
}

/// Réglages non fiables : chaque champ vaut `None` quand il manque ou n'a pas le bon type,
/// la validation retombe alors sur la valeur de base.
#[derive(Debug, Default, Clone, PartialEq)]
pub struct RawSettings {
    /// Voir [`AppSettings::language`].
    pub language: Option<String>,
    /// Voir [`AppSettings::global_shortcut`].
    pub global_shortcut: Option<String>,
    /// Voir [`AppSettings::global_shortcut_physical_key`].
    pub global_shortcut_physical_key: Option<String>,
    /// Voir [`AppSettings::shortcut_mode`].
    pub shortcut_mode: Option<String>,
    /// Voir [`AppSettings::overlay_width`].
    pub overlay_width: Option<f64>,
    /// Voir [`AppSettings::overlay_height`].
    pub overlay_height: Option<f64>,
    /// Voir [`AppSettings::enter_to_send`].
    pub enter_to_send: Option<bool>,
    /// Voir [`AppSettings::launch_at_startup`].
    pub launch_at_startup: Option<bool>,
    /// Voir [`AppSettings::show_menu_bar_icon`].
    pub show_menu_bar_icon: Option<bool>,
    /// Voir [`AppSettings::theme`].
    pub theme: Option<String>,
    /// Voir [`AppSettings::preferred_dark_theme`].
    pub preferred_dark_theme: Option<String>,
    /// Voir [`AppSettings::preferred_light_theme`].
    pub preferred_light_theme: Option<String>,
    /// Voir [`AppSettings::auto_update`].
    pub auto_update: Option<bool>,
    /// Entrées d'un objet JSON (`None` pour une valeur non textuelle) ; `None` si ce n'est
    /// pas un objet.
    pub app_shortcuts: Option<Vec<(String, Option<String>)>>,
    /// Voir [`AppSettings::formatting_bar_enabled`].
    pub formatting_bar_enabled: Option<bool>,
    /// Voir [`AppSettings::formatting_bar_mode`].
    pub formatting_bar_mode: Option<String>,
    /// Voir [`AppSettings::formatting_bar_style`].
    pub formatting_bar_style: Option<String>,
    /// Voir [`AppSettings::formatting_bar_position`].
    pub formatting_bar_position: Option<String>,
    /// Voir [`AppSettings::show_line_numbers`].
    pub show_line_numbers: Option<bool>,
    /// Voir [`AppSettings::word_wrap`].
    pub word_wrap: Option<bool>,
    /// Voir [`AppSettings::trailing_line`].
    pub trailing_line: Option<bool>,
    /// Voir [`AppSettings::show_outline`].
    pub show_outline: Option<bool>,
    /// Voir [`AppSettings::show_breadcrumbs`].
    pub show_breadcrumbs: Option<bool>,
    /// Voir [`AppSettings::hide_scrollbar`].
    pub hide_scrollbar: Option<bool>,
    /// Voir [`AppSettings::open_in_preview`].
    pub open_in_preview: Option<bool>,
    /// Éléments d'un tableau JSON (`None` pour un élément non textuel) ; `None` si ce n'est
    /// pas un tableau.
    pub collections_exclude: Option<Vec<Option<String>>>,
    /// Voir [`AppSettings::overlay_position`].
    pub overlay_position: RawPosition,
    /// Voir [`AppSettings::mcp_enabled`].
    pub mcp_enabled: Option<bool>,
    /// Voir [`AppSettings::mcp_port`].
    pub mcp_port: Option<f64>,
    /// Voir [`AppSettings::mcp_token`].
    pub mcp_token: Option<String>,
}

impl RawSettings {
    /// Les réglages valides vus comme une entrée : base de la fusion avec un patch.
    pub fn from_settings(settings: &AppSettings) -> Self {
        Self {
            language: Some(settings.language.as_str().to_owned()),
            global_shortcut: Some(settings.global_shortcut.clone()),
            global_shortcut_physical_key: settings.global_shortcut_physical_key.clone(),
            shortcut_mode: Some(settings.shortcut_mode.as_str().to_owned()),
            overlay_width: Some(f64::from(settings.overlay_width)),
            overlay_height: Some(f64::from(settings.overlay_height)),
            enter_to_send: Some(settings.enter_to_send),
            launch_at_startup: Some(settings.launch_at_startup),
            show_menu_bar_icon: Some(settings.show_menu_bar_icon),
            theme: Some(settings.theme.as_str().to_owned()),
            preferred_dark_theme: Some(settings.preferred_dark_theme.as_str().to_owned()),
            preferred_light_theme: Some(settings.preferred_light_theme.as_str().to_owned()),
            auto_update: Some(settings.auto_update),
            app_shortcuts: Some(raw_shortcuts(&settings.app_shortcuts)),
            formatting_bar_enabled: Some(settings.formatting_bar_enabled),
            formatting_bar_mode: Some(settings.formatting_bar_mode.as_str().to_owned()),
            formatting_bar_style: Some(settings.formatting_bar_style.as_str().to_owned()),
            formatting_bar_position: Some(settings.formatting_bar_position.as_str().to_owned()),
            show_line_numbers: Some(settings.show_line_numbers),
            word_wrap: Some(settings.word_wrap),
            trailing_line: Some(settings.trailing_line),
            show_outline: Some(settings.show_outline),
            show_breadcrumbs: Some(settings.show_breadcrumbs),
            hide_scrollbar: Some(settings.hide_scrollbar),
            open_in_preview: Some(settings.open_in_preview),
            collections_exclude: Some(
                settings
                    .collections_exclude
                    .iter()
                    .cloned()
                    .map(Some)
                    .collect(),
            ),
            overlay_position: raw_position(settings),
            mcp_enabled: Some(settings.mcp_enabled),
            mcp_port: Some(f64::from(settings.mcp_port)),
            mcp_token: Some(settings.mcp_token.clone()),
        }
    }

    /// `self` dont chaque champ présent dans `patch` est remplacé (fusion `{...self, ...patch}`).
    /// Exception : un patch qui change le raccourci global sans donner sa touche physique
    /// l'efface (l'ancienne ne correspond plus au nouveau raccourci).
    pub fn overridden_by(self, patch: Self) -> Self {
        let physical_key = if patch.global_shortcut.is_some() {
            patch.global_shortcut_physical_key
        } else {
            patch
                .global_shortcut_physical_key
                .or(self.global_shortcut_physical_key)
        };

        Self {
            language: patch.language.or(self.language),
            global_shortcut: patch.global_shortcut.or(self.global_shortcut),
            global_shortcut_physical_key: physical_key,
            shortcut_mode: patch.shortcut_mode.or(self.shortcut_mode),
            overlay_width: patch.overlay_width.or(self.overlay_width),
            overlay_height: patch.overlay_height.or(self.overlay_height),
            enter_to_send: patch.enter_to_send.or(self.enter_to_send),
            launch_at_startup: patch.launch_at_startup.or(self.launch_at_startup),
            show_menu_bar_icon: patch.show_menu_bar_icon.or(self.show_menu_bar_icon),
            theme: patch.theme.or(self.theme),
            preferred_dark_theme: patch.preferred_dark_theme.or(self.preferred_dark_theme),
            preferred_light_theme: patch.preferred_light_theme.or(self.preferred_light_theme),
            auto_update: patch.auto_update.or(self.auto_update),
            app_shortcuts: patch.app_shortcuts.or(self.app_shortcuts),
            formatting_bar_enabled: patch.formatting_bar_enabled.or(self.formatting_bar_enabled),
            formatting_bar_mode: patch.formatting_bar_mode.or(self.formatting_bar_mode),
            formatting_bar_style: patch.formatting_bar_style.or(self.formatting_bar_style),
            formatting_bar_position: patch
                .formatting_bar_position
                .or(self.formatting_bar_position),
            show_line_numbers: patch.show_line_numbers.or(self.show_line_numbers),
            word_wrap: patch.word_wrap.or(self.word_wrap),
            trailing_line: patch.trailing_line.or(self.trailing_line),
            show_outline: patch.show_outline.or(self.show_outline),
            show_breadcrumbs: patch.show_breadcrumbs.or(self.show_breadcrumbs),
            hide_scrollbar: patch.hide_scrollbar.or(self.hide_scrollbar),
            open_in_preview: patch.open_in_preview.or(self.open_in_preview),
            collections_exclude: patch.collections_exclude.or(self.collections_exclude),
            overlay_position: merge_position(self.overlay_position, patch.overlay_position),
            mcp_enabled: patch.mcp_enabled.or(self.mcp_enabled),
            mcp_port: patch.mcp_port.or(self.mcp_port),
            mcp_token: patch.mcp_token.or(self.mcp_token),
        }
    }
}

fn raw_shortcuts(shortcuts: &[(String, String)]) -> Vec<(String, Option<String>)> {
    shortcuts
        .iter()
        .map(|(id, accelerator)| (id.clone(), Some(accelerator.clone())))
        .collect()
}

fn raw_position(settings: &AppSettings) -> RawPosition {
    match settings.overlay_position {
        Some(position) => RawPosition::At {
            x: f64::from(position.x),
            y: f64::from(position.y),
        },
        None => RawPosition::Invalid,
    }
}

fn merge_position(base: RawPosition, patch: RawPosition) -> RawPosition {
    match patch {
        RawPosition::Absent => base,
        RawPosition::Invalid | RawPosition::At { .. } => patch,
    }
}
