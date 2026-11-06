// What a translation may not change, and every label it must: GRAMMAR.md § Structure,
// held by corpus/structure.json.
import type { Chart } from './types';

export interface ChartStructure {
  type: Chart['type'];
  direction: Chart['direction'];
  legend: string[];
  groups: string[];
  nodes: { id: string; tone: string; shape: string; group: string | null; start: boolean }[];
  edges: { from: string; to: string; tone: string; labeled: boolean }[];
}

export type StructureSection = 'type' | 'direction' | 'legend' | 'groups' | 'nodes' | 'edges';
export interface StructureDiff {
  section: StructureSection;
  /** The base's id at the first difference, or the translation's when the base has run out. */
  subject: string;
}

/** Everything that changes the drawing's shape. Order counts: layout reads it. */
export function chartStructure(chart: Chart): ChartStructure {
  return {
    type: chart.type,
    direction: chart.direction,
    legend: chart.legend.map((l) => l.tone),
    groups: chart.groups.map((g) => g.id),
    nodes: chart.nodes.map((n) => ({ id: n.id, tone: n.tone, shape: n.shape, group: n.group ?? null, start: n.start })),
    edges: chart.edges.map((e) => ({ from: e.from, to: e.to, tone: e.tone, labeled: e.label !== '' })),
  };
}

function firstDiff<T>(a: T[], b: T[], same: (x: T, y: T) => boolean, name: (x: T) => string): string | null {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i];
    const y = b[i];
    if (x === undefined) return name(y!);
    if (y === undefined || !same(x, y)) return name(x);
  }
  return null;
}

/** The first structural difference, in the order of `ChartStructure`'s fields, or null when they match. */
export function chartStructureDiff(base: Chart, other: Chart): StructureDiff | null {
  const a = chartStructure(base);
  const b = chartStructure(other);
  if (a.type !== b.type) return { section: 'type', subject: 'type' };
  if (a.direction !== b.direction) return { section: 'direction', subject: 'direction' };
  const eq = <T>(x: T, y: T) => x === y;
  const legend = firstDiff(a.legend, b.legend, eq, String);
  if (legend !== null) return { section: 'legend', subject: legend };
  const groups = firstDiff(a.groups, b.groups, eq, String);
  if (groups !== null) return { section: 'groups', subject: groups };
  const nodes = firstDiff(a.nodes, b.nodes, (x, y) => x.id === y.id && x.tone === y.tone && x.shape === y.shape && x.group === y.group && x.start === y.start, (n) => n.id);
  if (nodes !== null) return { section: 'nodes', subject: nodes };
  const edges = firstDiff(a.edges, b.edges, (x, y) => x.from === y.from && x.to === y.to && x.tone === y.tone && x.labeled === y.labeled, (e) => `${e.from} -> ${e.to}`);
  if (edges !== null) return { section: 'edges', subject: edges };
  return null;
}

/** Every label, one per line: caption, legend, groups, nodes, then the edges that have one. */
export function chartText(chart: Chart): string {
  return [
    chart.caption,
    ...chart.legend.map((l) => l.label),
    ...chart.groups.map((g) => g.label),
    ...chart.nodes.map((n) => n.label),
    ...chart.edges.map((e) => e.label).filter((l) => l !== ''),
  ].join('\n');
}
