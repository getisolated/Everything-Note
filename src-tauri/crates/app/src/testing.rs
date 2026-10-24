//! Doublures en mémoire des ports, pour les tests des cas d'usage.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use domain::collection::{Collection, CollectionKind};
use domain::folder::{Folder, FolderDeleteMode};
use domain::note::{NewNote, Note, NoteChanges};
use domain::settings::{AppSettings, RawSettings};
use platform::sync::lock;

use crate::ports::{
    CollectionFiles, CollectionStore, CollectionWatcher, EntryKind, ExportWriter, FolderStore,
    NoteStore, PdfRenderer, SecretSource, SettingsStore, ZipEntry,
};
use crate::{AppError, AppResult};

/// Un dossier de test.
pub fn folder(id: i64, parent_id: Option<i64>, is_default: bool) -> Folder {
    Folder {
        id,
        name: format!("folder {id}"),
        parent_id,
        is_default,
        sort_order: None,
        color: None,
        created_at: String::new(),
    }
}

/// Dossiers en mémoire.
#[derive(Default)]
pub struct MemoryFolders {
    folders: Mutex<Vec<Folder>>,
    /// Appels faits au stockage, pour vérifier ce qui a (ou n'a pas) été demandé.
    pub calls: Mutex<Vec<String>>,
}

impl MemoryFolders {
    /// Stockage contenant ces dossiers.
    pub fn with(folders: Vec<Folder>) -> Self {
        Self {
            folders: Mutex::new(folders),
            calls: Mutex::default(),
        }
    }

    fn record(&self, call: String) {
        lock(&self.calls).push(call);
    }

    fn children(&self, id: i64) -> Vec<i64> {
        let folders = lock(&self.folders);
        folders
            .iter()
            .filter(|f| f.parent_id == Some(id))
            .map(|f| f.id)
            .collect()
    }
}

impl FolderStore for MemoryFolders {
    fn all(&self) -> AppResult<Vec<Folder>> {
        Ok(lock(&self.folders).clone())
    }

    fn by_id(&self, id: i64) -> AppResult<Option<Folder>> {
        Ok(lock(&self.folders)
            .iter()
            .find(|folder| folder.id == id)
            .cloned())
    }

    fn ensure_default(&self, name: &str) -> AppResult<()> {
        self.record(format!("ensure_default {name}"));
        Ok(())
    }

    fn insert(&self, name: &str, parent_id: Option<i64>) -> AppResult<Folder> {
        let mut folders = lock(&self.folders);
        let created = Folder {
            name: name.to_owned(),
            ..folder(folders.len() as i64 + 100, parent_id, false)
        };
        folders.push(created.clone());
        Ok(created)
    }

    fn rename(&self, id: i64, name: &str) -> AppResult<()> {
        self.record(format!("rename {id} {name}"));
        Ok(())
    }

    fn set_parent(&self, id: i64, parent_id: Option<i64>) -> AppResult<()> {
        self.record(format!("set_parent {id} {parent_id:?}"));
        let mut folders = lock(&self.folders);
        folders
            .iter_mut()
            .filter(|f| f.id == id)
            .for_each(|f| f.parent_id = parent_id);
        Ok(())
    }

    fn set_positions(&self, parent_id: Option<i64>, ordered_ids: &[i64]) -> AppResult<()> {
        self.record(format!("set_positions {parent_id:?} {ordered_ids:?}"));
        Ok(())
    }

    fn subtree_ids(&self, id: i64) -> AppResult<Vec<i64>> {
        let mut subtree = vec![id];
        let mut index = 0;
        while let Some(current) = subtree.get(index).copied() {
            subtree.extend(self.children(current));
            index += 1;
        }
        Ok(subtree)
    }

    fn delete(&self, id: i64, mode: FolderDeleteMode) -> AppResult<Vec<i64>> {
        self.record(format!("delete {id} {}", mode.as_str()));
        Ok(vec![1, 2])
    }

    fn empty(&self, id: i64) -> AppResult<Vec<i64>> {
        self.record(format!("empty {id}"));
        Ok(vec![3])
    }

    fn set_color(&self, ids: &[i64], color: Option<&str>) -> AppResult<()> {
        self.record(format!("set_color {ids:?} {color:?}"));
        Ok(())
    }
}

/// Notes en mémoire.
#[derive(Default)]
pub struct MemoryNotes {
    notes: Mutex<Vec<Note>>,
    /// Appels faits au stockage.
    pub calls: Mutex<Vec<String>>,
}

impl MemoryNotes {
    /// Stockage contenant ces notes.
    pub fn with(notes: Vec<Note>) -> Self {
        Self {
            notes: Mutex::new(notes),
            calls: Mutex::default(),
        }
    }

    fn record(&self, call: String) {
        lock(&self.calls).push(call);
    }
}

/// Une note de test.
pub fn note(id: i64, folder_id: Option<i64>, tags: &str) -> Note {
    Note {
        id,
        title: format!("note {id}"),
        content: String::new(),
        tags: tags.to_owned(),
        folder_id,
        sort_order: None,
        color: None,
        created_at: String::new(),
        updated_at: String::new(),
    }
}

impl NoteStore for MemoryNotes {
    fn all(&self) -> AppResult<Vec<Note>> {
        self.record("all".to_owned());
        Ok(lock(&self.notes).clone())
    }

    fn by_id(&self, id: i64) -> AppResult<Option<Note>> {
        Ok(lock(&self.notes).iter().find(|note| note.id == id).cloned())
    }

    fn insert(&self, new: &NewNote) -> AppResult<Note> {
        let mut notes = lock(&self.notes);
        let created = Note {
            title: new.title.clone(),
            ..note(notes.len() as i64 + 1, new.folder_id, "[]")
        };
        notes.push(created.clone());
        Ok(created)
    }

    fn update(&self, id: i64, changes: &NoteChanges) -> AppResult<()> {
        self.record(format!("update {id} {changes:?}"));
        Ok(())
    }

    fn set_folder(&self, id: i64, folder_id: Option<i64>) -> AppResult<()> {
        self.record(format!("set_folder {id} {folder_id:?}"));
        let mut notes = lock(&self.notes);
        notes
            .iter_mut()
            .filter(|n| n.id == id)
            .for_each(|n| n.folder_id = folder_id);
        Ok(())
    }

    fn set_positions(&self, folder_id: Option<i64>, ordered_ids: &[i64]) -> AppResult<()> {
        self.record(format!("set_positions {folder_id:?} {ordered_ids:?}"));
        Ok(())
    }

    fn delete(&self, id: i64) -> AppResult<()> {
        self.record(format!("delete {id}"));
        Ok(())
    }

    fn set_color(&self, ids: &[i64], color: Option<&str>) -> AppResult<()> {
        self.record(format!("set_color {ids:?} {color:?}"));
        Ok(())
    }

    fn search(&self, fts_query: &str) -> AppResult<Vec<Note>> {
        self.record(format!("search {fts_query}"));
        Ok(Vec::new())
    }

    fn by_tag(&self, like_pattern: &str) -> AppResult<Vec<Note>> {
        self.record(format!("by_tag {like_pattern}"));
        Ok(Vec::new())
    }

    fn tag_columns(&self) -> AppResult<Vec<String>> {
        Ok(lock(&self.notes)
            .iter()
            .map(|note| note.tags.clone())
            .collect())
    }
}

/// Liste des collections en mémoire.
#[derive(Default)]
pub struct MemoryCollections {
    collections: Mutex<Vec<Collection>>,
}

impl CollectionStore for MemoryCollections {
    fn all(&self) -> AppResult<Vec<Collection>> {
        Ok(lock(&self.collections).clone())
    }

    fn get(&self, path: &str) -> AppResult<Option<Collection>> {
        Ok(lock(&self.collections)
            .iter()
            .find(|c| c.path == path)
            .cloned())
    }

    fn add(&self, path: &str, kind: CollectionKind, display_name: &str) -> AppResult<Collection> {
        let mut collections = lock(&self.collections);
        let added = Collection {
            path: path.to_owned(),
            kind,
            display_name: display_name.to_owned(),
            sort_order: collections.len() as i64 + 1,
            created_at: String::new(),
        };
        collections.push(added.clone());
        Ok(added)
    }

    fn remove(&self, path: &str) -> AppResult<()> {
        lock(&self.collections).retain(|c| c.path != path);
        Ok(())
    }

    fn rename(&self, path: &str, display_name: &str) -> AppResult<Option<Collection>> {
        let mut collections = lock(&self.collections);
        collections
            .iter_mut()
            .filter(|c| c.path == path)
            .for_each(|c| c.display_name = display_name.to_owned());
        Ok(collections.iter().find(|c| c.path == path).cloned())
    }

    fn relocate(&self, from: &str, to: &str) -> AppResult<Option<Collection>> {
        let mut collections = lock(&self.collections);
        collections
            .iter_mut()
            .filter(|c| c.path == from)
            .for_each(|c| c.path = to.to_owned());
        Ok(collections.iter().find(|c| c.path == to).cloned())
    }
}

/// Disque en mémoire : des entrées et le texte des fichiers.
#[derive(Default)]
pub struct FakeFiles {
    entries: Mutex<HashMap<PathBuf, EntryKind>>,
    contents: Mutex<HashMap<PathBuf, String>>,
    /// Opérations faites sur le disque.
    pub operations: Mutex<Vec<String>>,
}

impl FakeFiles {
    /// Ajoute un dossier.
    pub fn add_dir(&self, path: &Path) {
        lock(&self.entries).insert(path.to_path_buf(), EntryKind::Directory);
    }

    /// Ajoute un fichier et son texte.
    pub fn add_file(&self, path: &Path, content: &str) {
        lock(&self.entries).insert(path.to_path_buf(), EntryKind::File);
        lock(&self.contents).insert(path.to_path_buf(), content.to_owned());
    }

    fn record(&self, operation: String) {
        lock(&self.operations).push(operation);
    }
}

impl CollectionFiles for FakeFiles {
    fn entry_kind(&self, path: &Path) -> Option<EntryKind> {
        lock(&self.entries).get(path).copied()
    }

    fn read_text(&self, path: &Path) -> AppResult<String> {
        lock(&self.contents)
            .get(path)
            .cloned()
            .ok_or_else(|| AppError::file_system("missing"))
    }

    fn read_bytes(&self, path: &Path) -> AppResult<Vec<u8>> {
        self.read_text(path).map(String::into_bytes)
    }

    fn write_text(&self, path: &Path, content: &str) -> AppResult<()> {
        self.record(format!("write {}", path.display()));
        self.add_file(path, content);
        Ok(())
    }

    fn create_new(&self, path: &Path) -> AppResult<()> {
        self.record(format!("create {}", path.display()));
        self.add_file(path, "");
        Ok(())
    }

    fn rename(&self, from: &Path, to: &Path) -> AppResult<()> {
        self.record(format!("rename {} -> {}", from.display(), to.display()));
        Ok(())
    }

    fn trash(&self, path: &Path) -> AppResult<()> {
        self.record(format!("trash {}", path.display()));
        Ok(())
    }
}

/// Surveillant qui note les demandes.
#[derive(Default)]
pub struct RecordingWatcher {
    /// Demandes reçues.
    pub calls: Mutex<Vec<String>>,
}

impl RecordingWatcher {
    /// Les demandes reçues.
    pub fn calls(&self) -> Vec<String> {
        lock(&self.calls).clone()
    }

    fn record(&self, call: String) {
        lock(&self.calls).push(call);
    }
}

impl CollectionWatcher for RecordingWatcher {
    fn watch(&self, root: &str, kind: CollectionKind) {
        self.record(format!("watch {root} {}", kind.as_str()));
    }

    fn unwatch(&self, root: &str) {
        self.record(format!("unwatch {root}"));
    }

    fn set_excludes(&self, excludes: Vec<String>) {
        self.record(format!("excludes {excludes:?}"));
    }

    fn search(&self, request_id: u64, query: String) {
        self.record(format!("search {request_id} {query}"));
    }

    fn cancel_search(&self, request_id: u64) {
        self.record(format!("cancel {request_id}"));
    }

    fn graph(&self, root: &str) {
        self.record(format!("graph {root}"));
    }
}

/// Réglages en mémoire.
#[derive(Default)]
pub struct MemorySettings {
    /// Réglages « sur le disque ».
    pub stored: Mutex<Option<RawSettings>>,
    /// Réglages enregistrés, dans l'ordre.
    pub saved: Mutex<Vec<AppSettings>>,
}

impl SettingsStore for MemorySettings {
    fn load(&self) -> AppResult<Option<RawSettings>> {
        Ok(lock(&self.stored).clone())
    }

    fn save(&self, settings: &AppSettings) -> AppResult<()> {
        lock(&self.saved).push(settings.clone());
        Ok(())
    }
}

/// Jetons prévisibles : `0…01`, `0…02`… ; `failing` simule l'absence de source de hasard.
#[derive(Default)]
pub struct CountingSecrets {
    issued: Mutex<u64>,
    failing: bool,
}

impl CountingSecrets {
    /// Source qui échoue toujours.
    pub fn failing() -> Self {
        Self {
            failing: true,
            ..Self::default()
        }
    }
}

impl SecretSource for CountingSecrets {
    fn new_token(&self) -> AppResult<String> {
        if self.failing {
            return Err(AppError::Storage("no randomness".to_owned()));
        }
        let mut issued = lock(&self.issued);
        *issued += 1;
        Ok(format!("{:064x}", *issued))
    }
}

/// Écrivain d'export qui garde ce qu'on lui donne.
#[derive(Default)]
pub struct RecordingWriter {
    files: Mutex<Vec<(PathBuf, Vec<u8>)>>,
    zips: Mutex<Vec<ZipEntry>>,
}

impl RecordingWriter {
    /// Fichiers écrits.
    pub fn files(&self) -> Vec<(PathBuf, Vec<u8>)> {
        lock(&self.files).clone()
    }

    /// Entrées des archives écrites.
    pub fn zip_entries(&self) -> Vec<ZipEntry> {
        lock(&self.zips).clone()
    }
}

impl ExportWriter for RecordingWriter {
    fn write_file(&self, path: &Path, content: &[u8]) -> AppResult<()> {
        lock(&self.files).push((path.to_path_buf(), content.to_vec()));
        Ok(())
    }

    fn write_zip(&self, _path: &Path, entries: &[ZipEntry]) -> AppResult<()> {
        lock(&self.zips).extend_from_slice(entries);
        Ok(())
    }
}

/// Rendu PDF factice : chaque page devient `%PDF ` suivi de son HTML ; une page `fail`
/// échoue comme une impression refusée.
#[derive(Default)]
pub struct FakePdfRenderer {
    calls: Mutex<Vec<Vec<String>>>,
}

impl FakePdfRenderer {
    /// Lots de pages demandés.
    pub fn calls(&self) -> Vec<Vec<String>> {
        lock(&self.calls).clone()
    }
}

impl PdfRenderer for FakePdfRenderer {
    fn render(&self, pages: &[String], rendered: &mut dyn FnMut(usize)) -> AppResult<Vec<Vec<u8>>> {
        lock(&self.calls).push(pages.to_vec());
        let mut documents = Vec::with_capacity(pages.len());

        for (index, page) in pages.iter().enumerate() {
            if page == "fail" {
                return Err(AppError::file_system("print failed"));
            }
            documents.push(format!("%PDF {page}").into_bytes());
            rendered(index + 1);
        }
        Ok(documents)
    }
}
