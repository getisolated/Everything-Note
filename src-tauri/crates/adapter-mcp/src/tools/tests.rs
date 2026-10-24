use std::sync::Arc;

use adapter_sqlite::SqliteStore;
use app::folders::FoldersService;
use app::notes::NotesService;

use super::*;

/// Base en mémoire avec le dossier par défaut (Inbox).
fn services() -> McpServices {
    let store = Arc::new(SqliteStore::open_in_memory().unwrap());
    let folders = Arc::new(FoldersService::new(store.clone()));
    folders.ensure_default().unwrap();

    McpServices {
        notes: Arc::new(NotesService::new(store.clone(), store)),
        folders,
    }
}

fn inbox(services: &McpServices) -> i64 {
    services.folders.default_folder_id().unwrap().unwrap()
}

fn create(services: &McpServices, content: &str, tags: &[&str]) -> i64 {
    let args = CreateNoteArgs {
        content: content.to_owned(),
        title: None,
        folder_id: None,
        tags: Some(tags.iter().map(|tag| (*tag).to_owned()).collect()),
    };
    create_note(services, args).unwrap()["id"].as_i64().unwrap()
}

fn ids(listed: &Value) -> Vec<i64> {
    listed["notes"]
        .as_array()
        .unwrap()
        .iter()
        .map(|note| note["id"].as_i64().unwrap())
        .collect()
}

#[test]
fn creates_a_note_in_the_inbox_titled_by_its_first_line() {
    let services = services();
    let args = CreateNoteArgs {
        content: "\n# Groceries\n- bread".to_owned(),
        title: None,
        folder_id: None,
        tags: Some(vec![" food ".to_owned(), "food".to_owned(), String::new()]),
    };

    let created = create_note(&services, args).unwrap();

    assert_eq!(created["title"], "Groceries");
    assert_eq!(created["folder_id"], inbox(&services));
    assert_eq!(created["tags"], json!(["food"]));
    assert!(created.get("content").is_none());
}

#[test]
fn puts_an_explicit_title_on_the_first_line() {
    let services = services();
    let args = CreateNoteArgs {
        content: "- bread".to_owned(),
        title: Some("Groceries".to_owned()),
        folder_id: None,
        tags: None,
    };

    let id = create_note(&services, args).unwrap()["id"]
        .as_i64()
        .unwrap();
    let note = get_note(&services, GetNoteArgs { id }).unwrap();

    assert_eq!(note["title"], "Groceries");
    assert_eq!(note["content"], "# Groceries\n\n- bread");
}

#[test]
fn creates_in_a_given_folder_and_refuses_an_unknown_one() {
    let services = services();
    let work = services.folders.create("Work", None).unwrap().unwrap();
    let in_folder = |folder_id| CreateNoteArgs {
        content: "Plan".to_owned(),
        title: None,
        folder_id: Some(folder_id),
        tags: None,
    };

    let created = create_note(&services, in_folder(work.id)).unwrap();
    let refused = create_note(&services, in_folder(999)).unwrap_err();

    assert_eq!(created["folder_id"], work.id);
    assert!(refused.contains("Folder 999 not found"), "{refused}");
}

#[test]
fn reads_a_whole_note_or_explains_it_is_missing() {
    let services = services();
    let id = create(&services, "Title\nbody", &["a"]);

    let note = get_note(&services, GetNoteArgs { id }).unwrap();
    let missing = get_note(&services, GetNoteArgs { id: 999 }).unwrap_err();

    assert_eq!(note["content"], "Title\nbody");
    assert_eq!(note["tags"], json!(["a"]));
    assert!(note["created_at"].is_string() && note["updated_at"].is_string());
    assert!(missing.contains("Note 999 not found"), "{missing}");
}

#[test]
fn replaces_the_content_and_the_title() {
    let services = services();
    let id = create(&services, "Old\nbody", &[]);
    let args = UpdateNoteArgs {
        id,
        content: "# New\nother".to_owned(),
    };

    let updated = update_note(&services, args).unwrap();

    assert_eq!(updated["title"], "New");
    assert_eq!(
        get_note(&services, GetNoteArgs { id }).unwrap()["content"],
        "# New\nother"
    );
    let missing = UpdateNoteArgs {
        id: 999,
        content: String::new(),
    };
    assert!(update_note(&services, missing).is_err());
}

#[test]
fn appends_after_a_blank_line() {
    let services = services();
    let id = create(&services, "Log\n- one\n", &[]);
    let args = AppendToNoteArgs {
        id,
        text: "- two".to_owned(),
    };

    append_to_note(&services, args).unwrap();

    assert_eq!(
        get_note(&services, GetNoteArgs { id }).unwrap()["content"],
        "Log\n- one\n\n- two"
    );
    let blank = AppendToNoteArgs {
        id,
        text: "  ".to_owned(),
    };
    assert!(append_to_note(&services, blank).is_err());
}

#[test]
fn lists_notes_by_folder_and_tag_within_the_limit() {
    let services = services();
    let work = services.folders.create("Work", None).unwrap().unwrap();
    let first = create(&services, "One", &["x"]);
    let second = create(&services, "Two", &["x", "y"]);
    let third = create(&services, "Three", &[]);
    services.notes.move_to_folder(third, Some(work.id)).unwrap();

    let all = list_notes(&services, ListNotesArgs::default()).unwrap();
    let tagged = list_notes(
        &services,
        ListNotesArgs {
            tag: Some("x".to_owned()),
            ..ListNotesArgs::default()
        },
    )
    .unwrap();
    let in_work = list_notes(
        &services,
        ListNotesArgs {
            folder_id: Some(work.id),
            ..ListNotesArgs::default()
        },
    )
    .unwrap();
    let limited = list_notes(
        &services,
        ListNotesArgs {
            limit: Some(1),
            ..ListNotesArgs::default()
        },
    )
    .unwrap();

    assert_eq!(all["total"], 3);
    assert!(all["notes"][0].get("content").is_none());
    let mut tagged_ids = ids(&tagged);
    tagged_ids.sort_unstable();
    assert_eq!(tagged_ids, [first, second]);
    assert_eq!(ids(&in_work), [third]);
    assert_eq!(
        (limited["total"].as_u64(), ids(&limited).len()),
        (Some(3), 1)
    );
}

#[test]
fn refuses_to_list_an_unknown_folder() {
    let services = services();
    let args = ListNotesArgs {
        folder_id: Some(999),
        ..ListNotesArgs::default()
    };
    assert!(list_notes(&services, args).is_err());
}

#[test]
fn searches_with_a_snippet() {
    let services = services();
    let id = create(
        &services,
        "Trip\nRemember the passport and the tickets",
        &[],
    );
    create(&services, "Other\nnothing here", &[]);
    let search = |query: &str| SearchNotesArgs {
        query: query.to_owned(),
        limit: None,
    };

    let found = search_notes(&services, search("passp")).unwrap();

    assert_eq!(ids(&found), [id]);
    assert!(
        found["notes"][0]["snippet"]
            .as_str()
            .unwrap()
            .contains("passport"),
        "{found}"
    );
    assert!(search_notes(&services, search("  ")).is_err());
}

#[test]
fn lists_folders_with_their_path() {
    let services = services();
    let work = services.folders.create("Work", None).unwrap().unwrap();
    services.folders.create("Ideas", Some(work.id)).unwrap();

    let listed = list_folders(&services).unwrap();
    let paths: Vec<&str> = listed["folders"]
        .as_array()
        .unwrap()
        .iter()
        .map(|folder| folder["path"].as_str().unwrap())
        .collect();

    assert_eq!(paths, ["Inbox", "Work", "Work/Ideas"]);
    assert_eq!(listed["folders"][0]["is_default"], true);
    assert_eq!(listed["folders"][2]["parent_id"], work.id);
}

#[test]
fn lists_the_tags() {
    let services = services();
    create(&services, "One", &["b", "a"]);
    create(&services, "Two", &["a"]);

    assert_eq!(list_tags(&services).unwrap(), json!({ "tags": ["a", "b"] }));
}

#[test]
fn bounds_the_limits() {
    assert_eq!(limit(None, 50), 50);
    assert_eq!(limit(Some(0), 50), 1);
    assert_eq!(limit(Some(10_000), 50), MAX_LIMIT);
}
