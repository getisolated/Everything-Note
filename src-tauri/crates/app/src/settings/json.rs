//! Forme JSON des réglages (clés camelCase), partagée par `settings.json` et les patchs du
//! renderer.

use serde_json::{Map, Value, json};

use domain::settings::{AppSettings, RawPosition, RawSettings};

/// Lecture tolérante : un champ absent ou du mauvais type vaut `None` ; une valeur qui n'est
/// pas un objet ne fournit aucun champ.
pub fn raw_from_json(value: &Value) -> RawSettings {
    let Some(object) = value.as_object() else {
        return RawSettings::default();
    };
    let text = |key: &str| object.get(key).and_then(Value::as_str).map(str::to_owned);
    let number = |key: &str| object.get(key).and_then(Value::as_f64);
    let flag = |key: &str| object.get(key).and_then(Value::as_bool);

    RawSettings {
        language: text("language"),
        global_shortcut: text("globalShortcut"),
        global_shortcut_physical_key: text("globalShortcutPhysicalKey"),
        shortcut_mode: text("shortcutMode"),
        overlay_width: number("overlayWidth"),
        overlay_height: number("overlayHeight"),
        enter_to_send: flag("enterToSend"),
        launch_at_startup: flag("launchAtStartup"),
        show_menu_bar_icon: flag("showMenuBarIcon"),
        theme: text("theme"),
        preferred_dark_theme: text("preferredDarkTheme"),
        preferred_light_theme: text("preferredLightTheme"),
        auto_update: flag("autoUpdate"),
        app_shortcuts: object.get("appShortcuts").and_then(shortcut_entries),
        formatting_bar_enabled: flag("formattingBarEnabled"),
        formatting_bar_mode: text("formattingBarMode"),
        formatting_bar_style: text("formattingBarStyle"),
        formatting_bar_position: text("formattingBarPosition"),
        show_line_numbers: flag("showLineNumbers"),
        word_wrap: flag("wordWrap"),
        trailing_line: flag("trailingLine"),
        show_outline: flag("showOutline"),
        show_breadcrumbs: flag("showBreadcrumbs"),
        hide_scrollbar: flag("hideScrollbar"),
        open_in_preview: flag("openInPreview"),
        collections_exclude: object.get("collectionsExclude").and_then(exclude_items),
        overlay_position: object
            .get("overlayPosition")
            .map_or(RawPosition::Absent, position),
        mcp_enabled: flag("mcpEnabled"),
        mcp_port: number("mcpPort"),
        mcp_token: text("mcpToken"),
    }
}

fn shortcut_entries(value: &Value) -> Option<Vec<(String, Option<String>)>> {
    let entries = value.as_object()?;
    Some(
        entries
            .iter()
            .map(|(id, accelerator)| (id.clone(), accelerator.as_str().map(str::to_owned)))
            .collect(),
    )
}

fn exclude_items(value: &Value) -> Option<Vec<Option<String>>> {
    let items = value.as_array()?;
    Some(
        items
            .iter()
            .map(|item| item.as_str().map(str::to_owned))
            .collect(),
    )
}

fn position(value: &Value) -> RawPosition {
    let coordinate = |key: &str| value.get(key).and_then(Value::as_f64);

    match (coordinate("x"), coordinate("y")) {
        (Some(x), Some(y)) => RawPosition::At { x, y },
        _ => RawPosition::Invalid,
    }
}

/// Forme JSON complète des réglages (celle de `settings.json` et de l'IPC).
pub fn settings_to_json(settings: &AppSettings) -> Value {
    json!({
        "language": settings.language.as_str(),
        "globalShortcut": settings.global_shortcut,
        "globalShortcutPhysicalKey": settings.global_shortcut_physical_key,
        "shortcutMode": settings.shortcut_mode.as_str(),
        "overlayWidth": settings.overlay_width,
        "overlayHeight": settings.overlay_height,
        "enterToSend": settings.enter_to_send,
        "launchAtStartup": settings.launch_at_startup,
        "showMenuBarIcon": settings.show_menu_bar_icon,
        "theme": settings.theme.as_str(),
        "preferredDarkTheme": settings.preferred_dark_theme.as_str(),
        "preferredLightTheme": settings.preferred_light_theme.as_str(),
        "autoUpdate": settings.auto_update,
        "appShortcuts": shortcuts_object(&settings.app_shortcuts),
        "formattingBarEnabled": settings.formatting_bar_enabled,
        "formattingBarMode": settings.formatting_bar_mode.as_str(),
        "formattingBarStyle": settings.formatting_bar_style.as_str(),
        "formattingBarPosition": settings.formatting_bar_position.as_str(),
        "showLineNumbers": settings.show_line_numbers,
        "wordWrap": settings.word_wrap,
        "trailingLine": settings.trailing_line,
        "showOutline": settings.show_outline,
        "showBreadcrumbs": settings.show_breadcrumbs,
        "hideScrollbar": settings.hide_scrollbar,
        "openInPreview": settings.open_in_preview,
        "collectionsExclude": settings.collections_exclude,
        "overlayPosition": settings.overlay_position.map(|p| json!({ "x": p.x, "y": p.y })),
        "mcpEnabled": settings.mcp_enabled,
        "mcpPort": settings.mcp_port,
        "mcpToken": settings.mcp_token,
    })
}

fn shortcuts_object(shortcuts: &[(String, String)]) -> Value {
    let entries = shortcuts
        .iter()
        .map(|(id, accelerator)| (id.clone(), Value::from(accelerator.as_str())));
    Value::Object(entries.collect::<Map<String, Value>>())
}

#[cfg(test)]
mod tests {
    use super::*;
    use domain::settings::sanitize_settings;

    #[test]
    fn round_trips_the_settings() {
        let settings = AppSettings {
            app_shortcuts: vec![("tab.close".to_owned(), "Ctrl+W".to_owned())],
            overlay_position: Some(domain::overlay::Position { x: -10, y: 20 }),
            global_shortcut_physical_key: Some("Digit1".to_owned()),
            word_wrap: false,
            show_menu_bar_icon: false,
            mcp_enabled: true,
            mcp_port: 40000,
            mcp_token: "f".repeat(domain::settings::MCP_TOKEN_LENGTH),
            ..AppSettings::default()
        };

        let raw = raw_from_json(&settings_to_json(&settings));

        assert_eq!(sanitize_settings(&raw, &AppSettings::default()), settings);
    }

    #[test]
    fn reads_nothing_from_a_non_object() {
        assert_eq!(raw_from_json(&json!("nope")), RawSettings::default());
        assert_eq!(raw_from_json(&Value::Null), RawSettings::default());
    }

    #[test]
    fn ignores_fields_of_the_wrong_type() {
        let raw = raw_from_json(&json!({
            "overlayWidth": "500", "wordWrap": 0, "appShortcuts": ["x"], "collectionsExclude": "a",
        }));

        assert_eq!(raw.overlay_width, None);
        assert_eq!(raw.word_wrap, None);
        assert_eq!(raw.app_shortcuts, None);
        assert_eq!(raw.collections_exclude, None);
    }

    #[test]
    fn distinguishes_an_absent_position_from_an_invalid_one() {
        let absent = raw_from_json(&json!({}));
        let null = raw_from_json(&json!({ "overlayPosition": null }));
        let partial = raw_from_json(&json!({ "overlayPosition": { "x": "a", "y": 2 } }));

        assert_eq!(absent.overlay_position, RawPosition::Absent);
        assert_eq!(null.overlay_position, RawPosition::Invalid);
        assert_eq!(partial.overlay_position, RawPosition::Invalid);
    }

    #[test]
    fn keeps_non_text_items_as_missing() {
        let raw =
            raw_from_json(&json!({ "collectionsExclude": ["a", 3], "appShortcuts": { "a": 1 } }));

        assert_eq!(
            raw.collections_exclude,
            Some(vec![Some("a".to_owned()), None])
        );
        assert_eq!(raw.app_shortcuts, Some(vec![("a".to_owned(), None)]));
    }
}
