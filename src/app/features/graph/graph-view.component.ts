import {
  Component, ElementRef, OnDestroy, afterNextRender, effect, inject, signal, untracked, viewChild,
  ChangeDetectionStrategy,
} from '@angular/core';
import {
  Simulation, SimulationLinkDatum, SimulationNodeDatum,
  forceCollide, forceLink, forceManyBody, forceRadial, forceSimulation, forceX, forceY,
} from 'd3-force';

import { BacklinksService } from '../../core/services/backlinks.service';
import { TabsService } from '../../core/services/tabs.service';
import { ThemeService } from '../../core/services/theme.service';
import { FileDocsService } from '../../core/services/file-docs.service';
import { CollectionsService } from '../../core/services/collections.service';
import { NoteGraph } from '../../core/utils/note-links.util';

interface SimNode extends SimulationNodeDatum {
  id: number;
  title: string;
  degree: number;
  missing: boolean;
  radius: number;
  /** 0 = fully visible, 1 = fully dimmed; eased toward its target on every frame. */
  dim: number;
}

interface SimLink extends SimulationLinkDatum<SimNode> {
  dim: number;
}

interface Palette {
  node: string;
  open: string;
  active: string;
  link: string;
  linkHighlight: string;
  missing: string;
  label: string;
  halo: string;
}

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 4;
const DRAG_THRESHOLD = 3;
const LABEL_MAX_LENGTH = 28;
const LABEL_FONT_SIZE = 11;
const LINK_CURVATURE = 0.12;
const ARROW_SIZE = 6;
/** Ticks run at once on the first layout, so the graph does not open as a ball exploding. */
const WARMUP_TICKS = 150;
/** Time constant (ms) of the dimming (about 95% reached after 3x) transition when hovering a node. */
const DIM_DURATION = 70;
const DIM_ALPHA_NODE = 0.15;
const DIM_ALPHA_LINK = 0.1;
/** Duration (ms) of the animation played when the graph appears. */
const INTRO_DURATION = 700;
const INTRO_START_ZOOM = 0.8;

function nodeRadius(degree: number): number {
  return 4 + Math.sqrt(degree) * 2.5;
}

/** Interactive graph of the links between notes (canvas + d3-force): zoom, pan, drag, click to open. */
@Component({
  selector: 'app-graph-view',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="graph" #host>
      <canvas #canvas
        (pointerdown)="onPointerDown($event)"
        (pointermove)="onPointerMove($event)"
        (pointerup)="onPointerUp($event)"
        (pointercancel)="onPointerUp($event)"
        (pointerleave)="onPointerLeave()"
        (dblclick)="fit()"
      ></canvas>

      <div class="graph-toolbar">
        <button type="button" class="graph-btn" [class.active]="hideOrphans()" (click)="backlinks.toggleHideOrphans()"
          title="Hide the notes without any link">Hide orphans</button>
        <button type="button" class="graph-btn" (click)="fit()" title="Fit the graph in the view (double-click)">Fit</button>
      </div>

      @if (graph().nodes.length === 0) {
        <div class="graph-empty">{{ collections.selectedRoot() !== null ? 'No markdown file to show.' : 'No notes to show.' }}</div>
      } @else {
        <div class="graph-legend">
          <span>{{ graph().nodes.length }} notes · {{ graph().links.length }} links</span>
          @if (graph().links.length === 0) {
            <span>Link notes by typing <kbd>note://ID</kbd> — see the <em>Copy Note Link</em> command</span>
          }
        </div>
      }
    </div>
  `,
  styleUrl: './graph-view.component.scss',
})
export class GraphViewComponent implements OnDestroy {
  protected readonly backlinks = inject(BacklinksService);
  private readonly tabs = inject(TabsService);
  private readonly fileDocs = inject(FileDocsService);
  protected readonly collections = inject(CollectionsService);
  private readonly theme = inject(ThemeService);

  protected readonly graph = this.backlinks.graph;
  protected readonly hideOrphans = this.backlinks.hideOrphans;

  private readonly canvasRef = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private readonly hostRef = viewChild.required<ElementRef<HTMLElement>>('host');
  private readonly ready = signal(false);

  private ctx: CanvasRenderingContext2D | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private frame = 0;
  private width = 0;
  private height = 0;
  private pixelRatio = 1;
  private palette: Palette | null = null;

  private readonly linkForce = forceLink<SimNode, SimLink>([]).id(d => d.id).distance(70).strength(0.4);
  private readonly simulation: Simulation<SimNode, SimLink> = forceSimulation<SimNode>([])
    .force('link', this.linkForce)
    .force('charge', forceManyBody<SimNode>().strength(-180).distanceMax(450))
    .force('collide', forceCollide<SimNode>().radius(d => d.radius + 6))
    .force('x', forceX<SimNode>(0).strength(d => d.degree === 0 ? 0 : 0.04))
    .force('y', forceY<SimNode>(0).strength(d => d.degree === 0 ? 0 : 0.04))
    .on('tick', () => this.scheduleDraw())
    .stop();

  private nodes: SimNode[] = [];
  private links: SimLink[] = [];
  private neighbours = new Map<number, Set<number>>();
  private signature = '';
  /** The view was fitted once: later resizes keep what the user did with zoom and pan. */
  private fitted = false;
  /** Hidden under another page: the intro plays again when it comes back. */
  private hidden = true;
  private introStart = 0;
  private lastDraw = 0;

  private view = { x: 0, y: 0, k: 1 };
  private hovered: SimNode | null = null;
  private dragged: SimNode | null = null;
  private panning = false;
  private moved = false;
  private pointerStart = { x: 0, y: 0 };
  private pointerLast = { x: 0, y: 0 };

  constructor() {
    afterNextRender(() => {
      const canvas = this.canvasRef().nativeElement;

      this.ctx = canvas.getContext('2d');
      canvas.addEventListener('wheel', this.onWheel, { passive: false });
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(this.hostRef().nativeElement);
      this.resize();
      this.ready.set(true);
    });

    effect(() => {
      const graph = this.graph();

      if (this.ready()) {
        untracked(() => this.applyGraph(graph));
      }
    });

    // Re-read the colours once the theme attribute is on the document
    effect(() => {
      this.theme.theme();
      requestAnimationFrame(() => {
        this.palette = null;
        this.scheduleDraw();
      });
    });

    // The open tabs and the reference note change the highlights, not the layout
    effect(() => {
      this.tabs.tabs();
      this.backlinks.referenceNoteId();
      this.scheduleDraw();
    });
  }

  ngOnDestroy(): void {
    this.simulation.stop();
    this.resizeObserver?.disconnect();
    this.canvasRef().nativeElement.removeEventListener('wheel', this.onWheel);
    cancelAnimationFrame(this.frame);
  }

  // ── Layout ─────────────────────────────────────────────────────────────────

  private applyGraph(graph: NoteGraph): void {
    const previous = new Map(this.nodes.map(n => [n.id, n]));
    const signature = this.signatureOf(graph);

    this.neighbours = new Map(graph.nodes.map(n => [n.id, new Set<number>()]));

    for (const { source, target } of graph.links) {
      this.neighbours.get(source)?.add(target);
      this.neighbours.get(target)?.add(source);
    }

    // Typing in a note rebuilds the graph for nothing most of the time: same shape, so no new layout
    if (signature === this.signature) {
      for (const n of graph.nodes) {
        const node = previous.get(n.id);

        if (node) {
          node.title = n.title;
        }
      }

      this.scheduleDraw();
      return;
    }

    this.signature = signature;

    const nodes = graph.nodes.map<SimNode>(n => {
      const kept = previous.get(n.id);

      return { ...n, radius: nodeRadius(n.degree), dim: kept?.dim ?? 0, x: kept?.x, y: kept?.y, vx: kept?.vx, vy: kept?.vy };
    });

    this.placeNewNodes(nodes, previous.size);
    this.nodes = nodes;
    this.hovered = null;
    this.dragged = null;
    this.simulation.nodes(this.nodes);
    this.links = graph.links.map(l => ({ source: l.source, target: l.target, dim: 0 }));
    this.linkForce.links(this.links);

    // Orphans orbit on a ring around the connected part
    const orphans = nodes.filter(n => n.degree === 0).length;
    const ringRadius = 160 + Math.sqrt(orphans) * 22;

    this.simulation.force('orphans', forceRadial<SimNode>(ringRadius, 0, 0).strength(d => d.degree === 0 ? 0.1 : 0));

    if (previous.size === 0) {
      this.simulation.alpha(1).tick(WARMUP_TICKS);
      this.fitted = false;
      this.fit();
    } else {
      this.simulation.alpha(0.4);
    }

    this.simulation.restart();
  }

  /** A new note starts next to a note it is linked to, so it does not cross the whole graph. */
  private placeNewNodes(nodes: SimNode[], previousCount: number): void {
    if (previousCount === 0) {
      return;
    }

    const byId = new Map(nodes.map(n => [n.id, n]));

    for (const node of nodes) {
      if (node.x !== undefined) {
        continue;
      }

      const anchorId = [...(this.neighbours.get(node.id) ?? [])].find(id => byId.get(id)?.x !== undefined);
      const anchor = anchorId === undefined ? undefined : byId.get(anchorId);

      if (anchor) {
        node.x = (anchor.x ?? 0) + (Math.random() - 0.5) * 40;
        node.y = (anchor.y ?? 0) + (Math.random() - 0.5) * 40;
      }
    }
  }

  private signatureOf(graph: NoteGraph): string {
    const nodes = graph.nodes.map(n => `${n.id}${n.missing ? 'm' : ''}:${n.degree}`).join(',');
    const links = graph.links.map(l => `${l.source}>${l.target}`).join(',');

    return `${nodes}|${links}`;
  }

  // ── View ───────────────────────────────────────────────────────────────────

  private resize(): void {
    const rect = this.hostRef().nativeElement.getBoundingClientRect();

    // Hidden (the home page is display: none under a note): nothing to size, keep the view as it is
    if (rect.width === 0 || rect.height === 0) {
      this.hidden = true;
      return;
    }

    if (this.hidden) {
      this.hidden = false;
      this.introStart = performance.now();
    }

    const canvas = this.canvasRef().nativeElement;

    this.pixelRatio = window.devicePixelRatio || 1;
    this.width = rect.width;
    this.height = rect.height;
    canvas.width = Math.round(rect.width * this.pixelRatio);
    canvas.height = Math.round(rect.height * this.pixelRatio);

    if (!this.fitted && this.nodes.length > 0) {
      this.fit();
    } else {
      this.scheduleDraw();
    }
  }

  /** Zooms and centres the view on the whole graph. */
  fit(): void {
    if (this.width === 0 || this.height === 0) {
      return;
    }

    if (this.nodes.length === 0) {
      this.view = { x: this.width / 2, y: this.height / 2, k: 1 };
      this.scheduleDraw();
      return;
    }

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const n of this.nodes) {
      minX = Math.min(minX, (n.x ?? 0) - n.radius);
      minY = Math.min(minY, (n.y ?? 0) - n.radius);
      maxX = Math.max(maxX, (n.x ?? 0) + n.radius);
      maxY = Math.max(maxY, (n.y ?? 0) + n.radius);
    }

    const boxWidth = Math.max(maxX - minX, 1);
    const boxHeight = Math.max(maxY - minY, 1);
    const fitted = Math.min(this.width / boxWidth, this.height / boxHeight) * 0.85;
    const k = Math.min(Math.max(fitted, MIN_ZOOM), 1.6);

    this.view = {
      k,
      x: this.width / 2 - ((minX + maxX) / 2) * k,
      y: this.height / 2 - ((minY + maxY) / 2) * k,
    };
    this.fitted = true;
    this.scheduleDraw();
  }

  private toWorld(screenX: number, screenY: number): { x: number; y: number } {
    return { x: (screenX - this.view.x) / this.view.k, y: (screenY - this.view.y) / this.view.k };
  }

  private pointerPosition(event: PointerEvent | WheelEvent): { x: number; y: number } {
    const rect = this.canvasRef().nativeElement.getBoundingClientRect();

    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  private nodeAt(screenX: number, screenY: number): SimNode | null {
    const { x, y } = this.toWorld(screenX, screenY);
    const slack = 4 / this.view.k;

    // Last drawn is on top
    for (let i = this.nodes.length - 1; i >= 0; i--) {
      const n = this.nodes[i];
      const reach = n.radius + slack;

      if (((n.x ?? 0) - x) ** 2 + ((n.y ?? 0) - y) ** 2 <= reach * reach) {
        return n;
      }
    }

    return null;
  }

  // ── Interaction ────────────────────────────────────────────────────────────

  private readonly onWheel = (event: WheelEvent): void => {
    event.preventDefault();

    const { x, y } = this.pointerPosition(event);
    const factor = Math.exp(-event.deltaY * 0.0015);
    const k = Math.min(Math.max(this.view.k * factor, MIN_ZOOM), MAX_ZOOM);
    const world = this.toWorld(x, y);

    // The point under the cursor stays under the cursor
    this.view = { k, x: x - world.x * k, y: y - world.y * k };
    this.fitted = true;
    this.scheduleDraw();
  };

  protected onPointerDown(event: PointerEvent): void {
    const { x, y } = this.pointerPosition(event);
    const node = this.nodeAt(x, y);

    this.canvasRef().nativeElement.setPointerCapture(event.pointerId);
    this.pointerStart = { x, y };
    this.pointerLast = { x, y };
    this.moved = false;

    if (node) {
      this.dragged = node;
      node.fx = node.x;
      node.fy = node.y;
    } else {
      this.panning = true;
    }
  }

  protected onPointerMove(event: PointerEvent): void {
    const { x, y } = this.pointerPosition(event);

    if (this.dragged) {
      this.moved = this.moved || Math.hypot(x - this.pointerStart.x, y - this.pointerStart.y) > DRAG_THRESHOLD;

      if (this.moved) {
        const world = this.toWorld(x, y);

        this.dragged.fx = world.x;
        this.dragged.fy = world.y;
        // Wakes the layout so the linked notes follow the dragged one
        this.simulation.alphaTarget(0.3).restart();
      }
    } else if (this.panning) {
      this.view = { ...this.view, x: this.view.x + x - this.pointerLast.x, y: this.view.y + y - this.pointerLast.y };
      this.fitted = true;
      this.scheduleDraw();
    } else {
      const node = this.nodeAt(x, y);

      if (node !== this.hovered) {
        this.hovered = node;
        this.canvasRef().nativeElement.style.cursor = node && !node.missing ? 'pointer' : 'default';
        this.scheduleDraw();
      }
    }

    this.pointerLast = { x, y };
  }

  protected onPointerUp(event: PointerEvent): void {
    const node = this.dragged;
    const canvas = this.canvasRef().nativeElement;

    if (canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }

    this.dragged = null;
    this.panning = false;

    if (!node) {
      return;
    }

    this.simulation.alphaTarget(0);
    node.fx = null;
    node.fy = null;

    if (!this.moved && !node.missing) {
      this.open(node.id, node.title);
    }
  }

  /** A node is a note, or a file of the collection whose graph is shown. */
  private open(id: number, title: string): void {
    const file = this.fileDocs.refFor(id);

    if (file) {
      this.collections.open(file);
    } else {
      this.tabs.openNote(id, title);
    }
  }

  protected onPointerLeave(): void {
    if (this.hovered) {
      this.hovered = null;
      this.scheduleDraw();
    }
  }

  // ── Drawing ────────────────────────────────────────────────────────────────

  private scheduleDraw(): void {
    if (this.frame === 0) {
      this.frame = requestAnimationFrame(() => {
        this.frame = 0;
        this.draw();
      });
    }
  }

  private readPalette(): Palette {
    const style = getComputedStyle(this.hostRef().nativeElement);
    const read = (name: string): string => style.getPropertyValue(name).trim();

    return {
      node: read('--evn-text-dimmed'),
      open: read('--evn-accent'),
      active: read('--evn-accent-text'),
      link: read('--evn-border'),
      linkHighlight: read('--evn-accent-text'),
      missing: read('--evn-text-faint'),
      label: read('--evn-text-soft'),
      halo: read('--evn-bg'),
    };
  }

  private draw(): void {
    const ctx = this.ctx;

    if (!ctx || this.width === 0) {
      return;
    }

    this.palette ??= this.readPalette();

    const now = performance.now();
    const dt = this.lastDraw === 0 ? 16 : Math.min(now - this.lastDraw, 64);
    const introProgress = Math.min((now - this.introStart) / INTRO_DURATION, 1);
    const intro = 1 - (1 - introProgress) ** 3;
    const palette = this.palette;
    const focus = this.hovered ?? this.dragged;
    const focusLinks = focus ? this.neighbours.get(focus.id) : undefined;
    const openIds = new Set(this.tabs.tabs().map(t => t.noteId));
    const referenceId = this.backlinks.referenceNoteId();
    const isRelated = (node: SimNode): boolean => focus === null || node === focus || (focusLinks?.has(node.id) ?? false);
    const step = 1 - Math.exp(-dt / DIM_DURATION);
    let animating = introProgress < 1;

    const ease = (current: number, target: number): number => {
      const next = current + (target - current) * step;

      if (Math.abs(target - next) < 0.01) {
        return target;
      }

      animating = true;
      return next;
    };

    for (const node of this.nodes) {
      node.dim = ease(node.dim, isRelated(node) ? 0 : 1);
    }

    for (const link of this.links) {
      const touchesFocus = focus !== null && (link.source === focus || link.target === focus);

      link.dim = ease(link.dim, focus && !touchesFocus ? 1 : 0);
    }

    // The graph grows from the centre of the view while it fades in
    const zoom = INTRO_START_ZOOM + (1 - INTRO_START_ZOOM) * intro;
    const cx = this.width / 2;
    const cy = this.height / 2;

    ctx.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);
    ctx.translate(cx, cy);
    ctx.scale(zoom, zoom);
    ctx.translate(-cx, -cy);
    ctx.translate(this.view.x, this.view.y);
    ctx.scale(this.view.k, this.view.k);

    // Links first, so the nodes sit on top of them
    for (const link of this.links) {
      const source = link.source as SimNode;
      const target = link.target as SimNode;
      const touchesFocus = focus !== null && (source === focus || target === focus);

      ctx.globalAlpha = (1 - link.dim * (1 - DIM_ALPHA_LINK)) * intro;
      ctx.strokeStyle = touchesFocus ? palette.linkHighlight : palette.link;
      ctx.fillStyle = ctx.strokeStyle;
      this.drawLink(ctx, source, target, target.missing);
    }

    for (const node of this.nodes) {
      ctx.globalAlpha = (1 - node.dim * (1 - DIM_ALPHA_NODE)) * intro;
      this.drawNode(ctx, node, palette, node.id === referenceId, openIds.has(node.id), node === focus);
    }

    ctx.globalAlpha = 1;

    for (const node of this.nodes) {
      if (node.dim < 1) {
        this.drawLabel(ctx, node, palette, node === focus || node.id === referenceId, (1 - node.dim) * intro);
      }
    }

    this.lastDraw = animating ? now : 0;

    if (animating) {
      this.scheduleDraw();
    }
  }

  /** A slightly curved arrow: two notes linking each other get two distinct arcs instead of one superposed line. */
  private drawLink(ctx: CanvasRenderingContext2D, source: SimNode, target: SimNode, dashed: boolean): void {
    const { k } = this.view;
    const sx = source.x ?? 0;
    const sy = source.y ?? 0;
    const tx = target.x ?? 0;
    const ty = target.y ?? 0;
    const dx = tx - sx;
    const dy = ty - sy;
    const bend = Math.hypot(dx, dy) * LINK_CURVATURE;
    const length = Math.hypot(dx, dy) || 1;
    const cx = (sx + tx) / 2 - (dy / length) * bend;
    const cy = (sy + ty) / 2 + (dx / length) * bend;

    // The arrow stops at the border of the target
    const endLength = Math.hypot(tx - cx, ty - cy) || 1;
    const ux = (tx - cx) / endLength;
    const uy = (ty - cy) / endLength;
    const ex = tx - ux * (target.radius + 2);
    const ey = ty - uy * (target.radius + 2);

    ctx.lineWidth = 1.1 / k;
    ctx.setLineDash(dashed ? [4 / k, 4 / k] : []);
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.quadraticCurveTo(cx, cy, ex, ey);
    ctx.stroke();
    ctx.setLineDash([]);

    const size = ARROW_SIZE / Math.max(k, 0.6);

    ctx.beginPath();
    ctx.moveTo(ex, ey);
    ctx.lineTo(ex - ux * size - uy * size * 0.5, ey - uy * size + ux * size * 0.5);
    ctx.lineTo(ex - ux * size + uy * size * 0.5, ey - uy * size - ux * size * 0.5);
    ctx.closePath();
    ctx.fill();
  }

  private drawNode(
    ctx: CanvasRenderingContext2D, node: SimNode, palette: Palette, isReference: boolean, isOpen: boolean, isFocus: boolean,
  ): void {
    const { k } = this.view;
    const x = node.x ?? 0;
    const y = node.y ?? 0;

    ctx.beginPath();
    ctx.arc(x, y, node.radius, 0, Math.PI * 2);

    if (node.missing) {
      ctx.setLineDash([3 / k, 3 / k]);
      ctx.strokeStyle = palette.missing;
      ctx.lineWidth = 1.2 / k;
      ctx.stroke();
      ctx.setLineDash([]);
      return;
    }

    if (isReference) {
      ctx.shadowColor = palette.active;
      ctx.shadowBlur = 14;
    }

    ctx.fillStyle = isReference || isFocus ? palette.active : isOpen ? palette.open : palette.node;
    ctx.fill();
    ctx.shadowBlur = 0;

    if (isReference) {
      ctx.beginPath();
      ctx.arc(x, y, node.radius + 3 / k, 0, Math.PI * 2);
      ctx.strokeStyle = palette.active;
      ctx.lineWidth = 1.2 / k;
      ctx.stroke();
    }
  }

  /** Titles fade in with the zoom; the connected notes keep theirs when zoomed out. */
  private drawLabel(ctx: CanvasRenderingContext2D, node: SimNode, palette: Palette, emphasised: boolean, visibility: number): void {
    const { k } = this.view;
    const zoomAlpha = Math.min(Math.max((k - 0.5) / 0.4, 0), 1);
    const alpha = (emphasised ? 1 : Math.max(zoomAlpha, node.degree >= 3 ? 0.7 : 0)) * visibility;

    if (alpha === 0) {
      return;
    }

    const title = node.title.length > LABEL_MAX_LENGTH ? `${node.title.slice(0, LABEL_MAX_LENGTH - 1)}…` : node.title;
    const x = node.x ?? 0;
    const y = (node.y ?? 0) + node.radius + 12 / k;

    ctx.globalAlpha = alpha;
    ctx.font = `${LABEL_FONT_SIZE / k}px "Segoe UI", system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 3 / k;
    ctx.strokeStyle = palette.halo;
    ctx.strokeText(title, x, y);
    ctx.fillStyle = emphasised ? palette.active : palette.label;
    ctx.fillText(title, x, y);
    ctx.globalAlpha = 1;
  }
}
