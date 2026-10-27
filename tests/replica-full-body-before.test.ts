import test from 'node:test';
import assert from 'node:assert/strict';
import { matchesNativeBodyBefore } from '../src/replica-full/body.js';
import { documentHashV2 } from '../src/replica-v2/journal.js';
import type { DraftSnapshot } from '../src/wordpress/types.js';

test('body comparison accepts only the exact empty featured-image false/zero sentinel without altering native attestation', () => {
  const settings = { template: 'elementor_header_footer', post_featured_image: { url: '', id: false, size: '' }, menu_order: 0 }, expected: DraftSnapshot = { pageId: 9, runId: 'owned-run', title: 'Owned', status: 'draft', elements: [], settings, hash: documentHashV2([], settings) }, original = structuredClone(expected);
  assert.equal(matchesNativeBodyBefore([], { ...settings, post_featured_image: { url: '', id: 0, size: '' } }, expected), true); assert.deepEqual(expected, original);
  for (const image of [{ url: '', id: '', size: '' }, { url: '', id: null, size: '' }, { url: '', id: 1, size: '' }, { url: 'https://site.test/image.jpg', id: 0, size: '' }, { url: '', id: 0, size: 'thumbnail' }, { url: '', id: 0, size: '', extra: '' }]) assert.equal(matchesNativeBodyBefore([], { ...settings, post_featured_image: image }, expected), false);
  assert.equal(matchesNativeBodyBefore([], { ...settings, menu_order: 1, post_featured_image: { url: '', id: 0, size: '' } }, expected), false);
  assert.equal(matchesNativeBodyBefore([{ id: 'new', elType: 'container', settings: {}, elements: [] }], { ...settings, post_featured_image: { url: '', id: 0, size: '' } }, expected), false);
  assert.equal(matchesNativeBodyBefore([], settings, { ...expected, hash: 'a'.repeat(64) }), false);
});
