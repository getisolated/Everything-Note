//! Commande d'export.

use app::AppError;
use domain::export::ExportKind;
use domain::i18n::{MessageKey, message};
use presentation::dto::ExportProgressDto;
use presentation::events::EXPORT_PROGRESS;
use presentation::{IpcError, IpcResult, export};
use tauri::{AppHandle, Manager, WebviewWindow};
use tauri_plugin_dialog::DialogExt;

use crate::events::emit_to;
use crate::state::desktop;

/// Demande où enregistrer, puis écrit l'export ; rend le chemin écrit, `null` si annulé.
/// Le rendu des PDF (long, il attend la fenêtre d'impression) se fait hors des threads de
/// l'IPC ; son avancement est envoyé à la fenêtre appelante (`export:progress`).
#[tauri::command]
pub async fn export_save(
    app: AppHandle,
    window: WebviewWindow,
    kind: String,
    suggested_name: String,
    payload: serde_json::Value,
) -> IpcResult<Option<String>> {
    let kind = export::kind(&kind)?;
    let payload = export::payload(kind, payload)?;
    let Some(path) = ask_destination(&app, &window, kind, &suggested_name) else {
        return Ok(None);
    };
    let label = window.label().to_owned();

    tauri::async_runtime::spawn_blocking(move || {
        let mut progress = |index, total| {
            emit_to(
                &app,
                &label,
                EXPORT_PROGRESS,
                ExportProgressDto { index, total },
            );
        };
        export::save(
            &desktop(&app).services.export,
            kind,
            &path,
            payload,
            &mut progress,
        )
        .map(Some)
    })
    .await
    .map_err(|error| IpcError::from(AppError::file_system(error)))?
}

fn ask_destination(
    app: &AppHandle,
    window: &WebviewWindow,
    kind: ExportKind,
    title: &str,
) -> Option<std::path::PathBuf> {
    let language = desktop(app).services.settings.current().language;
    let filter = match kind {
        ExportKind::Markdown => MessageKey::FilterMarkdown,
        ExportKind::Html => MessageKey::FilterHtml,
        ExportKind::Pdf => MessageKey::FilterPdf,
        ExportKind::Zip | ExportKind::PdfZip => MessageKey::FilterZip,
    };
    let mut dialog = app
        .dialog()
        .file()
        .set_parent(window)
        .set_file_name(export::suggested_file_name(kind, title))
        .add_filter(message(language, filter), &[kind.extension()]);
    if let Ok(documents) = app.path().document_dir() {
        dialog = dialog.set_directory(documents);
    }
    dialog.blocking_save_file()?.into_path().ok()
}
