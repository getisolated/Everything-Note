//! Mise en forme des recherches de l'utilisateur pour SQLite (FTS5 et `LIKE`).

/// Chaque mot entre guillemets (guillemets internes doublés) : les opérateurs FTS5
/// (`NOT`, `*`, `-`…) tapés par l'utilisateur deviennent du texte littéral.
///
/// ```
/// assert_eq!(domain::search::sanitize_fts_query("  foo   bar "), r#""foo" "bar""#);
/// ```
pub fn sanitize_fts_query(query: &str) -> String {
    query
        .split_whitespace()
        .map(|token| format!("\"{}\"", token.replace('"', "\"\"")))
        .collect::<Vec<_>>()
        .join(" ")
}

/// Requête FTS5 de recherche par préfixe du dernier mot, `None` quand il n'y a rien à
/// chercher (la liste complète des notes est alors attendue).
pub fn fts_prefix_query(query: &str) -> Option<String> {
    let sanitized = sanitize_fts_query(query);

    (!sanitized.is_empty()).then(|| format!("{sanitized}*"))
}

/// Échappe les jokers de `LIKE` (`%`, `_` et `\`, le caractère d'échappement choisi).
pub fn escape_like(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_")
}

/// Motif `LIKE` (échappement `\`) qui trouve un tag dans la colonne JSON des tags.
pub fn tag_like_pattern(tag: &str) -> String {
    format!("%\"{}\"%", escape_like(&tag.replace('"', "")))
}

/// Extrait d'au plus `max_chars` caractères (plus les `…` des coupures) autour de la première
/// occurrence d'un mot de la recherche, sans tenir compte de la casse ; les blancs et retours
/// à la ligne deviennent une espace. Sans occurrence (note trouvée par son titre ou ses
/// tags), c'est le début du texte.
///
/// ```
/// let text = "Courses\n\nAcheter du pain et du lait";
/// assert_eq!(domain::search::snippet(text, "LAIT", 15), "…pain et du lait");
/// ```
pub fn snippet(text: &str, query: &str, max_chars: usize) -> String {
    let flat: Vec<char> = text
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .collect();
    let folded: Vec<char> = flat.iter().copied().map(fold_case).collect();
    let first_match = query
        .split_whitespace()
        .map(|word| word.chars().map(fold_case).collect::<Vec<_>>())
        .filter_map(|word| folded.windows(word.len()).position(|window| window == word))
        .min();

    // Un peu de contexte avant l'occurrence, le reste après
    let wanted_start = first_match.map_or(0, |at| at.saturating_sub(max_chars / 4));
    let end = (wanted_start + max_chars).min(flat.len());
    let start = end.saturating_sub(max_chars).min(wanted_start);

    let mut excerpt: String = flat[start..end].iter().collect();
    if start > 0 {
        excerpt.insert(0, '…');
    }
    if end < flat.len() {
        excerpt.push('…');
    }
    excerpt
}

/// Le caractère en minuscule, quand sa minuscule tient en un caractère (les positions du
/// texte replié restent celles du texte).
fn fold_case(character: char) -> char {
    let mut lower = character.to_lowercase();
    match (lower.next(), lower.next()) {
        (Some(single), None) => single,
        _ => character,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn centers_the_snippet_on_the_first_match() {
        let text = "alpha beta gamma delta epsilon zeta eta theta";
        assert_eq!(snippet(text, "delta", 12), "…ma delta eps…");
        assert_eq!(snippet(text, "zeta GAMMA", 8), "…a gamma …");
    }

    #[test]
    fn starts_at_the_beginning_without_a_match() {
        assert_eq!(
            snippet("one\ntwo\n\nthree", "nothing", 100),
            "one two three"
        );
        assert_eq!(snippet("one two three", "", 3), "one…");
        assert_eq!(snippet("", "word", 10), "");
    }

    #[test]
    fn keeps_the_end_of_the_text_full() {
        assert_eq!(snippet("aaaa bbbb", "bbbb", 6), "…a bbbb");
    }

    #[test]
    fn ignores_case_on_any_alphabet() {
        assert_eq!(snippet("Été à Paris", "ÉTÉ", 20), "Été à Paris");
        assert_eq!(snippet("aaaaaaaaaa ΣΟΦΙΑ", "σοφια", 5), "… ΣΟΦΙ…");
    }

    #[test]
    fn wraps_each_word_in_quotes() {
        assert_eq!(sanitize_fts_query("hello"), "\"hello\"");
        assert_eq!(sanitize_fts_query("hello world"), "\"hello\" \"world\"");
    }

    #[test]
    fn escapes_quotes_inside_words() {
        assert_eq!(sanitize_fts_query("say \"hi\""), "\"say\" \"\"\"hi\"\"\"");
    }

    #[test]
    fn trims_and_collapses_spaces() {
        assert_eq!(sanitize_fts_query("  foo   bar  "), "\"foo\" \"bar\"");
        assert_eq!(sanitize_fts_query(""), "");
        assert_eq!(sanitize_fts_query("   "), "");
    }

    #[test]
    fn makes_fts_operators_literal() {
        assert_eq!(sanitize_fts_query("c++"), "\"c++\"");
        assert_eq!(sanitize_fts_query("NOT OR AND"), "\"NOT\" \"OR\" \"AND\"");
    }

    #[test]
    fn builds_a_prefix_query_only_when_there_is_something_to_search() {
        assert_eq!(fts_prefix_query("not"), Some("\"not\"*".to_owned()));
        assert_eq!(fts_prefix_query("  "), None);
    }

    #[test]
    fn escapes_like_wildcards() {
        assert_eq!(escape_like("hello"), "hello");
        assert_eq!(escape_like("100%"), "100\\%");
        assert_eq!(escape_like("file_name"), "file\\_name");
        assert_eq!(escape_like("path\\to"), "path\\\\to");
        assert_eq!(escape_like("%_\\"), "\\%\\_\\\\");
        assert_eq!(escape_like(""), "");
    }

    #[test]
    fn matches_a_whole_tag_in_the_json_column() {
        assert_eq!(tag_like_pattern("to_do"), "%\"to\\_do\"%");
        assert_eq!(tag_like_pattern("a\"b"), "%\"ab\"%");
    }
}
