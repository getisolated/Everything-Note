//! Écriture des exports.

use std::io::Write;
use std::path::Path;

use app::ports::{ExportWriter, ZipEntry};
use app::{AppError, AppResult};
use zip::CompressionMethod;
use zip::write::{SimpleFileOptions, ZipWriter};

/// Exports écrits sur le disque.
#[derive(Debug, Default)]
pub struct DiskExportWriter;

impl ExportWriter for DiskExportWriter {
    fn write_file(&self, path: &Path, content: &[u8]) -> AppResult<()> {
        std::fs::write(path, content).map_err(AppError::file_system)
    }

    fn write_zip(&self, path: &Path, entries: &[ZipEntry]) -> AppResult<()> {
        let file = std::fs::File::create(path).map_err(AppError::file_system)?;
        let mut archive = ZipWriter::new(file);
        let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);

        for entry in entries {
            archive
                .start_file(entry.path.as_str(), options)
                .map_err(AppError::file_system)?;
            archive
                .write_all(&entry.content)
                .map_err(AppError::file_system)?;
        }
        archive.finish().map_err(AppError::file_system)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use std::io::Read;

    use super::*;

    #[test]
    fn writes_entries_that_read_back() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("export.zip");
        let entries = [
            ZipEntry {
                path: "Dossier/Été.md".into(),
                content: "# Été\n\nContenu".into(),
            },
            ZipEntry {
                path: "b.pdf".into(),
                content: vec![0x25, 0x50, 0x44, 0x46, 0xff, 0x00],
            },
        ];

        DiskExportWriter.write_zip(&path, &entries).unwrap();

        let mut archive = zip::ZipArchive::new(std::fs::File::open(&path).unwrap()).unwrap();
        assert_eq!(archive.len(), 2);
        let mut text = String::new();
        archive
            .by_name("Dossier/Été.md")
            .unwrap()
            .read_to_string(&mut text)
            .unwrap();
        assert_eq!(text, "# Été\n\nContenu");
        let mut bytes = Vec::new();
        archive
            .by_name("b.pdf")
            .unwrap()
            .read_to_end(&mut bytes)
            .unwrap();
        assert_eq!(bytes, [0x25, 0x50, 0x44, 0x46, 0xff, 0x00]);
    }

    #[test]
    fn writes_a_file_as_is() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("note.pdf");

        DiskExportWriter.write_file(&path, b"%PDF-1.4").unwrap();

        assert_eq!(std::fs::read(&path).unwrap(), b"%PDF-1.4");
    }
}
