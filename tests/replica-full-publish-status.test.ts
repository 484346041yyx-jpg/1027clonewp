import test from 'node:test';
import assert from 'node:assert/strict';
import { matchesPublishedDocument } from '../src/replica-full/body.js';
import { documentHashV2 } from '../src/replica-v2/journal.js';

test('published Elementor status control is accepted only for the exact authorized draft to publish transition', () => {
  const elements = [{ id: 'owned', elType: 'container', settings: {}, elements: [] }];
  const settings = { post_status: 'draft', custom_css: '.owned{color:red}', title: 'Owned test' };
  const hash = documentHashV2(elements as any, settings);
  assert.equal(matchesPublishedDocument(elements, { ...settings, post_status: 'publish' }, hash, 'publish'), true);
  assert.equal(matchesPublishedDocument(elements, { ...settings, post_status: 'publish' }, hash, 'draft'), false);
  assert.equal(matchesPublishedDocument(elements, { ...settings, post_status: 'private' }, hash, 'publish'), false);
  assert.equal(matchesPublishedDocument(elements, { ...settings, post_status: 'publish', title: 'Other' }, hash, 'publish'), false);
  assert.equal(matchesPublishedDocument(elements, { ...settings, post_status: 'publish', custom_css: '' }, hash, 'publish'), false);
  assert.equal(matchesPublishedDocument([], { ...settings, post_status: 'publish' }, hash, 'publish'), false);
  const published = { ...settings, post_status: 'publish' };
  assert.equal(matchesPublishedDocument(elements, published, documentHashV2(elements as any, published), 'publish'), true);
});
