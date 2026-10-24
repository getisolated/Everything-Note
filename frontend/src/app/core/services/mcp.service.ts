import { Injectable, OnDestroy, inject, signal } from '@angular/core';
import type { McpStatusDto } from '../bindings/McpStatusDto';
import { DesktopBridgeService } from './desktop-bridge.service';

/** State of the local MCP server (running, stopped, port taken…), pushed by the main process. */
@Injectable({ providedIn: 'root' })
export class McpService implements OnDestroy {
  private readonly bridge = inject(DesktopBridgeService);
  private readonly _status = signal<McpStatusDto | null>(null);
  private readonly unsubscribe: () => void;
  /** Set once a pushed state arrived: the initial request must not overwrite it with an older one. */
  private pushed = false;

  /** `null` until known, and outside the desktop app. */
  readonly status = this._status.asReadonly();

  constructor() {
    this.unsubscribe = this.bridge.onMcpStatus(status => {
      this.pushed = true;
      this._status.set(status);
    });
    void this.load();
  }

  private async load(): Promise<void> {
    const status = await this.bridge.getMcpStatus();
    if (status && !this.pushed) this._status.set(status);
  }

  ngOnDestroy(): void {
    this.unsubscribe();
  }
}
