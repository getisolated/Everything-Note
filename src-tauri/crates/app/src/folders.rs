//! Cas d'usage des dossiers de notes.

use std::sync::Arc;

use domain::color::normalize_color;
use domain::folder::{
    DEFAULT_FOLDER_NAME, Folder, FolderDeleteMode, is_valid_parent, normalize_folder_name,
};

use crate::AppResult;
use crate::ports::FolderStore;

/// Dossiers : arborescence, ordre, suppression.
///
/// Les refus (nom invalide, parent inconnu, cycle, dossier par défaut) rendent `None` : le
/// renderer garde alors son état.
pub struct FoldersService {
    folders: Arc<dyn FolderStore>,
}

impl FoldersService {
    /// Service branché sur son stockage.
    pub fn new(folders: Arc<dyn FolderStore>) -> Self {
        Self { folders }
    }

    /// Crée le dossier par défaut s'il manque : les notes créées à la volée y arrivent.
    pub fn ensure_default(&self) -> AppResult<()> {
        self.folders.ensure_default(DEFAULT_FOLDER_NAME)
    }

    /// Tous les dossiers.
    pub fn all(&self) -> AppResult<Vec<Folder>> {
        self.folders.all()
    }

    /// Le dossier par défaut (`Inbox`), où arrivent les notes créées sans dossier ; `None`
    /// s'il n'existe pas (encore).
    pub fn default_folder_id(&self) -> AppResult<Option<i64>> {
        let folders = self.folders.all()?;
        Ok(folders
            .iter()
            .find(|folder| folder.is_default)
            .map(|folder| folder.id))
    }

    /// Crée un dossier.
    pub fn create(&self, name: &str, parent_id: Option<i64>) -> AppResult<Option<Folder>> {
        let Some(name) = normalize_folder_name(name) else {
            return Ok(None);
        };
        if !self.parent_exists(parent_id)? {
            return Ok(None);
        }
        self.folders.insert(&name, parent_id).map(Some)
    }

    /// Renomme un dossier.
    pub fn rename(&self, id: i64, name: &str) -> AppResult<Option<Folder>> {
        let Some(name) = normalize_folder_name(name) else {
            return Ok(None);
        };
        if self.folders.by_id(id)?.is_none() {
            return Ok(None);
        }
        self.folders.rename(id, &name)?;
        self.folders.by_id(id)
    }

    /// Déplace un dossier ; refusé pour le dossier par défaut, un parent inconnu, ou un
    /// parent pris dans le sous-arbre du dossier.
    pub fn move_folder(&self, id: i64, parent_id: Option<i64>) -> AppResult<Option<Folder>> {
        let Some(folder) = self.folders.by_id(id)? else {
            return Ok(None);
        };
        if !self.can_move(&folder, parent_id)? {
            return Ok(None);
        }
        self.folders.set_parent(id, parent_id)?;
        self.folders.by_id(id)
    }

    /// Range le dossier sous `parent_id` à la position donnée par `ordered_ids` (tous les
    /// enfants de ce parent dans l'ordre d'affichage).
    pub fn place(
        &self,
        id: i64,
        parent_id: Option<i64>,
        ordered_ids: &[i64],
    ) -> AppResult<Option<Folder>> {
        let Some(folder) = self.folders.by_id(id)? else {
            return Ok(None);
        };
        if folder.parent_id != parent_id && self.move_folder(id, parent_id)?.is_none() {
            return Ok(None);
        }
        self.folders.set_positions(parent_id, ordered_ids)?;
        self.folders.by_id(id)
    }

    /// Supprime le dossier et ses sous-dossiers ; rend les notes supprimées, `None` si refusé
    /// (dossier par défaut ou inconnu).
    pub fn delete(&self, id: i64, mode: FolderDeleteMode) -> AppResult<Option<Vec<i64>>> {
        match self.folders.by_id(id)? {
            Some(folder) if !folder.is_default => self.folders.delete(id, mode).map(Some),
            Some(_) | None => Ok(None),
        }
    }

    /// Vide le dossier (notes, sous-dossiers) en le gardant, le dossier par défaut compris ;
    /// rend les notes supprimées, `None` pour un dossier inconnu.
    pub fn empty(&self, id: i64) -> AppResult<Option<Vec<i64>>> {
        if self.folders.by_id(id)?.is_none() {
            return Ok(None);
        }
        self.folders.empty(id).map(Some)
    }

    /// Colore des dossiers ; une couleur invalide les décolore.
    pub fn set_color(&self, ids: &[i64], color: Option<&str>) -> AppResult<()> {
        if ids.is_empty() {
            return Ok(());
        }
        self.folders
            .set_color(ids, normalize_color(color).as_deref())
    }

    fn parent_exists(&self, parent_id: Option<i64>) -> AppResult<bool> {
        match parent_id {
            Some(parent) => Ok(self.folders.by_id(parent)?.is_some()),
            None => Ok(true),
        }
    }

    fn can_move(&self, folder: &Folder, parent_id: Option<i64>) -> AppResult<bool> {
        if folder.is_default || !self.parent_exists(parent_id)? {
            return Ok(false);
        }
        let subtree = self.folders.subtree_ids(folder.id)?;
        Ok(is_valid_parent(&subtree, parent_id))
    }
}

#[cfg(test)]
mod tests;
