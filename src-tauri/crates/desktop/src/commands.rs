//! Commandes IPC appelées par le renderer (`invoke('notes_get_all')`…).
//!
//! Toutes sont asynchrones : elles tournent hors du thread principal, qui garde la main sur
//! les fenêtres (les dialogues bloquants en dépendent).

mod collections;
mod export;
mod folders;
mod mcp;
mod notes;
mod settings;
mod shell;
mod updates;

use tauri::ipc::Invoke;

/// Le routeur des commandes.
pub fn handler() -> impl Fn(Invoke) -> bool + Send + Sync + 'static {
    tauri::generate_handler![
        notes::notes_get_all,
        notes::notes_get_by_id,
        notes::notes_create,
        notes::notes_update,
        notes::notes_move,
        notes::notes_place,
        notes::notes_delete,
        notes::notes_set_color,
        notes::notes_search,
        notes::notes_by_tag,
        notes::notes_all_tags,
        folders::folders_get_all,
        folders::folders_create,
        folders::folders_rename,
        folders::folders_move,
        folders::folders_place,
        folders::folders_delete,
        folders::folders_empty,
        folders::folders_set_color,
        collections::collections_list,
        collections::collections_pick,
        collections::collections_remove,
        collections::collections_rename,
        collections::collections_relocate,
        collections::collections_load,
        collections::collections_read,
        collections::collections_write,
        collections::collections_create_file,
        collections::collections_rename_path,
        collections::collections_move_path,
        collections::collections_trash,
        collections::collections_reveal,
        collections::collections_search,
        collections::collections_cancel_search,
        collections::collections_graph,
        settings::settings_get,
        settings::settings_set,
        settings::overlay_hide,
        mcp::mcp_status,
        mcp::mcp_regenerate_token,
        export::export_save,
        updates::update_get_info,
        updates::update_apply,
        shell::shell_open_external,
    ]
}
