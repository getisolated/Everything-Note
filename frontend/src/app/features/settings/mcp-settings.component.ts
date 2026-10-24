import { ChangeDetectionStrategy, Component, OnDestroy, computed, inject, input, signal } from '@angular/core';
import { I18nService } from '../../core/i18n/i18n.service';
import { McpService } from '../../core/services/mcp.service';
import { SettingsService } from '../../core/services/settings.service';
import { claudeCodeCommand, claudeDesktopConfig, maskToken, mcpStatusMessage } from '../../core/utils/mcp.util';

/** How long a "Copied" confirmation stays on its button. */
const COPIED_MS = 1500;

type CopyTarget = 'token' | 'claudeCode' | 'claudeDesktop';

/** Controls of the "AI (MCP)" settings that are more than a value: the access token and the client setup. */
@Component({
  selector: 'app-mcp-settings',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (part() === 'token') {
      <div class="row">
        <code class="value token" [class.empty]="!token()">{{ token() ? shownToken() : i18n.t('settings.mcp.noToken') }}</code>
        @if (token()) {
          <button class="btn" (click)="revealed.set(!revealed())">{{ i18n.t(revealed() ? 'settings.mcp.hide' : 'settings.mcp.show') }}</button>
          <button class="btn" (click)="copy('token', token())">{{ copyLabel('token') }}</button>
          <button class="btn" (click)="regenerate()">{{ i18n.t('settings.mcp.regenerate') }}</button>
        }
      </div>
    } @else {
      @if (statusMessage(); as message) {
        <div class="status" [class.running]="status()?.state === 'running'" [class.failed]="status()?.state === 'failed'">
          <span class="dot"></span>{{ i18n.t(message.key, message.params) }}
        </div>
      }
      @if (token()) {
        <div class="client">Claude Code</div>
        <div class="row">
          <pre class="value snippet">{{ claudeCode() }}</pre>
          <button class="btn" (click)="copy('claudeCode', claudeCode())">{{ copyLabel('claudeCode') }}</button>
        </div>
        <div class="client">Claude Desktop</div>
        <div class="row">
          <pre class="value snippet">{{ claudeDesktop() }}</pre>
          <button class="btn" (click)="copy('claudeDesktop', claudeDesktop())">{{ copyLabel('claudeDesktop') }}</button>
        </div>
      } @else {
        <div class="hint">{{ i18n.t('settings.mcp.noToken') }}</div>
      }
    }
  `,
  styles: [`
    :host { display: block; }
    .row { display: flex; align-items: flex-start; gap: 6px; max-width: 640px; }
    .value {
      flex: 1;
      min-width: 0;
      margin: 0;
      padding: 4px 8px;
      background: var(--daftr-bg-input);
      border: 1px solid var(--daftr-border-soft);
      border-radius: 2px;
      color: var(--daftr-text);
      font-family: var(--daftr-font-mono);
      font-size: 12px;
      user-select: text;
    }
    .token { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .token.empty { color: var(--daftr-text-dimmed); font-family: inherit; }
    .snippet { white-space: pre-wrap; word-break: break-all; max-height: 220px; overflow: auto; }
    .btn {
      flex: none;
      padding: 4px 10px;
      background: var(--daftr-bg-input);
      border: 1px solid var(--daftr-border-soft);
      border-radius: 2px;
      color: var(--daftr-text);
      font: inherit;
      cursor: pointer;
    }
    .btn:hover { border-color: var(--daftr-accent); }
    .client { margin: 10px 0 4px; color: var(--daftr-text-strong); font-weight: 600; }
    .status { display: flex; align-items: center; gap: 8px; color: var(--daftr-text-soft); user-select: text; }
    .status .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--daftr-text-faint); flex: none; }
    .status.running .dot { background: var(--daftr-syntax-comment); }
    .status.failed { color: var(--daftr-danger); }
    .status.failed .dot { background: var(--daftr-danger); }
    .hint { margin-top: 8px; color: var(--daftr-text-dimmed); }
  `],
})
export class McpSettingsComponent implements OnDestroy {
  protected readonly i18n = inject(I18nService);
  private readonly settingsService = inject(SettingsService);
  private readonly mcp = inject(McpService);

  /** `token`: the masked token and its buttons; `connection`: server state and client setup. */
  readonly part = input.required<'token' | 'connection'>();

  protected readonly revealed = signal(false);
  protected readonly copied = signal<CopyTarget | null>(null);
  private copiedTimer: ReturnType<typeof setTimeout> | null = null;

  protected readonly token = computed(() => this.settingsService.settings().mcpToken);
  private readonly port = computed(() => this.settingsService.settings().mcpPort);
  protected readonly shownToken = computed(() => (this.revealed() ? this.token() : maskToken(this.token())));
  protected readonly status = this.mcp.status;
  protected readonly statusMessage = computed(() => mcpStatusMessage(this.status()));
  protected readonly claudeCode = computed(() => claudeCodeCommand(this.port(), this.token()));
  protected readonly claudeDesktop = computed(() => claudeDesktopConfig(this.port(), this.token()));

  protected copyLabel(target: CopyTarget): string {
    return this.i18n.t(this.copied() === target ? 'settings.mcp.copied' : 'settings.mcp.copy');
  }

  protected async copy(target: CopyTarget, text: string): Promise<void> {
    await navigator.clipboard.writeText(text);
    this.copied.set(target);
    if (this.copiedTimer) clearTimeout(this.copiedTimer);
    this.copiedTimer = setTimeout(() => this.copied.set(null), COPIED_MS);
  }

  protected async regenerate(): Promise<void> {
    await this.settingsService.regenerateMcpToken();
  }

  ngOnDestroy(): void {
    if (this.copiedTimer) clearTimeout(this.copiedTimer);
  }
}
