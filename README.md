# Folio

Public packages, starter sites and example bundles for
[Folio](https://upax.ai), the documents and sites product in UPAX.

| Path | What it holds |
|---|---|
| [`packages/folio-charts`](packages/folio-charts) | `@upax-ai/folio-charts`: the chart grammar, checks and SVG renderer |

## Development

Node.js 22 or newer.

```sh
npm ci
npm run check   # repo scan, then typecheck, tests, build and package checks for every package
```

## Releasing

Each package versions on its own. Tag a release as `<package directory>-vX.Y.Z`,
for example `folio-charts-v0.1.0`, push the tag, and run the **Publish** workflow
with that tag. The release waits in npm's stage queue until a maintainer approves it.

## License

[MIT](LICENSE)
