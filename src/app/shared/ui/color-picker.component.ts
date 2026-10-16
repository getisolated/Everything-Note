import { ChangeDetectionStrategy, Component, computed, input, OnInit, output, signal } from '@angular/core';
import { Hsv, hexToHsv, hsvToHex, normalizeHex } from '../../core/utils/color.util';

const RECENT_COLORS_KEY = 'evn-recent-colors';
const MAX_RECENT_COLORS = 8;
const PANEL_WIDTH_PX = 236;
const PANEL_HEIGHT_PX = 330;
const VIEWPORT_MARGIN_PX = 8;

/** Swatches offered before any color was ever picked; readable on light and dark themes. */
const PRESET_COLORS = ['#e5534b', '#f69d50', '#d4a72c', '#57ab5a', '#39c5cf', '#539bf5', '#986ee2', '#e275ad'];

/** Free color picker (saturation/value area, hue slider, hex field, presets and recent colors) shown as a popover. */
@Component({
  selector: 'app-color-picker',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:keydown.escape)': 'closed.emit()',
  },
  template: `
    <div class="backdrop" (click)="closed.emit()" (contextmenu)="$event.preventDefault(); closed.emit()"></div>
    <div class="panel" role="dialog" aria-label="Pick a color" [style.left.px]="position().left" [style.top.px]="position().top">
      <div
        class="sv-area"
        [style.background-color]="hueColor()"
        (pointerdown)="startDrag($event, 'sv')"
        (pointermove)="drag($event, 'sv')"
        (pointerup)="endDrag($event)"
      >
        <span class="sv-thumb" [style.left.%]="hsv().s * 100" [style.top.%]="(1 - hsv().v) * 100" [style.background]="hex()"></span>
      </div>

      <div
        class="hue-slider"
        (pointerdown)="startDrag($event, 'hue')"
        (pointermove)="drag($event, 'hue')"
        (pointerup)="endDrag($event)"
      >
        <span class="hue-thumb" [style.left.%]="hsv().h / 3.6"></span>
      </div>

      <div class="hex-row">
        <span class="preview" [style.background]="hex()"></span>
        <input
          class="hex-input"
          aria-label="Hexadecimal color"
          spellcheck="false"
          maxlength="7"
          [value]="hex()"
          (change)="onHexInput($event)"
          (keydown.enter)="onHexInput($event)"
        />
      </div>

      <div class="swatches" aria-label="Presets">
        @for (color of presets; track color) {
          <button type="button" class="swatch" [style.background]="color" [title]="color" (click)="choose(color)"></button>
        }
      </div>
      @if (recent().length) {
        <div class="swatches-label">Recent</div>
        <div class="swatches" aria-label="Recent colors">
          @for (color of recent(); track color) {
            <button type="button" class="swatch" [style.background]="color" [title]="color" (click)="choose(color)"></button>
          }
        </div>
      }

      <div class="actions">
        <button type="button" class="btn link" (click)="picked.emit(null)">No color</button>
        <span class="spacer"></span>
        <button type="button" class="btn" (click)="closed.emit()">Cancel</button>
        <button type="button" class="btn primary" (click)="apply()">Apply</button>
      </div>
    </div>
  `,
  styleUrls: ['./color-picker.component.scss'],
})
export class ColorPickerComponent implements OnInit {
  /** Color shown when opening; null starts from the first preset. */
  readonly value = input<string | null>(null);
  /** Viewport point the popover opens at (kept inside the window). */
  readonly x = input(0);
  readonly y = input(0);

  /** The chosen color, `null` for "no color". */
  readonly picked = output<string | null>();
  readonly closed = output<void>();

  protected readonly presets = PRESET_COLORS;
  protected readonly hsv = signal<Hsv>(hexToHsv(PRESET_COLORS[0] as string));
  protected readonly hex = computed(() => hsvToHex(this.hsv()));
  protected readonly hueColor = computed(() => `hsl(${this.hsv().h}, 100%, 50%)`);
  protected readonly recent = signal<string[]>(readRecentColors());

  protected readonly position = computed(() => ({
    left: Math.max(VIEWPORT_MARGIN_PX, Math.min(this.x(), window.innerWidth - PANEL_WIDTH_PX - VIEWPORT_MARGIN_PX)),
    top: Math.max(VIEWPORT_MARGIN_PX, Math.min(this.y(), window.innerHeight - PANEL_HEIGHT_PX - VIEWPORT_MARGIN_PX)),
  }));

  ngOnInit(): void {
    const initial = this.value();

    if (initial) {
      this.hsv.set(hexToHsv(initial));
    }
  }

  protected startDrag(event: PointerEvent, target: 'sv' | 'hue'): void {
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    this.drag(event, target);
  }

  protected drag(event: PointerEvent, target: 'sv' | 'hue'): void {
    const element = event.currentTarget as HTMLElement;

    if (!element.hasPointerCapture(event.pointerId)) {
      return;
    }

    const box = element.getBoundingClientRect();
    const x = clamp01((event.clientX - box.left) / box.width);
    const y = clamp01((event.clientY - box.top) / box.height);

    if (target === 'sv') {
      this.hsv.update(hsv => ({ ...hsv, s: x, v: 1 - y }));
    } else {
      this.hsv.update(hsv => ({ ...hsv, h: Math.min(359.9, x * 360) }));
    }
  }

  protected endDrag(event: PointerEvent): void {
    (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
  }

  protected onHexInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    const hex = normalizeHex(input.value);

    if (hex) {
      this.hsv.set(hexToHsv(hex));
    }
    input.value = this.hex();
  }

  protected choose(color: string): void {
    this.hsv.set(hexToHsv(color));
  }

  protected apply(): void {
    const hex = this.hex();
    saveRecentColor(hex);
    this.picked.emit(hex);
  }
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function readRecentColors(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(RECENT_COLORS_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.map(value => normalizeHex(String(value))).filter((hex): hex is string => hex !== null) : [];
  } catch {
    return [];
  }
}

function saveRecentColor(hex: string): void {
  const next = [hex, ...readRecentColors().filter(color => color !== hex)].slice(0, MAX_RECENT_COLORS);

  try {
    localStorage.setItem(RECENT_COLORS_KEY, JSON.stringify(next));
  } catch {
    // Storage unavailable: no recent colors next time, nothing else is lost
  }
}
