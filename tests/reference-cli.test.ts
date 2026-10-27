import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

test('reference CLI accepts exactly one HTTP(S) URL and rejects unsafe inputs before business profile or target authentication', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'clonewp-reference-cli-'));
  const root = path.resolve(import.meta.dirname, '..');
  const loader = pathToFileURL(path.join(root, 'node_modules/tsx/dist/loader.mjs')).href;
  const invoke = (args: string[]) => new Promise<{ code: number; stdout: string; stderr: string }>(resolve => {
    execFile(process.execPath, ['--import', loader, path.join(root, 'src/reference-cli.ts'), ...args], {
      cwd: directory, timeout: 20_000,
      env: { SystemRoot: process.env.SystemRoot, TEMP: os.tmpdir(), TMP: os.tmpdir() },
    }, (error, stdout, stderr) => resolve({ code: error ? Number((error as NodeJS.ErrnoException & { code?: unknown }).code) : 0, stdout, stderr }));
  });
  try {
    for (const args of [[], ['https://example.com/', '--publish'], ['https://example.com/', 'other.json'], ['https://example.com/', 'https://other.example/'], ['https://example.com/', '--observed', 'relative/path'], ['file:///private'], ['original/design.json']]) {
      const result = await invoke(args);
      assert.equal(result.code, 2); assert.match(result.stderr, /Usage: npm run reference -- <REFERENCE_URL>/); assert.equal(result.stdout, '');
      assert.doesNotMatch(result.stderr, /credentials|project\.json|business-profile|ENOENT/);
    }
    for (const input of ['http://127.0.0.1/', 'http://169.254.169.254/', 'http://0x7f000001/', 'http://[::1]/', 'https://user:password@8.8.8.8/']) {
      const result = await invoke([input]);
      assert.equal(result.code, 1); assert.match(result.stderr, /forbidden|private|reserved|internal/i); assert.equal(result.stdout, '');
      assert.doesNotMatch(result.stderr, /credentials|project\.json|business-profile|ENOENT/);
    }
    const observed = await invoke(['https://8.8.8.8/', '--observed', path.join(directory, 'missing-observation')]);
    assert.equal(observed.code, 1); assert.doesNotMatch(observed.stderr, /Usage:|credentials|business-profile/); assert.equal(observed.stdout, '');
    assert.deepEqual(await readdir(directory), []);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
