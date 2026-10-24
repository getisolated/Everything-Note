//! Cas d'usage des réglages : chargement, patchs du renderer, enregistrement.

mod change;
pub mod json;

pub use change::SettingsChange;

use std::sync::{Arc, Mutex};

use domain::i18n::Language;
use domain::overlay::Position;
use domain::settings::{AppSettings, RawPosition, RawSettings, is_mcp_token, sanitize_settings};
use platform::sync::lock;

use crate::ports::{SecretSource, SettingsStore};
use crate::{AppError, AppResult};

/// Réglages courants, toujours valides, et leur persistance.
pub struct SettingsService {
    store: Arc<dyn SettingsStore>,
    secrets: Arc<dyn SecretSource>,
    current: Mutex<AppSettings>,
}

impl SettingsService {
    /// Service branché sur son stockage et sa source de jetons, avec les réglages par
    /// défaut tant que rien n'est chargé.
    pub fn new(store: Arc<dyn SettingsStore>, secrets: Arc<dyn SecretSource>) -> Self {
        Self {
            store,
            secrets,
            current: Mutex::new(AppSettings::default()),
        }
    }

    /// Charge les réglages ; un fichier absent ou illisible donne les défauts. Sans langue
    /// choisie (premier lancement, réglages antérieurs aux langues), la locale de l'OS
    /// décide, et ce choix est enregistré. Un serveur MCP activé sans jeton (fichier modifié
    /// à la main) en reçoit un, enregistré aussi.
    pub fn load(&self, os_locale: Option<&str>) -> AppSettings {
        let raw = self.read_stored();
        let has_language = raw.language.as_deref().and_then(Language::parse).is_some();
        let sanitized = sanitize_settings(&raw, &AppSettings::default());
        let token_missing = sanitized.needs_mcp_token();
        let mut settings = self.with_mcp_token(sanitized);

        *lock(&self.current) = settings.clone();
        if !has_language {
            settings.language = Language::from_locale(os_locale);
        }
        if !has_language || token_missing {
            self.commit(settings.clone());
        }
        settings
    }

    /// Réglages courants.
    pub fn current(&self) -> AppSettings {
        lock(&self.current).clone()
    }

    /// Réglages qui résulteraient du patch du renderer, sans les appliquer. La position de
    /// l'overlay et le jeton MCP appartiennent au processus principal : le renderer ne les
    /// change jamais. Activer le serveur MCP pour la première fois génère son jeton.
    pub fn candidate(&self, mut patch: RawSettings) -> AppSettings {
        let before = self.current();
        patch.overlay_position = RawPosition::Absent;
        patch.mcp_token = None;

        let merged = RawSettings::from_settings(&before).overridden_by(patch);
        self.with_mcp_token(sanitize_settings(&merged, &before))
    }

    /// Remplace le jeton du serveur MCP (les clients configurés avec l'ancien sont refusés)
    /// et l'enregistre ; rend l'avant/après pour redémarrer le serveur.
    pub fn regenerate_mcp_token(&self) -> AppResult<SettingsChange> {
        let next = AppSettings {
            mcp_token: self.new_mcp_token()?,
            ..self.current()
        };
        Ok(self.commit(next))
    }

    /// Applique et enregistre des réglages valides ; rend l'avant/après pour que l'appelant
    /// applique les effets (raccourci, tray, démarrage…). Un échec d'écriture est journalisé
    /// : les réglages restent appliqués pour la session.
    pub fn commit(&self, next: AppSettings) -> SettingsChange {
        let before = std::mem::replace(&mut *lock(&self.current), next.clone());

        if let Err(error) = self.store.save(&next) {
            tracing::error!(%error, "réglages non enregistrés");
        }
        SettingsChange {
            before,
            after: next,
        }
    }

    /// Mémorise la position de l'overlay choisie par l'utilisateur.
    pub fn set_overlay_position(&self, position: Position) -> SettingsChange {
        let next = AppSettings {
            overlay_position: Some(position),
            ..self.current()
        };
        self.commit(next)
    }

    /// Les réglages, avec un jeton si le serveur MCP est activé sans jeton ; sans source de
    /// hasard, le serveur reste éteint plutôt que de tourner sans protection.
    fn with_mcp_token(&self, mut settings: AppSettings) -> AppSettings {
        if settings.needs_mcp_token() {
            match self.new_mcp_token() {
                Ok(token) => settings.mcp_token = token,
                Err(error) => {
                    tracing::error!(%error, "jeton MCP non généré, serveur désactivé");
                    settings.mcp_enabled = false;
                }
            }
        }
        settings
    }

    fn new_mcp_token(&self) -> AppResult<String> {
        let token = self.secrets.new_token()?;

        if token.is_empty() || !is_mcp_token(&token) {
            return Err(AppError::Storage("malformed MCP token".to_owned()));
        }
        Ok(token)
    }

    fn read_stored(&self) -> RawSettings {
        match self.store.load() {
            Ok(stored) => stored.unwrap_or_default(),
            Err(error) => {
                tracing::warn!(%error, "réglages illisibles, valeurs par défaut");
                RawSettings::default()
            }
        }
    }
}

#[cfg(test)]
mod tests;
