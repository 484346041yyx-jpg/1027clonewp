import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const bundledPhp = join(root, '.cache', 'php-8.3', 'php.exe');

test('reused footer guard follows configured HTML blocks, widgets and menus without unrelated changes', { skip: !existsSync(bundledPhp) }, () => {
  const output = execFileSync(bundledPhp, [join(root, 'tests', 'fixtures', 'reused-footer-hash.php')], { cwd: root, encoding: 'utf8', timeout: 10_000 });
  assert.equal(output.trim(), 'footer hash guard passed');
});
