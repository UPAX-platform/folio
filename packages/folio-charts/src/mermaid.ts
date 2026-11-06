import type { Chart, ChartNode, ChartOptions, EdgeTone } from './types';

const MERMAID_COLORS: Record<string, string> = {
  approve: '#1F7A4D',
  done: '#1F7A4D',
  reject: '#B42318',
  review: '#B26B12',
  progress: '#B26B12',
  fail: '#8A91A6',
};

/** Legend entries in a twin: the edge colour as a square, dashed tones with a dashed arrow. */
const LEGEND_MARKS: Record<EdgeTone, string> = { neutral: '⬛ →', approve: '🟩 →', reject: '🟥 →', review: '🟧 ⇢', fail: '⬜ ⇢' };

/** The chart as a Mermaid flowchart block, preceded by its caption. */
export function chartMermaid(chart: Chart, opts: ChartOptions = {}): string {
  const q = (s: string) => `"${s.replace(/"/g, '#quot;')}"`;
  const id = new Map(chart.nodes.map((n, i) => [n.id, `n${i + 1}`]));
  const dir = chart.direction === 'down' ? 'TD' : opts.rtl ? 'RL' : 'LR';
  const node = (n: ChartNode) => {
    const t = q(n.label);
    const body = n.shape === 'pill' ? `([${t}])` : n.shape === 'diamond' ? `{${t}}` : n.shape === 'end' ? `((${t}))` : `[${t}]`;
    return `${id.get(n.id)}${body}`;
  };
  const out = [`flowchart ${dir}`];
  for (const g of chart.groups) {
    out.push(`  subgraph g_${g.id.replace(/-/g, '_')}[${q(g.label)}]`);
    for (const n of chart.nodes.filter((n) => n.group === g.id)) out.push(`    ${node(n)}`);
    out.push('  end');
  }
  for (const n of chart.nodes.filter((n) => !n.group)) out.push(`  ${node(n)}`);
  const links: string[] = [];
  chart.nodes.filter((n) => n.start).forEach((n, i) => links.push(`  start${i}((" ")) --> ${id.get(n.id)}`));
  const styles: string[] = [];
  for (const e of chart.edges) {
    const dashed = e.tone === 'review' || e.tone === 'fail';
    const arrow = dashed ? '-.->' : '-->';
    if (MERMAID_COLORS[e.tone]) styles.push(`  linkStyle ${links.length} stroke:${MERMAID_COLORS[e.tone]}`);
    links.push(`  ${id.get(e.from)} ${arrow}${e.label ? `|${q(e.label)}|` : ''} ${id.get(e.to)}`);
  }
  const classes = [...new Set(chart.nodes.map((n) => n.tone))].filter((t) => MERMAID_COLORS[t]);
  const classDefs = classes.map((t) => `  classDef ${t} stroke:${MERMAID_COLORS[t]},stroke-width:2px`);
  const assigns = classes.map((t) => `  class ${chart.nodes.filter((n) => n.tone === t).map((n) => id.get(n.id)).join(',')} ${t}`);
  const legend = chart.legend.length ? `\n\n${chart.legend.map((k) => `- ${LEGEND_MARKS[k.tone]} ${k.label}`).join('\n')}` : '';
  return `*${chart.caption}*\n\n\`\`\`mermaid\n${[...out, ...links, ...styles, ...classDefs, ...assigns].join('\n')}\n\`\`\`${legend}`;
}
