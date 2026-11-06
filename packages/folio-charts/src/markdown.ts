// Charts in Markdown, read through the subset parser, plus renderCharts for sites
// that read Folio's HTML rendition.
import { chartHtml } from './html';
import { chartMermaid } from './mermaid';
import { parseChartSource } from './parse';
import type { Chart, ChartOptions } from './types';

const FENCE = /^```chart[^\S\n]*\n([\s\S]*?)\n```[^\S\n]*$/gm;

/** A source fence is authored by hand here, so a bad one still stops the build, naming `where`. */
function parseOrThrow(src: string, where = 'chart'): Chart {
  const r = parseChartSource(src);
  if (r.ok) return r.chart;
  const p = r.problems[0]!;
  throw new Error(`${where}: chart: ${p.rule} ${p.subject}${p.line ? ` at line ${p.line}` : ''}`);
}

/** Markdown twin: every ```chart block becomes its Mermaid version. */
export function chartsToMarkdown(md: string, opts: ChartOptions = {}): string {
  return md.replace(FENCE, (_m, src: string) => chartMermaid(parseOrThrow(src, opts.where), opts));
}

/**
 * Site rendering, in two steps around the Markdown renderer: `markdown` has
 * each chart swapped for a placeholder paragraph, and `inject` puts the
 * figures into the rendered HTML in their place.
 */
export function extractCharts(md: string, opts: ChartOptions = {}): { markdown: string; inject: (html: string) => string } {
  const figs: string[] = [];
  const markdown = md.replace(FENCE, (_m, src: string) => {
    figs.push(chartHtml(parseOrThrow(src, opts.where), opts));
    return `UPAXCHART${figs.length - 1}X`;
  });
  return { markdown, inject: (html) => html.replace(/<p>UPAXCHART(\d+)X<\/p>/g, (_m, i: string) => figs[Number(i)]!) };
}

const FIGURE = /<figure\b[^>]*\bdata-chart="(\d+)"[^>]*>[\s\S]*?<\/figure>/g;

function collect(node: unknown, out: unknown[]): void {
  if (!node || typeof node !== 'object') return;
  const n = node as { type?: unknown; attrs?: unknown; content?: unknown };
  if (n.type === 'chart') out.push(n.attrs);
  if (Array.isArray(n.content)) for (const k of n.content) collect(k, out);
}

/**
 * Folio's HTML rendition holds each chart as `<figure data-chart="n">` with caption
 * and steps. This swaps each for the drawing, from the kth `chart` node in the AST.
 * A figure with no such node keeps its text. Fetch the AST only when `html` holds
 * `data-chart=`.
 */
export function renderCharts(html: string, ast: unknown, opts: ChartOptions = {}): string {
  const charts: unknown[] = [];
  collect(ast, charts);
  return html.replace(FIGURE, (fig, n: string) => {
    const chart = charts[Number(n)];
    return chart === undefined ? fig : chartHtml(chart as Chart, opts);
  });
}
