import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const consumer = mkdtempSync(join(tmpdir(), 'folio-charts-consumer-'));
try {
  const [archive] = JSON.parse(execFileSync('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', consumer], { cwd: root, encoding: 'utf8' }));
  writeFileSync(join(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
  execFileSync('npm', ['install', '--offline', '--ignore-scripts', '--no-audit', join(consumer, archive.filename)], { cwd: consumer, stdio: 'pipe' });
  writeFileSync(join(consumer, 'smoke.mjs'), `
    import assert from 'node:assert/strict';
    import { existsSync, readFileSync } from 'node:fs';
    import { createRequire } from 'node:module';
    import { chartHtml, parseChartSource, printChartSource, renderCharts } from '@upax-ai/folio-charts';
    const require = createRequire(import.meta.url);
    const parsed = parseChartSource('caption: Review\\nnodes:\\n  - { id: a, label: A, start: true }\\n  - { id: b, label: B }\\nedges:\\n  - a -> b: Next [approve]');
    assert.equal(parsed.ok, true);
    assert.match(chartHtml(parsed.chart), /<svg/);
    assert.equal(parseChartSource(printChartSource(parsed.chart)).ok, true);
    assert.match(renderCharts('<figure data-chart="0"><figcaption>Review</figcaption></figure>', { type: 'doc', content: [{ type: 'chart', attrs: parsed.chart }] }), /<svg/);
    assert.equal(typeof require('@upax-ai/folio-charts').parseChartSource, 'function');
    assert.ok(existsSync(require.resolve('@upax-ai/folio-charts/charts.css')));
    assert.ok(JSON.parse(readFileSync(require.resolve('@upax-ai/folio-charts/corpus/valid.json'), 'utf8')).length > 0);
  `);
  execFileSync(process.execPath, ['smoke.mjs'], { cwd: consumer, stdio: 'pipe' });
  console.log('Packed consumer: parses, draws and resolves its stylesheet and corpus, as ESM and CommonJS.');

  const source = `
    import { chartHtml, checkChart, parseChartSource, type Chart, type ChartProblem } from '@upax-ai/folio-charts';
    const parsed = parseChartSource('nodes: []');
    const problems: ChartProblem[] = parsed.ok ? checkChart(parsed.chart) : parsed.problems;
    export function draw(chart: Chart): string { return problems.length ? '' : chartHtml(chart, { rtl: true }); }
  `;
  for (const extension of ['mts', 'cts']) writeFileSync(join(consumer, `consumer.${extension}`), source);
  execFileSync(process.execPath, [fileURLToPath(new URL('../../../node_modules/typescript/bin/tsc', import.meta.url)),
    '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--target', 'ES2022', '--strict', '--noEmit',
    'consumer.mts', 'consumer.cts'], { cwd: consumer, stdio: 'pipe' });
  console.log('Packed consumer: types check under strict NodeNext ESM and CommonJS.');
} catch (error) {
  if (error.stdout) process.stderr.write(error.stdout);
  if (error.stderr) process.stderr.write(error.stderr);
  throw error;
} finally {
  rmSync(consumer, { recursive: true, force: true });
}
