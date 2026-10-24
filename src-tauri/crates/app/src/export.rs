//! Cas d'usage de l'export des notes vers le disque.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use domain::export::{ExportKind, ExportedNote, UNTITLED, safe_file_name, zip_paths};

use crate::ports::{ExportWriter, PdfRenderer, ZipEntry};
use crate::{AppError, AppResult, Refusal};

/// Contenu à exporter.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ExportPayload {
    /// Une note : son markdown, ou sa page HTML autonome (HTML et PDF).
    Text(String),
    /// Plusieurs notes, pour une archive : markdown, ou pages HTML à rendre en PDF.
    Notes(Vec<ExportedNote>),
}

/// Avancement d'un export long (archive de PDF) : `done` documents rendus sur `total`.
pub type ExportProgress<'a> = &'a mut dyn FnMut(usize, usize);

/// Export des notes.
pub struct ExportService {
    writer: Arc<dyn ExportWriter>,
    pdf: Arc<dyn PdfRenderer>,
}

impl ExportService {
    /// Service branché sur son écrivain et son rendu PDF.
    pub fn new(writer: Arc<dyn ExportWriter>, pdf: Arc<dyn PdfRenderer>) -> Self {
        Self { writer, pdf }
    }

    /// Nom de fichier proposé pour un export (titre rendu sûr, extension du format).
    pub fn suggested_file_name(kind: ExportKind, title: &str) -> String {
        format!("{}.{}", safe_file_name(title, UNTITLED), kind.extension())
    }

    /// Écrit l'export à l'emplacement choisi par l'utilisateur ; rend ce chemin. Une archive
    /// attend des notes, les autres formats un texte ; `progress` suit le rendu des PDF.
    pub fn save(
        &self,
        kind: ExportKind,
        path: &Path,
        payload: ExportPayload,
        progress: ExportProgress<'_>,
    ) -> AppResult<PathBuf> {
        match (kind, payload) {
            (ExportKind::Markdown | ExportKind::Html, ExportPayload::Text(text)) => {
                self.writer.write_file(path, text.as_bytes())?;
            }
            (ExportKind::Pdf, ExportPayload::Text(html)) => {
                let pdf = self
                    .pdf
                    .render(&[html], &mut |done| progress(done, 1))?
                    .pop()
                    .ok_or_else(|| AppError::file_system("PDF rendering produced no document"))?;
                self.writer.write_file(path, &pdf)?;
            }
            (ExportKind::Zip, ExportPayload::Notes(notes)) => {
                let contents = notes
                    .iter()
                    .map(|note| note.content.clone().into_bytes())
                    .collect();
                self.writer
                    .write_zip(path, &zip_entries(kind, &notes, contents))?;
            }
            (ExportKind::PdfZip, ExportPayload::Notes(notes)) => {
                let pages: Vec<String> = notes.iter().map(|note| note.content.clone()).collect();
                let total = pages.len();
                let pdfs = self.pdf.render(&pages, &mut |done| progress(done, total))?;
                self.writer
                    .write_zip(path, &zip_entries(kind, &notes, pdfs))?;
            }
            (ExportKind::Zip | ExportKind::PdfZip, ExportPayload::Text(_))
            | (
                ExportKind::Markdown | ExportKind::Html | ExportKind::Pdf,
                ExportPayload::Notes(_),
            ) => {
                return Err(Refusal::InvalidExport.into());
            }
        }
        Ok(path.to_path_buf())
    }
}

/// Entrées de l'archive : chemins uniques avec l'extension du format, dans l'ordre des notes.
fn zip_entries(kind: ExportKind, notes: &[ExportedNote], contents: Vec<Vec<u8>>) -> Vec<ZipEntry> {
    let paths = zip_paths(notes, kind.entry_extension().unwrap_or("md"));

    paths
        .into_iter()
        .zip(contents)
        .map(|(path, content)| ZipEntry { path, content })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testing::{FakePdfRenderer, RecordingWriter};

    fn note(path: &str) -> ExportedNote {
        ExportedNote {
            path: path.to_owned(),
            content: format!("# {path}"),
        }
    }

    fn service() -> (ExportService, Arc<RecordingWriter>, Arc<FakePdfRenderer>) {
        let writer = Arc::new(RecordingWriter::default());
        let pdf = Arc::new(FakePdfRenderer::default());
        (ExportService::new(writer.clone(), pdf.clone()), writer, pdf)
    }

    fn no_progress() -> impl FnMut(usize, usize) {
        |_, _| {}
    }

    #[test]
    fn suggests_a_safe_file_name() {
        assert_eq!(
            ExportService::suggested_file_name(ExportKind::Html, "a/b"),
            "a-b.html"
        );
        assert_eq!(
            ExportService::suggested_file_name(ExportKind::Markdown, " "),
            "Untitled.md"
        );
        assert_eq!(
            ExportService::suggested_file_name(ExportKind::Pdf, "Plan"),
            "Plan.pdf"
        );
        assert_eq!(
            ExportService::suggested_file_name(ExportKind::PdfZip, "Projet"),
            "Projet.zip"
        );
    }

    #[test]
    fn writes_a_text_export() {
        let (service, writer, _) = service();

        let written = service.save(
            ExportKind::Markdown,
            Path::new("n.md"),
            ExportPayload::Text("x".into()),
            &mut no_progress(),
        );

        assert_eq!(written.unwrap(), PathBuf::from("n.md"));
        assert_eq!(writer.files(), [(PathBuf::from("n.md"), b"x".to_vec())]);
    }

    #[test]
    fn writes_the_notes_of_a_folder_with_unique_paths() {
        let (service, writer, pdf) = service();
        let notes = vec![note("Projet/Idées"), note("Projet/idées")];

        service
            .save(
                ExportKind::Zip,
                Path::new("d.zip"),
                ExportPayload::Notes(notes),
                &mut no_progress(),
            )
            .unwrap();

        let entries = writer.zip_entries();
        let paths: Vec<&str> = entries.iter().map(|entry| entry.path.as_str()).collect();
        assert_eq!(paths, ["Projet/Idées.md", "Projet/idées (2).md"]);
        assert_eq!(entries[0].content, b"# Projet/Id\xc3\xa9es");
        assert!(pdf.calls().is_empty());
    }

    #[test]
    fn renders_a_note_to_pdf() {
        let (service, writer, pdf) = service();
        let mut steps = Vec::new();

        service
            .save(
                ExportKind::Pdf,
                Path::new("n.pdf"),
                ExportPayload::Text("<p>x</p>".into()),
                &mut |done, total| steps.push((done, total)),
            )
            .unwrap();

        assert_eq!(pdf.calls(), [vec!["<p>x</p>".to_owned()]]);
        assert_eq!(
            writer.files(),
            [(PathBuf::from("n.pdf"), b"%PDF <p>x</p>".to_vec())]
        );
        assert_eq!(steps, [(1, 1)]);
    }

    #[test]
    fn renders_each_note_of_a_pdf_archive_in_order() {
        let (service, writer, pdf) = service();
        let notes = vec![note("Plan"), note("Projet/Plan"), note("plan")];
        let mut steps = Vec::new();

        service
            .save(
                ExportKind::PdfZip,
                Path::new("d.zip"),
                ExportPayload::Notes(notes),
                &mut |done, total| steps.push((done, total)),
            )
            .unwrap();

        assert_eq!(pdf.calls().len(), 1);
        let entries = writer.zip_entries();
        let paths: Vec<&str> = entries.iter().map(|entry| entry.path.as_str()).collect();
        assert_eq!(paths, ["Plan.pdf", "Projet/Plan.pdf", "plan (2).pdf"]);
        assert_eq!(entries[1].content, b"%PDF # Projet/Plan");
        assert_eq!(steps, [(1, 3), (2, 3), (3, 3)]);
    }

    #[test]
    fn writes_nothing_when_the_rendering_fails() {
        let (service, writer, _) = service();
        let notes = vec![
            note("a"),
            ExportedNote {
                path: "b".into(),
                content: "fail".into(),
            },
        ];

        let saved = service.save(
            ExportKind::PdfZip,
            Path::new("d.zip"),
            ExportPayload::Notes(notes),
            &mut no_progress(),
        );

        assert!(matches!(saved, Err(AppError::FileSystem(_))));
        assert!(writer.zip_entries().is_empty());
    }

    #[test]
    fn refuses_a_payload_that_does_not_match_the_format() {
        let (service, _, pdf) = service();
        let refused = |kind: ExportKind, payload: ExportPayload| {
            matches!(
                service.save(kind, Path::new("x"), payload, &mut no_progress()),
                Err(AppError::Refused(Refusal::InvalidExport))
            )
        };

        assert!(refused(ExportKind::Zip, ExportPayload::Text(String::new())));
        assert!(refused(
            ExportKind::PdfZip,
            ExportPayload::Text(String::new())
        ));
        assert!(refused(ExportKind::Html, ExportPayload::Notes(vec![])));
        assert!(refused(ExportKind::Pdf, ExportPayload::Notes(vec![])));
        assert!(pdf.calls().is_empty());
    }
}
