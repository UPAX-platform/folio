/**
 * Charts in Folio documents and help Markdown: a fenced ```chart block holding a
 * small graph (status lifecycles, approval routes, process flows), stored in
 * Folio as a `chart` node's attrs. No runtime dependencies.
 *
 *  - Parse and print: `parseChartSource`, `printChartSource` (GRAMMAR.md).
 *  - Check and compare: `checkChart`, `chartStructure`, `chartStructureDiff`, `chartText`.
 *  - Draw: `chartHtml`, `layoutChart`, `renderCharts`, `extractCharts`, themed by
 *    `charts.css` through `--chart-*` tokens.
 *  - Twins: `chartMermaid`, `chartsToMarkdown`.
 */
export { checkChart, MAX_CAPTION_BYTES, MAX_CHART_BYTES, MAX_EDGES, MAX_GROUPS, MAX_ID_BYTES, MAX_LABEL_BYTES, MAX_LEGEND, MAX_NODES } from './check';
export { chartHtml } from './html';
export { layoutChart, type LaidEdge, type Layout } from './layout';
export { chartsToMarkdown, extractCharts, renderCharts } from './markdown';
export { chartMermaid } from './mermaid';
export { MAX_SOURCE_BYTES, parseChartSource, type ChartParse } from './parse';
export { printChartSource } from './print';
export { chartStructure, chartStructureDiff, chartText, type ChartStructure, type StructureDiff, type StructureSection } from './structure';
export { EDGE_TONES, NODE_SHAPES, NODE_TONES } from './types';
export type { Chart, ChartEdge, ChartNode, ChartOptions, ChartProblem, ChartRule, EdgeTone, LayoutProblem, NodeShape, NodeTone } from './types';
