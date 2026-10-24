//! État partagé de l'application, géré par Tauri (`app.state::<DesktopState>()`).

use std::sync::atomic::{AtomicBool, Ordering};

use presentation::Services;
use tauri::{AppHandle, Manager};

use crate::mcp::McpState;
use crate::shortcut::ShortcutState;
use crate::updater::UpdateState;
use crate::windows::overlay::OverlayState;

/// Services et état des fenêtres.
pub struct DesktopState {
    /// Cas d'usage.
    pub services: Services,
    /// Fermer la fenêtre la cache dans le tray ; seul un vrai « Quitter » ferme l'app.
    quitting: AtomicBool,
    /// Les fichiers passés au lancement ne s'ouvrent qu'au premier chargement de la fenêtre.
    launch_files_opened: AtomicBool,
    /// Overlay de note rapide.
    pub overlay: OverlayState,
    /// Raccourci global enregistré.
    pub shortcut: ShortcutState,
    /// Mise à jour trouvée / téléchargée.
    pub updates: UpdateState,
    /// Serveur MCP.
    pub mcp: McpState,
}

impl DesktopState {
    /// État initial.
    pub fn new(services: Services) -> Self {
        Self {
            services,
            quitting: AtomicBool::new(false),
            launch_files_opened: AtomicBool::new(false),
            overlay: OverlayState::default(),
            shortcut: ShortcutState::default(),
            updates: UpdateState::default(),
            mcp: McpState::default(),
        }
    }

    /// L'application est en train de quitter.
    pub fn is_quitting(&self) -> bool {
        self.quitting.load(Ordering::Relaxed)
    }

    /// Marque l'application comme quittant : les fenêtres se ferment vraiment.
    pub fn set_quitting(&self) {
        self.quitting.store(true, Ordering::Relaxed);
    }

    /// `true` la première fois seulement.
    pub fn take_launch_files(&self) -> bool {
        !self.launch_files_opened.swap(true, Ordering::Relaxed)
    }
}

/// L'état de l'application (géré dès `setup`).
pub fn desktop(app: &AppHandle) -> tauri::State<'_, DesktopState> {
    app.state::<DesktopState>()
}
