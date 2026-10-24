//! Export des notes vers le disque : noms de fichiers sûrs et chemins dans une archive.

use crate::text::truncate_chars;

text_enum! {
    /// Format d'export.
    pub enum ExportKind {
        /// Note en markdown.
        Markdown => "md",
        /// Note rendue en page HTML autonome.
        Html => "html",
        /// Note rendue en PDF (impression de sa page HTML autonome).
        Pdf => "pdf",
        /// Notes en markdown dans une archive ZIP.
        Zip => "zip",
        /// Notes rendues en PDF dans une archive ZIP.
        PdfZip => "pdf-zip",
    }
}

impl ExportKind {
    /// Extension du fichier écrit (sans point).
    pub const fn extension(self) -> &'static str {
        match self {
            Self::Zip | Self::PdfZip => "zip",
            Self::Markdown | Self::Html | Self::Pdf => self.as_str(),
        }
    }

    /// Extension des fichiers d'une archive (sans point), `None` pour un fichier seul.
    pub const fn entry_extension(self) -> Option<&'static str> {
        match self {
            Self::Zip => Some("md"),
            Self::PdfZip => Some("pdf"),
            Self::Markdown | Self::Html | Self::Pdf => None,
        }
    }
}

/// Une note d'un export de plusieurs notes : son chemin dans l'archive (dossiers puis titre,
/// sans extension, séparés par `/`) et son contenu (markdown, ou page HTML autonome à rendre
/// en PDF).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExportedNote {
    /// Chemin relatif.
    pub path: String,
    /// Markdown ou page HTML, selon le format.
    pub content: String,
}

/// Nom utilisé quand un titre ne laisse rien d'utilisable.
pub const UNTITLED: &str = "Untitled";

const MAX_NAME_LENGTH: usize = 120;
const RESERVED_DEVICES: [&str; 4] = ["con", "prn", "aux", "nul"];
const NUMBERED_DEVICES: [&str; 2] = ["com", "lpt"];

/// Un titre utilisable comme nom de fichier ou de dossier Windows : les caractères interdits
/// deviennent des tirets ; jamais vide (`fallback`) ni réservé (`CON` → `CON-`).
///
/// ```
/// assert_eq!(domain::export::safe_file_name("a/b:c*d?", "Untitled"), "a-b-c-d-");
/// ```
pub fn safe_file_name(name: &str, fallback: &str) -> String {
    let replaced: String = name.chars().map(replace_forbidden).collect();
    let collapsed = replaced.split_whitespace().collect::<Vec<_>>().join(" ");
    let without_trailing = collapsed.trim_end_matches(['.', ' ']);
    let cleaned = truncate_chars(without_trailing, MAX_NAME_LENGTH).trim();

    if cleaned.is_empty() {
        return fallback.to_owned();
    }
    if is_reserved_device(cleaned) {
        return format!("{cleaned}-");
    }
    cleaned.to_owned()
}

fn replace_forbidden(c: char) -> char {
    let forbidden = matches!(c, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*');
    if forbidden || c <= '\u{1f}' { '-' } else { c }
}

/// Noms de périphériques que Windows refuse comme nom de fichier, quelle que soit l'extension.
fn is_reserved_device(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();

    if RESERVED_DEVICES.contains(&lower.as_str()) {
        return true;
    }
    let Some((prefix, digit)) = lower.split_at_checked(3) else {
        return false;
    };
    NUMBERED_DEVICES.contains(&prefix)
        && digit.len() == 1
        && digit.chars().all(|c| c.is_ascii_digit())
}

/// Chemins des notes dans l'archive : chaque segment rendu sûr, l'extension `extension`
/// ajoutée, les doublons (sans tenir compte de la casse) numérotés `Note (2).md`.
pub fn zip_paths(notes: &[ExportedNote], extension: &str) -> Vec<String> {
    let mut used: Vec<String> = Vec::with_capacity(notes.len());

    notes
        .iter()
        .map(|note| {
            let path = unique_zip_path(&safe_segments(&note.path), extension, &used);
            used.push(path.to_lowercase());
            path
        })
        .collect()
}

fn safe_segments(path: &str) -> String {
    path.split('/')
        .map(|segment| safe_file_name(segment, UNTITLED))
        .collect::<Vec<_>>()
        .join("/")
}

fn unique_zip_path(base: &str, extension: &str, used: &[String]) -> String {
    let is_free = |candidate: &str| !used.contains(&candidate.to_lowercase());
    let first = format!("{base}.{extension}");

    if is_free(&first) {
        return first;
    }
    (2..)
        .map(|copy| format!("{base} ({copy}).{extension}"))
        .find(|candidate| is_free(candidate))
        .unwrap_or(first)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn note(path: &str) -> ExportedNote {
        ExportedNote {
            path: path.to_owned(),
            content: String::new(),
        }
    }

    #[test]
    fn replaces_forbidden_characters_and_trims_trailing_dots() {
        assert_eq!(safe_file_name("a/b:c*d?", UNTITLED), "a-b-c-d-");
        assert_eq!(
            safe_file_name("  Notes du jour.  ", UNTITLED),
            "Notes du jour"
        );
        assert_eq!(safe_file_name("tab\there  x", UNTITLED), "tab-here x");
    }

    #[test]
    fn never_returns_an_empty_or_reserved_name() {
        assert_eq!(safe_file_name("   ", UNTITLED), "Untitled");
        assert_eq!(safe_file_name("...", UNTITLED), "Untitled");
        assert_eq!(safe_file_name("CON", UNTITLED), "CON-");
        assert_eq!(safe_file_name("lpt1", UNTITLED), "lpt1-");
        assert_eq!(safe_file_name("com10", UNTITLED), "com10");
    }

    #[test]
    fn cuts_long_names() {
        assert_eq!(
            safe_file_name(&"é".repeat(200), UNTITLED).chars().count(),
            120
        );
    }

    #[test]
    fn adds_the_extension_keeps_folders_and_numbers_duplicates() {
        let paths = zip_paths(
            &[note("Projet/Idées"), note("Projet/idées"), note("a:b")],
            "md",
        );
        assert_eq!(paths, ["Projet/Idées.md", "Projet/idées (2).md", "a-b.md"]);
    }

    #[test]
    fn numbers_every_further_duplicate() {
        let paths = zip_paths(&[note("x"), note("x"), note("X")], "md");
        assert_eq!(paths, ["x.md", "x (2).md", "X (3).md"]);
    }

    #[test]
    fn uses_the_extension_of_the_archive_entries() {
        let paths = zip_paths(&[note("Projet/Plan"), note("projet/plan")], "pdf");
        assert_eq!(paths, ["Projet/Plan.pdf", "projet/plan (2).pdf"]);
    }

    #[test]
    fn exposes_the_extension_of_each_kind() {
        assert_eq!(
            ExportKind::parse("zip").map(ExportKind::extension),
            Some("zip")
        );
        assert_eq!(ExportKind::parse("pdf"), Some(ExportKind::Pdf));
        assert_eq!(ExportKind::Pdf.extension(), "pdf");
        assert_eq!(ExportKind::parse("pdf-zip"), Some(ExportKind::PdfZip));
        assert_eq!(ExportKind::PdfZip.extension(), "zip");
        assert_eq!(ExportKind::PdfZip.entry_extension(), Some("pdf"));
        assert_eq!(ExportKind::Zip.entry_extension(), Some("md"));
        assert_eq!(ExportKind::Html.entry_extension(), None);
        assert_eq!(ExportKind::parse("docx"), None);
    }
}
