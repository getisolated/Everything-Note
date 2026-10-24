//! Le serveur MCP de bout en bout : un vrai serveur HTTP sur un port libre, une base
//! SQLite temporaire, et les requêtes JSON-RPC d'un client MCP (initialisation, liste des
//! outils, appels), avec et sans jeton.
//!
//! Le client HTTP est écrit à la main (HTTP/1.1 sur TCP) : `reqwest`, compilé avec les
//! options TLS du reste de l'espace de travail, exige un fournisseur de chiffrement.

// Tout ce fichier est du code de test (`unwrap`, `panic!` permis comme dans les `mod tests`)
#![cfg(test)]

use std::io;
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;

use adapter_mcp::{MCP_PATH, McpConfig, McpServer, McpServerHandle, McpServices, McpStartError};
use adapter_sqlite::SqliteStore;
use app::folders::FoldersService;
use app::notes::NotesService;
use domain::note::NewNote;
use serde_json::{Value, json};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;

const TOKEN: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const PROTOCOL_VERSION: &str = "2025-06-18";

/// Un serveur démarré sur une base temporaire contenant une note.
struct Running {
    handle: McpServerHandle,
    services: McpServices,
    changes: Arc<AtomicUsize>,
    note_id: i64,
    _directory: tempfile::TempDir,
}

fn services(directory: &tempfile::TempDir) -> McpServices {
    let store = Arc::new(SqliteStore::open(&directory.path().join("notes.db")).unwrap());
    let folders = Arc::new(FoldersService::new(store.clone()));
    folders.ensure_default().unwrap();

    McpServices {
        notes: Arc::new(NotesService::new(store.clone(), store)),
        folders,
    }
}

async fn start_on(port: u16, services: McpServices) -> (McpServerHandle, Arc<AtomicUsize>) {
    let changes = Arc::new(AtomicUsize::new(0));
    let counter = changes.clone();
    let config = McpConfig {
        port,
        token: TOKEN.to_owned(),
    };
    let on_change = Arc::new(move || {
        counter.fetch_add(1, Ordering::SeqCst);
    });

    let handle = McpServer::start(config, services, on_change).await.unwrap();
    (handle, changes)
}

async fn start() -> Running {
    let directory = tempfile::tempdir().unwrap();
    let services = services(&directory);
    let note = NewNote {
        title: "Hello".to_owned(),
        content: "Hello\nworld".to_owned(),
        tags: vec!["greeting".to_owned()],
        folder_id: None,
    };
    let note_id = services.notes.create(note).unwrap().id;
    let (handle, changes) = start_on(0, services.clone()).await;

    Running {
        handle,
        services,
        changes,
        note_id,
        _directory: directory,
    }
}

/// Réponse HTTP lue jusqu'à la fermeture de la connexion.
struct Response {
    status: u16,
    headers: Vec<(String, String)>,
    body: String,
}

impl Response {
    fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(key, _)| key.eq_ignore_ascii_case(name))
            .map(|(_, value)| value.as_str())
    }
}

/// Une requête HTTP/1.1 (`Connection: close`) sur `127.0.0.1:port`.
async fn http(
    port: u16,
    method: &str,
    path: &str,
    headers: &[(&str, String)],
    body: &str,
) -> io::Result<Response> {
    let mut stream = TcpStream::connect(("127.0.0.1", port)).await?;
    let mut request = format!(
        "{method} {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\nContent-Length: {}\r\n",
        body.len()
    );
    for (name, value) in headers {
        request.push_str(&format!("{name}: {value}\r\n"));
    }
    request.push_str("\r\n");
    request.push_str(body);
    stream.write_all(request.as_bytes()).await?;

    let mut raw = Vec::new();
    tokio::time::timeout(Duration::from_secs(10), stream.read_to_end(&mut raw))
        .await
        .map_err(|_| io::Error::new(io::ErrorKind::TimedOut, "no response"))??;
    Ok(parse_response(&raw))
}

fn parse_response(raw: &[u8]) -> Response {
    let text = String::from_utf8_lossy(raw);
    let (head, body) = text.split_once("\r\n\r\n").unwrap();
    let mut lines = head.split("\r\n");
    let status = lines
        .next()
        .unwrap()
        .split(' ')
        .nth(1)
        .unwrap()
        .parse()
        .unwrap();
    let headers: Vec<(String, String)> = lines
        .filter_map(|line| line.split_once(':'))
        .map(|(name, value)| (name.trim().to_owned(), value.trim().to_owned()))
        .collect();
    let mut response = Response {
        status,
        headers,
        body: body.to_owned(),
    };
    if response.header("transfer-encoding") == Some("chunked") {
        response.body = dechunk(body);
    }
    response
}

/// Corps d'une réponse `Transfer-Encoding: chunked`.
fn dechunk(mut chunked: &str) -> String {
    let mut body = String::new();
    while let Some((size_line, rest)) = chunked.split_once("\r\n") {
        let size_text = size_line.split(';').next().unwrap().trim();
        let size = usize::from_str_radix(size_text, 16).unwrap();
        if size == 0 {
            break;
        }
        body.push_str(&rest[..size]);
        chunked = rest[size..].trim_start_matches("\r\n");
    }
    body
}

/// Client MCP minimal : en-têtes du transport HTTP « streamable ».
struct Client {
    port: u16,
    session: Option<String>,
}

impl Client {
    fn new(port: u16) -> Self {
        Self {
            port,
            session: None,
        }
    }

    async fn post(&self, token: Option<&str>, origin: Option<&str>, body: &Value) -> Response {
        let mut headers = vec![
            ("Content-Type", "application/json".to_owned()),
            ("Accept", "application/json, text/event-stream".to_owned()),
        ];
        if let Some(token) = token {
            headers.push(("Authorization", format!("Bearer {token}")));
        }
        if let Some(origin) = origin {
            headers.push(("Origin", origin.to_owned()));
        }
        if let Some(session) = &self.session {
            headers.push(("Mcp-Session-Id", session.clone()));
            headers.push(("MCP-Protocol-Version", PROTOCOL_VERSION.to_owned()));
        }
        http(self.port, "POST", MCP_PATH, &headers, &body.to_string())
            .await
            .unwrap()
    }

    /// Requête JSON-RPC authentifiée ; rend le message de réponse.
    async fn call(&self, id: u64, method: &str, params: Value) -> Value {
        let body = json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params });
        let response = self.post(Some(TOKEN), None, &body).await;
        assert_eq!(response.status, 200, "{method}: {}", response.body);
        response_message(&response.body, id)
    }

    async fn initialize(&mut self) -> Value {
        let response = self.post(Some(TOKEN), None, &initialize_request()).await;
        assert_eq!(response.status, 200, "{}", response.body);
        self.session = response.header("mcp-session-id").map(str::to_owned);
        let initialized = response_message(&response.body, 1);

        let notification = json!({ "jsonrpc": "2.0", "method": "notifications/initialized" });
        let acknowledged = self.post(Some(TOKEN), None, &notification).await;
        assert!((200..300).contains(&acknowledged.status));
        initialized
    }

    /// Appel d'outil ; rend `(texte, is_error)`.
    async fn tool(&self, id: u64, name: &str, arguments: Value) -> (String, bool) {
        let params = json!({ "name": name, "arguments": arguments });
        let message = self.call(id, "tools/call", params).await;
        let result = &message["result"];
        let text = result["content"][0]["text"].as_str().unwrap_or_default();
        (text.to_owned(), result["isError"] == json!(true))
    }
}

fn initialize_request() -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {
            "protocolVersion": PROTOCOL_VERSION,
            "capabilities": {},
            "clientInfo": { "name": "daftr-test", "version": "1.0" },
        },
    })
}

/// La réponse `id`, en JSON direct ou dans un flux SSE (`data: …`).
fn response_message(body: &str, id: u64) -> Value {
    let candidates: Vec<Value> = match serde_json::from_str::<Value>(body) {
        Ok(value) => vec![value],
        Err(_) => body
            .lines()
            .filter_map(|line| line.strip_prefix("data:"))
            .filter_map(|data| serde_json::from_str(data.trim()).ok())
            .collect(),
    };
    candidates
        .into_iter()
        .find(|message| message["id"] == json!(id))
        .unwrap_or_else(|| panic!("no response {id} in {body:?}"))
}

#[tokio::test(flavor = "multi_thread")]
async fn refuses_requests_without_the_token_or_from_a_web_page() {
    let server = start().await;
    let client = Client::new(server.handle.port());
    let body = initialize_request();

    let anonymous = client.post(None, None, &body).await;
    assert_eq!(anonymous.status, 401);
    assert_eq!(anonymous.header("www-authenticate"), Some("Bearer"));

    let wrong = client.post(Some(&"f".repeat(64)), None, &body).await;
    assert_eq!(wrong.status, 401);

    let web_page = client
        .post(Some(TOKEN), Some("http://evil.example"), &body)
        .await;
    assert_eq!(web_page.status, 403);

    let local_page = client
        .post(Some(TOKEN), Some("http://localhost:4200"), &body)
        .await;
    assert_eq!(local_page.status, 200);

    server.handle.stop().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn serves_the_tools_to_an_authenticated_client() {
    let server = start().await;
    let mut client = Client::new(server.handle.port());

    let initialized = client.initialize().await;
    assert_eq!(initialized["result"]["serverInfo"]["name"], "daftr");
    assert!(initialized["result"]["capabilities"]["tools"].is_object());

    let listed = client.call(2, "tools/list", json!({})).await;
    let tools = listed["result"]["tools"].as_array().unwrap();
    let mut names: Vec<&str> = tools
        .iter()
        .map(|tool| tool["name"].as_str().unwrap())
        .collect();
    names.sort_unstable();
    assert_eq!(
        names,
        [
            "append_to_note",
            "create_note",
            "get_note",
            "list_folders",
            "list_notes",
            "list_tags",
            "search_notes",
            "update_note",
        ]
    );
    let create = tools
        .iter()
        .find(|tool| tool["name"] == "create_note")
        .unwrap();
    assert_eq!(create["inputSchema"]["additionalProperties"], false);
    assert_eq!(create["inputSchema"]["required"], json!(["content"]));

    let (text, is_error) = client
        .tool(3, "get_note", json!({ "id": server.note_id }))
        .await;
    let note: Value = serde_json::from_str(&text).unwrap();
    assert!(!is_error);
    assert_eq!(note["content"], "Hello\nworld");
    assert_eq!(note["tags"], json!(["greeting"]));

    let (text, is_error) = client.tool(4, "get_note", json!({ "id": 999 })).await;
    assert!(is_error);
    assert!(text.contains("Note 999 not found"), "{text}");

    server.handle.stop().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn reports_every_write_to_the_app() {
    let server = start().await;
    let mut client = Client::new(server.handle.port());
    client.initialize().await;

    let arguments = json!({ "content": "From an AI", "tags": ["ai"] });
    let (text, is_error) = client.tool(2, "create_note", arguments).await;
    assert!(!is_error, "{text}");
    let created: Value = serde_json::from_str(&text).unwrap();
    let id = created["id"].as_i64().unwrap();

    let (_, is_error) = client
        .tool(3, "append_to_note", json!({ "id": id, "text": "More" }))
        .await;
    assert!(!is_error);

    let (_, is_error) = client.tool(4, "list_notes", json!({})).await;
    assert!(!is_error);
    assert_eq!(server.changes.load(Ordering::SeqCst), 2);

    let stored = server.services.notes.by_id(id).unwrap().unwrap();
    assert_eq!(stored.content, "From an AI\n\nMore");
    assert_eq!(
        stored.folder_id,
        server.services.folders.default_folder_id().unwrap()
    );

    server.handle.stop().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn answers_404_elsewhere_without_asking_for_the_token() {
    let server = start().await;

    let response = http(server.handle.port(), "GET", "/other", &[], "")
        .await
        .unwrap();

    assert_eq!(response.status, 404);
    server.handle.stop().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn frees_its_port_when_stopped_and_reports_a_busy_port() {
    let directory = tempfile::tempdir().unwrap();
    let services = services(&directory);
    let (first, _) = start_on(0, services.clone()).await;
    let port = first.port();
    assert_eq!(first.url(), format!("http://127.0.0.1:{port}/mcp"));

    let config = McpConfig {
        port,
        token: TOKEN.to_owned(),
    };
    let busy = McpServer::start(config, services.clone(), Arc::new(|| {})).await;
    assert!(matches!(busy, Err(McpStartError::PortInUse(p)) if p == port));

    first.stop().await;
    assert!(http(port, "GET", MCP_PATH, &[], "").await.is_err());

    let (restarted, _) = start_on(port, services).await;
    assert_eq!(restarted.port(), port);
    restarted.stop().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn never_starts_without_a_token() {
    let directory = tempfile::tempdir().unwrap();
    let config = McpConfig {
        port: 0,
        token: String::new(),
    };

    let started = McpServer::start(config, services(&directory), Arc::new(|| {})).await;

    assert!(matches!(started, Err(McpStartError::MissingToken)));
}
