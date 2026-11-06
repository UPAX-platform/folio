import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
assert.equal(Object.keys(manifest.dependencies ?? {}).length, 0, 'The package must stay free of runtime dependencies');
assert.equal(Object.keys(manifest.peerDependencies ?? {}).length, 0, 'The package must stay free of peer dependencies');
const [pack] = JSON.parse(execFileSync('npm', ['pack', '--dry-run', '--ignore-scripts', '--json'], { encoding: 'utf8' }));
for (const file of pack.files) {
  assert.match(file.path, /^(dist\/index\.(?:js|cjs|d\.ts|d\.cts)|src\/charts\.css|corpus\/(?:valid|invalid|structure|rendition)\.json|package\.json|README\.md|LICENSE|CHANGELOG\.md|GRAMMAR\.md)$/,
    `Unexpected publish artifact: ${file.path}`);
}
assert.ok(Object.keys(await import(manifest.name)).length, 'Empty ESM export');
assert.ok(Object.keys(require(manifest.name)).length, 'Empty CommonJS export');
console.log(`Package checks passed: ${pack.files.length} public files, ESM/CommonJS imports, artifact allowlist.`);
