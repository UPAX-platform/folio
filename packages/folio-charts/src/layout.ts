// test/goldens.test.ts holds the drawing of every sample chart, byte for byte.
import type { Chart, ChartEdge, ChartNode, ChartOptions, LayoutProblem } from './types';

/** Rough advance widths at 13px (IBM Plex Sans / the Arabic stack); good enough to size boxes. */
export function textWidth(s: string): number {
  let w = 0;
  for (const ch of s) {
    if (/[؀-ۿ]/.test(ch)) w += 6.6;
    else if (/[A-Z]/.test(ch)) w += 8.4;
    else if (/[mwMW@%]/.test(ch)) w += 10.2;
    else if (/[ilj.,:;'|!()[\]]/.test(ch)) w += 3.6;
    else if (ch === ' ') w += 3.5;
    else w += 7;
  }
  return w;
}

/** Breaks a label into lines of at most `max` px. */
function wrap(s: string, max: number): string[] {
  const out: string[] = [];
  let line = '';
  for (const word of s.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (line && textWidth(next) > max) {
      out.push(line);
      line = word;
    } else line = next;
  }
  if (line) out.push(line);
  return out;
}

export const LINE_H = 17;
const NODE_PAD_X = 16;
const NODE_PAD_Y = 10;
const EDGE_LABEL_MAX = 92;
const SEP = 22; // between nodes of one rank
const RANK_GAP = 48; // between ranks, before labels
export const GROUP_PAD = 14;
export const GROUP_HEAD = 24;
const MARGIN = 16;

export interface Pt {
  x: number;
  y: number;
}
interface LNode {
  id: string;
  /** Original node, absent for the dummies that carry long edges. */
  node?: ChartNode;
  lines: string[];
  w: number;
  h: number;
  rank: number;
  order: number;
  /** Main axis (rank) and cross axis (order) centres. */
  main: number;
  cross: number;
  group?: string;
}
export interface LaidEdge {
  edge: ChartEdge;
  points: Pt[];
  label?: { x: number; y: number; w: number; h: number; lines: string[] };
}
export interface Layout {
  width: number;
  height: number;
  nodes: (LNode & { x: number; y: number })[];
  edges: LaidEdge[];
  groups: { id: string; label: string; x: number; y: number; w: number; h: number }[];
  starts: { from: Pt; to: Pt }[];
  /** What only geometry can see. The chart still draws; a build never fails on these. */
  problems: LayoutProblem[];
}

/** Geometry for a chart that passed `checkChart`; `chartHtml` checks first, other callers must. */
export function layoutChart(chart: Chart, opts: ChartOptions = {}): Layout {
  const across = chart.direction === 'across';
  const size = (n: ChartNode) => {
    const lines = wrap(n.label, n.shape === 'diamond' ? 120 : 124);
    const tw = Math.max(...lines.map(textWidth));
    let w = Math.max(tw + NODE_PAD_X * 2, n.shape === 'end' ? 0 : 84);
    let h = lines.length * LINE_H + NODE_PAD_Y * 2;
    if (n.shape === 'diamond') [w, h] = [w * 1.45, h * 1.6];
    if (n.shape === 'end') w = h = Math.max(w, h);
    return { lines, w, h };
  };
  const nodes = new Map<string, LNode>(
    chart.nodes.map((n) => [n.id, { id: n.id, node: n, ...size(n), rank: 0, order: 0, main: 0, cross: 0, ...(n.group ? { group: n.group } : {}) }]),
  );
  const mainSize = (n: LNode) => (across ? n.w : n.h);
  const crossSize = (n: LNode) => (across ? n.h : n.w);

  // 1. Break cycles: an edge back to a node on the DFS stack is laid out reversed.
  const outs = new Map<string, ChartEdge[]>(chart.nodes.map((n) => [n.id, []]));
  for (const e of chart.edges) outs.get(e.from)!.push(e);
  const reversed = new Set<ChartEdge>();
  const state = new Map<string, 1 | 2>();
  const visit = (id: string) => {
    state.set(id, 1);
    for (const e of outs.get(id)!) {
      const s = state.get(e.to);
      if (s === 1) reversed.add(e);
      else if (!s) visit(e.to);
    }
    state.set(id, 2);
  };
  for (const n of [...chart.nodes.filter((n) => n.start), ...chart.nodes]) if (!state.has(n.id)) visit(n.id);
  const dag = chart.edges.map((e) => (reversed.has(e) ? { u: e.to, v: e.from, e } : { u: e.from, v: e.to, e }));

  // 2. Ranks: longest path, then sources pulled next to their first successor.
  // Groups read as columns (or rows): each starts after every rank of the groups before it.
  const preds = new Map<string, string[]>(chart.nodes.map((n) => [n.id, []]));
  const succs = new Map<string, string[]>(chart.nodes.map((n) => [n.id, []]));
  for (const { u, v } of dag) {
    succs.get(u)!.push(v);
    preds.get(v)!.push(u);
  }
  const topo: string[] = [];
  const indeg = new Map(chart.nodes.map((n) => [n.id, preds.get(n.id)!.length]));
  const queue = chart.nodes.filter((n) => indeg.get(n.id) === 0).map((n) => n.id);
  while (queue.length) {
    const id = queue.shift()!;
    topo.push(id);
    for (const v of succs.get(id)!) {
      indeg.set(v, indeg.get(v)! - 1);
      if (indeg.get(v) === 0) queue.push(v);
    }
  }
  const floor = new Map<string, number>();
  for (let pass = 0; pass <= chart.groups.length; pass++) {
    for (const id of topo) nodes.get(id)!.rank = Math.max(floor.get(nodes.get(id)!.group!) ?? 0, ...preds.get(id)!.map((u) => nodes.get(u)!.rank + 1));
    let next = 0;
    for (const g of chart.groups) {
      floor.set(g.id, next);
      next = Math.max(next, ...chart.nodes.filter((n) => n.group === g.id).map((n) => nodes.get(n.id)!.rank + 1));
    }
  }
  for (const id of [...topo].reverse()) {
    const n = nodes.get(id)!;
    if (preds.get(id)!.length === 0 && succs.get(id)!.length && !n.node!.start)
      n.rank = Math.max(floor.get(n.group!) ?? -Infinity, Math.min(...succs.get(id)!.map((v) => nodes.get(v)!.rank)) - 1);
  }

  // 3. Long edges get a dummy per rank they cross; the middle one carries the label.
  const segs = new Map<ChartEdge, string[]>();
  const labelOf = new Map<string, string[]>();
  let dummies = 0;
  for (const { u, v, e } of dag) {
    const chain = [u];
    const ru = nodes.get(u)!.rank;
    const span = nodes.get(v)!.rank - ru;
    const mid = Math.floor(span / 2);
    for (let r = ru + 1; r < ru + span; r++) {
      const id = `\u0000d${dummies++}`;
      const lines = e.label && r === ru + mid ? wrap(e.label, EDGE_LABEL_MAX) : [];
      if (lines.length) labelOf.set(id, lines);
      const w = lines.length ? Math.max(...lines.map(textWidth)) + 10 : 8;
      const h = lines.length ? lines.length * LINE_H + 4 : 8;
      nodes.set(id, { id, lines: [], w, h, rank: r, order: 0, main: 0, cross: 0 });
      chain.push(id);
    }
    chain.push(v);
    segs.set(e, chain);
  }
  const adjUp = new Map<string, string[]>();
  const adjDown = new Map<string, string[]>();
  for (const chain of segs.values())
    for (let i = 1; i < chain.length; i++) {
      (adjDown.get(chain[i - 1]!) ?? adjDown.set(chain[i - 1]!, []).get(chain[i - 1]!)!).push(chain[i]!);
      (adjUp.get(chain[i]!) ?? adjUp.set(chain[i]!, []).get(chain[i]!)!).push(chain[i - 1]!);
    }

  // 4. Order within ranks: barycentre sweeps, keeping the arrangement with fewest crossings.
  const maxRank = Math.max(...[...nodes.values()].map((n) => n.rank));
  const minRank = Math.min(...[...nodes.values()].map((n) => n.rank));
  const ranks: LNode[][] = [];
  for (let r = minRank; r <= maxRank; r++) ranks.push([...nodes.values()].filter((n) => n.rank === r));
  const groupIndex = new Map(chart.groups.map((g, i) => [g.id, i]));
  const reindex = () => ranks.forEach((rk) => rk.forEach((n, i) => (n.order = i)));
  reindex();
  const crossings = () => {
    let c = 0;
    for (let r = 0; r < ranks.length - 1; r++) {
      const es = ranks[r]!.flatMap((n) => (adjDown.get(n.id) ?? []).map((v) => [n.order, nodes.get(v)!.order] as const));
      for (let i = 0; i < es.length; i++) for (let j = i + 1; j < es.length; j++) if ((es[i]![0] - es[j]![0]) * (es[i]![1] - es[j]![1]) < 0) c++;
    }
    return c;
  };
  let best = ranks.map((rk) => rk.map((n) => n.id));
  let bestC = crossings();
  for (let it = 0; it < 8 && bestC > 0; it++) {
    const down = it % 2 === 0;
    const seq = down ? ranks.slice(1) : ranks.slice(0, -1).reverse();
    for (const rk of seq) {
      const bary = new Map(
        rk.map((n) => {
          const ns = (down ? adjUp : adjDown).get(n.id) ?? [];
          return [n.id, ns.length ? ns.reduce((s, v) => s + nodes.get(v)!.order, 0) / ns.length : n.order];
        }),
      );
      rk.sort((a, b) => (groupIndex.get(a.group!) ?? -1) - (groupIndex.get(b.group!) ?? -1) || bary.get(a.id)! - bary.get(b.id)! || a.order - b.order);
      rk.forEach((n, i) => (n.order = i));
    }
    const c = crossings();
    if (c < bestC) [best, bestC] = [ranks.map((rk) => rk.map((n) => n.id)), c];
  }
  best.forEach((ids, r) => (ranks[r] = ids.map((id) => nodes.get(id)!)));
  reindex();

  // 5. Coordinates. Rank gaps fit the labels of the edges that cross them.
  const gapFor = (r: number) => {
    let need = RANK_GAP;
    for (const [e, chain] of segs)
      if (chain.length === 2 && e.label && Math.min(nodes.get(chain[0]!)!.rank, nodes.get(chain[1]!)!.rank) === r) {
        const lines = wrap(e.label, EDGE_LABEL_MAX);
        need = Math.max(need, across ? Math.max(...lines.map(textWidth)) + 28 : lines.length * LINE_H + 28);
      }
    // Leaving or entering a group box needs room for its padding.
    const here = new Set(ranks[r - minRank]?.map((n) => n.group));
    const next = new Set(ranks[r - minRank + 1]?.map((n) => n.group));
    const change = [...here, ...next].some((g) => g && !(here.has(g) && next.has(g)));
    return need + (change ? GROUP_PAD * 2 + (across ? 0 : GROUP_HEAD) : 0);
  };
  let main = 0;
  ranks.forEach((rk, i) => {
    const half = Math.max(...rk.map(mainSize)) / 2;
    if (i > 0) main += half + gapFor(minRank + i - 1);
    rk.forEach((n) => (n.main = main));
    main += half;
  });
  const sepBetween = (a: LNode, b: LNode) => {
    let s = SEP;
    if (a.group !== b.group) s += (a.group ? GROUP_PAD : 0) + (b.group ? GROUP_PAD + (across ? GROUP_HEAD : 0) : 0);
    return s + crossSize(a) / 2 + crossSize(b) / 2;
  };
  const place = (rk: LNode[], want: (n: LNode) => number) => {
    if (!rk.length) return;
    const d = rk.map(want);
    const x = [d[0]!];
    for (let i = 1; i < rk.length; i++) x.push(Math.max(d[i]!, x[i - 1]! + sepBetween(rk[i - 1]!, rk[i]!)));
    const shift = d.reduce((s, v, i) => s + v - x[i]!, 0) / rk.length;
    rk.forEach((n, i) => (n.cross = x[i]! + shift));
  };
  for (const rk of ranks) place(rk, (n) => n.order * 60);
  for (let it = 0; it < 6; it++) {
    const down = it % 2 === 0;
    for (const rk of down ? ranks.slice(1) : ranks.slice(0, -1).reverse())
      place(rk, (n) => {
        const ns = [...((down ? adjUp : adjDown).get(n.id) ?? []), ...(it > 1 ? ((down ? adjDown : adjUp).get(n.id) ?? []) : [])];
        return ns.length ? ns.reduce((s, v) => s + nodes.get(v)!.cross, 0) / ns.length : n.cross;
      });
  }

  // To x/y with a margin; groups reserve room for their padding and heading.
  const all = [...nodes.values()];
  const gPadLead = chart.groups.length ? GROUP_PAD + (across ? GROUP_HEAD : 0) : 0;
  const gPadMain = chart.groups.length ? GROUP_PAD + (across ? 0 : GROUP_HEAD) : 0;
  const minCross = Math.min(...all.map((n) => n.cross - crossSize(n) / 2)) - gPadLead;
  const maxCross = Math.max(...all.map((n) => n.cross + crossSize(n) / 2)) + (chart.groups.length ? GROUP_PAD : 0);
  const startRoom = chart.nodes.some((n) => n.start) ? 30 : 0;
  const mainOff = MARGIN + startRoom + gPadMain - Math.min(...all.map((n) => n.main - mainSize(n) / 2));
  const xy = (m: number, c: number): Pt => (across ? { x: m + mainOff, y: c - minCross + MARGIN } : { x: c - minCross + MARGIN, y: m + mainOff });
  const placed = all.map((n) => ({ ...n, ...xy(n.main, n.cross) }));
  const byId = new Map(placed.map((n) => [n.id, n]));
  const totalMain = Math.max(...all.map((n) => n.main + mainSize(n) / 2)) + mainOff + MARGIN + (chart.groups.length ? GROUP_PAD : 0);
  const totalCross = maxCross - minCross + MARGIN * 2;
  const width = across ? totalMain : totalCross;
  const height = across ? totalCross : totalMain;

  // 6. Edge paths: port → dummies → port. Each side of a node spreads its ports in
  // the order of the edges' other ends, so no two edges share an anchor; edges
  // sharing a rank pair also fan out around the middle.
  const port = (n: (typeof placed)[number], out: boolean, off: number): Pt => {
    // On a diamond an offset port moves in from the tip along the slanted side.
    const half = (across ? n.w : n.h) / 2;
    const slope = n.node?.shape === 'diamond' ? half / ((across ? n.h : n.w) / 2) : 0;
    const d = (out ? 1 : -1) * (half - Math.abs(off) * slope);
    return across ? { x: n.x + d, y: n.y + off } : { x: n.x + off, y: n.y + d };
  };
  const crossOf = (id: string) => (across ? byId.get(id)!.y : byId.get(id)!.x);
  const sides = new Map<string, { e: ChartEdge; toward: number }[]>();
  for (const [e, c] of segs) {
    const side = (k: string, toward: string) => (sides.get(k) ?? sides.set(k, []).get(k)!).push({ e, toward: crossOf(toward) });
    side(`${c[0]}>out`, c[1]!);
    side(`${c[c.length - 1]}>in`, c[c.length - 2]!);
  }
  const offset = (id: string, dir: 'out' | 'in', e: ChartEdge) => {
    const list = sides.get(`${id}>${dir}`)!;
    if (list.length < 2) return 0;
    const sorted = [...list].sort((a, b) => a.toward - b.toward);
    const n = byId.get(id)!;
    const step = Math.min(14, (crossSizeOf(n) - 10) / (list.length - 1));
    return (sorted.findIndex((x) => x.e === e) - (list.length - 1) / 2) * step;
  };
  const crossSizeOf = (n: { w: number; h: number; node?: ChartNode }) => (n.node?.shape === 'diamond' ? 0.5 : 1) * (across ? n.h : n.w);
  const pairKey = (c: string[]) => [c[0], c[c.length - 1]].sort().join('|');
  const fan = new Map<string, ChartEdge[]>();
  for (const [e, c] of segs) (fan.get(pairKey(c)) ?? fan.set(pairKey(c), []).get(pairKey(c))!).push(e);
  const anchors = new Map<LaidEdge['label'], Pt>();
  const edges: LaidEdge[] = chart.edges.map((e) => {
    const chain = segs.get(e)!;
    const sibs = fan.get(pairKey(chain))!;
    const k = sibs.indexOf(e) - (sibs.length - 1) / 2;
    const u = byId.get(chain[0]!)!;
    const v = byId.get(chain[chain.length - 1]!)!;
    const pts: Pt[] = [port(u, true, offset(u.id, 'out', e))];
    let label: LaidEdge['label'];
    for (const id of chain.slice(1, -1)) {
      const d = byId.get(id)!;
      const p = { x: d.x, y: d.y };
      pts.push(p);
      if (labelOf.has(id)) anchors.set((label = { x: d.x, y: d.y, w: d.w, h: d.h, lines: labelOf.get(id)! }), p);
    }
    pts.push(port(v, false, offset(v.id, 'in', e)));
    if (chain.length === 2) {
      const a = pts[0]!;
      const b = pts[1]!;
      const spread = k * (across ? LINE_H * 1.6 + 8 : 64);
      const m = across ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 + spread } : { x: (a.x + b.x) / 2 + spread, y: (a.y + b.y) / 2 };
      if (k !== 0 || e.label) pts.splice(1, 0, m);
      if (e.label) {
        const lines = wrap(e.label, EDGE_LABEL_MAX);
        anchors.set((label = { ...m, w: Math.max(...lines.map(textWidth)) + 10, h: lines.length * LINE_H + 4, lines }), m);
      }
    }
    if (reversed.has(e)) pts.reverse();
    return { edge: e, points: pts, ...(label ? { label } : {}) };
  });

  // Labels that land on each other are pushed apart across the flow; the path follows its label.
  const ls = [...anchors.keys()] as NonNullable<LaidEdge['label']>[];
  for (let it = 0; it < 24; it++) {
    let moved = false;
    for (let i = 0; i < ls.length; i++)
      for (let j = i + 1; j < ls.length; j++) {
        const a = ls[i]!;
        const b = ls[j]!;
        const ox = (a.w + b.w) / 2 + 4 - Math.abs(a.x - b.x);
        const oy = (a.h + b.h) / 2 + 2 - Math.abs(a.y - b.y);
        if (ox <= 0 || oy <= 0) continue;
        moved = true;
        const key = across ? 'y' : 'x';
        const need = (across ? oy : ox) / 2 + 0.5;
        const sign = a[key] < b[key] || (a[key] === b[key] && i < j) ? -1 : 1;
        a[key] += sign * need;
        b[key] -= sign * need;
      }
    if (!moved) break;
  }
  for (const [l, p] of anchors) [p.x, p.y] = [l!.x, l!.y];

  // 7. Groups around their members; boxes that overlap each other or a stranger are problems.
  // An empty group is checkChart's group_empty and has no box to draw.
  const groups = chart.groups.flatMap((g) => {
    const ms = placed.filter((n) => n.group === g.id);
    if (!ms.length) return [];
    const x0 = Math.min(...ms.map((n) => n.x - n.w / 2)) - GROUP_PAD;
    const y0 = Math.min(...ms.map((n) => n.y - n.h / 2)) - GROUP_PAD - GROUP_HEAD;
    const x1 = Math.max(...ms.map((n) => n.x + n.w / 2)) + GROUP_PAD;
    const y1 = Math.max(...ms.map((n) => n.y + n.h / 2)) + GROUP_PAD;
    return [{ id: g.id, label: g.label, x: x0, y: y0, w: x1 - x0, h: y1 - y0 }];
  });
  const hit = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) =>
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  const problems: LayoutProblem[] = [];
  groups.forEach((g, i) => {
    for (const o of groups.slice(i + 1)) if (hit(g, o)) problems.push({ rule: 'group_overlap', subject: `${g.id} ${o.id}` });
    for (const n of placed)
      if (n.node && n.group !== g.id && hit(g, { x: n.x - n.w / 2, y: n.y - n.h / 2, w: n.w, h: n.h })) problems.push({ rule: 'node_in_group', subject: `${n.id} ${g.id}` });
  });

  // The start marker sits just outside the start node's group, clear of its heading.
  const starts = placed
    .filter((n) => n.node?.start)
    .map((n) => {
      const to = port(n, false, 0);
      const g = groups.find((x) => x.id === n.group);
      const from = across ? { x: Math.min(to.x - 24, g ? g.x - 10 : Infinity), y: to.y } : { x: to.x, y: Math.min(to.y - 24, g ? g.y - 10 : Infinity) };
      return { from, to };
    });

  const out: Layout = { width, height, nodes: placed.filter((n) => n.node), edges, groups, starts, problems };
  fit(out);
  if (opts.rtl && across) mirror(out);
  return { ...out, width: Math.ceil(out.width), height: Math.ceil(out.height) };
}

/**
 * Sizes the canvas to everything drawn, with a margin on every side. Runs last,
 * because moving labels apart can push one past the edge the ranks set.
 */
function fit(l: Layout) {
  const boxes = [
    ...l.nodes.map((n) => ({ x: n.x - n.w / 2, y: n.y - n.h / 2, w: n.w, h: n.h })),
    ...l.edges.flatMap((e) => [...e.points.map((p) => ({ x: p.x, y: p.y, w: 0, h: 0 })), ...(e.label ? [{ x: e.label.x - e.label.w / 2, y: e.label.y - e.label.h / 2, w: e.label.w, h: e.label.h }] : [])]),
    ...l.groups,
    ...l.starts.map((s) => ({ x: s.from.x - 6, y: s.from.y - 6, w: 12, h: 12 })),
  ];
  const dx = MARGIN - Math.min(...boxes.map((b) => b.x));
  const dy = MARGIN - Math.min(...boxes.map((b) => b.y));
  for (const n of l.nodes) [n.x, n.y] = [n.x + dx, n.y + dy];
  for (const e of l.edges) {
    for (const p of e.points) [p.x, p.y] = [p.x + dx, p.y + dy];
    if (e.label) [e.label.x, e.label.y] = [e.label.x + dx, e.label.y + dy];
  }
  for (const g of l.groups) [g.x, g.y] = [g.x + dx, g.y + dy];
  for (const s of l.starts) for (const p of [s.from, s.to]) [p.x, p.y] = [p.x + dx, p.y + dy];
  l.width = Math.max(...boxes.map((b) => b.x + b.w)) + dx + MARGIN;
  l.height = Math.max(...boxes.map((b) => b.y + b.h)) + dy + MARGIN;
}

/** Right-to-left: flips every x so the chart reads from the right. */
function mirror(l: Layout) {
  const f = (x: number) => l.width - x;
  for (const n of l.nodes) n.x = f(n.x);
  for (const e of l.edges) {
    for (const p of e.points) p.x = f(p.x);
    if (e.label) e.label.x = f(e.label.x);
  }
  for (const g of l.groups) g.x = l.width - g.x - g.w;
  for (const s of l.starts) [s.from.x, s.to.x] = [f(s.from.x), f(s.to.x)];
}
