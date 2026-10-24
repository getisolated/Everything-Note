import { describe, it, expect } from 'vitest';
import type { McpStatusDto } from '../src/app/core/bindings/McpStatusDto';
import { translate } from '../src/app/core/i18n/translate';
import { claudeCodeCommand, claudeDesktopConfig, maskToken, mcpStatusMessage, mcpUrl } from '../src/app/core/utils/mcp.util';

const TOKEN = 'ab'.repeat(32);

function status(overrides: Partial<McpStatusDto>): McpStatusDto {
  return { state: 'stopped', port: 38427, url: null, error: null, message: null, ...overrides };
}

function message(value: McpStatusDto | null): string | null {
  const described = mcpStatusMessage(value);
  return described ? translate('en', described.key, described.params) : null;
}

describe('MCP client setup', () => {
  it('points to the local endpoint', () => {
    expect(mcpUrl(38427)).toBe('http://127.0.0.1:38427/mcp');
  });

  it('builds the Claude Code command with the bearer token', () => {
    expect(claudeCodeCommand(4000, TOKEN)).toBe(
      `claude mcp add --transport http daftr http://127.0.0.1:4000/mcp --header "Authorization: Bearer ${TOKEN}"`,
    );
  });

  it('builds the Claude Desktop entry through mcp-remote, the header in an environment variable', () => {
    const config = JSON.parse(claudeDesktopConfig(4000, TOKEN));
    expect(config).toEqual({
      mcpServers: {
        daftr: {
          command: 'npx',
          args: ['-y', 'mcp-remote', 'http://127.0.0.1:4000/mcp', '--header', 'Authorization:${AUTH_HEADER}'],
          env: { AUTH_HEADER: `Bearer ${TOKEN}` },
        },
      },
    });
  });

  it('hides the token but its first characters', () => {
    const token = '0123456789abcdef'.repeat(4);
    expect(maskToken(token).startsWith('0123')).toBe(true);
    expect(maskToken(token)).not.toContain('4567');
    expect(maskToken('')).toBe('');
  });
});

describe('mcpStatusMessage', () => {
  it('describes each state', () => {
    expect(message(null)).toBeNull();
    expect(message(status({ state: 'running', port: 4000, url: 'http://127.0.0.1:4000/mcp' }))).toBe('Running on http://127.0.0.1:4000/mcp');
    expect(message(status({}))).toBe('Stopped');
    expect(message(status({ state: 'failed', port: 4000, error: 'portInUse' }))).toBe('Port 4000 is already in use by another program: choose another port.');
    expect(message(status({ state: 'failed', error: 'other', message: 'denied' }))).toBe('The MCP server could not start: denied');
  });
});
