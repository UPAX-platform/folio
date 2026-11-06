# Chart source grammar

The definition this package (`src/parse.ts`, `src/check.ts`, `src/print.ts`, `src/structure.ts`) implements, and any other implementation must follow. `corpus/{valid,invalid,structure}.json` is the conformance suite: a change here that lands in only one implementation fails the other's tests.

It is a strict subset of YAML 1.2. Everything accepted reads the same under `yaml` 2.x (`test/differential.test.ts`), and this package has no YAML library at runtime. Much of YAML is refused on purpose, each with a line number.

## Parsing runs in stages

Each stage runs only when the one before found nothing.

| Stage | Reports |
|---|---|
| 0. Size | `too_large`, subject `source`, when the UTF-8 source is over 32,768 bytes |
| 1. Syntax | The **first** problem only: `source_syntax`, subject a reason below, with a line |
| 2. Shape | **All** `unknown_key` and `edge_form`, with lines, in the order below |
| 3. Check | **All** rule findings of [Check](#check), which also applies to stored JSON. No lines |

Lines count from 1 and split only on line feed.

## Syntax

**Characters.** Scan the whole source first, and report the first forbidden character in it, wherever it is, comments included:

- Reason `tab`: U+0009.
- Reason `control_char`: U+0000–U+0008, U+000B–U+001F (carriage return included), U+007F–U+009F, U+2028, U+2029, U+FEFF. In a UTF-16 language also a lone surrogate; its counterpart in a UTF-8 language is invalid UTF-8, which is `control_char` there.

**Document.** Lines are taken in order. A blank line (only spaces) or a comment line (spaces, then `#`) is skipped anywhere. With no other line: `empty`, line 1. Every other line starts at column 0 and is, checked in this order:

1. Indented: `indent`.
2. `---` or `...` then a space or the end of the line, or anything starting with `%`: `document_marker`.
3. A top-level entry, below.

**Entry.** `key:` then the end of the line, or `key: rest`. A line that doesn't split that way is `key`: the key is the text before the first colon, it can't start with a space, and the colon is followed by a space or the end of the line.

- The key must match `^[A-Za-z_][A-Za-z0-9_-]*$`, else `key`. A key in [not-a-string](#scalars) is `not_string`. A key seen before in the same mapping is `duplicate_key`.
- If `rest` is blank or a comment, the value is a [body](#bodies), or null when the next non-blank line is at column 0 or there is none.
- Otherwise the value is an [inline value](#inline-values).

### Bodies

The body is every following line up to the next non-blank line at column 0. Its first non-blank line sets its indent and its kind. Every other non-blank line must have exactly that indent, else `indent`.

- **Sequence**, when the first line, past the indent, is `-` then a space or the end of the line. Each line must be the same form, else `item_mapping`, and holds one [item](#items). A sequence at the key's own indent is not a body and fails as `key`.
- **Mapping**, otherwise. Each line is an entry as above, with an [inline value](#inline-values), or null when nothing follows the colon. Nothing nests under it.

### Items

After the `-` and any spaces:

- Nothing, or a comment: `item_empty`.
- `[`, `{`, `"` or `'`: an [inline value](#inline-values).
- Otherwise check the [first character](#scalars), then scan for whichever comes first: a space and `#` (a comment begins), or a colon followed by a space or the end of the line.
  - A colon: the text before it, with trailing spaces removed, is a one-key mapping's key. It must contain `->`, else `item_mapping`. What follows is an inline value, or null when it's blank or a comment.
  - Otherwise: a plain string, checked by [not-a-string](#scalars).

### Inline values

After any spaces:

- `[` or `{`: [flow](#flow).
- `"` or `'`: [quoted](#scalars).
- Otherwise check the first character, then scan as for items. A colon there is `plain_colon`. The text, with trailing spaces removed, is a plain string, checked by not-a-string.

After a flow or quoted value only spaces may follow, then the end of the line or a `#` with at least one space before it. Anything else is `trailing`.

### Flow

A flow collection opens and closes on one line. Reaching the end of the line inside one is `unterminated`, and multi-line flow therefore fails on its first line. Depth is at most 3, else `flow_depth`.

Spaces are allowed around every token. After an entry comes either the closing bracket, or `,` and another entry:

- A colon there: `plain_colon`. Anything else: `trailing`.
- A comma followed by the closing bracket or another comma: `flow_comma`.

**Flow plain text** checks the first character, then runs until the first of:

- `,` `[` `]` `{` `}`
- A colon followed by a space, the end of the line, or one of those five: it ends the text.
- A `#` right after a space: `unterminated`, because YAML reads the rest of the line as a comment.

Trailing spaces are removed.

**In `[ … ]`,** an entry is a nested collection, a quoted string, or flow plain text. Plain text followed by a colon is a one-key mapping: its key must contain `->`, else `item_mapping`, and the value is a [flow value](#flow-values). Plain text alone is checked by not-a-string.

**In `{ … }`,** an entry is a key:

- A quote: `quoted_key`.
- Flow plain text, which not-a-string applies to. A key seen before is `duplicate_key`.
- A colon then a flow value, or no colon and the value is null. So `{ label: Read, Update }` has a key `Update`, which is why that mistake surfaces as `unknown_key`.

### Flow values

After any spaces: `,` `]` or `}` means null, without consuming it. Otherwise a nested collection, a quoted string, or flow plain text checked by not-a-string.

### Scalars

**First character of plain text.** In this order:

| Character | Reason |
|---|---|
| `&` `*` | `anchor` |
| `!` | `tag` |
| `\|` `>` | `block_scalar` |
| `?` `-` `:` `,` `[` `]` `{` `}` `#` `%` `@` `` ` `` | `indicator` |

**Not-a-string.** Plain text matching this is `not_string`:

```
^(?:~|null|Null|NULL|true|True|TRUE|false|False|FALSE|[-+]?[0-9]+|0o[0-7]+|0x[0-9a-fA-F]+|[-+]?(?:\.[0-9]+|[0-9]+(?:\.[0-9]*)?)(?:[eE][-+]?[0-9]+)?|[-+]?\.(?:inf|Inf|INF)|\.(?:nan|NaN|NAN))$
```

The one exception: as the value of a key named exactly `start`, in a flow mapping, an entry or a body, `true` and `false` are booleans. `1_000`, `0x1G`, `2026-01-01`, `12:30:00`, `yes`, `no`, `on` and `off` are strings, as they are in YAML 1.2.

**Double-quoted.** The only escapes are `\"` and `\\`. Any other backslash is `escape`. No closing quote on the line is `unterminated`.

**Single-quoted.** `''` is a quote. No closing quote on the line is `unterminated`.

## Shape

Walks the parsed values and fills in defaults, producing the stored form. Problems come in this order: unknown top-level keys, then groups, nodes and edges in document order.

Top-level keys: `type`, `caption`, `direction`, `legend`, `groups`, `nodes`, `edges`. Otherwise `unknown_key`, subject the key, at that key's line.

| Field | When absent | Otherwise |
|---|---|---|
| `type` | `flow` | As read |
| `direction` | `across` | As read |
| `caption` | null | As read; a string is [trimmed](#javascript-semantics-every-implementation-must-match) |
| `legend` | `[]`, and null too | A mapping becomes `[{tone: key, label}]`, labels trimmed, in order. Anything else becomes null, so the check refuses it. In source a legend is never a list |
| `groups`, `edges` | `[]`, and null too | A list is walked. Anything else goes to the check as read |
| `nodes` | `[]`, and null too | A list is walked. Anything else goes to the check as read |

An item that isn't a mapping goes to the check as read, except in `edges`.

**Group.** Keys `id`, `label`, else `unknown_key`. `id` and `label` are trimmed strings, or null.

**Node.** Keys `id`, `label`, `tone`, `shape`, `group`, `start`, else `unknown_key`. `id` and `label` as for groups. Defaults: `tone` `neutral`, `shape` `pill` when `type` is `states` and otherwise `box`, `start` false. `group` is left out when absent. A value that is present passes through untrimmed, null included.

**Edge.** Taken in this order:

1. A mapping with one key containing `->`. With `k` the key:
   - The value is a list of exactly one string `t`: the string `k [t]`.
   - The value is a string `v`: the string `k: v`. Null: the string `k: `.
   - Anything else: `edge_form`, subject `k`.
2. A string is matched against the pattern below. No match: `edge_form`, subject the string. A match gives `from`, `to`, `label` (empty when absent) and `tone` (`neutral` when absent).
   ```
   ^\s*([a-z][a-z0-9_-]*)\s*->\s*([a-z][a-z0-9_-]*)\s*(?::\s*(.*?))?\s*(?:\[([a-z]+)\])?\s*$
   ```
3. Not a mapping: `edge_form`, subject `edges[i]`, where `i` counts all items.
4. A mapping: keys `from`, `to`, `label`, `tone`, else `unknown_key`. `from` or `to` absent: `edge_form`, subject `edges[i]`. `from`, `to` and `label` are trimmed when strings. `label` absent is empty, null stays null. `tone` absent is `neutral`.

## Check

`checkChart` takes the stored form as any JSON value and returns every finding, in the order written here. An empty list means it is safe to lay out and render.

| Rule | Subject |
|---|---|
| `label_required`, `value_not_allowed`, `too_large` on a label | The owner: `caption`, a legend's tone, a group's or node's id, or `from -> to` |
| `id_invalid`, `id_duplicate` | The id, or `nodes[i]`/`groups[i]` when it isn't a non-empty string of at most 64 bytes |
| `nodes_required` | `nodes` |
| `group_unknown` | The node's id |
| `group_empty` | The group's id |
| `edge_unknown_node`, `edge_self_loop`, `edge_duplicate` | `from -> to` |

**Labels.** A required label fails as:

1. `label_required`: not a string, or empty once trimmed.
2. `value_not_allowed`: it differs from its trim, or holds a [forbidden character](#syntax) or a line feed. Otherwise it could not print and read back the same.
3. `too_large`: over 256 bytes of UTF-8 (the caption: 1,024).

**The order.**

1. Not an object: `value_not_allowed` subject `chart`, and stop.
2. Keys other than the seven fields and `suggestion`, **sorted**: `value_not_allowed`, subject the key.
3. `type` is `states` or `flow`, `direction` is `across` or `down`: else `value_not_allowed`, subject the field.
4. `caption`, as a label.
5. `legend`: not a list `value_not_allowed` subject `legend`; over 5 entries `too_large` subject `legend`, and skip them. Per entry:
   - Not an object, or `tone` not an edge tone, or a tone already seen: `value_not_allowed` subject `legend`, and next.
   - A key other than `tone`, `label`: `value_not_allowed` subject `legend`.
   - `label`, as a label, subject the tone.
6. `groups`: not a list `value_not_allowed` subject `groups`; over 12 `too_large`, and skip them. Per group, `at` being `groups[i]`:
   - Not an object: `value_not_allowed` subject `at`, and next.
   - `id`, [as below](#ids).
   - Seen before: `id_duplicate`.
   - A key other than `id`, `label`: `value_not_allowed`.
   - `label`, as a label.
7. `nodes`: not a list or empty `nodes_required`; over 40 `too_large` subject `nodes`, and skip them. Per node, `at` being `nodes[i]`:
   - Not an object: `value_not_allowed` subject `at`, and next.
   - `id`, as below. Seen before: `id_duplicate`.
   - A key other than `id`, `label`, `tone`, `shape`, `group`, `start`: `value_not_allowed`.
   - `label`, as a label.
   - `tone` in `neutral todo progress done approve reject review`: else `value_not_allowed`.
   - `shape` in `box pill diamond end`: else `value_not_allowed`.
   - `group`, when present: not a string `value_not_allowed`. When `groups` is a list within its cap and doesn't hold it, `group_unknown`. Otherwise it counts the group as used.
   - `start` a boolean: else `value_not_allowed`.
8. `edges`: not a list `value_not_allowed` subject `edges`; over 80 `too_large`, and skip them. Per edge, `at` being `edges[i]`:
   - Not an object, or `from` or `to` not a string of at most 64 bytes: `value_not_allowed` subject `at`, and next.
   - When `nodes` is a list within its cap and lacks either end: `edge_unknown_node`, once.
   - `from` equals `to`: `edge_self_loop`.
   - That pair seen before: `edge_duplicate`. The reverse is a different pair.
   - A key other than `from`, `to`, `label`, `tone`: `value_not_allowed`.
   - `label` must be a string, and may be empty. When it isn't: as a label's steps 2 and 3.
   - `tone` in `neutral approve reject review fail`: else `value_not_allowed`.
9. When `groups` and `nodes` are lists within their caps, each group no node used, in order: `group_empty`.
10. Only with no findings so far: [canonical JSON](#javascript-semantics-every-implementation-must-match) over 32,768 bytes is `too_large`, subject `chart`.

### Ids

Not a string matching `^[a-z][a-z0-9_-]*$`: `id_invalid`. Over 64 bytes and matching: `too_large`, subject `at`. Every later finding for that item uses the id as subject, or `at` when the id isn't a non-empty string of at most 64 bytes.

## Printer

`printChartSource` takes a chart that passed the check. Lines join with a line feed, with none after the last.

```
type: states                    omitted when flow
direction: down                 omitted when across
caption: …
legend:                         omitted when empty
  approve: …                    one per line, in order
groups:                         omitted when empty
  - { id: …, label: … }
nodes:
  - { id: …, label: …, tone: …, shape: …, group: …, start: true }
edges:                          omitted when empty
  - a -> b: Label [reject]
```

Node keys are always in that order. `tone` is omitted when `neutral`, `shape` when it is the `type`'s default, `group` when absent, `start` when false.

**Scalars.** A value is plain when [plain-safe](#plain-safe), else double-quoted, escaping only `\` and `"`. Tones and shapes are always plain.

**Edges.** With `tone` empty when `neutral`:

| Label | Printed |
|---|---|
| Empty, no tone | `- a -> b` |
| Empty, tone | `- a -> b: [reject]` |
| Plain-safe, no tone | `- a -> b: Label` |
| Plain-safe, tone | `- a -> b: Label [reject]` |
| Not plain-safe | `- { from: a, to: b, label: "…" }`, then `, tone: reject` before the ` }` when there is one. `from` and `to` as scalars |

In the shorthand, ids print as they are, because the whole key is a string to any parser.

### Plain-safe

Conservative on purpose, so a printed fence reads under any YAML parser. A string is plain-safe when all of these hold:

- It isn't empty and equals its trim.
- It holds none of ``: # , [ ] { } & * ! | > ' " % @ ` ? \``.
- It holds none of U+00A0, U+1680, U+2000–U+200A, U+202F, U+205F, U+3000.
- Its first character is none of `- ~ = < . + 0 1 2 3 4 5 6 7 8 9` (ASCII digits only).
- Lower-cased (ASCII), it isn't one of `null true false yes no on off y n`.

`?` is excluded because some YAML parsers end a plain scalar there in flow context.

## Structure

`chartStructure` is, in order: `type`, `direction`, `legend[].tone`, `groups[].id`, `nodes[].{id, tone, shape, group, start}` (`group` null when absent), `edges[].{from, to, tone, labeled}`. `labeled` is whether `label` is not empty.

`chartStructureDiff(base, other)` returns the first difference in that order as `{section, subject}`, or null:

- `type`, `direction`: the subject is the section's name.
- The lists compare position by position, whole entries. At the first differing position the subject is the base's entry, or `other`'s when the base has run out.
- An entry's subject: the tone, the id, or `from -> to`.

`chartText` is the labels, one per line: caption, legend, groups, nodes, then edges with a label.

## JavaScript semantics every implementation must match

- **Trim** and `\s` in the edge pattern are JavaScript's: U+0009–U+000D, U+0020, U+00A0, U+1680, U+2000–U+200A, U+2028, U+2029, U+202F, U+205F, U+3000, U+FEFF. Where a language's `\s` is ASCII, the pattern needs an explicit class.
- **`.*?` in the edge pattern** can't meet a line feed: a label never holds one, since source has one line per value and the check refuses them.
- **Byte counts** are UTF-8.
- **Sorting** the unknown keys is JavaScript's default order, by UTF-16 code units. Outside the BMP that isn't byte order.
- **Stored JSON** keeps the last of a duplicate key, as JSON.parse does. A decoder may read an escaped lone surrogate (`"\ud800"`) as U+FFFD, which then passes, where this package refuses it as a forbidden character.
- **Canonical JSON** is what the 32 KiB cap measures. Keys in this order, with no spaces:
  - The chart: `type, caption, direction, legend, groups, nodes, edges`.
  - `legend`: `tone, label`. `groups`: `id, label`. `edges`: `from, to, label, tone`.
  - `nodes`: `id, label, tone, shape, group, start`, with `group` left out when absent.
  - `suggestion` isn't counted.
  - A string escapes `"`, `\` and the C0 controls only, and a check that reached this step has refused the controls. So nothing else is escaped: not `<`, `>` or `&`, and not U+2028 or U+2029, which the check has also refused. An encoder that escapes HTML by default must have that turned off, or measure directly.

## What only this package sees

`layoutChart` returns `problems` and still draws: `group_overlap` (subject `a b`, each pair once) and `node_in_group` (subject `node group`). They need geometry, so the check doesn't report them and the corpus doesn't hold them.
