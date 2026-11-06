// The chart source grammar: a strict subset of YAML 1.2. GRAMMAR.md is the
// definition and corpus/ holds every implementation to the same reading. Every
// input this accepts reads the same under yaml 2.x
// (test/differential.test.ts); the reverse is deliberately not true.
import { checkChart } from './check';
import { SOURCE_FORBIDDEN, type Chart, type ChartProblem } from './types';

export const MAX_SOURCE_BYTES = 32 * 1024;

const MAX_FLOW_DEPTH = 3;
const KEY = /^[A-Za-z_][A-Za-z0-9_-]*$/;
/** YAML 1.2 core schema's non-strings. `true` and `false` are allowed only as the value of `start`. */
const NOT_STRING =
  /^(?:~|null|Null|NULL|true|True|TRUE|false|False|FALSE|[-+]?[0-9]+|0o[0-7]+|0x[0-9a-fA-F]+|[-+]?(?:\.[0-9]+|[0-9]+(?:\.[0-9]*)?)(?:[eE][-+]?[0-9]+)?|[-+]?\.(?:inf|Inf|INF)|\.(?:nan|NaN|NAN))$/;
const FLOW_STOP = ',[]{}';

export type RawValue = string | boolean | null | RawMap | RawSeq;
export interface RawMap {
  kind: 'map';
  pairs: { key: string; value: RawValue; line: number }[];
}
export interface RawSeq {
  kind: 'seq';
  items: { value: RawValue; line: number }[];
}

class SyntaxProblem extends Error {
  constructor(
    readonly reason: string,
    readonly line: number,
  ) {
    super(reason);
  }
}

/** One line's worth of scanning. A value never spans lines. */
class Cursor {
  pos = 0;
  constructor(
    readonly s: string,
    readonly line: number,
  ) {}
  get ch(): string {
    return this.s[this.pos] ?? '';
  }
  get done(): boolean {
    return this.pos >= this.s.length;
  }
  spaces(): void {
    while (this.ch === ' ') this.pos++;
  }
  fail(reason: string): never {
    throw new SyntaxProblem(reason, this.line);
  }
  /** Only spaces, then the end of the line or a comment that follows a space. */
  end(): void {
    const start = this.pos;
    this.spaces();
    if (this.done) return;
    if (this.ch === '#' && this.pos > start) return;
    this.fail('trailing');
  }
}

function checkFirstChar(c: Cursor): void {
  const ch = c.ch;
  if (ch === '&' || ch === '*') c.fail('anchor');
  if (ch === '!') c.fail('tag');
  if (ch === '|' || ch === '>') c.fail('block_scalar');
  if ('?-:,[]{}#%@`'.includes(ch)) c.fail('indicator');
}

function scalar(text: string, c: Cursor, key: string | null): string | boolean {
  if (!NOT_STRING.test(text)) return text;
  if (key === 'start' && (text === 'true' || text === 'false')) return text === 'true';
  return c.fail('not_string');
}

function quoted(c: Cursor): string {
  const q = c.ch;
  c.pos++;
  let out = '';
  for (;;) {
    if (c.done) c.fail('unterminated');
    const ch = c.ch;
    if (q === '"' && ch === '\\') {
      const next = c.s[c.pos + 1];
      if (next !== '"' && next !== '\\') c.fail('escape');
      out += next;
      c.pos += 2;
    } else if (ch === q) {
      if (q === "'" && c.s[c.pos + 1] === "'") {
        out += "'";
        c.pos += 2;
      } else {
        c.pos++;
        return out;
      }
    } else {
      out += ch;
      c.pos++;
    }
  }
}

// ---------------------------------------------------------------- flow values

/** Ends at a flow indicator or at a colon that separates. A ` #` in flow would swallow the closing bracket. */
function flowPlain(c: Cursor): string {
  checkFirstChar(c);
  const start = c.pos;
  while (!c.done) {
    const ch = c.ch;
    if (FLOW_STOP.includes(ch)) break;
    if (ch === ':') {
      const next = c.s[c.pos + 1] ?? '';
      if (next === '' || next === ' ' || FLOW_STOP.includes(next)) break;
    }
    if (ch === '#' && c.s[c.pos - 1] === ' ') c.fail('unterminated');
    c.pos++;
  }
  return c.s.slice(start, c.pos).replace(/ +$/, '');
}

function flowValue(c: Cursor, depth: number, key: string | null): RawValue {
  c.spaces();
  const ch = c.ch;
  if (ch === '') c.fail('unterminated');
  if (ch === ',' || ch === ']' || ch === '}') return null;
  if (ch === '[' || ch === '{') return flowCollection(c, depth + 1);
  if (ch === '"' || ch === "'") return quoted(c);
  return scalar(flowPlain(c), c, key);
}

function flowCollection(c: Cursor, depth: number): RawMap | RawSeq {
  if (depth > MAX_FLOW_DEPTH) c.fail('flow_depth');
  return c.ch === '[' ? flowSeq(c, depth) : flowMap(c, depth);
}

/** After an entry: `,` and another entry, or the close. A trailing comma is refused. */
function flowNext(c: Cursor, close: string): boolean {
  c.spaces();
  if (c.done) c.fail('unterminated');
  if (c.ch === close) {
    c.pos++;
    return false;
  }
  if (c.ch === ':') c.fail('plain_colon');
  if (c.ch !== ',') c.fail('trailing');
  c.pos++;
  c.spaces();
  if (c.done) c.fail('unterminated');
  if (c.ch === close || c.ch === ',') c.fail('flow_comma');
  return true;
}

function flowSeq(c: Cursor, depth: number): RawSeq {
  c.pos++;
  c.spaces();
  const items: RawSeq['items'] = [];
  if (c.ch === ']') {
    c.pos++;
    return { kind: 'seq', items };
  }
  do {
    c.spaces();
    const ch = c.ch;
    let value: RawValue;
    if (ch === '') c.fail('unterminated');
    else if (ch === '[' || ch === '{') value = flowCollection(c, depth + 1);
    else if (ch === '"' || ch === "'") value = quoted(c);
    else {
      const text = flowPlain(c);
      if (c.ch === ':') {
        // `[a -> b: Label]` is a single-pair mapping. Only the edge shorthand may use it.
        if (!text.includes('->')) c.fail('item_mapping');
        c.pos++;
        value = { kind: 'map', pairs: [{ key: text, value: flowValue(c, depth, null), line: c.line }] };
      } else value = scalar(text, c, null);
    }
    items.push({ value: value!, line: c.line });
  } while (flowNext(c, ']'));
  return { kind: 'seq', items };
}

function flowMap(c: Cursor, depth: number): RawMap {
  c.pos++;
  c.spaces();
  const pairs: RawMap['pairs'] = [];
  if (c.ch === '}') {
    c.pos++;
    return { kind: 'map', pairs };
  }
  do {
    c.spaces();
    if (c.done) c.fail('unterminated');
    if (c.ch === '"' || c.ch === "'") c.fail('quoted_key');
    const key = flowPlain(c);
    if (NOT_STRING.test(key)) c.fail('not_string');
    if (pairs.some((p) => p.key === key)) c.fail('duplicate_key');
    let value: RawValue = null;
    if (c.ch === ':') {
      c.pos++;
      value = flowValue(c, depth, key);
    }
    pairs.push({ key, value, line: c.line });
  } while (flowNext(c, '}'));
  return { kind: 'map', pairs };
}

// --------------------------------------------------------------- block values

/** The offset of a comment (` #`) or a separating colon (`: `, or `:` last), whichever comes first. */
function plainBreak(s: string, from: number): { at: number; colon: boolean } {
  for (let i = from; i < s.length; i++) {
    if (s[i] === ' ' && s[i + 1] === '#') return { at: i, colon: false };
    if (s[i] === ':' && (i + 1 === s.length || s[i + 1] === ' ')) return { at: i, colon: true };
  }
  return { at: s.length, colon: false };
}

/** A value on the same line as its key: flow, quoted or plain. */
function inlineValue(c: Cursor, key: string | null): RawValue {
  c.spaces();
  const ch = c.ch;
  if (ch === '[' || ch === '{') {
    const v = flowCollection(c, 1);
    c.end();
    return v;
  }
  if (ch === '"' || ch === "'") {
    const v = quoted(c);
    c.end();
    return v;
  }
  checkFirstChar(c);
  const b = plainBreak(c.s, c.pos);
  if (b.colon) c.fail('plain_colon');
  return scalar(c.s.slice(c.pos, b.at).replace(/ +$/, ''), c, key);
}

/** A `- ` item: a flow collection, a quoted string, a plain string, or the shorthand `a -> b: value`. */
function blockItem(c: Cursor): RawValue {
  c.spaces();
  const ch = c.ch;
  if (ch === '') c.fail('item_empty');
  if (ch === '#') c.fail('item_empty');
  if (ch === '[' || ch === '{' || ch === '"' || ch === "'") return inlineValue(c, null);
  checkFirstChar(c);
  const b = plainBreak(c.s, c.pos);
  const text = c.s.slice(c.pos, b.at).replace(/ +$/, '');
  if (!b.colon) return scalar(text, c, null);
  if (!text.includes('->')) c.fail('item_mapping');
  c.pos = b.at + 1;
  c.spaces();
  const value = c.done || c.ch === '#' ? null : inlineValue(c, null);
  return { kind: 'map', pairs: [{ key: text, value, line: c.line }] };
}

const indentOf = (l: string): number => l.length - l.replace(/^ +/, '').length;
const isBlank = (l: string): boolean => /^ *(?:#.*)?$/.test(l);

const keyLine = (l: string): RegExpExecArray | null => /^([^ :][^:]*?):(?: (.*))?$/.exec(l);

function checkKey(key: string, line: number): void {
  if (!KEY.test(key)) throw new SyntaxProblem('key', line);
  if (NOT_STRING.test(key)) throw new SyntaxProblem('not_string', line);
}

/** Parses the grammar to raw values, or throws the first SyntaxProblem. */
export function parseRaw(src: string): RawMap {
  const bad = SOURCE_FORBIDDEN.exec(src);
  if (bad) throw new SyntaxProblem(bad[0] === '\t' ? 'tab' : 'control_char', src.slice(0, bad.index).split('\n').length);
  const lines = src.split('\n');
  const pairs: RawMap['pairs'] = [];
  const blockMapPair = (pairsOut: RawMap['pairs'], key: string, value: RawValue, line: number) => {
    if (pairsOut.some((p) => p.key === key)) throw new SyntaxProblem('duplicate_key', line);
    pairsOut.push({ key, value, line });
  };

  let i = 0;
  while (i < lines.length) {
    const text = lines[i]!;
    const n = i + 1;
    i++;
    if (isBlank(text)) continue;
    if (indentOf(text) > 0) throw new SyntaxProblem('indent', n);
    if (/^(?:---|\.\.\.)(?: |$)/.test(text) || text.startsWith('%')) throw new SyntaxProblem('document_marker', n);
    const m = keyLine(text);
    if (!m) throw new SyntaxProblem('key', n);
    const key = m[1]!;
    checkKey(key, n);
    const rest = m[2] ?? '';
    if (!isBlank(rest)) {
      const c = new Cursor(rest, n);
      blockMapPair(pairs, key, inlineValue(c, key), n);
      continue;
    }

    // The body: every following indented line. Blank and comment lines may sit between them.
    let first = -1;
    let j = i;
    for (; j < lines.length; j++) {
      const l = lines[j]!;
      if (isBlank(l)) continue;
      if (indentOf(l) === 0) break;
      if (first < 0) first = j;
    }
    if (first < 0) {
      blockMapPair(pairs, key, null, n);
      continue;
    }
    const indent = indentOf(lines[first]!);
    const isSeq = /^-(?: |$)/.test(lines[first]!.slice(indent));
    const seq: RawSeq = { kind: 'seq', items: [] };
    const map: RawMap = { kind: 'map', pairs: [] };
    for (let k = first; k < j; k++) {
      const l = lines[k]!;
      if (isBlank(l)) continue;
      const ln = k + 1;
      if (indentOf(l) !== indent) throw new SyntaxProblem('indent', ln);
      const body = l.slice(indent);
      if (isSeq) {
        if (!/^-(?: |$)/.test(body)) throw new SyntaxProblem('item_mapping', ln);
        seq.items.push({ value: blockItem(new Cursor(body.slice(1), ln)), line: ln });
      } else {
        const bm = keyLine(body);
        if (!bm) throw new SyntaxProblem('key', ln);
        checkKey(bm[1]!, ln);
        const brest = bm[2] ?? '';
        const value = isBlank(brest) ? null : inlineValue(new Cursor(brest, ln), bm[1]!);
        blockMapPair(map.pairs, bm[1]!, value, ln);
      }
    }
    blockMapPair(pairs, key, isSeq ? seq : map, n);
    i = j;
  }
  if (!pairs.length) throw new SyntaxProblem('empty', 1);
  return { kind: 'map', pairs };
}

/** Raw values as the plain data a YAML library would return. */
export function rawToJs(v: RawValue): unknown {
  if (v === null || typeof v !== 'object') return v;
  if (v.kind === 'seq') return v.items.map((x) => rawToJs(x.value));
  const out: Record<string, unknown> = {};
  for (const p of v.pairs) Object.defineProperty(out, p.key, { value: rawToJs(p.value), enumerable: true, writable: true, configurable: true });
  return out;
}

// ------------------------------------------------------------------ resolving

const EDGE = /^\s*([a-z][a-z0-9_-]*)\s*->\s*([a-z][a-z0-9_-]*)\s*(?::\s*(.*?))?\s*(?:\[([a-z]+)\])?\s*$/;
const trimmed = (v: unknown): unknown => (typeof v === 'string' ? v.trim() : v);
const isMap = (v: RawValue): v is RawMap => v !== null && typeof v === 'object' && v.kind === 'map';
const isSeq = (v: RawValue): v is RawSeq => v !== null && typeof v === 'object' && v.kind === 'seq';
const get = (m: RawMap, key: string): RawValue | undefined => m.pairs.find((p) => p.key === key)?.value;
/** An absent key takes its default. A present one goes to the check as it reads, null included, to be refused there. */
const has = (m: RawMap, key: string): boolean => m.pairs.some((p) => p.key === key);

function resolve(raw: RawMap, problems: ChartProblem[]): unknown {
  const only = (m: RawMap, allowed: string[]) => {
    for (const p of m.pairs) if (!allowed.includes(p.key)) problems.push({ rule: 'unknown_key', subject: p.key, line: p.line });
  };
  only(raw, ['type', 'caption', 'direction', 'legend', 'groups', 'nodes', 'edges']);

  const type = has(raw, 'type') ? rawToJs(get(raw, 'type')!) : 'flow';
  const direction = has(raw, 'direction') ? rawToJs(get(raw, 'direction')!) : 'across';

  const groupsRaw = get(raw, 'groups') ?? null;
  const groups = isSeq(groupsRaw)
    ? groupsRaw.items.map((g) => {
        if (!isMap(g.value)) return rawToJs(g.value);
        only(g.value, ['id', 'label']);
        return { id: trimmed(rawToJs(get(g.value, 'id') ?? null)), label: trimmed(rawToJs(get(g.value, 'label') ?? null)) };
      })
    : groupsRaw === null
      ? []
      : rawToJs(groupsRaw);

  const nodesRaw = get(raw, 'nodes') ?? null;
  const nodes = isSeq(nodesRaw)
    ? nodesRaw.items.map((n) => {
        if (!isMap(n.value)) return rawToJs(n.value);
        only(n.value, ['id', 'label', 'tone', 'shape', 'group', 'start']);
        const o = n.value;
        return {
          id: trimmed(rawToJs(get(o, 'id') ?? null)),
          label: trimmed(rawToJs(get(o, 'label') ?? null)),
          tone: has(o, 'tone') ? rawToJs(get(o, 'tone')!) : 'neutral',
          shape: has(o, 'shape') ? rawToJs(get(o, 'shape')!) : type === 'states' ? 'pill' : 'box',
          ...(has(o, 'group') ? { group: rawToJs(get(o, 'group')!) } : {}),
          start: has(o, 'start') ? rawToJs(get(o, 'start')!) : false,
        };
      })
    : nodesRaw === null
      ? []
      : rawToJs(nodesRaw);

  const edgesRaw = get(raw, 'edges') ?? null;
  const edges = isSeq(edgesRaw)
    ? edgesRaw.items.flatMap((item, i) => {
        const bad = (subject: string): unknown[] => {
          problems.push({ rule: 'edge_form', subject, line: item.line });
          return [];
        };
        let e: RawValue = item.value;
        // `- a -> b: label` reads as the one-key mapping { "a -> b": label }.
        if (isMap(e) && e.pairs.length === 1 && e.pairs[0]!.key.includes('->')) {
          const { key, value: v } = e.pairs[0]!;
          // `- a -> b: [reject]` (no label) reads as a list holding the tone.
          if (isSeq(v)) {
            const tone = v.items[0]?.value;
            if (v.items.length !== 1 || typeof tone !== 'string') return bad(key);
            e = `${key} [${tone}]`;
          } else if (isMap(v) || typeof v === 'boolean') return bad(key);
          else e = `${key}: ${v ?? ''}`;
        }
        if (typeof e === 'string') {
          const m = EDGE.exec(e);
          if (!m) return bad(e);
          return [{ from: m[1], to: m[2], label: m[3] ?? '', tone: m[4] ?? 'neutral' }];
        }
        if (!isMap(e)) return bad(`edges[${i}]`);
        only(e, ['from', 'to', 'label', 'tone']);
        if (!has(e, 'from') || !has(e, 'to')) return bad(`edges[${i}]`);
        return [
          {
            from: trimmed(rawToJs(get(e, 'from')!)),
            to: trimmed(rawToJs(get(e, 'to')!)),
            label: has(e, 'label') ? trimmed(rawToJs(get(e, 'label')!)) : '',
            tone: has(e, 'tone') ? rawToJs(get(e, 'tone')!) : 'neutral',
          },
        ];
      })
    : edgesRaw === null
      ? []
      : rawToJs(edgesRaw);

  const legendRaw = get(raw, 'legend') ?? null;
  const legend = isMap(legendRaw)
    ? legendRaw.pairs.map((p) => ({ tone: p.key, label: trimmed(rawToJs(p.value)) }))
    : legendRaw === null
      ? []
      : null; // In source a legend is only a mapping, though the stored form is a list.

  return {
    type,
    caption: trimmed(rawToJs(get(raw, 'caption') ?? null)),
    direction,
    legend,
    groups,
    nodes,
    edges,
  };
}

export type ChartParse = { ok: true; chart: Chart } | { ok: false; problems: ChartProblem[] };

/**
 * Parses one chart's source to its stored form. Three stages, each reached only
 * when the one before found nothing: syntax (the first problem only), shape
 * (unknown_key and edge_form, all of them), then `checkChart` (all of them).
 */
export function parseChartSource(src: string): ChartParse {
  if (new TextEncoder().encode(src).length > MAX_SOURCE_BYTES) return { ok: false, problems: [{ rule: 'too_large', subject: 'source' }] };
  let raw: RawMap;
  try {
    raw = parseRaw(src);
  } catch (e) {
    if (e instanceof SyntaxProblem) return { ok: false, problems: [{ rule: 'source_syntax', subject: e.reason, line: e.line }] };
    throw e;
  }
  const problems: ChartProblem[] = [];
  const chart = resolve(raw, problems);
  if (problems.length) return { ok: false, problems };
  const checked = checkChart(chart);
  return checked.length ? { ok: false, problems: checked } : { ok: true, chart: chart as Chart };
}
