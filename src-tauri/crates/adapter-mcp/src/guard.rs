//! Contrôle d'accès de chaque requête : jeton et origine.

use std::sync::Arc;

use axum::extract::{Request, State};
use axum::http::{HeaderMap, StatusCode, header};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};

/// Laisse passer la requête si son origine est locale et qu'elle porte le jeton ; sinon
/// `403` (origine) ou `401` (jeton).
pub(crate) async fn require_token(
    State(token): State<Arc<str>>,
    request: Request,
    next: Next,
) -> Response {
    let headers = request.headers();

    if !origin_allowed(headers) {
        tracing::warn!("requête MCP refusée : origine non locale");
        return (StatusCode::FORBIDDEN, "Forbidden: origin not allowed").into_response();
    }
    if !bearer_matches(header_text(headers, header::AUTHORIZATION), &token) {
        return (
            StatusCode::UNAUTHORIZED,
            [(header::WWW_AUTHENTICATE, "Bearer")],
            "Unauthorized: missing or invalid bearer token",
        )
            .into_response();
    }
    next.run(request).await
}

/// L'en-tête `Origin` est absent (client hors navigateur) ou désigne une page locale ; un
/// en-tête illisible est refusé.
fn origin_allowed(headers: &HeaderMap) -> bool {
    match headers.get(header::ORIGIN) {
        None => true,
        Some(value) => value.to_str().is_ok_and(is_local_origin),
    }
}

/// `http://127.0.0.1` ou `http://localhost`, avec ou sans port.
fn is_local_origin(origin: &str) -> bool {
    let Some(authority) = origin.strip_prefix("http://") else {
        return false;
    };
    let (host, port) = match authority.split_once(':') {
        Some((host, port)) => (host, Some(port)),
        None => (authority, None),
    };
    let valid_port = port.is_none_or(|port| {
        port.bytes().all(|byte| byte.is_ascii_digit()) && port.parse::<u16>().is_ok()
    });

    matches!(host, "127.0.0.1" | "localhost") && valid_port
}

fn header_text(headers: &HeaderMap, name: header::HeaderName) -> Option<&str> {
    headers.get(name).and_then(|value| value.to_str().ok())
}

/// `Authorization: Bearer <jeton>` (schéma sans casse) avec le bon jeton, comparé en temps
/// constant.
fn bearer_matches(authorization: Option<&str>, token: &str) -> bool {
    let Some((scheme, credentials)) = authorization.and_then(|value| value.split_once(' ')) else {
        return false;
    };
    scheme.eq_ignore_ascii_case("bearer")
        && !token.is_empty()
        && constant_time_eq(credentials.trim().as_bytes(), token.as_bytes())
}

/// Égalité dont la durée ne dépend pas de la position de la première différence.
fn constant_time_eq(left: &[u8], right: &[u8]) -> bool {
    left.len() == right.len()
        && left
            .iter()
            .zip(right)
            .fold(0_u8, |difference, (a, b)| difference | (a ^ b))
            == 0
}

#[cfg(test)]
mod tests {
    use axum::http::HeaderValue;

    use super::*;

    #[test]
    fn accepts_only_local_http_origins() {
        for origin in [
            "http://127.0.0.1",
            "http://127.0.0.1:38427",
            "http://localhost",
            "http://localhost:3000",
        ] {
            assert!(is_local_origin(origin), "{origin}");
        }
        for origin in [
            "https://localhost",
            "http://evil.example",
            "http://localhost.evil.example",
            "http://127.0.0.1.nip.io",
            "http://localhost:99999",
            "http://localhost:",
            "http://localhost:80/",
            "null",
            "",
        ] {
            assert!(!is_local_origin(origin), "{origin}");
        }
    }

    #[test]
    fn lets_requests_without_origin_through() {
        let mut headers = HeaderMap::new();
        assert!(origin_allowed(&headers));

        headers.insert(
            header::ORIGIN,
            HeaderValue::from_static("http://evil.example"),
        );
        assert!(!origin_allowed(&headers));
    }

    #[test]
    fn requires_the_exact_bearer_token() {
        let token = "abc123";

        assert!(bearer_matches(Some("Bearer abc123"), token));
        assert!(bearer_matches(Some("bearer abc123"), token));
        assert!(!bearer_matches(Some("Bearer abc12"), token));
        assert!(!bearer_matches(Some("Bearer abc1234"), token));
        assert!(!bearer_matches(Some("Basic abc123"), token));
        assert!(!bearer_matches(Some("abc123"), token));
        assert!(!bearer_matches(None, token));
        assert!(!bearer_matches(Some("Bearer "), ""));
    }
}
