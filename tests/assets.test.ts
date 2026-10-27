import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { downloadAssets } from '../src/assets/index.js';
import { startMarketingFixture } from './fixtures/marketing.js';

const asset = (url: string) => ({ url, kind: 'image' as const, sourceNodeIds: ['src-image'], viewports: ['desktop'], objectFit: 'cover', objectPosition: '60% 50%' });

test('assets use actual bytes, image dimensions, hashes, deduplication, redirects, and crop metadata', async () => {
  const fixture = await startMarketingFixture();
  const dir = await mkdtemp(path.join(os.tmpdir(), 'clonewp-assets-'));
  try {
    const result = await downloadAssets({ assets: [asset(`${fixture.url}/image.png`), asset(`${fixture.url}/duplicate.png`), asset(`${fixture.url}/redirect`)], runDir: dir, allowLocalForTests: true });
    assert.equal(result.downloaded, 1);
    assert.equal(result.failed, 0);
    assert.equal(result.entries[1].status, 'duplicate');
    const entry = result.entries[0];
    assert.equal(entry.mime, 'image/png'); assert.equal(entry.width, 1200); assert.equal(entry.height, 600);
    assert.equal(entry.objectPosition, '60% 50%');
    assert.equal(entry.sha256, createHash('sha256').update(fixture.image).digest('hex'));
    assert.deepEqual(await readFile(entry.path!), fixture.image);
    assert.equal(result.totalBytes, fixture.image.length);
    assert.equal(JSON.parse(await readFile(result.artifactPath, 'utf8')).entries.length, 3);
  } finally { await fixture.close(); await rm(dir, { recursive: true, force: true }); }
});

test('assets diagnose invalid bytes, unsafe SVG, oversized resources, and private redirects', async () => {
  const fixture = await startMarketingFixture();
  const dir = await mkdtemp(path.join(os.tmpdir(), 'clonewp-assets-fail-'));
  try {
    const result = await downloadAssets({ assets: ['/broken.png', '/unsafe.svg', '/oversize', '/redirect-private'].map(resource => asset(`${fixture.url}${resource}`)), runDir: dir, allowLocalForTests: true, maxBytes: 1_000_000 });
    assert.equal(result.failed, 4);
    assert.equal(result.downloaded, 0);
    assert.match(result.entries[1].error!, /unsafe/);
    assert.match(result.entries[2].error!, /exceeds/);
    assert.match(result.entries[3].error!, /private/);
    const guarded = await downloadAssets({ assets: [asset(`${fixture.url}/image.png`)], runDir: path.join(dir, 'guarded') });
    assert.equal(guarded.failed, 1);
    assert.match(guarded.entries[0].error!, /private/);
  } finally { await fixture.close(); await rm(dir, { recursive: true, force: true }); }
});

test('safe inline/vector assets become verified WordPress-compatible raster files', async () => {
  const fixture = await startMarketingFixture();
  const dir = await mkdtemp(path.join(os.tmpdir(), 'clonewp-vector-assets-'));
  try {
    const inline = `data:image/png;base64,${fixture.image.toString('base64')}`;
    const result = await downloadAssets({ assets: [asset(`${fixture.url}/safe.svg`), asset(inline)], runDir: dir, allowLocalForTests: true });
    assert.equal(result.failed, 0);
    assert.equal(result.entries[0].mime, 'image/png');
    assert.match(result.entries[0].converted!, /svg rasterized/);
    assert.equal(result.entries[0].width, 100);
    assert.equal(result.entries[1].sha256, createHash('sha256').update(fixture.image).digest('hex'));
  } finally { await fixture.close(); await rm(dir, { recursive: true, force: true }); }
});
