# @upax-ai/folio-charts

Charts in Folio documents: status lifecycles, approval routes and process flows,
written as a small text block and drawn as inline SVG. No runtime dependencies,
ESM and CommonJS exports, and right-to-left layouts. Node.js 22+ and modern browsers
are supported.

```sh
npm install @upax-ai/folio-charts
```

## Writing a chart

A chart is a strict subset of YAML 1.2. [GRAMMAR.md](GRAMMAR.md) is the full definition.

```yaml
type: states
caption: How a request moves from draft to done.
nodes:
  - { id: draft, label: Draft, tone: todo, start: true }
  - { id: review, label: In review, tone: review }
  - { id: done, label: Done, tone: done }
edges:
  - draft -> review: Submit
  - review -> done: Approve [approve]
  - review -> draft: Send back [reject]
```

## Drawing a chart

```ts
import { chartHtml, parseChartSource } from '@upax-ai/folio-charts';
import '@upax-ai/folio-charts/charts.css';

const parsed = parseChartSource(source);
if (parsed.ok) element.innerHTML = chartHtml(parsed.chart, { rtl: false });
else console.error(parsed.problems);
```

A chart that fails `checkChart` renders as a text list of its caption and steps, so
stored data can't reach the page as markup.

## Rendering a Folio document

Folio's HTML holds each chart as `<figure data-chart="n">` with a text version, which
reads well with no package at all. `renderCharts` swaps each figure for its drawing,
from the kth `chart` node in the document's AST. Fetch the AST only when the HTML
holds `data-chart=`.

```ts
import { renderCharts } from '@upax-ai/folio-charts';

const html = renderCharts(doc.html, doc.ast, { rtl: doc.dir === 'rtl' });
```

## Charts in Markdown

`extractCharts` works around a Markdown renderer, and `chartsToMarkdown` turns each
fence into Mermaid for places that can't draw SVG.

```ts
import { extractCharts } from '@upax-ai/folio-charts';

const { markdown, inject } = extractCharts(source, { where: 'guide.md' });
const html = inject(renderMarkdown(markdown));
```

## Theming

`charts.css` reads every color from tokens your page defines, so light and dark follow
your theme: `--chart-surface`, `--chart-sunk`, `--chart-line`, `--chart-line-strong`,
`--chart-strong`, `--chart-muted`, `--chart-subtle`, `--chart-success`,
`--chart-success-soft`, `--chart-danger`, `--chart-accent`, `--chart-accent-soft`,
`--chart-radius` and `--chart-font`.

## API

| Export | Does |
|---|---|
| `parseChartSource`, `printChartSource` | Source to the stored form and back, in canonical form |
| `checkChart` | Every rule a stored chart breaks. Empty means it is safe to draw |
| `chartStructure`, `chartStructureDiff`, `chartText` | What a translation may not change, and the labels it must |
| `chartHtml`, `layoutChart` | The figure as HTML, or just its geometry |
| `renderCharts`, `extractCharts` | Charts inside a Folio document or Markdown |
| `chartMermaid`, `chartsToMarkdown` | The Mermaid twin of a chart or document |

## Conformance corpus

`corpus/` holds the cases any other implementation of the grammar must agree on,
importable as `@upax-ai/folio-charts/corpus/valid.json`, `invalid.json`, `structure.json`
and `rendition.json`.
