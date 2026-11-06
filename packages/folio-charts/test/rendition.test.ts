// The HTML contract. corpus/rendition.json holds what Folio's delivery API serves:
// the sanitized `html` and the `ast`, as a site receives them. Each figure must
// become the drawing of the chart at its ordinal, and nothing else may move.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { chartHtml, renderCharts, type Chart } from '../src';

interface RenditionCase {
  name: string;
  html: string;
  ast: unknown;
}

const file = join(__dirname, '..', 'corpus', 'rendition.json');
const cases = JSON.parse(readFileSync(file, 'utf8')) as RenditionCase[];
const named = cases.map((c) => [c.name, c] as const);

/** The AST's charts in document order, written apart from the package's own walk. */
function chartsOf(node: unknown): Chart[] {
  const n = node as { type?: string; attrs?: Chart; content?: unknown[] };
  return [...(n.type === 'chart' ? [n.attrs!] : []), ...(n.content ?? []).flatMap(chartsOf)];
}

interface Figure {
  ordinal: number;
  start: number;
  end: number;
  text: string;
}

/** The served figures by plain search. A label can't close one: its markup is escaped. */
function figuresOf(html: string): Figure[] {
  const out: Figure[] = [];
  for (let at = html.indexOf('<figure data-chart="'); at >= 0; at = html.indexOf('<figure data-chart="', at + 1)) {
    const close = '</figure>';
    const end = html.indexOf(close, at) + close.length;
    out.push({ ordinal: Number(/^<figure data-chart="(\d+)" dir="auto">/.exec(html.slice(at))![1]), start: at, end, text: html.slice(at, end) });
  }
  return out;
}

const unescape = (s: string): string =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#34;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

describe('rendition.json, as served', () => {
  it('holds a document with at least two charts', () => {
    expect(cases.some((c) => figuresOf(c.html).length >= 2)).toBe(true);
  });

  it.each(named)('%s: each figure is its chart, in document order', (_n, c) => {
    const charts = chartsOf(c.ast);
    const figures = figuresOf(c.html);
    expect(figures.map((f) => f.ordinal)).toEqual(charts.map((_c, i) => i));
    for (const f of figures) {
      const caption = /<figcaption>([\s\S]*?)<\/figcaption>/.exec(f.text)![1]!;
      expect(unescape(caption)).toBe(charts[f.ordinal]!.caption);
    }
  });

  describe.each([false, true])('rtl %s', (rtl) => {
    it.each(named)('%s: renderCharts replaces each figure with the right drawing', (_n, c) => {
      const charts = chartsOf(c.ast);
      let want = '';
      let from = 0;
      for (const f of figuresOf(c.html)) {
        want += c.html.slice(from, f.start) + chartHtml(charts[f.ordinal]!, { rtl });
        from = f.end;
      }
      want += c.html.slice(from);

      const got = renderCharts(c.html, c.ast, { rtl });
      expect(got).toBe(want);
      expect(got).not.toContain('data-chart=');
      expect(got).not.toContain('<script');
      expect(got).not.toContain('<img');
    });
  });

  it('a chart that fails the check draws nothing and still holds its place', () => {
    const c = cases.find((x) => x.name === 'a chart that fails the check keeps its place')!;
    const got = renderCharts(c.html, c.ast);
    expect(got.match(/<svg/g)).toHaveLength(2);
    expect(got.match(/s-chart-fallback/g)).toHaveLength(1);
    expect(got.indexOf('<svg')).toBeLessThan(got.indexOf('s-chart-fallback'));
    expect(got.indexOf('s-chart-fallback')).toBeLessThan(got.lastIndexOf('<svg'));
  });
});
