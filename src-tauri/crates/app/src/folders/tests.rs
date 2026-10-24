use std::sync::Arc;

use domain::folder::FolderDeleteMode;
use platform::sync::lock;

use super::FoldersService;
use crate::testing::{MemoryFolders, folder};

/// Inbox (1, par défaut) ; 2 à la racine ; 3 sous 2 ; 4 sous 3.
fn fixture() -> (Arc<MemoryFolders>, FoldersService) {
    let store = Arc::new(MemoryFolders::with(vec![
        folder(1, None, true),
        folder(2, None, false),
        folder(3, Some(2), false),
        folder(4, Some(3), false),
    ]));
    (store.clone(), FoldersService::new(store))
}

fn calls(store: &MemoryFolders) -> Vec<String> {
    lock(&store.calls).clone()
}

#[test]
fn creates_a_folder_with_a_trimmed_name() {
    let (_, service) = fixture();
    let created = service.create("  Work ", Some(2)).unwrap().unwrap();
    assert_eq!(
        (created.name.as_str(), created.parent_id),
        ("Work", Some(2))
    );
}

#[test]
fn refuses_an_invalid_name_or_an_unknown_parent() {
    let (_, service) = fixture();
    assert!(service.create("   ", None).unwrap().is_none());
    assert!(service.create("Work", Some(99)).unwrap().is_none());
    assert!(service.rename(99, "Work").unwrap().is_none());
}

#[test]
fn refuses_to_move_the_default_folder() {
    let (store, service) = fixture();
    assert!(service.move_folder(1, Some(2)).unwrap().is_none());
    assert!(
        calls(&store)
            .iter()
            .all(|call| !call.starts_with("set_parent"))
    );
}

#[test]
fn refuses_to_move_a_folder_into_its_subtree() {
    let (_, service) = fixture();
    assert!(service.move_folder(2, Some(4)).unwrap().is_none());
    assert!(service.move_folder(2, Some(2)).unwrap().is_none());
}

#[test]
fn moves_a_folder_elsewhere() {
    let (_, service) = fixture();
    assert_eq!(
        service.move_folder(4, None).unwrap().unwrap().parent_id,
        None
    );
}

#[test]
fn placing_under_a_new_parent_moves_then_renumbers() {
    let (store, service) = fixture();

    service.place(4, Some(2), &[3, 4]).unwrap();

    assert_eq!(
        calls(&store),
        [
            "set_parent 4 Some(2)".to_owned(),
            "set_positions Some(2) [3, 4]".to_owned()
        ]
    );
}

#[test]
fn a_refused_placement_does_not_renumber() {
    let (store, service) = fixture();

    assert!(service.place(1, Some(2), &[1]).unwrap().is_none());
    assert!(calls(&store).is_empty());
}

#[test]
fn never_deletes_the_default_folder() {
    let (store, service) = fixture();

    assert_eq!(
        service.delete(1, FolderDeleteMode::DeleteAll).unwrap(),
        None
    );
    assert_eq!(
        service.delete(99, FolderDeleteMode::DeleteAll).unwrap(),
        None
    );
    assert_eq!(
        service.delete(2, FolderDeleteMode::MoveToRoot).unwrap(),
        Some(vec![1, 2])
    );
    assert_eq!(calls(&store), ["delete 2 moveToRoot".to_owned()]);
}

#[test]
fn empties_any_known_folder_including_the_default_one() {
    let (_, service) = fixture();
    assert_eq!(service.empty(1).unwrap(), Some(vec![3]));
    assert_eq!(service.empty(99).unwrap(), None);
}

#[test]
fn finds_the_default_folder() {
    let (_, service) = fixture();
    assert_eq!(service.default_folder_id().unwrap(), Some(1));

    let without = FoldersService::new(Arc::new(MemoryFolders::with(vec![folder(2, None, false)])));
    assert_eq!(without.default_folder_id().unwrap(), None);
}
