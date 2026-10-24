//! Commandes d'export.

use std::path::Path;

use app::Refusal;
use app::export::{ExportPayload, ExportProgress, ExportService};
use domain::export::ExportKind;

use crate::IpcResult;
use crate::dto::ExportedNoteDto;

/// Format d'export demandé, refusé s'il est inconnu.
pub fn kind(value: &str) -> IpcResult<ExportKind> {
    ExportKind::parse(value).ok_or_else(|| Refusal::InvalidExport.into())
}

/// Nom de fichier proposé dans le dialogue d'enregistrement.
pub fn suggested_file_name(kind: ExportKind, title: &str) -> String {
    ExportService::suggested_file_name(kind, title)
}

/// Contenu de l'export (JSON non fiable) : une liste de notes pour une archive, un texte sinon.
pub fn payload(kind: ExportKind, value: serde_json::Value) -> IpcResult<ExportPayload> {
    let payload = match kind {
        ExportKind::Zip | ExportKind::PdfZip => {
            serde_json::from_value::<Vec<ExportedNoteDto>>(value)
                .map(|notes| ExportPayload::Notes(notes.into_iter().map(Into::into).collect()))
        }
        ExportKind::Markdown | ExportKind::Html | ExportKind::Pdf => {
            serde_json::from_value::<String>(value).map(ExportPayload::Text)
        }
    };
    payload.map_err(|_| Refusal::InvalidExport.into())
}

/// Écrit l'export ; rend le chemin écrit. `progress` suit le rendu des PDF.
pub fn save(
    export: &ExportService,
    kind: ExportKind,
    path: &Path,
    payload: ExportPayload,
    progress: ExportProgress<'_>,
) -> IpcResult<String> {
    Ok(export
        .save(kind, path, payload, progress)?
        .to_string_lossy()
        .into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn reads_the_payload_of_each_format() {
        let notes = payload(ExportKind::Zip, json!([{ "path": "a", "content": "x" }])).unwrap();
        let pages = payload(
            ExportKind::PdfZip,
            json!([{ "path": "a", "content": "<p>x</p>" }]),
        )
        .unwrap();
        let text = payload(ExportKind::Html, json!("<p>x</p>")).unwrap();
        let pdf = payload(ExportKind::Pdf, json!("<p>x</p>")).unwrap();

        assert!(matches!(notes, ExportPayload::Notes(list) if list.len() == 1));
        assert!(matches!(pages, ExportPayload::Notes(list) if list.len() == 1));
        assert_eq!(text, ExportPayload::Text("<p>x</p>".into()));
        assert_eq!(pdf, ExportPayload::Text("<p>x</p>".into()));
    }

    #[test]
    fn reads_the_pdf_formats() {
        assert_eq!(kind("pdf").unwrap(), ExportKind::Pdf);
        assert_eq!(kind("pdf-zip").unwrap(), ExportKind::PdfZip);
    }

    #[test]
    fn refuses_malformed_requests() {
        assert!(kind("docx").is_err());
        assert!(payload(ExportKind::Zip, json!("text")).is_err());
        assert!(payload(ExportKind::PdfZip, json!("<p>x</p>")).is_err());
        assert!(payload(ExportKind::Pdf, json!([])).is_err());
        assert!(payload(ExportKind::Markdown, json!([1])).is_err());
    }
}
