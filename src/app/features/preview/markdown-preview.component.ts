import { ChangeDetectionStrategy, Component, ElementRef, afterRenderEffect, computed, effect, inject, input, output } from '@angular/core';
import { PreviewScrollRequest } from '../../core/models/editor.model';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { LinkStatus } from '../../core/utils/note-paths.util';
import { createMarkdownRenderer, renderMarkdown } from '../../shared/markdown/markdown-renderer';
import { highlightCodeBlocks, renderMermaidBlocks } from '../../shared/markdown/preview-enhancers';
import { ThemeService } from '../../core/services/theme.service';

/** Space kept above the block a scroll sync brings to the top. */
const SYNC_TOP_MARGIN_PX = 16;

/** GitHub-like, read-only rendering of a note (preview mode, or beside the editor). */
@Component({
  selector: 'app-markdown-preview',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(click)': 'onClick($event)',
    '(scroll)': 'onScroll()',
  },
  template: `<article class="markdown-body" [innerHTML]="html()"></article>`,
  styleUrls: ['./markdown-preview.component.scss'],
})
export class MarkdownPreviewComponent {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly theme = inject(ThemeService);

  readonly content = input('');
  /** Whether a link target exists (same rule as the editor): broken local links are drawn in red. */
  readonly linkStatus = input<(target: string) => LinkStatus>(() => 'note');
  /** The editor scrolled (side by side): the preview follows. */
  readonly scrollRequest = input<PreviewScrollRequest | null>(null);

  /** A link was clicked: a note path, `note://id` or web address, to open. */
  readonly linkClicked = output<string>();
  /** The user scrolled the preview: first source line now at the top (1-based, fractional). */
  readonly scrolledToLine = output<number>();

  /** Set while the preview scrolls because of the editor: that scroll must not be echoed back. */
  private syncing = false;

  private readonly renderer = computed(() => createMarkdownRenderer({ linkStatus: this.linkStatus() }));

  /** Sanitized by DOMPurify in renderMarkdown, so Angular's own (stricter) sanitizer must not strip the classes and inputs. */
  protected readonly html = computed<SafeHtml>(() => this.sanitizer.bypassSecurityTrustHtml(renderMarkdown(this.renderer(), this.content())));

  constructor() {
    effect(() => {
      const request = this.scrollRequest();

      if (request) {
        this.scrollToLine(request.line);
      }
    });

    afterRenderEffect(() => {
      this.html();
      this.theme.theme();
      const root = this.host.nativeElement;
      // Every theme block of styles.scss sets color-scheme: the diagrams follow it
      const dark = getComputedStyle(document.documentElement).colorScheme.includes('dark');
      void highlightCodeBlocks(root);
      void renderMermaidBlocks(root, dark);
    });
  }

  /** Scrolls so that `line` (1-based, may be fractional) of the source is at the top, between the blocks around it. */
  scrollToLine(line: number): void {
    const blocks = this.blocks();
    let index = blocks.findIndex(block => block.line > line) - 1;

    if (index === -2) {
      index = blocks.length - 1;
    }

    const current = blocks[Math.max(0, index)];

    if (!current) {
      return;
    }

    const next = blocks[index + 1];
    const ratio = next && index >= 0 ? (line - current.line) / (next.line - current.line) : 0;
    const top = next ? current.top + ratio * (next.top - current.top) : current.top;

    this.syncing = true;
    this.host.nativeElement.scrollTop = Math.max(0, top - SYNC_TOP_MARGIN_PX);
  }

  protected onScroll(): void {
    if (this.syncing) {
      this.syncing = false;
      return;
    }

    const scrollTop = this.host.nativeElement.scrollTop + SYNC_TOP_MARGIN_PX;
    const blocks = this.blocks();
    const index = blocks.findIndex(block => block.top > scrollTop) - 1;
    const current = blocks[index >= 0 ? index : blocks.length - 1];

    if (!current) {
      return;
    }

    const next = blocks[index + 1];
    const ratio = next && index >= 0 ? (scrollTop - current.top) / Math.max(1, next.top - current.top) : 0;
    this.scrolledToLine.emit(next && index >= 0 ? current.line + ratio * (next.line - current.line) : current.line);
  }

  protected onClick(event: MouseEvent): void {
    const link = (event.target as HTMLElement).closest<HTMLAnchorElement>('a[href]');

    if (!link) {
      return;
    }

    // Never a navigation of the app page itself: links are opened by the app (footnote links have no data-href)
    event.preventDefault();
    const href = link.dataset['href'] ?? link.getAttribute('href') ?? '';

    // Anchors (footnotes, headings) stay inside the preview
    if (href.startsWith('#')) {
      this.host.nativeElement.querySelector(`[id="${CSS.escape(href.slice(1))}"]`)?.scrollIntoView({ block: 'start' });
      return;
    }

    this.linkClicked.emit(href);
  }

  /** Top-level blocks with their source line and their offset in the scrolled content. */
  private blocks(): { line: number; top: number }[] {
    const root = this.host.nativeElement;
    const origin = root.getBoundingClientRect().top - root.scrollTop;

    return Array.from(root.querySelectorAll<HTMLElement>('.markdown-body > [data-line]')).map(element => ({
      line: Number(element.dataset['line']),
      top: element.getBoundingClientRect().top - origin,
    }));
  }
}
