//! Validation des réglages non fiables.

use super::{
    AppSettings, FormattingBarMode, FormattingBarPosition, FormattingBarStyle, MCP_MAX_PORT,
    MCP_MIN_PORT, OVERLAY_MAX_HEIGHT, OVERLAY_MAX_WIDTH, OVERLAY_MIN_HEIGHT, OVERLAY_MIN_WIDTH,
    RawPosition, RawSettings, ShortcutMode, ThemeId, ThemeKind, ThemePreference, is_mcp_token,
};
use crate::i18n::Language;
use crate::overlay::Position;
use crate::text::round_half_up;

const MAX_EXCLUDES: usize = 100;
const MAX_EXCLUDE_LENGTH: usize = 100;
const MAX_APP_SHORTCUTS: usize = 100;
const MAX_SHORTCUT_ID_LENGTH: usize = 64;
const MAX_ACCELERATOR_LENGTH: usize = 64;

/// Réglages complets et valides construits depuis une entrée non fiable : chaque champ
/// absent ou invalide garde la valeur de `base` (les réglages actuels, pas les défauts).
pub fn sanitize_settings(raw: &RawSettings, base: &AppSettings) -> AppSettings {
    let mut settings = base.clone();

    apply_general(raw, &mut settings);
    apply_overlay(raw, &mut settings);
    apply_appearance(raw, &mut settings);
    apply_editor(raw, &mut settings);
    apply_mcp(raw, &mut settings);
    settings
}

fn apply_general(raw: &RawSettings, settings: &mut AppSettings) {
    settings.language = parsed(&raw.language, Language::parse, settings.language);
    // Le raccourci et sa touche physique vont ensemble : un raccourci invalide garde la paire
    if let Some(shortcut) = global_shortcut(&raw.global_shortcut) {
        settings.global_shortcut = shortcut;
        settings.global_shortcut_physical_key = raw
            .global_shortcut_physical_key
            .as_deref()
            .filter(|code| is_physical_key(code))
            .map(str::to_owned);
    }
    settings.shortcut_mode = parsed(
        &raw.shortcut_mode,
        ShortcutMode::parse,
        settings.shortcut_mode,
    );
    settings.launch_at_startup = raw.launch_at_startup.unwrap_or(settings.launch_at_startup);
    settings.show_menu_bar_icon = raw
        .show_menu_bar_icon
        .unwrap_or(settings.show_menu_bar_icon);
    settings.auto_update = raw.auto_update.unwrap_or(settings.auto_update);
    settings.app_shortcuts = app_shortcuts(raw.app_shortcuts.as_deref(), &settings.app_shortcuts);
    settings.collections_exclude = excludes(
        raw.collections_exclude.as_deref(),
        &settings.collections_exclude,
    );
}

fn apply_overlay(raw: &RawSettings, settings: &mut AppSettings) {
    let (min_width, max_width) = (OVERLAY_MIN_WIDTH, OVERLAY_MAX_WIDTH);
    let (min_height, max_height) = (OVERLAY_MIN_HEIGHT, OVERLAY_MAX_HEIGHT);

    settings.overlay_width = clamp_size(
        raw.overlay_width,
        min_width,
        max_width,
        settings.overlay_width,
    );
    settings.overlay_height = clamp_size(
        raw.overlay_height,
        min_height,
        max_height,
        settings.overlay_height,
    );
    settings.enter_to_send = raw.enter_to_send.unwrap_or(settings.enter_to_send);
    settings.overlay_position = position(raw.overlay_position, settings.overlay_position);
}

fn apply_appearance(raw: &RawSettings, settings: &mut AppSettings) {
    let (dark, light) = (ThemeKind::Dark, ThemeKind::Light);

    settings.theme = parsed(&raw.theme, ThemePreference::parse, settings.theme);
    settings.preferred_dark_theme = theme_of_kind(
        &raw.preferred_dark_theme,
        dark,
        settings.preferred_dark_theme,
    );
    settings.preferred_light_theme = theme_of_kind(
        &raw.preferred_light_theme,
        light,
        settings.preferred_light_theme,
    );
}

fn apply_editor(raw: &RawSettings, settings: &mut AppSettings) {
    let bar = (settings.formatting_bar_mode, settings.formatting_bar_style);

    settings.formatting_bar_enabled = raw
        .formatting_bar_enabled
        .unwrap_or(settings.formatting_bar_enabled);
    settings.formatting_bar_mode =
        parsed(&raw.formatting_bar_mode, FormattingBarMode::parse, bar.0);
    settings.formatting_bar_style =
        parsed(&raw.formatting_bar_style, FormattingBarStyle::parse, bar.1);
    settings.formatting_bar_position = parsed(
        &raw.formatting_bar_position,
        FormattingBarPosition::parse,
        settings.formatting_bar_position,
    );
    settings.show_line_numbers = raw.show_line_numbers.unwrap_or(settings.show_line_numbers);
    settings.word_wrap = raw.word_wrap.unwrap_or(settings.word_wrap);
    settings.trailing_line = raw.trailing_line.unwrap_or(settings.trailing_line);
    settings.show_outline = raw.show_outline.unwrap_or(settings.show_outline);
    settings.show_breadcrumbs = raw.show_breadcrumbs.unwrap_or(settings.show_breadcrumbs);
    settings.hide_scrollbar = raw.hide_scrollbar.unwrap_or(settings.hide_scrollbar);
    settings.open_in_preview = raw.open_in_preview.unwrap_or(settings.open_in_preview);
}

fn apply_mcp(raw: &RawSettings, settings: &mut AppSettings) {
    let (min, max) = (u32::from(MCP_MIN_PORT), u32::from(MCP_MAX_PORT));

    settings.mcp_enabled = raw.mcp_enabled.unwrap_or(settings.mcp_enabled);
    // Borné à [MCP_MIN_PORT, MCP_MAX_PORT] : la conversion en u16 ne peut pas échouer
    let port = clamp_size(raw.mcp_port, min, max, u32::from(settings.mcp_port));
    settings.mcp_port = u16::try_from(port).unwrap_or(settings.mcp_port);
    if let Some(token) = raw.mcp_token.as_deref().filter(|token| is_mcp_token(token)) {
        settings.mcp_token = token.to_owned();
    }
}

fn parsed<T: Copy>(value: &Option<String>, parse: impl Fn(&str) -> Option<T>, fallback: T) -> T {
    value.as_deref().and_then(parse).unwrap_or(fallback)
}

/// Raccourci global sans espaces autour ; `None` s'il est absent ou vide.
fn global_shortcut(value: &Option<String>) -> Option<String> {
    let trimmed = value.as_deref().map(str::trim).unwrap_or_default();
    (!trimmed.is_empty()).then(|| trimmed.to_owned())
}

/// `^Key[A-Z]$|^Digit[0-9]$` : les seuls codes de touche enregistrés pour le raccourci global.
fn is_physical_key(code: &str) -> bool {
    match code.as_bytes() {
        [b'K', b'e', b'y', letter] => letter.is_ascii_uppercase(),
        [b'D', b'i', b'g', b'i', b't', digit] => digit.is_ascii_digit(),
        _ => false,
    }
}

/// Un thème de la famille attendue : un thème clair ne peut pas être le sombre de `system`.
fn theme_of_kind(value: &Option<String>, kind: ThemeKind, fallback: ThemeId) -> ThemeId {
    let theme = value.as_deref().and_then(ThemeId::parse);
    theme
        .filter(|theme| theme.kind() == kind)
        .unwrap_or(fallback)
}

fn clamp_size(value: Option<f64>, min: u32, max: u32, fallback: u32) -> u32 {
    let Some(number) = value.filter(|number| number.is_finite()) else {
        return fallback;
    };
    let clamped = round_half_up(number).clamp(f64::from(min), f64::from(max));
    // Borné à [min, max] juste au-dessus : la conversion est exacte
    clamped as u32
}

fn app_shortcuts(
    value: Option<&[(String, Option<String>)]>,
    fallback: &[(String, String)],
) -> Vec<(String, String)> {
    let Some(entries) = value else {
        return fallback.to_vec();
    };
    entries
        .iter()
        .take(MAX_APP_SHORTCUTS)
        .filter_map(|(id, accelerator)| valid_shortcut(id, accelerator.as_deref()?))
        .collect()
}

fn valid_shortcut(id: &str, accelerator: &str) -> Option<(String, String)> {
    let trimmed = accelerator.trim();
    let valid_accelerator =
        !trimmed.is_empty() && accelerator.chars().count() <= MAX_ACCELERATOR_LENGTH;

    (is_shortcut_id(id) && valid_accelerator).then(|| (id.to_owned(), trimmed.to_owned()))
}

/// `^[a-z0-9.-]{1,64}$` : les ids définis par le renderer (`note.new`, `tab.close`…).
fn is_shortcut_id(id: &str) -> bool {
    let allowed = |c: char| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '.' || c == '-';
    (1..=MAX_SHORTCUT_ID_LENGTH).contains(&id.len()) && id.chars().all(allowed)
}

fn excludes(value: Option<&[Option<String>]>, fallback: &[String]) -> Vec<String> {
    let Some(items) = value else {
        return fallback.to_vec();
    };
    let mut names: Vec<String> = Vec::new();

    for name in items.iter().flatten().map(|name| name.trim()) {
        let valid = !name.is_empty()
            && name.chars().count() <= MAX_EXCLUDE_LENGTH
            && !name.contains(['/', '\\']);

        if valid && !names.iter().any(|kept| kept == name) {
            names.push(name.to_owned());
        }
    }
    names.truncate(MAX_EXCLUDES);
    names
}

fn position(value: RawPosition, fallback: Option<Position>) -> Option<Position> {
    match value {
        RawPosition::Absent => fallback,
        RawPosition::Invalid => None,
        RawPosition::At { x, y } => Some(Position {
            x: coordinate(x)?,
            y: coordinate(y)?,
        }),
    }
}

fn coordinate(value: f64) -> Option<i32> {
    let rounded = round_half_up(value);
    let in_range =
        value.is_finite() && (f64::from(i32::MIN)..=f64::from(i32::MAX)).contains(&rounded);
    // Fini et dans les bornes d'i32 juste au-dessus : la conversion est exacte
    in_range.then_some(rounded as i32)
}
