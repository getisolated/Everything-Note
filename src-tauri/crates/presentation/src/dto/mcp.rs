//! Serveur MCP (accès des IA aux notes).

use serde::Serialize;
use ts_rs::TS;

/// État du serveur MCP.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum McpState {
    /// Désactivé dans les réglages.
    Stopped,
    /// À l'écoute.
    Running,
    /// Activé mais n'a pas pu démarrer.
    Failed,
}

/// Cause d'un échec du démarrage.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum McpErrorKind {
    /// Le port est déjà pris par un autre programme.
    PortInUse,
    /// Autre échec ; `message` donne celui du système.
    Other,
}

/// État du serveur MCP montré dans les réglages.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct McpStatusDto {
    /// État.
    pub state: McpState,
    /// Port demandé.
    pub port: u16,
    /// Adresse du point d'accès quand le serveur tourne.
    pub url: Option<String>,
    /// Cause de l'échec.
    pub error: Option<McpErrorKind>,
    /// Message de l'échec (celui du système).
    pub message: Option<String>,
}

impl McpStatusDto {
    /// Serveur désactivé.
    pub fn stopped(port: u16) -> Self {
        Self {
            state: McpState::Stopped,
            port,
            url: None,
            error: None,
            message: None,
        }
    }

    /// Serveur à l'écoute sur `url`.
    pub fn running(port: u16, url: String) -> Self {
        Self {
            state: McpState::Running,
            url: Some(url),
            ..Self::stopped(port)
        }
    }

    /// Démarrage impossible : le port est pris.
    pub fn port_in_use(port: u16) -> Self {
        Self {
            state: McpState::Failed,
            error: Some(McpErrorKind::PortInUse),
            ..Self::stopped(port)
        }
    }

    /// Démarrage impossible pour une autre raison.
    pub fn failed(port: u16, message: String) -> Self {
        Self {
            state: McpState::Failed,
            error: Some(McpErrorKind::Other),
            message: Some(message),
            ..Self::stopped(port)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_for_the_renderer() {
        let running = McpStatusDto::running(4000, "http://127.0.0.1:4000/mcp".into());
        let busy = McpStatusDto::port_in_use(4000);

        assert_eq!(
            serde_json::to_value(running).unwrap(),
            serde_json::json!({
                "state": "running", "port": 4000, "url": "http://127.0.0.1:4000/mcp",
                "error": null, "message": null,
            })
        );
        assert_eq!(
            serde_json::to_value(busy).unwrap()["error"],
            serde_json::json!("portInUse")
        );
    }
}
