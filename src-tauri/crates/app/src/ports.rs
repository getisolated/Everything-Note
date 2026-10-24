//! Ports : ce dont les cas d'usage ont besoin du monde extérieur.
//!
//! Les implémentations sont synchrones et partagées entre threads (`Send + Sync`).

use std::path::Path;

use domain::collection::{Collection, CollectionKind};
use domain::folder::{Folder, FolderDeleteMode};
use domain::note::{NewNote, Note, NoteChanges};
use domain::settings::{AppSettings, RawSettings};

use crate::AppResult;
use crate::collections::CollectionEvent;

/// Stockage des notes.
pub trait NoteStore: Send + Sync {
    /// Toutes les notes, les plus récemment modifiées d'abord.
    fn all(&self) -> AppResult<Vec<Note>>;
    /// Une note.
    fn by_id(&self, id: i64) -> AppResult<Option<Note>>;
    /// Crée une note (dossier déjà vérifié) et la rend.
    fn insert(&self, note: &NewNote) -> AppResult<Note>;
    /// Modifie les champs présents et met à jour `updated_at`.
    fn update(&self, id: i64, changes: &NoteChanges) -> AppResult<()>;
    /// Range la note dans un dossier sans toucher `updated_at` ; sa position n'est gardée
    /// que si le dossier ne change pas.
    fn set_folder(&self, id: i64, folder_id: Option<i64>) -> AppResult<()>;
    /// Numérote (1, 2…) les notes de `ordered_ids` qui sont bien dans `folder_id`.
    fn set_positions(&self, folder_id: Option<i64>, ordered_ids: &[i64]) -> AppResult<()>;
    /// Supprime une note.
    fn delete(&self, id: i64) -> AppResult<()>;
    /// Colore des notes sans toucher `updated_at`.
    fn set_color(&self, ids: &[i64], color: Option<&str>) -> AppResult<()>;
    /// Recherche plein texte (requête FTS5 déjà assainie), par pertinence.
    fn search(&self, fts_query: &str) -> AppResult<Vec<Note>>;
    /// Notes dont la colonne des tags correspond au motif `LIKE` (échappement `\`).
    fn by_tag(&self, like_pattern: &str) -> AppResult<Vec<Note>>;
    /// La colonne JSON des tags de chaque note.
    fn tag_columns(&self) -> AppResult<Vec<String>>;
}

/// Stockage des dossiers.
pub trait FolderStore: Send + Sync {
    /// Tous les dossiers, par identifiant.
    fn all(&self) -> AppResult<Vec<Folder>>;
    /// Un dossier.
    fn by_id(&self, id: i64) -> AppResult<Option<Folder>>;
    /// Crée le dossier par défaut s'il n'existe pas.
    fn ensure_default(&self, name: &str) -> AppResult<()>;
    /// Crée un dossier (nom et parent déjà vérifiés) et le rend.
    fn insert(&self, name: &str, parent_id: Option<i64>) -> AppResult<Folder>;
    /// Renomme un dossier.
    fn rename(&self, id: i64, name: &str) -> AppResult<()>;
    /// Change le parent ; la position n'est gardée que si le parent ne change pas.
    fn set_parent(&self, id: i64, parent_id: Option<i64>) -> AppResult<()>;
    /// Numérote (1, 2…) les dossiers de `ordered_ids` qui sont bien sous `parent_id`.
    fn set_positions(&self, parent_id: Option<i64>, ordered_ids: &[i64]) -> AppResult<()>;
    /// Le dossier et tous ses descendants.
    fn subtree_ids(&self, id: i64) -> AppResult<Vec<i64>>;
    /// Supprime le dossier et ses sous-dossiers en une transaction ; rend les notes supprimées.
    fn delete(&self, id: i64, mode: FolderDeleteMode) -> AppResult<Vec<i64>>;
    /// Supprime le contenu du dossier en une transaction ; rend les notes supprimées.
    fn empty(&self, id: i64) -> AppResult<Vec<i64>>;
    /// Colore des dossiers.
    fn set_color(&self, ids: &[i64], color: Option<&str>) -> AppResult<()>;
}

/// Stockage de la liste des collections.
pub trait CollectionStore: Send + Sync {
    /// Toutes les collections, dans l'ordre de la sidebar.
    fn all(&self) -> AppResult<Vec<Collection>>;
    /// Une collection, par son chemin exact.
    fn get(&self, path: &str) -> AppResult<Option<Collection>>;
    /// Ajoute une collection en dernier (un chemin déjà présent est rendu tel quel).
    fn add(&self, path: &str, kind: CollectionKind, display_name: &str) -> AppResult<Collection>;
    /// Retire une collection de la liste.
    fn remove(&self, path: &str) -> AppResult<()>;
    /// Change le nom affiché.
    fn rename(&self, path: &str, display_name: &str) -> AppResult<Option<Collection>>;
    /// La collection change de chemin (déplacée sur le disque).
    fn relocate(&self, from: &str, to: &str) -> AppResult<Option<Collection>>;
}

/// Nature d'une entrée du disque.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EntryKind {
    /// Un fichier.
    File,
    /// Un dossier.
    Directory,
}

/// Fichiers des collections sur le disque.
pub trait CollectionFiles: Send + Sync {
    /// Nature de l'entrée, `None` si elle n'existe pas.
    fn entry_kind(&self, path: &Path) -> Option<EntryKind>;
    /// Lit un fichier texte (UTF-8).
    fn read_text(&self, path: &Path) -> AppResult<String>;
    /// Lit un fichier binaire (images de l'aperçu).
    fn read_bytes(&self, path: &Path) -> AppResult<Vec<u8>>;
    /// Écrit un fichier texte (UTF-8).
    fn write_text(&self, path: &Path, content: &str) -> AppResult<()>;
    /// Crée un fichier vide, sans jamais écraser un fichier existant.
    fn create_new(&self, path: &Path) -> AppResult<()>;
    /// Renomme ou déplace une entrée.
    fn rename(&self, from: &Path, to: &Path) -> AppResult<()>;
    /// Envoie l'entrée à la corbeille : une suppression sur le disque reste réversible.
    fn trash(&self, path: &Path) -> AppResult<()>;
}

/// Parcours, surveillance et recherche des collections, en arrière-plan : les résultats
/// arrivent par un [`CollectionEventSink`].
pub trait CollectionWatcher: Send + Sync {
    /// Parcourt et surveille une collection ; son arbre arrive en événement (aussi pour
    /// rafraîchir : surveiller à nouveau renvoie toujours l'arbre).
    fn watch(&self, root: &str, kind: CollectionKind);
    /// Arrête de surveiller une collection.
    fn unwatch(&self, root: &str);
    /// Change les dossiers ignorés ; les collections surveillées sont reparcourues.
    fn set_excludes(&self, excludes: Vec<String>);
    /// Cherche dans les fichiers des collections surveillées ; une recherche plus récente
    /// arrête la précédente.
    fn search(&self, request_id: u64, query: String);
    /// Arrête une recherche.
    fn cancel_search(&self, request_id: u64);
    /// Construit le graphe des liens d'une collection surveillée.
    fn graph(&self, root: &str);
}

/// Destinataire des événements des collections (la fenêtre principale).
pub trait CollectionEventSink: Send + Sync {
    /// Publie un événement.
    fn publish(&self, event: CollectionEvent);
}

/// Persistance des réglages.
pub trait SettingsStore: Send + Sync {
    /// Réglages enregistrés, `None` au premier lancement ; illisibles = `None` aussi.
    fn load(&self) -> AppResult<Option<RawSettings>>;
    /// Enregistre les réglages.
    fn save(&self, settings: &AppSettings) -> AppResult<()>;
}

/// Source de secrets aléatoires (jeton du serveur MCP).
pub trait SecretSource: Send + Sync {
    /// Un nouveau jeton : 32 octets aléatoires en hexadécimal minuscule.
    fn new_token(&self) -> AppResult<String>;
}

/// Une entrée d'archive ZIP.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ZipEntry {
    /// Chemin dans l'archive, séparateurs `/`.
    pub path: String,
    /// Contenu du fichier (texte UTF-8 ou PDF).
    pub content: Vec<u8>,
}

/// Écriture des exports sur le disque.
pub trait ExportWriter: Send + Sync {
    /// Écrit un fichier (texte UTF-8 ou PDF).
    fn write_file(&self, path: &Path, content: &[u8]) -> AppResult<()>;
    /// Écrit une archive ZIP (deflate, noms UTF-8).
    fn write_zip(&self, path: &Path, entries: &[ZipEntry]) -> AppResult<()>;
}

/// Rendu de pages HTML autonomes en PDF (impression native d'un webview).
pub trait PdfRenderer: Send + Sync {
    /// Rend chaque page, dans l'ordre, en un document PDF ; `rendered(n)` est appelé dès que
    /// les `n` premières pages le sont. Bloque jusqu'à la fin ; le premier échec arrête tout.
    fn render(&self, pages: &[String], rendered: &mut dyn FnMut(usize)) -> AppResult<Vec<Vec<u8>>>;
}
