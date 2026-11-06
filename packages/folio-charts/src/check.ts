// The rules every stored chart must pass, returned as pairs in a fixed order:
// GRAMMAR.md § Check is the definition, corpus/ holds implementations to it.
// The input is `unknown` because stored JSON reaches this from any API writer.
import { EDGE_TONES, LABEL_FORBIDDEN, NODE_SHAPES, NODE_TONES, type ChartProblem, type ChartRule } from './types';

export const MAX_NODES = 40;
export const MAX_EDGES = 80;
export const MAX_GROUPS = 12;
export const MAX_LEGEND = 5;
export const MAX_ID_BYTES = 64;
export const MAX_LABEL_BYTES = 256;
export const MAX_CAPTION_BYTES = 1024;
export const MAX_CHART_BYTES = 32 * 1024;

const ID = /^[a-z][a-z0-9_-]*$/;
const encoder = new TextEncoder();
const bytes = (s: string): number => encoder.encode(s).length;
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The chart as JSON with its fields in stored order; its UTF-8 length is what the cap measures. */
function canonicalJson(c: Record<string, unknown>): string {
  const list = (k: string) => c[k] as Record<string, unknown>[];
  return JSON.stringify({
    type: c.type,
    caption: c.caption,
    direction: c.direction,
    legend: list('legend').map((l) => ({ tone: l.tone, label: l.label })),
    groups: list('groups').map((g) => ({ id: g.id, label: g.label })),
    nodes: list('nodes').map((n) => ({ id: n.id, label: n.label, tone: n.tone, shape: n.shape, ...(n.group !== undefined ? { group: n.group } : {}), start: n.start })),
    edges: list('edges').map((e) => ({ from: e.from, to: e.to, label: e.label, tone: e.tone })),
  });
}

/** Every rule a chart breaks, in a fixed order. Empty means it is safe to lay out and render. */
export function checkChart(input: unknown): ChartProblem[] {
  const out: ChartProblem[] = [];
  const add = (rule: ChartRule, subject: string) => out.push({ rule, subject });
  if (!isObject(input)) {
    add('value_not_allowed', 'chart');
    return out;
  }
  const c = input;

  /** A required label: a trimmed string with no forbidden character, within its cap. */
  const label = (v: unknown, subject: string, max = MAX_LABEL_BYTES) => {
    if (typeof v !== 'string' || v.trim() === '') return add('label_required', subject);
    if (v !== v.trim() || LABEL_FORBIDDEN.test(v)) return add('value_not_allowed', subject);
    if (bytes(v) > max) add('too_large', subject);
  };
  /** An id's own validity; returns the subject its other findings use. */
  const id = (v: unknown, fallback: string): string => {
    if (typeof v !== 'string' || !ID.test(v)) {
      add('id_invalid', typeof v === 'string' && v !== '' && bytes(v) <= MAX_ID_BYTES ? v : fallback);
      return typeof v === 'string' && v !== '' && bytes(v) <= MAX_ID_BYTES ? v : fallback;
    }
    if (bytes(v) > MAX_ID_BYTES) {
      add('too_large', fallback);
      return fallback;
    }
    return v;
  };
  const extras = (o: Record<string, unknown>, allowed: string[], subject: string) => {
    if (Object.keys(o).some((k) => !allowed.includes(k))) add('value_not_allowed', subject);
  };
  const oneOf = (v: unknown, all: readonly string[], subject: string) => {
    if (typeof v !== 'string' || !all.includes(v)) add('value_not_allowed', subject);
  };
  /** A list under its cap, or the finding that says it isn't. */
  const listOf = (key: string, max: number): unknown[] | null => {
    const v = c[key];
    if (!Array.isArray(v)) {
      add('value_not_allowed', key);
      return null;
    }
    if (v.length > max) {
      add('too_large', key);
      return null;
    }
    return v;
  };

  // `suggestion` is a pending edit, not the chart's, and its contents aren't read:
  // the drawing never prints it, and rejecting it restores a chart that is checked again.
  for (const k of Object.keys(c).sort()) if (!['type', 'caption', 'direction', 'legend', 'groups', 'nodes', 'edges', 'suggestion'].includes(k)) add('value_not_allowed', k);
  oneOf(c.type, ['states', 'flow'], 'type');
  oneOf(c.direction, ['across', 'down'], 'direction');
  label(c.caption, 'caption', MAX_CAPTION_BYTES);

  const legend = listOf('legend', MAX_LEGEND);
  if (legend) {
    const tones = new Set<unknown>();
    for (const l of legend) {
      if (!isObject(l) || typeof l.tone !== 'string' || !(EDGE_TONES as readonly string[]).includes(l.tone) || tones.has(l.tone)) {
        add('value_not_allowed', 'legend');
        continue;
      }
      tones.add(l.tone);
      extras(l, ['tone', 'label'], 'legend');
      label(l.label, l.tone);
    }
  }

  const groups = listOf('groups', MAX_GROUPS);
  const groupIds = new Set<string>();
  if (groups) {
    groups.forEach((g, i) => {
      const at = `groups[${i}]`;
      if (!isObject(g)) return add('value_not_allowed', at);
      const subject = id(g.id, at);
      if (typeof g.id === 'string') {
        if (groupIds.has(g.id)) add('id_duplicate', subject);
        groupIds.add(g.id);
      }
      extras(g, ['id', 'label'], subject);
      label(g.label, subject);
    });
  }

  const nodes = Array.isArray(c.nodes) && c.nodes.length > 0 ? c.nodes : null;
  const nodeIds = new Set<string>();
  const used = new Set<string>();
  if (!nodes) add('nodes_required', 'nodes');
  else if (nodes.length > MAX_NODES) add('too_large', 'nodes');
  else {
    nodes.forEach((n, i) => {
      const at = `nodes[${i}]`;
      if (!isObject(n)) return add('value_not_allowed', at);
      const subject = id(n.id, at);
      if (typeof n.id === 'string') {
        if (nodeIds.has(n.id)) add('id_duplicate', subject);
        nodeIds.add(n.id);
      }
      extras(n, ['id', 'label', 'tone', 'shape', 'group', 'start'], subject);
      label(n.label, subject);
      oneOf(n.tone, NODE_TONES, subject);
      oneOf(n.shape, NODE_SHAPES, subject);
      if (n.group !== undefined) {
        if (typeof n.group !== 'string') add('value_not_allowed', subject);
        else if (groups && !groupIds.has(n.group)) add('group_unknown', subject);
        else used.add(n.group);
      }
      if (typeof n.start !== 'boolean') add('value_not_allowed', subject);
    });
  }

  const edges = listOf('edges', MAX_EDGES);
  if (edges) {
    const pairs = new Set<string>();
    edges.forEach((e, i) => {
      const at = `edges[${i}]`;
      if (!isObject(e)) return add('value_not_allowed', at);
      if (typeof e.from !== 'string' || typeof e.to !== 'string' || bytes(e.from) > MAX_ID_BYTES || bytes(e.to) > MAX_ID_BYTES) return add('value_not_allowed', at);
      const subject = `${e.from} -> ${e.to}`;
      if (nodes && nodes.length <= MAX_NODES && (!nodeIds.has(e.from) || !nodeIds.has(e.to))) add('edge_unknown_node', subject);
      if (e.from === e.to) add('edge_self_loop', subject);
      const k = JSON.stringify([e.from, e.to]);
      if (pairs.has(k)) add('edge_duplicate', subject);
      pairs.add(k);
      extras(e, ['from', 'to', 'label', 'tone'], subject);
      if (typeof e.label !== 'string') add('value_not_allowed', subject);
      else if (e.label !== '') {
        if (e.label !== e.label.trim() || LABEL_FORBIDDEN.test(e.label)) add('value_not_allowed', subject);
        else if (bytes(e.label) > MAX_LABEL_BYTES) add('too_large', subject);
      }
      oneOf(e.tone, EDGE_TONES, subject);
    });
  }

  if (groups && nodes && nodes.length <= MAX_NODES) for (const g of groupIds) if (!used.has(g)) add('group_empty', g);

  if (!out.length && bytes(canonicalJson(c)) > MAX_CHART_BYTES) add('too_large', 'chart');
  return out;
}
