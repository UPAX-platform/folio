// The uid is a hash, so a figure's ids don't depend on call order. A chart that
// fails checkChart renders as text, because stored JSON can reach raw HTML sinks.
import { checkChart } from './check';
import { GROUP_HEAD, GROUP_PAD, LINE_H, layoutChart, textWidth, type Layout, type Pt } from './layout';
import type { Chart, ChartOptions } from './types';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const r1 = (n: number) => Math.round(n * 10) / 10;

/** A smooth path through points whose tangents follow the main axis. */
function curve(pts: Pt[], across: boolean): string {
  let d = `M${r1(pts[0]!.x)} ${r1(pts[0]!.y)}`;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const c1 = across ? { x: (a.x + b.x) / 2, y: a.y } : { x: a.x, y: (a.y + b.y) / 2 };
    const c2 = across ? { x: (a.x + b.x) / 2, y: b.y } : { x: b.x, y: (a.y + b.y) / 2 };
    d += ` C${r1(c1.x)} ${r1(c1.y)} ${r1(c2.x)} ${r1(c2.y)} ${r1(b.x)} ${r1(b.y)}`;
  }
  return d;
}

function lines(ls: string[], x: number, y: number, cls: string): string {
  const top = y - ((ls.length - 1) * LINE_H) / 2;
  return `<text class="${cls}" x="${r1(x)}" y="${r1(top)}" text-anchor="middle" dominant-baseline="central">${ls
    .map((t, i) => `<tspan x="${r1(x)}" ${i ? `dy="${LINE_H}"` : ''}>${esc(t)}</tspan>`)
    .join('')}</text>`;
}

function shape(n: Layout['nodes'][number]): string {
  const { x, y, w, h } = n;
  switch (n.node!.shape) {
    case 'diamond':
      return `<path class="s-chart-shape" d="M${r1(x)} ${r1(y - h / 2)} L${r1(x + w / 2)} ${r1(y)} L${r1(x)} ${r1(y + h / 2)} L${r1(x - w / 2)} ${r1(y)} Z"/>`;
    case 'end':
      return `<circle class="s-chart-shape" cx="${r1(x)}" cy="${r1(y)}" r="${r1(w / 2)}"/><circle class="s-chart-ring" cx="${r1(x)}" cy="${r1(y)}" r="${r1(w / 2 - 4)}"/>`;
    default:
      return `<rect class="s-chart-shape" x="${r1(x - w / 2)}" y="${r1(y - h / 2)}" width="${r1(w)}" height="${r1(h)}" rx="${n.node!.shape === 'pill' ? r1(h / 2) : 8}"/>`;
  }
}

/** FNV-1a of the chart and direction: the same figure gets the same ids in any call order. */
function hashUid(chart: Chart, rtl: boolean): string {
  // A pending `suggestion` attr is not part of the figure.
  const { suggestion: _, ...figure } = chart as Chart & { suggestion?: unknown };
  const s = `${rtl ? 'r' : 'l'}${JSON.stringify(figure)}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return `c${(h >>> 0).toString(36)}`;
}

/** Caption and steps, from whatever strings a chart that failed the check holds. */
function chartFallback(chart: unknown, rtl: boolean): string {
  const c = (chart ?? {}) as Record<string, unknown>;
  const list = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.filter((x) => x && typeof x === 'object') : []);
  const str = (v: unknown): string => (typeof v === 'string' ? v : '');
  const name = new Map(list(c.nodes).map((n) => [n.id, str(n.label)]));
  const steps = list(c.edges).map((e) => {
    const label = str(e.label);
    return `<li>${esc(name.get(e.from) || str(e.from))} ${rtl ? '←' : '→'} ${esc(name.get(e.to) || str(e.to))}${label ? `: ${esc(label)}` : ''}</li>`;
  });
  return `<figure class="s-chart s-chart-fallback not-content"><figcaption>${esc(str(c.caption))}</figcaption><ul>${steps.join('')}</ul></figure>`;
}

/** The chart as an HTML figure: inline SVG, caption, legend and a text version for screen readers. */
export function chartHtml(chart: Chart, opts: ChartOptions = {}): string {
  if (checkChart(chart).length) return chartFallback(chart, !!opts.rtl);
  const l = layoutChart(chart, opts);
  const across = chart.direction === 'across';
  const uid = opts.uid ?? hashUid(chart, !!opts.rtl);
  const arrow = opts.rtl ? '←' : '→';
  const tones = [...new Set(l.edges.map((e) => e.edge.tone))];
  const defs = tones
    .map((t) => `<marker id="${uid}-${t}" class="s-chart-tip s-chart-e-${t}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z"/></marker>`)
    .join('');
  // Group boxes go under the edges; their headings go over them, on a backing
  // that matches the box, so an edge passing through stays legible.
  const groups = l.groups.map((g) => `<rect class="s-chart-group" x="${r1(g.x)}" y="${r1(g.y)}" width="${r1(g.w)}" height="${r1(g.h)}" rx="12"/>`).join('');
  const heads = l.groups
    .map((g) => {
      const w = textWidth(g.label) * 0.95 + 8;
      const x = opts.rtl ? g.x + g.w - GROUP_PAD + 4 - w : g.x + GROUP_PAD - 4;
      const y = g.y + GROUP_HEAD / 2 + 4;
      const tx = opts.rtl ? x + w - 4 : x + 4;
      return `<g class="s-chart-head"><rect x="${r1(x)}" y="${r1(y - 9)}" width="${r1(w)}" height="18" rx="4"/><rect class="s-chart-group" x="${r1(x)}" y="${r1(y - 9)}" width="${r1(w)}" height="18" rx="4"/><text x="${r1(tx)}" y="${r1(y)}" text-anchor="start" dominant-baseline="central">${esc(g.label)}</text></g>`;
    })
    .join('');
  const edges = l.edges
    .map((e) => `<path class="s-chart-edge s-chart-e-${e.edge.tone}" d="${curve(e.points, across)}" marker-end="url(#${uid}-${e.edge.tone})"/>`)
    .join('');
  const starts = l.starts
    .map((s) => `<circle class="s-chart-start" cx="${r1(s.from.x)}" cy="${r1(s.from.y)}" r="5"/><path class="s-chart-edge s-chart-e-neutral" d="M${r1(s.from.x)} ${r1(s.from.y)} L${r1(s.to.x)} ${r1(s.to.y)}" marker-end="url(#${uid}-neutral)"/>`)
    .join('');
  const labels = l.edges
    .filter((e) => e.label)
    .map((e) => {
      const b = e.label!;
      return `<g class="s-chart-label s-chart-e-${e.edge.tone}"><rect x="${r1(b.x - b.w / 2)}" y="${r1(b.y - b.h / 2)}" width="${r1(b.w)}" height="${r1(b.h)}" rx="4"/>${lines(b.lines, b.x, b.y, '')}</g>`;
    })
    .join('');
  const nodes = l.nodes.map((n) => `<g class="s-chart-node s-chart-n-${n.node!.tone}">${shape(n)}${lines(n.lines, n.x, n.y, '')}</g>`).join('');
  const needsTip = tones.includes('neutral') || !l.starts.length ? '' : `<marker id="${uid}-neutral" class="s-chart-tip s-chart-e-neutral" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z"/></marker>`;

  const name = new Map(chart.nodes.map((n) => [n.id, n.label]));
  const text = [
    ...chart.nodes.filter((n) => n.start).map((n) => `<li>${arrow} ${esc(n.label)}</li>`),
    ...chart.edges.map((e) => `<li>${esc(name.get(e.from)!)} ${arrow} ${esc(name.get(e.to)!)}${e.label ? `: ${esc(e.label)}` : ''}</li>`),
  ].join('');
  const legend = chart.legend.length
    ? `<ul class="s-chart-legend">${chart.legend.map((k) => `<li><span class="s-chart-key s-chart-e-${k.tone}" aria-hidden="true"></span>${esc(k.label)}</li>`).join('')}</ul>`
    : '';
  return (
    `<figure class="s-chart s-chart-${chart.type} not-content"><div class="s-chart-scroll">` +
    `<svg viewBox="0 0 ${l.width} ${l.height}" width="${l.width}" height="${l.height}" style="min-inline-size:${Math.round(l.width * 0.75)}px" role="img" aria-labelledby="${uid}-cap" aria-describedby="${uid}-text">` +
    `<defs>${defs}${needsTip}</defs>${groups}${edges}${starts}${heads}${labels}${nodes}</svg></div>` +
    `<figcaption id="${uid}-cap">${esc(chart.caption)}</figcaption>${legend}` +
    `<ul id="${uid}-text" class="s-visually-hidden">${text}</ul></figure>`
  );
}
