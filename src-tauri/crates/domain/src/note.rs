//! Notes stockées dans la base.

/// Une note telle que stockée.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Note {
    /// Identifiant attribué par la base.
    pub id: i64,
    /// Titre (première ligne, extraite par le renderer).
    pub title: String,
    /// Texte markdown complet.
    pub content: String,
    /// Tags encodés en tableau JSON, tels que stockés (le renderer les décode).
    pub tags: String,
    /// Dossier de la note, `None` à la racine.
    pub folder_id: Option<i64>,
    /// Position choisie par l'utilisateur dans son dossier, `None` si jamais positionnée.
    pub sort_order: Option<i64>,
    /// Couleur `#rrggbb` de la sidebar, `None` sans couleur.
    pub color: Option<String>,
    /// Date de création (`YYYY-MM-DD HH:MM:SS`, UTC, format SQLite).
    pub created_at: String,
    /// Date de dernière modification du contenu, même format.
    pub updated_at: String,
}

/// Une note à créer.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewNote {
    /// Titre.
    pub title: String,
    /// Texte markdown.
    pub content: String,
    /// Tags.
    pub tags: Vec<String>,
    /// Dossier demandé ; un dossier inexistant place la note à la racine.
    pub folder_id: Option<i64>,
}

/// Champs modifiés d'une note ; `None` laisse le champ tel quel.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct NoteChanges {
    /// Nouveau titre.
    pub title: Option<String>,
    /// Nouveau contenu.
    pub content: Option<String>,
    /// Nouveaux tags, déjà encodés en tableau JSON.
    pub tags: Option<String>,
}

impl NoteChanges {
    /// Aucun champ à modifier : la note est rendue telle quelle, sans toucher `updated_at`.
    pub fn is_empty(&self) -> bool {
        self.title.is_none() && self.content.is_none() && self.tags.is_none()
    }
}

/// Titre d'une note : sa première ligne de vrai contenu (lignes vides et commentaires HTML
/// ignorés, comme les marqueurs de brouillon), sans les `#` d'un titre markdown ; vide s'il
/// n'y en a pas. Même règle que `extractNoteTitle` côté renderer.
///
/// ```
/// assert_eq!(domain::note::extract_title("\n# Courses\n- pain"), "Courses");
/// ```
pub fn extract_title(content: &str) -> String {
    let visible = strip_html_comments(content);
    let first_line = visible
        .split('\n')
        .find(|line| !line.trim().is_empty())
        .unwrap_or_default();

    first_line.trim_start_matches('#').trim().to_owned()
}

/// Contenu d'une note créée avec un titre explicite. Le titre d'une note étant sa première
/// ligne, un titre que le contenu ne porte pas déjà y est ajouté en tête (`# titre`) : la
/// note garde ce titre quand elle est modifiée dans l'éditeur.
///
/// ```
/// assert_eq!(domain::note::content_with_title("Idées", "- une"), "# Idées\n\n- une");
/// assert_eq!(domain::note::content_with_title("Idées", "# Idées\n- une"), "# Idées\n- une");
/// ```
pub fn content_with_title(title: &str, content: &str) -> String {
    let title = extract_title(title);

    if title.is_empty() || extract_title(content) == title {
        content.to_owned()
    } else if content.trim().is_empty() {
        format!("# {title}\n")
    } else {
        format!("# {title}\n\n{content}")
    }
}

/// `text` ajouté à la fin du contenu, séparé par une ligne vide ; une note vide devient `text`.
///
/// ```
/// assert_eq!(domain::note::append_text("a\n", "b"), "a\n\nb");
/// ```
pub fn append_text(content: &str, text: &str) -> String {
    let kept = content.trim_end_matches(['\n', '\r']);

    if kept.trim().is_empty() {
        text.to_owned()
    } else {
        format!("{kept}\n\n{text}")
    }
}

/// Le texte sans ses commentaires HTML ; un commentaire non fermé court jusqu'à la fin.
fn strip_html_comments(content: &str) -> String {
    let mut visible = String::with_capacity(content.len());
    let mut rest = content;

    while let Some(start) = rest.find("<!--") {
        visible.push_str(&rest[..start]);
        let comment = &rest[start + "<!--".len()..];
        match comment.find("-->") {
            Some(end) => rest = &comment[end + "-->".len()..],
            None => return visible,
        }
    }
    visible.push_str(rest);
    visible
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_the_title_like_the_renderer() {
        assert_eq!(extract_title("My Note\nSome content"), "My Note");
        assert_eq!(extract_title("## Sub Heading"), "Sub Heading");
        assert_eq!(extract_title("###### H6 Title"), "H6 Title");
        assert_eq!(extract_title("#  Spaced  "), "Spaced");
        assert_eq!(extract_title("Line 1\n# Line 2"), "Line 1");
        assert_eq!(extract_title("  # Not a heading"), "# Not a heading");
    }

    #[test]
    fn has_no_title_without_real_content() {
        assert_eq!(extract_title(""), "");
        assert_eq!(extract_title("\n\n"), "");
        assert_eq!(extract_title("# "), "");
        assert_eq!(extract_title("##"), "");
    }

    #[test]
    fn skips_blank_lines_and_html_comments_for_the_title() {
        assert_eq!(
            extract_title("\n<!-- draft -->\n# Real title\n<!-- /draft -->"),
            "Real title"
        );
        assert_eq!(extract_title("<!-- meta -->Title"), "Title");
        assert_eq!(extract_title("<!--\nmeta: 1\n-->\nTitle"), "Title");
        assert_eq!(extract_title("<!-- draft -->\n<!-- /draft -->"), "");
        assert_eq!(extract_title("<!-- unclosed"), "");
    }

    #[test]
    fn puts_a_missing_title_on_the_first_line() {
        assert_eq!(content_with_title("Plan", "step 1"), "# Plan\n\nstep 1");
        assert_eq!(content_with_title("Plan", ""), "# Plan\n");
        assert_eq!(content_with_title("# Plan", "Plan\nstep 1"), "Plan\nstep 1");
        assert_eq!(content_with_title("   ", "step 1"), "step 1");
        assert_eq!(extract_title(&content_with_title("Plan", "step 1")), "Plan");
    }

    #[test]
    fn appends_after_a_blank_line() {
        assert_eq!(append_text("a", "b"), "a\n\nb");
        assert_eq!(append_text("a\n\n\n", "b"), "a\n\nb");
        assert_eq!(append_text("a  \r\n", "b"), "a  \n\nb");
        assert_eq!(append_text("", "b"), "b");
        assert_eq!(append_text("\n\n", "b"), "b");
    }

    #[test]
    fn changes_are_empty_only_without_any_field() {
        assert!(NoteChanges::default().is_empty());

        let changes = NoteChanges {
            content: Some(String::new()),
            ..NoteChanges::default()
        };
        assert!(!changes.is_empty());
    }
}
