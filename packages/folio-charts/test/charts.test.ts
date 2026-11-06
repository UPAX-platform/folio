// The renderer: layout problems, uids, the text fallback, renderCharts.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { chartHtml, chartMermaid, chartStructure, chartStructureDiff, chartsToMarkdown, checkChart, extractCharts, layoutChart, parseChartSource, printChartSource, renderCharts, type Chart } from '../src';

const STATES = `
type: states
caption: Issue lifecycle
legend: { reject: Sent back }
groups:
  - { id: open, label: Open }
  - { id: closed, label: Closed }
nodes:
  - { id: todo, label: To do, group: open, start: true }
  - { id: doing, label: Doing, group: open }
  - { id: done, label: Done, tone: done, group: closed }
edges:
  - todo -> doing: Start
  - doing -> todo: Stop [reject]
  - { from: doing, to: done, label: Finish, tone: approve }
`;
const parseChart = (src: string): Chart => {
  const r = parseChartSource(src);
  if (!r.ok) throw new Error(JSON.stringify(r.problems));
  return r.chart;
};

it('parses edges in string, one-key mapping and object form', () => {
  const c = parseChart(STATES);
  expect(c.edges.map((e) => [e.from, e.to, e.label, e.tone])).toEqual([
    ['todo', 'doing', 'Start', 'neutral'],
    ['doing', 'todo', 'Stop', 'reject'],
    ['doing', 'done', 'Finish', 'approve'],
  ]);
  expect(c.nodes[0]!.shape).toBe('pill');
  expect(parseChart('caption: x\nnodes: [{ id: a, label: A }]').nodes[0]!.shape).toBe('box');
});

it('layout ranks follow the edges and groups read as columns', () => {
  const l = layoutChart(parseChart(STATES));
  const x = Object.fromEntries(l.nodes.map((n) => [n.id, n.x]));
  expect(x.todo! < x.doing! && x.doing! < x.done!).toBe(true);
  const [open, closed] = l.groups;
  expect(open!.x + open!.w <= closed!.x).toBe(true);
  // The back edge ends at "To do": its last point sits on that node's edge.
  const back = l.edges.find((e) => e.edge.from === 'doing' && e.edge.to === 'todo')!;
  const todo = l.nodes.find((n) => n.id === 'todo')!;
  expect(Math.abs(back.points.at(-1)!.x - (todo.x + todo.w / 2))).toBeLessThan(1);
});

it('rtl mirrors across charts', () => {
  const l = layoutChart(parseChart(STATES), { rtl: true });
  const x = Object.fromEntries(l.nodes.map((n) => [n.id, n.x]));
  expect(x.todo! > x.doing! && x.doing! > x.done!).toBe(true);
});

it('html is a captioned figure with a text version', () => {
  const html = chartHtml(parseChart(STATES));
  expect(html).toMatch(/^<figure class="s-chart s-chart-states not-content">/);
  expect(html).toMatch(/<figcaption id="c\w+-cap">Issue lifecycle<\/figcaption>/);
  expect(html).toMatch(/<li>Doing → To do: Stop<\/li>/);
  expect(html).toMatch(/class="s-chart-key s-chart-e-reject"/);
  expect(html).not.toMatch(/\bdoing\b/); // ids never reach the page
});

it('mermaid uses neutral ids, quotes labels and keeps styles', () => {
  const md = chartMermaid(parseChart(STATES.replace('Start', '"Say \\"go\\""')), { rtl: true });
  expect(md).toMatch(/^\*Issue lifecycle\*\n\n```mermaid\nflowchart RL\n/);
  expect(md).toMatch(/subgraph g_open\["Open"\]/);
  expect(md).toMatch(/n1 -->\|"Say #quot;go#quot;"\| n2/);
  expect(md).toMatch(/linkStyle 2 stroke:#B42318/);
  expect(md).toMatch(/- 🟥 → Sent back/);
});

it('markdown glue replaces only chart fences', () => {
  const src = `Intro\n\n\`\`\`chart\ncaption: C\nnodes: [{ id: a, label: A }]\n\`\`\`\n\n\`\`\`js\nx\n\`\`\`\n`;
  expect(chartsToMarkdown(src)).toMatch(/```mermaid[\s\S]*```js\nx\n```/);
  const { markdown, inject } = extractCharts(src);
  expect(markdown).toMatch(/^Intro\n\nUPAXCHART0X\n\n```js/);
  expect(inject('<p>Intro</p>\n<p>UPAXCHART0X</p>')).toMatch(/<p>Intro<\/p>\n<figure /);
});

it('a fence that does not parse stops the glue, naming the file and the line', () => {
  const src = '```chart\ncaption: c\nnodes: [{ id: a, label: &x A }]\n```';
  expect(() => extractCharts(src, { where: 'x.md' })).toThrow('x.md: chart: source_syntax anchor at line 2');
  expect(() => chartsToMarkdown(src, { where: 'x.md' })).toThrow('x.md: chart: source_syntax anchor at line 2');
});

it.each(['across', 'down'])('labels on edges leaving one node do not overlap, and ports are distinct (%s)', (direction) => {
  const l = layoutChart(parseChart(`direction: ${direction}\ncaption: c\nnodes: [{ id: a, label: Awaiting review }, { id: b, label: Approved }, { id: c, label: Rejected }]\nedges:\n  - a -> b: Approves\n  - a -> c: Refuses\n  - c -> a: Edit and resubmit`));
  const ls = l.edges.map((e) => e.label!).filter(Boolean);
  for (let i = 0; i < ls.length; i++)
    for (let j = i + 1; j < ls.length; j++) {
      const [p, q] = [ls[i]!, ls[j]!];
      expect(Math.abs(p.x - q.x) >= (p.w + q.w) / 2 || Math.abs(p.y - q.y) >= (p.h + q.h) / 2).toBe(true);
    }
  const ends = l.edges.flatMap((e) => [e.points[0]!, e.points.at(-1)!]).map((p) => `${Math.round(p.x)},${Math.round(p.y)}`);
  expect(new Set(ends).size).toBe(ends.length);
});

it('everything drawn stays inside the canvas, even labels pushed apart', () => {
  const l = layoutChart(parseChart('type: states\ncaption: c\nnodes: [{ id: open, label: Open, start: true }, { id: calc, label: Calculated }]\nedges:\n  - open -> calc: Calculate\n  - calc -> open: Withdraw calculation [reject]'));
  for (const e of l.edges) {
    const b = e.label!;
    expect(b.x - b.w / 2 >= 0 && b.y - b.h / 2 >= 0 && b.x + b.w / 2 <= l.width && b.y + b.h / 2 <= l.height).toBe(true);
  }
});

describe('layout problems', () => {
  // A group's members land in ranks around a stranger, so its box covers the stranger.
  const STRANGER = `caption: c\ngroups:\n  - { id: g, label: G }\nnodes:\n  - { id: a, label: A, group: g }\n  - { id: x, label: X }\n  - { id: b, label: B, group: g }\nedges:\n  - a -> x\n  - x -> b`;
  const OVERLAP = `caption: c\ngroups:\n  - { id: g, label: G }\n  - { id: h, label: H }\nnodes:\n  - { id: a, label: A, group: g }\n  - { id: b, label: B, group: h }\n  - { id: c, label: C, group: g }\nedges:\n  - a -> b\n  - b -> c`;

  it('a stranger inside a group is reported, and the chart still draws', () => {
    const l = layoutChart(parseChart(STRANGER));
    expect(l.problems).toEqual([{ rule: 'node_in_group', subject: 'x g' }]);
    expect(chartHtml(parseChart(STRANGER))).toContain('<svg');
  });
  it('groups that overlap are reported once per pair', () => {
    const l = layoutChart(parseChart(OVERLAP));
    expect(l.problems.filter((p) => p.rule === 'group_overlap')).toEqual([{ rule: 'group_overlap', subject: 'g h' }]);
    expect(chartHtml(parseChart(OVERLAP))).toContain('<svg');
  });
  it('an empty group never reaches a broken box', () => {
    const c: Chart = { ...parseChart('caption: c\nnodes: [{ id: a, label: A }]'), groups: [{ id: 'g', label: 'G' }] };
    const l = layoutChart(c);
    expect(l.groups).toEqual([]);
    expect(Number.isFinite(l.width)).toBe(true);
  });
});

describe('uid', () => {
  const c = parseChart(STATES);
  const uidOf = (html: string) => /id="(c\w+)-cap"/.exec(html)![1];
  it('does not depend on call order', () => {
    const first = chartHtml(c);
    chartHtml(parseChart('caption: other\nnodes: [{ id: a, label: A }]'));
    expect(chartHtml(c)).toBe(first);
  });
  it('differs by direction, so a page holding both has no collision', () => {
    expect(uidOf(chartHtml(c, { rtl: true }))).not.toBe(uidOf(chartHtml(c)));
  });
  it('can be set', () => {
    const html = chartHtml(c, { uid: 'fig7' });
    expect(html).toContain('id="fig7-cap"');
    expect(html).toContain('url(#fig7-neutral)');
    expect(html).not.toMatch(/(id="|url\(#|aria-\w+=")c[0-9a-z]+-/);
  });
});

describe('a stored chart that fails the check renders as text', () => {
  const MARKUP = '"><img src=x onerror=alert(1)>';
  const base = parseChart('caption: c\nnodes: [{ id: a, label: A }, { id: b, label: B }]\nedges:\n  - a -> b: Go');
  it.each([
    ['node tone', { ...base, nodes: [{ ...base.nodes[0]!, tone: MARKUP }, base.nodes[1]!] }],
    ['edge tone', { ...base, edges: [{ ...base.edges[0]!, tone: MARKUP }] }],
    ['legend tone', { ...base, legend: [{ tone: MARKUP, label: 'x' }] }],
    ['type', { ...base, type: MARKUP }],
    ['shape', { ...base, nodes: [{ ...base.nodes[0]!, shape: MARKUP }, base.nodes[1]!] }],
  ])('markup in %s never reaches the page', (_w, chart) => {
    const html = chartHtml(chart as unknown as Chart);
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<svg');
    expect(html).toContain('s-chart-fallback');
    expect(html).toContain('<li>A → B: Go</li>');
  });
  it('escapes markup in labels and survives anything', () => {
    const html = chartHtml({ caption: '<b>x</b>', nodes: [{ id: 'a', label: '<i>' }], edges: [{ from: 'a', to: 'z', label: '&' }] } as unknown as Chart, { rtl: true });
    expect(html).toContain('<figcaption>&lt;b&gt;x&lt;/b&gt;</figcaption>');
    expect(html).toContain('<li>&lt;i&gt; ← z: &amp;</li>');
    for (const v of [null, 'x', 5, [], { edges: 'x' }, { nodes: [null, 1] }]) expect(chartHtml(v as unknown as Chart)).toContain('s-chart-fallback');
  });
  it('a valid chart with a markup label is escaped, not refused', () => {
    const html = chartHtml({ ...base, caption: '<script>' });
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
    expect(html).toContain('<svg');
  });
});

describe('renderCharts', () => {
  const one = parseChart('caption: One\nnodes: [{ id: a, label: A }]');
  const two = parseChart('caption: Two\nnodes: [{ id: b, label: B }]');
  const ast = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x' }] }, { type: 'chart', attrs: one }, { type: 'callout', content: [{ type: 'paragraph' }] }, { type: 'chart', attrs: two }] };
  const fig = (n: number, text: string) => `<figure data-chart="${n}" dir="auto"><figcaption>${text}</figcaption><ul><li>step</li></ul></figure>`;

  it('swaps each figure for its drawing, by ordinal', () => {
    const html = renderCharts(`<p>a</p>${fig(1, 'Two')}<p>b</p>${fig(0, 'One')}<p>c</p>`, ast, { rtl: true });
    expect(html.match(/<svg/g)).toHaveLength(2);
    expect(html.indexOf('>Two<')).toBeLessThan(html.indexOf('>One<'));
    expect(html).toContain('<p>b</p>');
    expect(html).not.toContain('data-chart');
    expect(html).not.toContain('step');
  });
  it('still draws a chart stored nested, in document order: a renderer never fails', () => {
    const nested = { type: 'doc', content: [{ type: 'blockquote', content: [{ type: 'chart', attrs: one }] }, { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'chart', attrs: two }] }] }] };
    const html = renderCharts(`<blockquote>${fig(0, 'One')}</blockquote><ul><li>${fig(1, 'Two')}</li></ul>`, nested);
    expect(html.match(/<svg/g)).toHaveLength(2);
    expect(html).not.toContain('data-chart');
    expect(html.indexOf('>One<')).toBeLessThan(html.indexOf('>Two<'));
  });
  it('keeps the text when there is no such node', () => {
    expect(renderCharts(fig(5, 'x'), ast)).toBe(fig(5, 'x'));
    expect(renderCharts(fig(0, 'x'), null)).toBe(fig(0, 'x'));
  });
  it('leaves other figures alone', () => {
    const other = '<figure class="img"><img src="a"></figure>';
    expect(renderCharts(`${other}${fig(0, 'One')}`, ast)).toMatch(/^<figure class="img"><img src="a"><\/figure><figure class="s-chart/);
  });
  it('a stored chart that fails the check still renders only text', () => {
    const html = renderCharts(fig(0, 'x'), { content: [{ type: 'chart', attrs: { ...one, type: '<img>' } }] });
    expect(html).not.toContain('<img');
    expect(html).toContain('s-chart-fallback');
  });
});

describe('charts.css', () => {
  const css = readFileSync(join(__dirname, '../src/charts.css'), 'utf8');
  const body = css.slice(css.indexOf('*/') + 2);
  it('holds no literal color', () => {
    expect(body).not.toMatch(/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|\boklch\(/);
  });
  it('reads only --chart-* tokens', () => {
    expect(body).not.toContain('--s-');
    const used = new Set([...body.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]!));
    for (const t of used) expect(t.startsWith('--chart-')).toBe(true);
  });
  it('documents every token a host must define', () => {
    const local = new Set([...body.matchAll(/^\s*(--chart-[\w-]+):/gm)].map((m) => m[1]!));
    const header = css.slice(0, css.indexOf('*/'));
    for (const m of body.matchAll(/var\((--chart-[\w-]+)/g)) if (!local.has(m[1]!)) expect(header).toContain(m[1]!);
  });
  it('follows the direction of the content, not the language of the page', () => {
    expect(body).toContain("[dir='rtl'] .s-chart svg text");
    expect(body).not.toContain(':root[lang');
  });
  it('carries its own visually-hidden class', () => {
    expect(body).toContain('.s-visually-hidden');
  });
  it('styles every class the renderer writes', () => {
    const html = chartHtml(parseChart(`${STATES}`));
    const written = new Set([...html.matchAll(/class="([^"]*)"/g)].flatMap((m) => m[1]!.split(' ')).filter((c) => c.startsWith('s-chart') || c.startsWith('s-visually')));
    const unstyled = ['s-chart-states', 's-chart-n-neutral', 's-chart-e-neutral'];
    for (const c of written) if (!unstyled.includes(c)) expect(body).toContain(`.${c}`);
  });
});

// A pending suggestion rides on stored JSON, and the check doesn't read what's in
// it. Every output has to be blind to it.
describe('a pending suggestion attr', () => {
  const parsed = parseChartSource(STATES);
  if (!parsed.ok) throw new Error('STATES must parse');
  const chart = parsed.chart;
  const hostile: unknown[] = [
    { suggestion_id: 'LEAK', author_kind: 'ai', created_at: 'LEAK', previous: { caption: 'LEAK <script>alert(1)</script>' } },
    'LEAK <script>',
    [{ LEAK: { LEAK: [1, 2, 3] } }],
    12345,
    null,
  ];
  for (const suggestion of hostile) {
    const pending = { ...chart, suggestion } as Chart;
    const name = JSON.stringify(suggestion);
    it(`passes the check: ${name}`, () => {
      expect(checkChart(pending)).toEqual([]);
    });
    it(`reaches no output: ${name}`, () => {
      expect(chartHtml(pending)).toBe(chartHtml(chart));
      expect(chartHtml(pending, { rtl: true })).toBe(chartHtml(chart, { rtl: true }));
      expect(printChartSource(pending)).toBe(printChartSource(chart));
      expect(chartMermaid(pending)).toBe(chartMermaid(chart));
      const ast = { type: 'doc', content: [{ type: 'chart', attrs: pending }] };
      expect(renderCharts('<figure data-chart="0"></figure>', ast)).toBe(chartHtml(chart));
    });
    it(`is not structure: ${name}`, () => {
      expect(chartStructure(pending)).toEqual(chartStructure(chart));
      expect(chartStructureDiff(chart, pending)).toBeNull();
    });
    it(`stays out of a failed chart's text fallback: ${name}`, () => {
      const broken = { ...pending, edges: [{ from: 'nope', to: 'nada', label: '', tone: 'neutral' }] } as Chart;
      expect(chartHtml(broken)).not.toContain('LEAK');
    });
  }
  it('cannot be written in source', () => {
    const parsed = parseChartSource('caption: A\nsuggestion: x\nnodes:\n  - { id: a, label: A }');
    expect(parsed).toMatchObject({ ok: false, problems: [{ rule: 'unknown_key', subject: 'suggestion' }] });
  });
});
