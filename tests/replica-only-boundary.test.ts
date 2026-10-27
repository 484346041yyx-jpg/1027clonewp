import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { access, readFile, readdir, mkdtemp, rm } from 'node:fs/promises';
import sharp from 'sharp';
import { archiveRawInputV2 } from '../src/core/raw-input.js';
import { hashV2 } from '../src/replica-v2/journal.js';
import { assertSafeSVGBytesV2, validateAssetBytesV2 } from '../src/assets/validation.js';
import { resolveCreationMode } from '../src/core/creation-mode.js';
import { parseContextArguments } from '../src/context/cli.js';
import { claudePageScript } from '../src/claude-capture/session.js';

const root = path.resolve(import.meta.dirname, '..');

test('current browser bootstrap retains dynamically loaded geometry and observation resources', async () => {
  const script = await claudePageScript();
  assert.match(script, /claudeCapture/);
  assert.match(script, /measureGeometry|measure.*geometry|geometry/i);
  assert.ok(script.length > 1000);
});

test('only the full-replica writer is exposed and no retained source imports a retired writer', async () => {
  const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts.create, pkg.scripts['create:replica']);
  for (const name of ['create:original', 'create:replica:component', 'reference:brief']) assert.equal(pkg.scripts[name], undefined);
  assert.equal(pkg.dependencies['@openai/codex-sdk'], undefined);
  const walk = async (directory: string): Promise<string[]> => (await Promise.all((await readdir(directory, { withFileTypes: true })).map(row => row.isDirectory() ? walk(path.join(directory, row.name)) : [path.join(directory, row.name)]))).flat();
  for (const filename of (await walk(path.join(root, 'src'))).filter(name => /\.(ts|js)$/.test(name))) {
    const text = await readFile(filename, 'utf8');
    for (const match of text.matchAll(/(?:from\s*|import\s*\()\s*['"]([^'"]+)['"]/g)) {
      assert.doesNotMatch(match[1], /(?:original\/|fidelity\/|reference\/|core\/runner\.js|replica-v2\/runtime\.js|planning\/codex\.js)/, filename);
    }
    // Browser bootstrap arrays are runtime dependencies too; import-only scans
    // miss them. Keep the existing source resource paths executable.
    for (const match of text.matchAll(/['"]((?:\.\.?\/)[^'"\n]+\.(?:js|ts|php|css))['"]/g)) {
      const resource = path.resolve(path.dirname(filename), match[1]);
      if (path.relative(root, resource).startsWith('..')) continue;
      try { await access(resource); }
      catch { await assert.doesNotReject(access(resource.replace(/\.js$/, '.ts')), `${filename}: ${match[1]}`); }
    }
  }
  for (const input of [{ workflow: 'original-design' }, { workflow: 'block-replication', version: 1 }, { workflow: 'block-replication', version: 2 }]) assert.throws(() => resolveCreationMode(input), /Retired/);
  assert.equal(parseContextArguments(['load', '--intent', 'original'], root), undefined);
});

test('extracted media checks still reject executable SVG and declared MIME drift', async () => {
  assert.throws(() => assertSafeSVGBytesV2(Buffer.from('<svg><script>alert(1)</script></svg>')), /executable/);
  assert.throws(() => assertSafeSVGBytesV2(Buffer.from('<svg><image href="https://example.test/a.png"/></svg>')), /external/);
  const bytes = await sharp({ create: { width: 19, height: 13, channels: 3, background: '#123456' } }).png().toBuffer();
  assert.deepEqual(await validateAssetBytesV2(bytes, 'image/png'), { width: 19, height: 13, mimeType: 'image/png' });
  await assert.rejects(validateAssetBytesV2(bytes, 'image/jpeg'), /MIME/);
});

test('extracted archive preserves original input bytes and performs an idempotent second read', async () => {
  const directory = await mkdtemp(path.join(root, '.cache', 'raw-input-regression-'));
  try {
    const bytes = Buffer.from('{\n  "value": 7\n}\n'), options = { runDir: directory, kind: 'program' as const, sha256: hashV2(bytes), bytes, normalize: (value: unknown) => value };
    const first = await archiveRawInputV2(options);
    assert.deepEqual(await readFile(first.path), bytes);
    assert.equal((await archiveRawInputV2(options)).repaired, false);
    await assert.rejects(archiveRawInputV2({ ...options, bytes: Buffer.from('{}') }), /immutable hash/);
    assert.deepEqual(await readFile(first.path), bytes);
  } finally {
    assert.equal(path.dirname(directory), path.join(root, '.cache'));
    await rm(directory, { recursive: true });
  }
});
