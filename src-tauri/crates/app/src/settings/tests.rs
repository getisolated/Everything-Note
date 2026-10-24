use std::sync::Arc;

use domain::i18n::Language;
use domain::overlay::Position;
use domain::settings::{AppSettings, RawPosition, RawSettings};
use platform::sync::lock;

use super::SettingsService;
use crate::testing::{CountingSecrets, MemorySettings};

fn service(stored: Option<RawSettings>) -> (Arc<MemorySettings>, SettingsService) {
    service_with(stored, CountingSecrets::default())
}

fn service_with(
    stored: Option<RawSettings>,
    secrets: CountingSecrets,
) -> (Arc<MemorySettings>, SettingsService) {
    let store = Arc::new(MemorySettings {
        stored: std::sync::Mutex::new(stored),
        ..MemorySettings::default()
    });
    (
        store.clone(),
        SettingsService::new(store, Arc::new(secrets)),
    )
}

/// Jeton n° `n` de `CountingSecrets`.
fn token(n: u64) -> String {
    format!("{n:064x}")
}

#[test]
fn generates_the_mcp_token_on_the_first_activation_only() {
    let (_, service) = service(None);
    let enable = RawSettings {
        mcp_enabled: Some(true),
        ..RawSettings::default()
    };

    let enabled = service.candidate(enable.clone());
    assert!(enabled.mcp_enabled);
    assert_eq!(enabled.mcp_token, token(1));

    service.commit(enabled);
    let disabled = service.candidate(RawSettings {
        mcp_enabled: Some(false),
        ..RawSettings::default()
    });
    assert_eq!(disabled.mcp_token, token(1));
    service.commit(disabled);
    assert_eq!(service.candidate(enable).mcp_token, token(1));
}

#[test]
fn never_takes_the_mcp_token_from_the_renderer() {
    let (_, service) = service(None);
    let patch = RawSettings {
        mcp_token: Some("a".repeat(64)),
        ..RawSettings::default()
    };

    assert_eq!(service.candidate(patch).mcp_token, "");
}

#[test]
fn regenerates_and_saves_the_mcp_token() {
    let (store, service) = service(None);
    service.commit(service.candidate(RawSettings {
        mcp_enabled: Some(true),
        ..RawSettings::default()
    }));

    let change = service.regenerate_mcp_token().unwrap();

    assert_eq!(change.before.mcp_token, token(1));
    assert_eq!(change.after.mcp_token, token(2));
    assert!(change.mcp_changed());
    assert_eq!(
        lock(&store.saved).last().map(|s| s.mcp_token.clone()),
        Some(token(2))
    );
}

#[test]
fn keeps_the_mcp_server_off_without_randomness() {
    let (_, service) = service_with(None, CountingSecrets::failing());

    let candidate = service.candidate(RawSettings {
        mcp_enabled: Some(true),
        ..RawSettings::default()
    });

    assert!(!candidate.mcp_enabled && candidate.mcp_token.is_empty());
    assert!(service.regenerate_mcp_token().is_err());
}

#[test]
fn gives_a_token_to_a_server_enabled_by_hand() {
    let (store, service) = service(Some(RawSettings {
        language: Some("en".into()),
        mcp_enabled: Some(true),
        ..RawSettings::default()
    }));

    let loaded = service.load(None);

    assert_eq!(loaded.mcp_token, token(1));
    assert_eq!(
        lock(&store.saved).last().map(|s| s.mcp_token.clone()),
        Some(token(1))
    );
}

#[test]
fn restarts_the_mcp_server_only_when_it_changes() {
    let (_, service) = service(None);

    let port = service.commit(AppSettings {
        mcp_port: 40000,
        ..AppSettings::default()
    });
    let other = service.commit(AppSettings {
        mcp_port: 40000,
        word_wrap: false,
        ..AppSettings::default()
    });

    assert!(port.mcp_changed());
    assert!(!other.mcp_changed());
}

#[test]
fn follows_the_os_locale_on_the_first_launch_and_remembers_it() {
    let (store, service) = service(None);

    assert_eq!(service.load(Some("fr-FR")).language, Language::Fr);
    assert_eq!(
        lock(&store.saved).last().map(|s| s.language),
        Some(Language::Fr)
    );
}

#[test]
fn falls_back_to_english_for_an_untranslated_locale() {
    let (_, service) = service(None);
    assert_eq!(service.load(Some("de-DE")).language, Language::En);
}

#[test]
fn picks_the_locale_for_settings_saved_before_the_language_existed() {
    let (_, service) = service(Some(RawSettings {
        word_wrap: Some(false),
        ..RawSettings::default()
    }));

    let settings = service.load(Some("fr"));

    assert_eq!(settings.language, Language::Fr);
    assert!(!settings.word_wrap);
}

#[test]
fn keeps_the_language_the_user_chose() {
    let (store, service) = service(Some(RawSettings {
        language: Some("en".into()),
        ..RawSettings::default()
    }));

    assert_eq!(service.load(Some("fr")).language, Language::En);
    assert!(lock(&store.saved).is_empty());
}

#[test]
fn a_patch_never_moves_the_overlay() {
    let (_, service) = service(None);
    service.set_overlay_position(Position { x: 5, y: 6 });

    let candidate = service.candidate(RawSettings {
        overlay_position: RawPosition::At { x: 1.0, y: 1.0 },
        word_wrap: Some(false),
        ..RawSettings::default()
    });

    assert_eq!(candidate.overlay_position, Some(Position { x: 5, y: 6 }));
    assert!(!candidate.word_wrap);
}

#[test]
fn a_candidate_is_not_applied_until_committed() {
    let (store, service) = service(None);

    let candidate = service.candidate(RawSettings {
        show_outline: Some(true),
        ..RawSettings::default()
    });
    assert!(!service.current().show_outline);

    let change = service.commit(candidate);
    assert!(service.current().show_outline);
    assert!(!change.before.show_outline && change.after.show_outline);
    assert_eq!(lock(&store.saved).len(), 1);
}

#[test]
fn reports_what_changed() {
    let (_, service) = service(None);
    let next = AppSettings {
        global_shortcut: "Alt+K".into(),
        overlay_width: 300,
        ..AppSettings::default()
    };

    let change = service.commit(next);

    assert!(change.shortcut_changed() && change.overlay_size_changed());
    assert!(!change.language_changed() && !change.collections_exclude_changed());
}

#[test]
fn reports_a_hidden_menu_bar_icon() {
    let (_, service) = service(None);
    let next = AppSettings {
        show_menu_bar_icon: false,
        ..AppSettings::default()
    };

    let change = service.commit(next);

    assert!(change.menu_bar_icon_changed());
    assert!(!change.launch_at_startup_changed() && !change.shortcut_changed());
}

#[test]
fn a_new_physical_key_is_a_shortcut_change() {
    let (_, service) = service(None);
    let next = AppSettings {
        global_shortcut_physical_key: Some("KeyA".into()),
        ..AppSettings::default()
    };

    let change = service.commit(next);

    assert!(change.shortcut_changed());
}
