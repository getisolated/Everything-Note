//! Outils exposés aux IA : lecture et écriture des notes, sans suppression.
//!
//! Chaque outil est une fonction synchrone (comme les services) qui rend le JSON à renvoyer,
//! ou un message d'erreur lisible par l'IA. Les paramètres sont décrits en anglais : ces
//! descriptions forment le schéma JSON montré aux IA.

use std::collections::HashMap;
use std::sync::Arc;

use app::AppError;
use app::folders::FoldersService;
use app::notes::NotesService;
use domain::folder::Folder;
use domain::note::{NewNote, Note, NoteChanges, append_text, content_with_title, extract_title};
use domain::search::snippet;
use domain::tags::normalize_tags;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

/// Nombre de notes rendues par `list_notes` sans limite demandée.
const DEFAULT_LIST_LIMIT: usize = 50;
/// Nombre de notes rendues par `search_notes` sans limite demandée.
const DEFAULT_SEARCH_LIMIT: usize = 20;
/// Plafond de toute limite demandée.
const MAX_LIMIT: usize = 500;
/// Longueur des extraits de `search_notes`, en caractères.
const SNIPPET_LENGTH: usize = 200;

/// Services de l'application partagés avec le serveur MCP.
#[derive(Clone)]
pub struct McpServices {
    /// Notes.
    pub notes: Arc<NotesService>,
    /// Dossiers.
    pub folders: Arc<FoldersService>,
}

/// Résultat d'un outil : le JSON à renvoyer, ou un message d'erreur pour l'IA.
pub(crate) type ToolResult = Result<Value, String>;

/// Paramètres de `list_notes`.
#[derive(Debug, Default, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub(crate) struct ListNotesArgs {
    /// Seulement les notes de ce dossier.
    #[schemars(description = "Only the notes directly in this folder (id from list_folders).")]
    #[serde(default)]
    pub folder_id: Option<i64>,
    /// Seulement les notes portant ce tag.
    #[schemars(description = "Only the notes carrying this tag (exact name, see list_tags).")]
    #[serde(default)]
    pub tag: Option<String>,
    /// Nombre maximal de notes.
    #[schemars(
        description = "Maximum number of notes to return, most recently updated first. Default 50, at most 500.",
        range(min = 1, max = 500)
    )]
    #[serde(default)]
    pub limit: Option<u32>,
}

/// Paramètres de `search_notes`.
#[derive(Debug, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub(crate) struct SearchNotesArgs {
    /// Mots cherchés.
    #[schemars(
        description = "Words to look for in the titles and contents of the notes. Every word must match; the last one also matches as a prefix."
    )]
    pub query: String,
    /// Nombre maximal de résultats.
    #[schemars(
        description = "Maximum number of notes to return, best matches first. Default 20, at most 500.",
        range(min = 1, max = 500)
    )]
    #[serde(default)]
    pub limit: Option<u32>,
}

/// Paramètres de `get_note`.
#[derive(Debug, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub(crate) struct GetNoteArgs {
    /// Identifiant de la note.
    #[schemars(description = "Id of the note (from list_notes or search_notes).")]
    pub id: i64,
}

/// Paramètres de `create_note`.
#[derive(Debug, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub(crate) struct CreateNoteArgs {
    /// Texte markdown.
    #[schemars(description = "Markdown content of the note.")]
    pub content: String,
    /// Titre.
    #[schemars(
        description = "Title of the note. Daftr titles a note with its first line: when the content does not already start with this title, a '# title' heading is added at the top. Without it, the first line of the content is the title."
    )]
    #[serde(default)]
    pub title: Option<String>,
    /// Dossier.
    #[schemars(
        description = "Folder to create the note in (id from list_folders). Defaults to the Inbox folder."
    )]
    #[serde(default)]
    pub folder_id: Option<i64>,
    /// Tags.
    #[schemars(description = "Tags of the note.")]
    #[serde(default)]
    pub tags: Option<Vec<String>>,
}

/// Paramètres de `update_note`.
#[derive(Debug, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub(crate) struct UpdateNoteArgs {
    /// Identifiant de la note.
    #[schemars(description = "Id of the note to update.")]
    pub id: i64,
    /// Nouveau texte.
    #[schemars(
        description = "New markdown content, replacing the whole note. Its first line becomes the title."
    )]
    pub content: String,
}

/// Paramètres de `append_to_note`.
#[derive(Debug, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub(crate) struct AppendToNoteArgs {
    /// Identifiant de la note.
    #[schemars(description = "Id of the note to append to.")]
    pub id: i64,
    /// Texte ajouté.
    #[schemars(description = "Markdown text added at the end of the note, after a blank line.")]
    pub text: String,
}

/// Une note sans son contenu.
#[derive(Debug, Serialize)]
struct NoteSummary {
    id: i64,
    title: String,
    folder_id: Option<i64>,
    tags: Vec<String>,
    created_at: String,
    updated_at: String,
}

impl From<&Note> for NoteSummary {
    fn from(note: &Note) -> Self {
        Self {
            id: note.id,
            title: note.title.clone(),
            folder_id: note.folder_id,
            tags: app::notes::tags::decode(&note.tags),
            created_at: note.created_at.clone(),
            updated_at: note.updated_at.clone(),
        }
    }
}

/// Un dossier et son chemin depuis la racine.
#[derive(Debug, Serialize)]
struct FolderEntry {
    id: i64,
    name: String,
    parent_id: Option<i64>,
    path: String,
    is_default: bool,
}

/// Tous les dossiers, avec leur chemin (`Parent/Enfant`).
pub(crate) fn list_folders(services: &McpServices) -> ToolResult {
    let folders = services.folders.all().map_err(failure)?;
    let by_id: HashMap<i64, &Folder> = folders.iter().map(|folder| (folder.id, folder)).collect();
    let mut entries: Vec<FolderEntry> = folders
        .iter()
        .map(|folder| FolderEntry {
            id: folder.id,
            name: folder.name.clone(),
            parent_id: folder.parent_id,
            path: folder_path(folder, &by_id),
            is_default: folder.is_default,
        })
        .collect();

    entries.sort_by_cached_key(|entry| entry.path.to_lowercase());
    Ok(json!({ "folders": entries }))
}

/// Les notes, les plus récemment modifiées d'abord, filtrées par dossier et tag.
pub(crate) fn list_notes(services: &McpServices, args: ListNotesArgs) -> ToolResult {
    if let Some(folder_id) = args.folder_id {
        ensure_folder(services, folder_id)?;
    }
    let notes = match args.tag.as_deref().map(str::trim) {
        Some(tag) if !tag.is_empty() => services.notes.by_tag(tag).map_err(failure)?,
        _ => services.notes.all().map_err(failure)?,
    };
    let matching: Vec<&Note> = notes
        .iter()
        .filter(|note| args.folder_id.is_none() || note.folder_id == args.folder_id)
        .collect();
    let total = matching.len();
    let listed: Vec<NoteSummary> = matching
        .into_iter()
        .take(limit(args.limit, DEFAULT_LIST_LIMIT))
        .map(NoteSummary::from)
        .collect();
    Ok(json!({ "total": total, "notes": listed }))
}

/// Recherche plein texte, avec un extrait autour des mots trouvés.
pub(crate) fn search_notes(services: &McpServices, args: SearchNotesArgs) -> ToolResult {
    let query = args.query.trim();
    if query.is_empty() {
        return Err("The query must not be empty.".to_owned());
    }
    let found = services.notes.search(query).map_err(failure)?;
    let results: Vec<Value> = found
        .iter()
        .take(limit(args.limit, DEFAULT_SEARCH_LIMIT))
        .map(|note| {
            let mut entry = json!(NoteSummary::from(note));
            entry["snippet"] = json!(snippet(&note.content, query, SNIPPET_LENGTH));
            entry
        })
        .collect();

    Ok(json!({ "total": found.len(), "notes": results }))
}

/// Une note complète.
pub(crate) fn get_note(services: &McpServices, args: GetNoteArgs) -> ToolResult {
    let note = existing_note(services, args.id)?;
    Ok(with_content(&note))
}

/// Tous les tags utilisés.
pub(crate) fn list_tags(services: &McpServices) -> ToolResult {
    Ok(json!({ "tags": services.notes.all_tags().map_err(failure)? }))
}

/// Crée une note ; sans dossier, elle arrive dans le dossier par défaut (Inbox).
pub(crate) fn create_note(services: &McpServices, args: CreateNoteArgs) -> ToolResult {
    let folder_id = match args.folder_id {
        Some(id) => Some(ensure_folder(services, id)?),
        None => services.folders.default_folder_id().map_err(failure)?,
    };
    let content = match args.title.as_deref() {
        Some(title) => content_with_title(title, &args.content),
        None => args.content,
    };
    let note = NewNote {
        title: extract_title(&content),
        content,
        tags: normalize_tags(&args.tags.unwrap_or_default()),
        folder_id,
    };

    let created = services.notes.create(note).map_err(failure)?;
    Ok(json!(NoteSummary::from(&created)))
}

/// Remplace le contenu d'une note (et donc son titre, sa première ligne).
pub(crate) fn update_note(services: &McpServices, args: UpdateNoteArgs) -> ToolResult {
    existing_note(services, args.id)?;
    replace_content(services, args.id, args.content)
}

/// Ajoute du texte à la fin d'une note, après une ligne vide.
pub(crate) fn append_to_note(services: &McpServices, args: AppendToNoteArgs) -> ToolResult {
    if args.text.trim().is_empty() {
        return Err("The text to append must not be empty.".to_owned());
    }
    let note = existing_note(services, args.id)?;
    replace_content(services, args.id, append_text(&note.content, &args.text))
}

fn replace_content(services: &McpServices, id: i64, content: String) -> ToolResult {
    let changes = NoteChanges {
        title: Some(extract_title(&content)),
        content: Some(content),
        tags: None,
    };
    let updated = services.notes.update(id, &changes).map_err(failure)?;
    let note = updated.ok_or_else(|| note_not_found(id))?;
    Ok(json!(NoteSummary::from(&note)))
}

fn with_content(note: &Note) -> Value {
    let mut value = json!(NoteSummary::from(note));
    value["content"] = json!(note.content);
    value
}

fn existing_note(services: &McpServices, id: i64) -> Result<Note, String> {
    services
        .notes
        .by_id(id)
        .map_err(failure)?
        .ok_or_else(|| note_not_found(id))
}

fn ensure_folder(services: &McpServices, id: i64) -> Result<i64, String> {
    let folders = services.folders.all().map_err(failure)?;
    if folders.iter().any(|folder| folder.id == id) {
        Ok(id)
    } else {
        Err(format!(
            "Folder {id} not found. Use list_folders to get the existing folders."
        ))
    }
}

fn note_not_found(id: i64) -> String {
    format!("Note {id} not found. Use list_notes or search_notes to find notes.")
}

/// Chemin du dossier depuis la racine ; s'arrête sur un parent inconnu ou un cycle.
fn folder_path(folder: &Folder, by_id: &HashMap<i64, &Folder>) -> String {
    let mut names = vec![folder.name.as_str()];
    let mut parent = folder.parent_id;

    while let Some(current) = parent.and_then(|id| by_id.get(&id)) {
        if names.len() > by_id.len() {
            break;
        }
        names.push(current.name.as_str());
        parent = current.parent_id;
    }
    names.reverse();
    names.join("/")
}

fn limit(requested: Option<u32>, default: usize) -> usize {
    requested
        .and_then(|value| usize::try_from(value).ok())
        .unwrap_or(default)
        .clamp(1, MAX_LIMIT)
}

fn failure(error: AppError) -> String {
    tracing::warn!(%error, "outil MCP en échec");
    error.to_string()
}

#[cfg(test)]
mod tests;
