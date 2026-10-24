//! Jetons aléatoires du serveur MCP.

use app::ports::SecretSource;
use app::{AppError, AppResult};

/// Nombre d'octets aléatoires d'un jeton.
const TOKEN_BYTES: usize = 32;

/// Jetons tirés du générateur aléatoire du système.
#[derive(Debug, Default, Clone, Copy)]
pub struct RandomSecrets;

impl SecretSource for RandomSecrets {
    fn new_token(&self) -> AppResult<String> {
        let mut bytes = [0_u8; TOKEN_BYTES];
        getrandom::fill(&mut bytes).map_err(AppError::storage)?;

        Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
    }
}

#[cfg(test)]
mod tests {
    use domain::settings::{MCP_TOKEN_LENGTH, is_mcp_token};

    use super::*;

    #[test]
    fn draws_well_formed_and_distinct_tokens() {
        let first = RandomSecrets.new_token().unwrap();
        let second = RandomSecrets.new_token().unwrap();

        assert_eq!(first.len(), MCP_TOKEN_LENGTH);
        assert!(is_mcp_token(&first));
        assert_ne!(first, second);
    }
}
