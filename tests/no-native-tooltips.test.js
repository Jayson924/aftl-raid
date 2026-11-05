import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Hover text goes through data-tooltip-fixed or has-chip-tip, never the browser's title tooltip.
const NATIVE_TOOLTIP = [/(^|[\s"'`])title="/, /setAttribute\(\s*['"]title['"]/, /\b(?!build\b)\w+\.title\s*=(?!=)/];

const sourceFiles = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const path = join(dir, entry.name);
  if (entry.isDirectory()) return sourceFiles(path);
  return /\.(jsx?|html)$/.test(entry.name) ? [path] : [];
});

test('no element uses the native title tooltip', () => {
  const hits = [...sourceFiles('src'), 'index.html'].flatMap((file) => readFileSync(file, 'utf8').split(/\r?\n/)
    .map((line, i) => ({ line, at: `${file}:${i + 1}` }))
    .filter(({ line }) => NATIVE_TOOLTIP.some((re) => re.test(line))));
  assert.deepEqual(hits.map((h) => `${h.at}  ${h.line.trim().slice(0, 120)}`), []);
});
