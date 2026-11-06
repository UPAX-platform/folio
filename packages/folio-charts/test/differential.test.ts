// Every input the subset accepts reads the same under yaml 2.x. `yaml` is a dev
// dependency only, here.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse as yamlParse } from 'yaml';
import { printChartSource, type Chart } from '../src';
import { parseRaw, rawToJs } from '../src/parse';

const goldens = JSON.parse(readFileSync(join(__dirname, 'goldens/charts.json'), 'utf8')) as { charts: Record<string, { source: string; chart: Chart }> };
const sources = Object.values(goldens.charts).map((c) => c.source);
const yaml = (src: string): unknown => yamlParse(src, { logLevel: 'error' });
const accepted = (src: string): { value: unknown } | null => {
  try {
    return { value: rawToJs(parseRaw(src)) };
  } catch {
    return null;
  }
};

describe('the sample charts', () => {
  it.each(Object.entries(goldens.charts))('%s reads the same, authored and printed', (_n, c) => {
    expect(rawToJs(parseRaw(c.source))).toEqual(yaml(c.source));
    const printed = printChartSource(c.chart);
    expect(rawToJs(parseRaw(printed))).toEqual(yaml(printed));
  });
});

const NBSP = String.fromCodePoint(0xa0);
const TOKENS = [
  ': ', ':', ' #', '#', ',', ', ', '[', ']', '{', '}', '"', "'", "''", '\\', '\\"', '?', '? ', '- ', '-', '&a ', '*a', '!t ', '|', '>', '%', '@', '`', '~',
  'null', 'true', 'false', '10', '1e3', '0x10', '0o7', '1_000', '.5', '+1', '.inf', '.nan', '->', ' -> ', '---', '...', ' ', '  ', '\n', '\n  ', '\n- ', '\n  - ', '<<', '=',
  NBSP, '،', '؟', 'label: ', 'start: ', 'start: true', '{ ', ' }', '[ ', ' ]', 'legend:', '  approve: x', 'a -> b: x', '__proto__', '": x', ': [x]', ':}', ':,', ':]',
];

function fuzz(rounds: number, seed: number): { accepted: number; bad: { src: string; why: string }[] } {
  let s = seed >>> 0;
  const rnd = (n: number) => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) % n;
  };
  const small = ['caption: c\nnodes: [{ id: a, label: A }]', 'caption: c\nlegend:\n  approve: A\nnodes:\n  - { id: a, label: A, start: true }\nedges:\n  - a -> b: X [reject]\n  - a -> c: [review]', 'edges: [a -> b, a -> c: x, { from: a, to: b }]', "caption: 'it''s'\nnodes:\n  - { id: a, label: \"x\\\"y\" }"];
  let ok = 0;
  const bad: { src: string; why: string }[] = [];
  for (let i = 0; i < rounds; i++) {
    let src = i % 4 === 0 ? sources[rnd(sources.length)]! : small[rnd(small.length)]!;
    const edits = 1 + rnd(3);
    for (let e = 0; e < edits; e++) {
      const at = rnd(src.length + 1);
      if (rnd(5) === 0) src = src.slice(0, at) + src.slice(at + 1 + rnd(4));
      else src = src.slice(0, at) + TOKENS[rnd(TOKENS.length)]! + src.slice(at);
    }
    const mine = accepted(src);
    if (!mine) continue;
    ok++;
    try {
      const theirs = yaml(src);
      expect(mine.value).toEqual(theirs);
    } catch (err) {
      bad.push({ src, why: String(err).split('\n')[0]!.slice(0, 160) });
    }
  }
  return { accepted: ok, bad };
}

it('mutated sources: whatever the subset accepts, yaml reads the same', () => {
  const rounds = Number(process.env.CHART_FUZZ_ROUNDS ?? 4000);
  const r = fuzz(rounds, Number(process.env.CHART_FUZZ_SEED ?? 1));
  if (process.env.CHART_FUZZ_ROUNDS) console.log(`fuzz: ${rounds} rounds, ${r.accepted} accepted, ${r.bad.length} disagreed`);
  expect(r.bad.slice(0, 10)).toEqual([]);
  expect(r.accepted).toBeGreaterThan(rounds / 20);
}, 300_000);
