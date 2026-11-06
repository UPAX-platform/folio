export const NODE_TONES = ['neutral', 'todo', 'progress', 'done', 'approve', 'reject', 'review'] as const;
export const NODE_SHAPES = ['box', 'pill', 'diamond', 'end'] as const;
export const EDGE_TONES = ['neutral', 'approve', 'reject', 'review', 'fail'] as const;
export type NodeTone = (typeof NODE_TONES)[number];
export type NodeShape = (typeof NODE_SHAPES)[number];
export type EdgeTone = (typeof EDGE_TONES)[number];

export interface ChartNode {
  id: string;
  label: string;
  tone: NodeTone;
  shape: NodeShape;
  group?: string;
  start: boolean;
}
export interface ChartEdge {
  from: string;
  to: string;
  label: string;
  tone: EdgeTone;
}
/** Every default resolved. This is the stored form: a Folio `chart` node's attrs. */
export interface Chart {
  type: 'states' | 'flow';
  caption: string;
  direction: 'across' | 'down';
  legend: { tone: EdgeTone; label: string }[];
  groups: { id: string; label: string }[];
  nodes: ChartNode[];
  edges: ChartEdge[];
}

export interface ChartOptions {
  /** Right-to-left page: `across` charts run right to left. */
  rtl?: boolean;
  /** Names the source in errors, e.g. the article file. */
  where?: string;
  /** Prefix for the figure's element ids. Default: a hash of the chart and direction. */
  uid?: string;
}

/** The rules every implementation shares. GRAMMAR.md defines each subject. */
export type ChartRule =
  | 'label_required'
  | 'id_invalid'
  | 'id_duplicate'
  | 'nodes_required'
  | 'group_unknown'
  | 'group_empty'
  | 'edge_unknown_node'
  | 'edge_self_loop'
  | 'edge_duplicate'
  | 'value_not_allowed'
  | 'too_large'
  | 'source_syntax'
  | 'unknown_key'
  | 'edge_form';

export interface ChartProblem {
  rule: ChartRule;
  subject: string;
  /** 1-based line in the source. Only source_syntax, unknown_key and edge_form have one. */
  line?: number;
}

/** Only geometry can see these, so only TypeScript reports them. Subject: `a b`, the two ids. */
export interface LayoutProblem {
  rule: 'group_overlap' | 'node_in_group';
  subject: string;
}

/** Characters no source may hold: C0 and C1 controls except the line feed, DEL, line and paragraph separators, BOM, lone surrogates. */
export const SOURCE_FORBIDDEN = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u2028\u2029\ufeff\ud800-\udfff]/u;
/** The same for a label, which is one line. */
export const LABEL_FORBIDDEN = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\ufeff\ud800-\udfff]/u;
