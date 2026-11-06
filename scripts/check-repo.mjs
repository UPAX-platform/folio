import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
for (const file of files) {
  const content = readFileSync(file, 'utf8');
  if (/-----BEGIN (?:[A-Z ]*PRIVATE KEY|CERTIFICATE)-----|\b(?:gh[pousr]_[A-Za-z0-9]{30,}|AKIA[A-Z0-9]{16})\b/.test(content)) {
    throw new Error(`Possible credential in ${file}`);
  }
  if (/(?:\/Users\/|\/home\/|file:\/\/|[.]local\b|[.]internal\b)/.test(content)) {
    throw new Error(`Machine or internal reference in ${file}`);
  }
}
for (const dependency of Object.values(JSON.parse(readFileSync('package-lock.json', 'utf8')).packages)) {
  if (dependency.resolved && !dependency.link) {
    assert.equal(new URL(dependency.resolved).host, 'registry.npmjs.org', 'Lockfile may use only the public npm registry');
  }
}
console.log(`Repo checks passed: ${files.length} files, public registry only.`);
