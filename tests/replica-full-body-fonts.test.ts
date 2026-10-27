import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { importFullReplicaBodyAssets, type FullReplicaRemoteServices } from '../src/replica-full/body.js';
import { compileFullPageCSS } from '../src/replica-full/css.js';
import { sourceFontFixture } from './fixtures/source-font.js';

async function fixture() {
  const root = await realpath('D:/cloneWP'), directory = await mkdtemp(path.join(root, '.cache', 'full-body-fonts-'));
  const image = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#ffbb00' } }).png().toBuffer(), font = sourceFontFixture();
  await writeFile(path.join(directory, 'image.png'), image); await writeFile(path.join(directory, 'font.ttf'), font);
  const asset = (key: string, localPath: string, bytes: Buffer, mediaType: string) => ({ key, localPath, sourceUrl: `https://source.example/${localPath}`, sha256: createHash('sha256').update(bytes).digest('hex'), mediaType });
  const manifest = [asset('image', 'image.png', image, 'image/png'), asset('font', 'font.ttf', font, 'font/ttf'), asset('fontalias', 'font.ttf', font, 'font/ttf')];
  const options = { root, runDir: directory, jobDir: directory, runId: 'full-body-fonts-fixture', pageId: 77, manifest, required: ['font', 'image', 'fontalias'] };
  const cleanup = async () => { const actual = await realpath(directory); assert.equal(actual.toLowerCase(), directory.toLowerCase()); assert.ok(actual.toLowerCase().startsWith(root.toLowerCase() + path.sep)); await rm(actual, { recursive: true, force: true }); };
  return { directory, options, cleanup };
}

test('full body media imports images and explicit source fonts serially into one recoverable owned ledger', async () => {
  const fixtureData = await fixture(), calls: string[] = []; let fontPresent = false, loseFontResponse = true;
  const imported = (mimeType: string) => { const asset = fixtureData.options.manifest.find(row => row.mediaType === mimeType)!; return { attachmentId: mimeType === 'font/ttf' ? 43 : 42, url: `https://target.example/wp-content/uploads/${asset.localPath}`, mimeType, sha256: asset.sha256, sourceUrl: asset.sourceUrl }; };
  const client = {
    async verifyImportedAssets(pageId: number, assets: any[]) { assert.equal(pageId, 77); assert.ok(assets.every(asset => [42, 43].includes(asset.attachmentId))); },
    async inspectPendingAsset() { return { status: fontPresent ? 'attachment-present' : 'absent' }; },
    async importAsset(_filename: string, options: any) { assert.equal(options.mimeType, 'image/png'); calls.push('image'); await options.onCheckpoint({ phase: 'complete', remoteWriteStarted: true }); return imported('image/png'); },
    async importSourceFont(_filename: string, options: any) {
      assert.equal(options.mimeType, 'font/ttf'); assert.equal(options.pageId, 77); assert.equal(options.runId, fixtureData.options.runId);
      if (options.requireExisting) { assert.ok(fontPresent); calls.push('font-reconcile'); return imported('font/ttf'); }
      calls.push('font'); await options.onCheckpoint({ phase: 'registering', remoteWriteStarted: true }); fontPresent = true;
      if (loseFontResponse) { loseFontResponse = false; throw Error('Synthetic response loss after source font registration'); }
      return imported('font/ttf');
    },
  } as unknown as FullReplicaRemoteServices['client'];
  try {
    await assert.rejects(importFullReplicaBodyAssets({ ...fixtureData.options, client }), /response loss/);
    const pending = JSON.parse(await readFile(path.join(fixtureData.directory, 'assets', 'ledger.json'), 'utf8'));
    assert.equal(pending.assets.find((row: any) => row.key === 'image').status, 'complete');
    assert.equal(pending.assets.find((row: any) => row.key === 'font').status, 'unknown');
    const assets = await importFullReplicaBodyAssets({ ...fixtureData.options, client });
    assert.deepEqual(calls, ['image', 'font', 'font-reconcile']);
    assert.deepEqual(assets.map(asset => asset.key), ['image', 'font', 'fontalias']);
    assert.deepEqual(assets.map(asset => asset.attachmentId), [42, 43, 43]);
    const ledger = JSON.parse(await readFile(path.join(fixtureData.directory, 'assets', 'ledger.json'), 'utf8'));
    assert.equal(ledger.pageId, 77); assert.equal(ledger.runId, fixtureData.options.runId);
    assert.ok(ledger.assets.every((entry: any) => entry.status === 'complete' && entry.operations.every((operation: any) => operation.status === 'confirmed')));
    await importFullReplicaBodyAssets({ ...fixtureData.options, client }); assert.deepEqual(calls, ['image', 'font', 'font-reconcile']);
    const css = compileFullPageCSS('@font-face{font-family:"Source Fixture";src:url(__ASSET_font__) format("truetype")} :page{font-family:"Source Fixture"}', 77, assets, fixtureData.options.runId);
    assert.ok(css.includes('https://target.example/wp-content/uploads/font.ttf')); assert.ok(css.includes('cw-full-')); assert.ok(!css.includes('__ASSET_'));
  } finally { await fixtureData.cleanup(); }
});

test('full body source font adapter is required before any image or font upload', async () => {
  const fixtureData = await fixture(); let writes = 0;
  const client = { async verifyImportedAssets() {}, async inspectPendingAsset() { return { status: 'absent' }; }, async importAsset() { writes++; throw Error('Must not upload before font adapter validation'); } } as unknown as FullReplicaRemoteServices['client'];
  try { await assert.rejects(importFullReplicaBodyAssets({ ...fixtureData.options, client }), /source_font_adapter_required/); assert.equal(writes, 0); }
  finally { await fixtureData.cleanup(); }
});
