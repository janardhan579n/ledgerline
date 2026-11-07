import { ChangeDetectionStrategy, Component, DestroyRef, Directive, ElementRef, afterNextRender, computed, inject, input, signal } from '@angular/core';
import { formatMoney } from '../core/currency';

export interface Series { name: string; color: string; values: number[]; area?: boolean }

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}
const roundedTop = (x: number, y: number, w: number, h: number, r: number) => {
  if (h <= 0) return '';
  r = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
};

/** Tracks the host's width so charts redraw to fit. */
function useWidth(fallback = 600) {
  const el = inject(ElementRef<HTMLElement>);
  const width = signal(fallback);
  const destroy = inject(DestroyRef);
  afterNextRender(() => {
    const ro = new ResizeObserver(([e]) => width.set(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(el.nativeElement);
    destroy.onDestroy(() => ro.disconnect());
  });
  return { el, width };
}

@Component({
  selector: 'app-legend',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div class="legend">@for (s of series(); track s.name) {<span><i [style.background]="s.color"></i>{{ s.name }}</span>}</div>`,
})
export class Legend {
  readonly series = input.required<{ name: string; color: string }[]>();
}

const tipTemplate = `
  @if (tip(); as t) {
    <div class="chart-tip" [style.left.px]="t.left" [style.top.px]="t.top" role="status">
      <div class="tip-h">{{ t.title }}</div>
      @for (r of t.rows; track r.name) {<div class="tip-row"><span class="sw" [style.background]="r.color"></span>{{ r.name }}<b>{{ r.value }}</b></div>}
    </div>
  }`;

interface Tip { left: number; top: number; title: string; rows: { name: string; color: string; value: string }[] }

@Directive()
abstract class ChartBase {
  readonly labels = input.required<string[]>();
  readonly tipLabels = input<string[] | null>(null);
  readonly series = input.required<Series[]>();
  readonly currency = input.required<string>();
  readonly height = input(220);
  readonly ariaLabel = input('Chart');
  protected readonly w = useWidth();
  protected readonly tip = signal<Tip | null>(null);
  protected money(v: number, compact = false) { return formatMoney(v, this.currency(), { compact }); }
  protected showTip(ev: PointerEvent, i: number) {
    const title = (this.tipLabels() ?? this.labels())[i];
    const rows = this.series().map((s) => ({ name: s.name, color: s.color, value: this.money(s.values[i] ?? 0) }));
    const tw = 200;
    let left = ev.clientX + 14;
    if (left + tw > window.innerWidth - 8) left = ev.clientX - tw - 14;
    this.tip.set({ left: Math.max(8, left), top: Math.max(8, ev.clientY - 90), title, rows });
  }
}

@Component({
  selector: 'app-bar-chart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'chart' },
  template: `
    <svg [attr.viewBox]="'0 0 ' + g().width + ' ' + height()" [attr.width]="g().width" [attr.height]="height()" role="img" [attr.aria-label]="ariaLabel()">
      <g [attr.transform]="'translate(' + g().ml + ',' + g().mt + ')'">
        @for (t of g().ticks; track $index) {
          <line x1="0" [attr.x2]="g().iw" [attr.y1]="t.y" [attr.y2]="t.y" [class]="$first ? 'axis-base' : 'grid'" />
          <text [attr.x]="-8" [attr.y]="t.y + 4" text-anchor="end" class="tick">{{ t.label }}</text>
        }
        @for (b of g().bars; track $index) {
          <path [attr.d]="b.d" [attr.fill]="b.color" class="bar" [class.dim]="b.dim" [class.hover]="hover() === b.i" />
        }
        @for (l of labels(); track $index; let i = $index) {
          <text [attr.x]="i * g().band + g().band / 2" [attr.y]="g().ih + 18" text-anchor="middle" class="tick" [class.strong]="highlight() === i">{{ l }}</text>
          <rect [attr.x]="i * g().band" y="0" [attr.width]="g().band" [attr.height]="g().ih" fill="transparent"
            (pointermove)="hover.set(i); showTip($event, i)" (pointerleave)="hover.set(-1); tip.set(null)" />
        }
      </g>
    </svg>
    ${tipTemplate}
  `,
})
export class BarChart extends ChartBase {
  readonly highlight = input<number | null>(null);
  protected readonly hover = signal(-1);
  protected readonly g = computed(() => {
    const width = this.w.width(), height = this.height();
    const ml = 56, mr = 8, mt = 12, mb = 26;
    const iw = width - ml - mr, ih = height - mt - mb;
    const series = this.series();
    const max = niceMax(Math.max(0, ...series.flatMap((s) => s.values)));
    const ticks = [0, 1, 2, 3, 4].map((i) => ({ y: ih - (i / 4) * ih, label: this.money((max / 4) * i, true) }));
    const n = this.labels().length || 1;
    const band = iw / n, ns = series.length, gap = 2;
    const groupW = Math.min(band * 0.72, ns * 26);
    const bw = (groupW - gap * (ns - 1)) / ns;
    const hl = this.highlight();
    const bars = [];
    for (let i = 0; i < n; i++) {
      const gx = i * band + (band - groupW) / 2;
      for (let j = 0; j < ns; j++) {
        const v = Math.max(0, series[j].values[i] ?? 0);
        const h = (v / max) * ih;
        bars.push({ i, d: roundedTop(gx + j * (bw + gap), ih - h, bw, h, 4), color: series[j].color, dim: hl != null && hl !== i });
      }
    }
    return { width, ml, mt, iw, ih, ticks, band, bars };
  });
}

@Component({
  selector: 'app-line-chart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'chart' },
  template: `
    <svg [attr.viewBox]="'0 0 ' + g().width + ' ' + height()" [attr.width]="g().width" [attr.height]="height()" role="img" [attr.aria-label]="ariaLabel()">
      <g [attr.transform]="'translate(' + g().ml + ',' + g().mt + ')'">
        @for (t of g().ticks; track $index) {
          <line x1="0" [attr.x2]="g().iw" [attr.y1]="t.y" [attr.y2]="t.y" [class]="$first ? 'axis-base' : 'grid'" />
          <text [attr.x]="-8" [attr.y]="t.y + 4" text-anchor="end" class="tick">{{ t.label }}</text>
        }
        @for (x of g().xLabels; track x.i) {<text [attr.x]="x.x" [attr.y]="g().ih + 18" text-anchor="middle" class="tick">{{ x.label }}</text>}
        @for (s of g().paths; track $index) {
          @if (s.area) {<path [attr.d]="s.area" [attr.fill]="s.color" class="area" />}
          <path [attr.d]="s.line" [attr.stroke]="s.color" class="line" />
          <circle [attr.cx]="s.end[0]" [attr.cy]="s.end[1]" r="4" [attr.fill]="s.color" class="endpoint" />
        }
        @if (hover() >= 0) {<line [attr.x1]="g().X(hover())" [attr.x2]="g().X(hover())" y1="0" [attr.y2]="g().ih" class="crosshair" />}
        <rect x="0" y="0" [attr.width]="g().iw" [attr.height]="g().ih" fill="transparent" (pointermove)="move($event)" (pointerleave)="hover.set(-1); tip.set(null)" />
      </g>
    </svg>
    ${tipTemplate}
  `,
})
export class LineChart extends ChartBase {
  protected readonly hover = signal(-1);
  protected readonly g = computed(() => {
    const width = this.w.width(), height = this.height();
    const ml = 60, mr = 12, mt = 14, mb = 26;
    const iw = width - ml - mr, ih = height - mt - mb;
    const series = this.series();
    const max = niceMax(Math.max(1, ...series.flatMap((s) => s.values)));
    const n = this.labels().length;
    const X = (i: number) => (n === 1 ? iw / 2 : (i / (n - 1)) * iw);
    const Y = (v: number) => ih - (v / max) * ih;
    const every = Math.ceil(n / Math.max(2, Math.floor(iw / 56)));
    const xLabels = this.labels().map((label, i) => ({ i, x: X(i), label })).filter((x) => x.i % every === 0 || x.i === n - 1);
    const paths = series.map((s) => {
      const pts = s.values.map((v, i) => [X(i), Y(v)] as [number, number]);
      const line = pts.map((p, i) => (i ? 'L' : 'M') + p[0] + ',' + p[1]).join('');
      const area = s.area ? `M${pts[0][0]},${ih}` + pts.map((p) => `L${p[0]},${p[1]}`).join('') + `L${pts[pts.length - 1][0]},${ih}Z` : '';
      return { color: s.color, line, area, end: pts[pts.length - 1] };
    });
    const ticks = [0, 1, 2, 3, 4].map((i) => ({ y: ih - (i / 4) * ih, label: this.money((max / 4) * i, true) }));
    return { width, ml, mt, iw, ih, X, ticks, xLabels, paths, n };
  });
  protected move(ev: PointerEvent) {
    const svg = (ev.currentTarget as SVGElement).ownerSVGElement!;
    const r = svg.getBoundingClientRect();
    const { width, ml, iw, n } = this.g();
    const px = ((ev.clientX - r.left) / r.width) * width - ml;
    const i = Math.max(0, Math.min(n - 1, Math.round((px / iw) * (n - 1))));
    this.hover.set(i);
    this.showTip(ev, i);
  }
}

export interface HBarItem { label: string; value: number; sub?: string; color?: string }

@Component({
  selector: 'app-hbars',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (rows().length) {
      <ul class="hbars">
        @for (r of rows(); track r.label) {
          <li [attr.title]="r.label + ': ' + r.money">
            <div class="hb-top"><span class="hb-label">{{ r.label }}</span><span class="hb-val">{{ r.money }}@if (r.sub) {<small>{{ r.sub }}</small>}</span></div>
            <div class="hb-track"><span [style.width.%]="r.pct" [style.background]="r.color"></span></div>
          </li>
        }
      </ul>
    } @else {
      <p class="empty-sm">{{ empty() }}</p>
    }
  `,
})
export class HBars {
  readonly items = input.required<HBarItem[]>();
  readonly currency = input.required<string>();
  readonly color = input('var(--s1)');
  readonly empty = input('Nothing recorded for this period.');
  protected readonly rows = computed(() => {
    const items = this.items();
    const max = Math.max(...items.map((i) => Math.abs(i.value)), 1);
    return items.map((i) => ({ ...i, pct: Math.max(1.5, (Math.abs(i.value) / max) * 100), money: formatMoney(i.value, this.currency()), color: i.color ?? this.color() }));
  });
}

@Component({
  selector: 'app-progress',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div class="prog" [class]="'prog ' + status()" role="progressbar" [attr.aria-valuenow]="round(value() * 100)" aria-valuemin="0" aria-valuemax="100"><span [style.width.%]="clamp(value() * 100)"></span></div>`,
})
export class Progress {
  readonly value = input.required<number>();
  readonly status = input<string>('');
  protected round = Math.round;
  protected clamp = (v: number) => Math.max(0, Math.min(100, v));
}
