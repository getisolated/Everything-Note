import type { McpStatusDto } from '../bindings/McpStatusDto';
import type { TranslationParams } from '../i18n/translate';
import type { TranslationKey } from '../i18n/translations';

/** Name of the server in the AI clients' configuration. */
export const MCP_SERVER_NAME = 'daftr';

/** Endpoint of the local MCP server (see the Rust crate `adapter-mcp`). */
export function mcpUrl(port: number): string {
  return `http://127.0.0.1:${port}/mcp`;
}

/** Claude Code command that registers the server. */
export function claudeCodeCommand(port: number, token: string): string {
  return `claude mcp add --transport http ${MCP_SERVER_NAME} ${mcpUrl(port)} --header "Authorization: Bearer ${token}"`;
}

/**
 * `claude_desktop_config.json` entry: Claude Desktop only launches local commands, so `mcp-remote` bridges it to the
 * HTTP server. The header goes through an environment variable: Claude Desktop on Windows does not escape the spaces
 * inside `args` (workaround documented by mcp-remote).
 */
export function claudeDesktopConfig(port: number, token: string): string {
  const server = {
    command: 'npx',
    args: ['-y', 'mcp-remote', mcpUrl(port), '--header', 'Authorization:${AUTH_HEADER}'],
    env: { AUTH_HEADER: `Bearer ${token}` },
  };
  return JSON.stringify({ mcpServers: { [MCP_SERVER_NAME]: server } }, null, 2);
}

/** The token hidden behind bullets, keeping its first characters to tell two tokens apart. */
export function maskToken(token: string): string {
  return token ? `${token.slice(0, 4)}${'•'.repeat(20)}` : '';
}

/** Translated sentence describing the server state, `null` when unknown (outside the desktop app). */
export function mcpStatusMessage(status: McpStatusDto | null): { key: TranslationKey; params?: TranslationParams } | null {
  if (!status) return null;
  switch (status.state) {
    case 'running':
      return { key: 'settings.mcp.status.running', params: { url: status.url ?? mcpUrl(status.port) } };
    case 'stopped':
      return { key: 'settings.mcp.status.stopped' };
    case 'failed':
      return status.error === 'portInUse'
        ? { key: 'settings.mcp.status.portInUse', params: { port: status.port } }
        : { key: 'settings.mcp.status.failed', params: { message: status.message ?? '' } };
  }
}
