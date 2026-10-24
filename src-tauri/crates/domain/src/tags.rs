//! Tags des notes.

/// Tag des notes envoyées depuis l'overlay de note rapide (`QUICK_NOTE_TAG` côté renderer).
pub const QUICK_NOTE_TAG: &str = "quick-note";

/// Ancien nom du tag des notes rapides, renommé par une migration de la base.
pub const LEGACY_QUICK_NOTE_TAG: &str = "overlay";

/// Les tags avec `from` renommé en `to`, sans doublon quand `to` y est déjà ; l'ordre des
/// autres tags est conservé.
///
/// ```
/// let tags = vec!["quick-note".to_owned(), "overlay".to_owned()];
/// assert_eq!(domain::tags::rename_tag(&tags, "overlay", "quick-note"), vec!["quick-note"]);
/// ```
pub fn rename_tag(tags: &[String], from: &str, to: &str) -> Vec<String> {
    let mut renamed: Vec<String> = Vec::with_capacity(tags.len());

    for tag in tags {
        let next = if tag == from { to } else { tag.as_str() };

        if !renamed.iter().any(|kept| kept == next) {
            renamed.push(next.to_owned());
        }
    }
    renamed
}

/// Les tags sans les espaces autour, sans tag vide ni doublon, dans leur ordre.
///
/// ```
/// let tags = vec![" work ".to_owned(), "".to_owned(), "work".to_owned()];
/// assert_eq!(domain::tags::normalize_tags(&tags), vec!["work"]);
/// ```
pub fn normalize_tags(tags: &[String]) -> Vec<String> {
    let mut kept: Vec<String> = Vec::with_capacity(tags.len());

    for tag in tags.iter().map(|tag| tag.trim()) {
        if !tag.is_empty() && !kept.iter().any(|known| known == tag) {
            kept.push(tag.to_owned());
        }
    }
    kept
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn trims_and_deduplicates_tags() {
        assert_eq!(
            normalize_tags(&tags(&["b", " a", "", "  ", "a ", "b"])),
            tags(&["b", "a"])
        );
    }

    fn tags(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| (*value).to_owned()).collect()
    }

    #[test]
    fn renames_the_tag_and_keeps_the_others_in_place() {
        let renamed = rename_tag(&tags(&["a", "overlay", "b"]), "overlay", "quick-note");
        assert_eq!(renamed, tags(&["a", "quick-note", "b"]));
    }

    #[test]
    fn does_not_duplicate_the_new_tag() {
        let renamed = rename_tag(&tags(&["quick-note", "overlay"]), "overlay", "quick-note");
        assert_eq!(renamed, tags(&["quick-note"]));
    }

    #[test]
    fn leaves_other_tags_untouched() {
        assert_eq!(
            rename_tag(&tags(&["a"]), "overlay", "quick-note"),
            tags(&["a"])
        );
    }
}
