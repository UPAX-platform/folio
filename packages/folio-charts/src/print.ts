// The canonical printer. Every implementation prints the same bytes, so the rule
// below is deliberately simple and conservative: GRAMMAR.md § Printer.
import type { Chart, ChartEdge, ChartNode } from './types';

const PLAIN_UNSAFE = /[:#,[\]{}&*!|>'"%@`?\\\u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]/;
const PLAIN_UNSAFE_START = /^[-~=<.+0-9]/;
const RESERVED = /^(?:null|true|false|yes|no|on|off|y|n)$/i;

/** Whether any YAML parser reads `s`, unquoted, as this exact string. */
export function plainSafe(s: string): boolean {
  return s !== '' && s === s.trim() && !PLAIN_UNSAFE.test(s) && !PLAIN_UNSAFE_START.test(s) && !RESERVED.test(s);
}

const quote = (s: string): string => `"${s.replace(/[\\"]/g, '\\$&')}"`;
const scalar = (s: string): string => (plainSafe(s) ? s : quote(s));

function node(n: ChartNode, type: Chart['type']): string {
  const parts = [`id: ${scalar(n.id)}`, `label: ${scalar(n.label)}`];
  if (n.tone !== 'neutral') parts.push(`tone: ${n.tone}`);
  if (n.shape !== (type === 'states' ? 'pill' : 'box')) parts.push(`shape: ${n.shape}`);
  if (n.group !== undefined) parts.push(`group: ${scalar(n.group)}`);
  if (n.start) parts.push('start: true');
  return `  - { ${parts.join(', ')} }`;
}

function edge(e: ChartEdge): string {
  const tone = e.tone === 'neutral' ? '' : e.tone;
  if (e.label === '' || plainSafe(e.label)) {
    const body = [e.label, tone && `[${tone}]`].filter(Boolean).join(' ');
    return `  - ${e.from} -> ${e.to}${body ? `: ${body}` : ''}`;
  }
  return `  - { from: ${scalar(e.from)}, to: ${scalar(e.to)}, label: ${quote(e.label)}${tone ? `, tone: ${tone}` : ''} }`;
}

/** A chart that passed `checkChart`, as source. Lines end in `\n` except the last. */
export function printChartSource(chart: Chart): string {
  const out: string[] = [];
  if (chart.type !== 'flow') out.push(`type: ${chart.type}`);
  if (chart.direction !== 'across') out.push(`direction: ${chart.direction}`);
  out.push(`caption: ${scalar(chart.caption)}`);
  if (chart.legend.length) out.push('legend:', ...chart.legend.map((l) => `  ${l.tone}: ${scalar(l.label)}`));
  if (chart.groups.length) out.push('groups:', ...chart.groups.map((g) => `  - { id: ${scalar(g.id)}, label: ${scalar(g.label)} }`));
  out.push('nodes:', ...chart.nodes.map((n) => node(n, chart.type)));
  if (chart.edges.length) out.push('edges:', ...chart.edges.map(edge));
  return out.join('\n');
}
