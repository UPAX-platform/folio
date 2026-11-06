// Grammar conformance against corpus/, which any other implementation of the
// grammar reads too. A rule or printer change that lands in only one of them fails
// the other's suite: that's the drift alarm.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse as yamlParse } from 'yaml';
import { chartHtml, chartStructure, chartStructureDiff, chartText, checkChart, layoutChart, parseChartSource, printChartSource, type Chart, type ChartProblem, type ChartStructure, type StructureDiff } from '../src';
import { parseRaw, rawToJs } from '../src/parse';

const dir = join(__dirname, '..', 'corpus');
const load = <T>(name: string): T[] => {
  const cases = JSON.parse(readFileSync(join(dir, name), 'utf8')) as T[];
  expect(cases.length).toBeGreaterThan(0);
  return cases;
};

interface ValidCase {
  name: string;
  source: string;
  chart: Chart;
  canonical: string;
  text: string;
}
interface InvalidCase {
  name: string;
  source?: string;
  chart?: unknown;
  problems: ChartProblem[];
}
interface StructureCase {
  name: string;
  base: Chart;
  other: Chart;
  structure: ChartStructure;
  diff: StructureDiff | null;
}
const named = <T extends { name: string }>(cases: T[]) => cases.map((c) => [c.name, c] as const);
const parsed = (src: string): Chart => {
  const r = parseChartSource(src);
  if (!r.ok) throw new Error(JSON.stringify(r.problems));
  return r.chart;
};

describe('corpus: valid', () => {
  const cases = load<ValidCase>('valid.json');
  it('holds all 38 sample charts', () => {
    expect(cases.filter((c) => c.name.startsWith('sample/'))).toHaveLength(38);
  });
  it.each(named(cases))('%s', (_n, c) => {
    expect(parsed(c.source)).toEqual(c.chart);
    expect(rawToJs(parseRaw(c.source))).toEqual(yamlParse(c.source, { logLevel: 'error' }));
    expect(checkChart(c.chart)).toEqual([]);
    expect(chartText(c.chart)).toBe(c.text);
    // The printer's bytes, its fixed point, and that any YAML reads what it prints.
    expect(printChartSource(c.chart)).toBe(c.canonical);
    expect(parsed(c.canonical)).toEqual(c.chart);
    expect(printChartSource(parsed(c.canonical))).toBe(c.canonical);
    expect(rawToJs(parseRaw(c.canonical))).toEqual(yamlParse(c.canonical, { logLevel: 'error' }));
    // Whatever passes the check draws, in numbers.
    for (const rtl of [false, true]) expect(chartHtml(c.chart, { rtl })).not.toMatch(/NaN|Infinity|undefined/);
    expect(() => layoutChart(c.chart)).not.toThrow();
  });
});

describe('corpus: invalid', () => {
  it.each(named(load<InvalidCase>('invalid.json')))('%s', (_n, c) => {
    if (c.source !== undefined) {
      const r = parseChartSource(c.source);
      expect(r.ok ? [] : r.problems).toEqual(c.problems);
    } else {
      expect(checkChart(c.chart)).toEqual(c.problems);
    }
  });
});

describe('corpus: structure', () => {
  const cases = load<StructureCase>('structure.json');
  it('holds the 19 sample translated pairs', () => {
    expect(cases.filter((c) => c.name.startsWith('sample pair '))).toHaveLength(19);
  });
  it.each(named(cases))('%s', (_n, c) => {
    expect(chartStructure(c.other)).toEqual(c.structure);
    expect(chartStructureDiff(c.base, c.other)).toEqual(c.diff);
    if (c.diff === null) expect(chartStructureDiff(c.other, c.base)).toBeNull();
    else expect(chartStructureDiff(c.other, c.base)).not.toBeNull();
  });
});
