import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { resolveNativeImageResolution, sourceImageFamily } from '../src/replica-full/image-resolution.js';
import type { Native44Program } from '../src/native44/types.js';
import type { SourceFactsV2 } from '../src/replica-v2/source.js';
import type { Native44Asset } from '../src/native44/media.js';

const source = 'https://source.example/uploads/Gifts-under-200-Option-1';
const makeAsset = async (key: string, suffix: string, width: number, height: number) => {
  const bytes = await sharp({ create: { width, height, channels: 3, background: '#a51234' } }).webp().toBuffer();
  return { asset: { key, sourceUrl: `${source}${suffix}.webp`, localPath: `${key}.webp`, mediaType: 'image/webp', sha256: createHash('sha256').update(bytes).digest('hex') } as Native44Asset, bytes };
};
const program = (key: string) => ({ taskId: 'test-image', replicationProfile: 'desktop-browser-v1', blocks: [{ key: 'card', kind: 'composite', settings: {}, sourceFactIds: ['desktop:media:card'], children: [{ key: 'card_image', kind: 'native', widgetType: 'wd_image_or_svg', sourceFactIds: ['desktop:media:card'], widgetSettings: { image: { $asset: key }, image_size: 'full' } }] }] }) as unknown as Native44Program;
const facts = { facts: { 'desktop:media:card': { kind: 'media', value: { resource: { url: `${source}-150x150.webp` }, layout: { rect: { width: 397, height: 397 } } } } } } as unknown as SourceFactsV2;

test('new preparation promotes only the same photo family when a displayed image is undersized', async () => {
  const low = await makeAsset('low', '-150x150', 150, 150), high = await makeAsset('high', '-768x768', 768, 768), other = await makeAsset('other', '-2-1000x1000', 1000, 1000);
  const bytes = new Map([[low.asset.key, low.bytes], [high.asset.key, high.bytes], [other.asset.key, other.bytes]]);
  const original = program('low');
  const result = await resolveNativeImageResolution({ program: original, sourceFacts: facts, assets: [low.asset, high.asset, other.asset], readAsset: async asset => bytes.get(asset.key)! });
  assert.equal(result.replacements.length, 1);
  assert.equal(result.replacements[0].beforeAssetKey, 'low');
  assert.equal(result.replacements[0].afterAssetKey, 'high');
  assert.ok(result.replacements[0].beforeDensity < 0.4 && result.replacements[0].afterDensity > 1.9);
  assert.equal((result.program.blocks[0] as any).children[0].widgetSettings.image.$asset, 'high');
  assert.equal((original.blocks[0] as any).children[0].widgetSettings.image.$asset, 'low');
  assert.deepEqual(result.directImageSlots, []);
});

test('cropped native image uses the full imported URL when WordPress width-based srcset would pick an undersized variant', async () => {
  const low = await makeAsset('low', '-150x150', 150, 150), wide = await makeAsset('wide', '-768x432', 768, 432);
  const bytes = new Map([[low.asset.key, low.bytes], [wide.asset.key, wide.bytes]]);
  const result = await resolveNativeImageResolution({ program: program('low'), sourceFacts: facts, assets: [low.asset, wide.asset], readAsset: async asset => bytes.get(asset.key)! });
  assert.equal(result.replacements[0].afterAssetKey, 'wide');
  assert.deepEqual(result.directImageSlots, [{ componentKey: 'card_image', assetKey: 'wide' }]);
});

test('missing adequate source blocks a blurry new page before authentication', async () => {
  const low = await makeAsset('low', '-150x150', 150, 150);
  await assert.rejects(resolveNativeImageResolution({ program: program('low'), sourceFacts: facts, assets: [low.asset], readAsset: async () => low.bytes }), /image_resolution_no_adequate_source:card_image:image:397x397/);
  assert.equal(sourceImageFamily(`${source}-150x150.webp`), `${source}.webp`);
  assert.equal(sourceImageFamily(`${source}-2-1000x1000.webp`), `${source}-2.webp`);
});

test('an original background asset may retain the source site’s own enlargement', async () => {
  const original = await makeAsset('original', '', 1920, 600);
  const backgroundFacts = { facts: { 'desktop:media:card': { kind: 'media', value: { kind: 'background', resource: { url: original.asset.sourceUrl }, layout: { rect: { width: 1920, height: 764 } } } } } } as unknown as SourceFactsV2;
  const result = await resolveNativeImageResolution({ program: program('original'), sourceFacts: backgroundFacts, assets: [original.asset], readAsset: async () => original.bytes });
  assert.deepEqual(result.replacements, []);
});
