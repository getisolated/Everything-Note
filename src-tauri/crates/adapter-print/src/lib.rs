//! Impression native en PDF : une page HTML autonome est chargée dans une fenêtre cachée,
//! puis imprimée par le moteur du système (WKWebView sur macOS, WebView2 sous Windows), avec
//! le même rendu que l'export HTML (tableaux, code coloré, diagrammes).
//!
//! Seuls `macos.rs` et `windows.rs` appellent ces API natives (`unsafe`) ; le reste du crate,
//! comme tout le workspace, s'en passe.

#[cfg(target_os = "macos")]
#[allow(unsafe_code)]
mod macos;
mod renderer;
#[cfg(windows)]
#[allow(unsafe_code)]
mod windows;

use std::path::Path;

use tauri::WebviewWindow;

pub use renderer::WebviewPdfRenderer;

/// Fin d'une impression : `Ok` quand le PDF est écrit, un message lisible sinon.
pub type PrintDone = Box<dyn FnOnce(Result<(), String>) + Send>;

/// Imprime la page chargée dans `webview` vers le fichier PDF `target` (format A4, fond
/// imprimé). Le travail se fait sur le thread principal ; `on_done` reçoit le résultat, une
/// fois le fichier écrit. Une erreur rendue ici signifie que l'impression n'a pas commencé
/// (`on_done` n'est alors jamais appelé).
pub fn print_to_pdf(
    webview: &WebviewWindow,
    target: &Path,
    on_done: PrintDone,
) -> Result<(), String> {
    let target = target.to_path_buf();

    webview
        .with_webview(move |platform| print_native(platform, &target, on_done))
        .map_err(|error| error.to_string())
}

#[cfg(target_os = "macos")]
fn print_native(platform: tauri::webview::PlatformWebview, target: &Path, on_done: PrintDone) {
    macos::print(&platform, target, on_done);
}

#[cfg(windows)]
fn print_native(platform: tauri::webview::PlatformWebview, target: &Path, on_done: PrintDone) {
    windows::print(&platform, target, on_done);
}

#[cfg(not(any(target_os = "macos", windows)))]
fn print_native(_platform: tauri::webview::PlatformWebview, _target: &Path, on_done: PrintDone) {
    on_done(Err("PDF export is not available on this system".into()));
}

/// Format A4 en millimètres et marges des pages imprimées (celles du CSS `@page` de la page).
mod page {
    /// Largeur A4.
    #[cfg_attr(not(any(target_os = "macos", windows)), allow(dead_code))]
    pub const WIDTH_MM: f64 = 210.0;
    /// Hauteur A4.
    #[cfg_attr(not(any(target_os = "macos", windows)), allow(dead_code))]
    pub const HEIGHT_MM: f64 = 297.0;
    /// Marges sur les quatre côtés.
    #[cfg_attr(not(any(target_os = "macos", windows)), allow(dead_code))]
    pub const MARGIN_MM: f64 = 18.0;
}
