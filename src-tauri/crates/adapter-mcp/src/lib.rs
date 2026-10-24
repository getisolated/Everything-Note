//! Serveur MCP (Model Context Protocol) local : des IA (Claude Code, Claude Desktop,
//! Cursor…) lisent et écrivent les notes de l'utilisateur.
//!
//! Transport HTTP « streamable » (crate `rmcp`), lié à `127.0.0.1` seulement, au chemin
//! [`MCP_PATH`]. Chaque requête doit porter le jeton des réglages
//! (`Authorization: Bearer …`) ; un en-tête `Origin` autre que `http://127.0.0.1` ou
//! `http://localhost` est refusé (protection contre le DNS rebinding), comme un en-tête
//! `Host` autre qu'une adresse locale.
//!
//! Les outils passent par les services du crate `app` partagés avec l'application ; après
//! chaque écriture, le rappel fourni au démarrage prévient les fenêtres. Pas d'outil de
//! suppression, et les collections (fichiers sur le disque) restent hors de portée.

mod guard;
mod handler;
mod secrets;
mod server;
mod tools;

pub use secrets::RandomSecrets;
pub use server::{ChangeListener, MCP_PATH, McpConfig, McpServer, McpServerHandle, McpStartError};
pub use tools::McpServices;
