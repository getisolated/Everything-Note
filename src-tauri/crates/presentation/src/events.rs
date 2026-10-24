//! Noms des événements poussés vers les fenêtres (les mêmes qu'avec Electron).

/// Une autre fenêtre a modifié les notes : relire la liste.
pub const NOTES_CHANGED: &str = "notes:changed";
/// Les réglages ont changé (charge utile : `SettingsDto`).
pub const SETTINGS_CHANGED: &str = "settings:changed";
/// Ouvrir les réglages (menu du tray).
pub const OPEN_SETTINGS: &str = "settings:open";
/// L'overlay vient d'être montré.
pub const OVERLAY_SHOWN: &str = "overlay:shown";
/// Événement des collections (charge utile : `CollectionEventDto`).
pub const COLLECTIONS_EVENT: &str = "collections:event";
/// Fichiers à ouvrir dans des onglets (charge utile : `CollectionFileRefDto[]`).
pub const COLLECTIONS_OPEN: &str = "collections:open";
/// Mise à jour disponible (charge utile : `UpdateInfoDto`).
pub const UPDATE_AVAILABLE: &str = "update:available";
/// Avancement du téléchargement (charge utile : `UpdateProgressDto`).
pub const UPDATE_PROGRESS: &str = "update:progress";
/// Installeur téléchargé et vérifié (charge utile : `UpdateInfoDto`).
pub const UPDATE_DOWNLOADED: &str = "update:downloaded";
/// État du serveur MCP changé (charge utile : `McpStatusDto`).
pub const MCP_STATUS: &str = "mcp:status";
/// Échec du téléchargement (charge utile : message).
pub const UPDATE_DOWNLOAD_FAILED: &str = "update:download-failed";
/// Avancement d'un export en PDF (charge utile : `ExportProgressDto`).
pub const EXPORT_PROGRESS: &str = "export:progress";
