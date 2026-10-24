//! Windows : `ICoreWebView2_7::PrintToPdf` de WebView2, avec des réglages A4, sans en-tête ni
//! pied de page, fonds imprimés (blocs de code, lignes de tableau).

use std::path::Path;
use std::sync::{Arc, Mutex};

use platform::sync::lock;
use tauri::webview::PlatformWebview;
use webview2_com::Microsoft::Web::WebView2::Win32::{
    ICoreWebView2_7, ICoreWebView2Environment6, ICoreWebView2PrintSettings,
};
use webview2_com::PrintToPdfCompletedHandler;
use windows_core::{HSTRING, Interface};

use crate::PrintDone;
use crate::page::{HEIGHT_MM, MARGIN_MM, WIDTH_MM};

const MM_PER_INCH: f64 = 25.4;

/// La suite, partagée entre le gestionnaire de WebView2 et l'échec au lancement : appelée une
/// seule fois.
type SharedDone = Arc<Mutex<Option<PrintDone>>>;

/// Lance l'impression ; appelé sur le thread de l'interface (`with_webview`), celui de
/// WebView2. `on_done` est appelé par WebView2 à la fin, sur ce même thread.
pub fn print(platform: &PlatformWebview, target: &Path, on_done: PrintDone) {
    let done: SharedDone = Arc::new(Mutex::new(Some(on_done)));

    if let Err(error) = start(platform, target, done.clone()) {
        finish(&done, Err(error.message()));
    }
}

fn finish(done: &SharedDone, result: Result<(), String>) {
    let on_done = lock(done).take();

    if let Some(on_done) = on_done {
        on_done(result);
    }
}

fn start(platform: &PlatformWebview, target: &Path, done: SharedDone) -> windows_core::Result<()> {
    let path = HSTRING::from(target.as_os_str());
    let settings = print_settings(platform)?;
    let handler = PrintToPdfCompletedHandler::create(Box::new(move |result, success| {
        finish(
            &done,
            match result {
                Ok(()) if success => Ok(()),
                Ok(()) => Err("the system could not print the note".into()),
                Err(error) => Err(error.message()),
            },
        );
        Ok(())
    }));

    // SAFETY: appels COM de WebView2 sur le thread de l'interface, où vit le contrôleur que
    // Tauri fournit ; les interfaces obtenues sont comptées (`Interface`) et le gestionnaire
    // reste vivant tant que WebView2 en tient une référence.
    unsafe {
        let webview = platform
            .controller()
            .CoreWebView2()?
            .cast::<ICoreWebView2_7>()?;
        webview.PrintToPdf(&path, &settings, &handler)
    }
}

/// A4, marges du CSS `@page`, fonds imprimés, sans en-tête ni pied de page (en pouces).
fn print_settings(platform: &PlatformWebview) -> windows_core::Result<ICoreWebView2PrintSettings> {
    let margin = MARGIN_MM / MM_PER_INCH;

    // SAFETY: appels COM sur le thread de l'interface, sur l'environnement de Tauri et les
    // réglages qu'il vient de créer.
    unsafe {
        let settings = platform
            .environment()
            .cast::<ICoreWebView2Environment6>()?
            .CreatePrintSettings()?;
        settings.SetPageWidth(WIDTH_MM / MM_PER_INCH)?;
        settings.SetPageHeight(HEIGHT_MM / MM_PER_INCH)?;
        settings.SetMarginTop(margin)?;
        settings.SetMarginBottom(margin)?;
        settings.SetMarginLeft(margin)?;
        settings.SetMarginRight(margin)?;
        settings.SetShouldPrintBackgrounds(true)?;
        settings.SetShouldPrintHeaderAndFooter(false)?;
        Ok(settings)
    }
}
