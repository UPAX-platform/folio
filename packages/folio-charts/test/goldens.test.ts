// The drawing doesn't move. test/goldens/charts.json holds 38 sample charts, 19 in
// each of two scripts, drawn both ways. Their words are filler of the original
// lengths, so they exercise real layouts. Uids are normalized.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { chartHtml, chartMermaid, layoutChart, parseChartSource, printChartSource, type Chart } from '../src';

interface Golden {
  source: string;
  chart: Chart;
  ltr: string;
  rtl: string;
  mermaidLtr: string;
  mermaidRtl: string;
}
const goldens = JSON.parse(readFileSync(join(__dirname, 'goldens/charts.json'), 'utf8')) as { count: number; charts: Record<string, Golden> };
const normalize = (html: string) => html.replace(/(id="|url\(#|aria-labelledby="|aria-describedby=")c[0-9a-z]+-/g, '$1UID-');
const parsed = (src: string): Chart => {
  const r = parseChartSource(src);
  if (!r.ok) throw new Error(JSON.stringify(r.problems));
  return r.chart;
};

it('covers every sample chart', () => {
  expect(goldens.count).toBe(38);
  expect(Object.keys(goldens.charts)).toHaveLength(38);
});

describe.each(Object.entries(goldens.charts))('%s', (_name, g) => {
  it('the resolved chart draws the same', () => {
    expect(normalize(chartHtml(g.chart, { rtl: false }))).toBe(g.ltr);
    expect(normalize(chartHtml(g.chart, { rtl: true }))).toBe(g.rtl);
    expect(chartMermaid(g.chart, { rtl: false })).toBe(g.mermaidLtr);
    expect(chartMermaid(g.chart, { rtl: true })).toBe(g.mermaidRtl);
  });

  it('the subset parser resolves the source to the same chart', () => {
    expect(parsed(g.source)).toEqual(g.chart);
  });

  it('source to canonical print to parse draws the same', () => {
    const again = parsed(printChartSource(parsed(g.source)));
    expect(again).toEqual(g.chart);
    expect(normalize(chartHtml(again, { rtl: false }))).toBe(g.ltr);
    expect(normalize(chartHtml(again, { rtl: true }))).toBe(g.rtl);
    expect(chartMermaid(again, { rtl: true })).toBe(g.mermaidRtl);
  });

  it('has no layout problems', () => {
    expect(layoutChart(g.chart).problems).toEqual([]);
  });
});
