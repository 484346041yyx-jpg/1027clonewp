import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, realpathSync, lstatSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
test('test-site reset encrypts backups, restores owned files and tables, preserves auth and recovers partial failure', t => {
  const portable = path.join(root, '.cache/php-8.3/php.exe');
  const php = existsSync(portable) ? portable : 'php';
  const extension = existsSync(portable) ? ['-d', `extension_dir=${path.join(root, '.cache/php-8.3/ext')}`, '-d', 'extension=sodium'] : [];
  const probe = spawnSync(php, [...extension, '-r', 'exit(function_exists("sodium_crypto_secretstream_xchacha20poly1305_init_push") ? 0 : 2);'], { cwd: root, encoding: 'utf8' });
  if (probe.error || probe.status !== 0) { t.skip('PHP sodium unavailable; live WordPress/MySQL restore validation remains required.'); return; }
  for (const file of ['clonewp-test-reset.php', 'lib.php', 'request-gate.php', 'setup.php']) {
    const result = spawnSync(php, [...extension, '-l', path.join(root, 'src/test-site-reset/plugin', file)], { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stdout + result.stderr);
  }
  const directory = mkdtempSync(path.join(root, 'tests/fixtures/.test-site-reset-'));
  try {
    const result = spawnSync(php, [...extension, path.join(root, 'tests/fixtures/test-site-reset.php'), root, directory], { cwd: root, encoding: 'utf8', timeout: 60000 });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /PASS encryption/);
  } finally {
    const actual = realpathSync(directory), allowed = path.resolve(root, 'tests/fixtures');
    assert.ok(actual.startsWith(allowed + path.sep) && !lstatSync(directory).isSymbolicLink());
    rmSync(directory, { recursive: true, force: true });
  }
});
