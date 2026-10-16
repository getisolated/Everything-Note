import {
  ChangeDetectionStrategy, Component, ElementRef, OnDestroy, OnInit, ViewChild, computed, inject, signal
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { OverlayBackdrop } from '../../core/models/overlay-backdrop.model';
import { formatNoteTimestamp } from '../../core/utils/note-timestamp.util';
import { Note } from '../../core/models/note.model';
import { QUICK_NOTE_TAG } from '../../core/models/settings.model';
import { ElectronBridgeService } from '../../core/services/electron-bridge.service';
import { NotesService } from '../../core/services/notes.service';
import { SettingsService } from '../../core/services/settings.service';

const MAX_DISPLAYED_NOTES = 50;
const MAX_INPUT_HEIGHT_PX = 140;

interface OverlayMessage {
  note: Note;
  /** True for notes sent during this session: they play the entrance animation. */
  fresh: boolean;
}

@Component({
  selector: 'app-overlay',
  standalone: true,
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="overlay" [class.has-backdrop]="backdrop() !== null">
      @if (backdrop(); as backdrop) {
        <!-- Desktop screenshot kept aligned with the screen while the window moves, then blurred by the CSS -->
        <img class="backdrop" alt="" [src]="backdrop.dataUrl" [style.width.px]="backdrop.width" [style.height.px]="backdrop.height" [style.transform]="backdropTransform()" />
      }
      <div class="drag-handle" title="Drag to move"><span class="grip"></span></div>

      <!-- column-reverse: newest message first in the DOM, rendered at the bottom, scroll anchored to the bottom -->
      <div class="messages">
        @for (message of reversedMessages(); track message.note.id) {
          <div class="message" [class.enter]="message.fresh">
            <span>{{ message.note.content }}</span>
            <span class="message-time">{{ formatTime(message.note.createdAt) }}</span>
          </div>
        }
      </div>

      <textarea
        #input
        class="input"
        rows="1"
        [placeholder]="placeholder()"
        [ngModel]="draft()"
        (ngModelChange)="onDraftChange($event)"
        (keydown)="onKeydown($event)"
      ></textarea>
    </div>
  `,
  styleUrls: ['./overlay.component.scss'],
})
export class OverlayComponent implements OnInit, OnDestroy {
  private bridge = inject(ElectronBridgeService);
  private notesService = inject(NotesService);
  private settingsService = inject(SettingsService);

  @ViewChild('input', { static: true }) inputRef!: ElementRef<HTMLTextAreaElement>;

  readonly backdrop = signal<OverlayBackdrop | null>(null);
  readonly backdropTransform = signal('');
  readonly messages = signal<OverlayMessage[]>([]);
  readonly reversedMessages = computed(() => [...this.messages()].reverse());
  // Lives in the component: the window is only hidden (never destroyed), so the draft survives hide/show
  readonly draft = signal('');
  readonly placeholder = computed(() =>
    this.settingsService.settings().enterToSend
      ? 'Write a note… (Enter to send)'
      : 'Write a note… (Ctrl+Enter to send)');

  private unsubscribers: (() => void)[] = [];
  private trackingFrame = 0;

  async ngOnInit(): Promise<void> {
    this.unsubscribers.push(
      this.bridge.onOverlayBackdrop(backdrop => this.onBackdrop(backdrop)),
      this.bridge.onOverlayShown(() => this.onShown()),
      this.bridge.onNotesChanged(() => this.loadMessages()),
    );
    await this.loadMessages();
    this.focusInput();
  }

  ngOnDestroy(): void {
    cancelAnimationFrame(this.trackingFrame);
    this.unsubscribers.forEach(unsubscribe => unsubscribe());
  }

  protected formatTime(createdAt: string): string {
    return formatNoteTimestamp(createdAt);
  }

  onDraftChange(value: string): void {
    this.draft.set(value);
    this.resizeInput();
  }

  onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      this.bridge.hideOverlay();
      return;
    }
    if (event.key !== 'Enter' || event.isComposing) return;

    // Ctrl+Enter always sends; plain Enter sends only when configured so (Shift+Enter keeps the new line)
    const shouldSend = event.ctrlKey || (this.settingsService.settings().enterToSend && !event.shiftKey);
    if (shouldSend) {
      event.preventDefault();
      this.send();
    }
  }

  private onBackdrop(backdrop: OverlayBackdrop | null): void {
    this.backdrop.set(backdrop);
    this.alignBackdrop();
  }

  // The window is draggable and the screenshot is not: re-align it every frame while the overlay is visible
  private alignBackdrop(): void {
    cancelAnimationFrame(this.trackingFrame);
    const backdrop = this.backdrop();
    if (!backdrop || document.hidden) {
      return;
    }
    const transform = `translate(${backdrop.x - window.screenX}px, ${backdrop.y - window.screenY}px)`;
    if (transform !== this.backdropTransform()) {
      this.backdropTransform.set(transform);
    }
    this.trackingFrame = requestAnimationFrame(() => this.alignBackdrop());
  }

  private async onShown(): Promise<void> {
    this.alignBackdrop();
    await this.loadMessages();
    this.focusInput();
  }

  private async send(): Promise<void> {
    const text = this.draft().trim();
    if (!text) return;

    // Cleared immediately so a fast second Enter cannot send the same text twice
    this.draft.set('');
    this.resizeInput();

    const note = await this.bridge.createNote(this.notesService.extractTitle(text), text, [QUICK_NOTE_TAG]);
    this.messages.update(list => [...list, { note, fresh: true }].slice(-MAX_DISPLAYED_NOTES));
  }

  private async loadMessages(): Promise<void> {
    const notes = await this.bridge.getNotesByTag(QUICK_NOTE_TAG);
    const recent = notes.sort((a, b) => a.id - b.id).slice(-MAX_DISPLAYED_NOTES);
    this.messages.set(recent.map(note => ({ note, fresh: false })));
  }

  private focusInput(): void {
    // Deferred so the window has actually received focus when the element is focused
    setTimeout(() => {
      this.inputRef.nativeElement.focus();
      this.resizeInput();
    });
  }

  private resizeInput(): void {
    const element = this.inputRef.nativeElement;
    element.style.height = 'auto';
    element.style.height = `${Math.min(element.scrollHeight, MAX_INPUT_HEIGHT_PX)}px`;
  }
}
