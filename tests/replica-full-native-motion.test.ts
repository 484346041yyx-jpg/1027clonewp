import test from 'node:test';
import assert from 'node:assert/strict';
import { patchNativeCarouselMotion, assertNativeMotionBoundary } from '../src/replica-full/native-motion.js';
import type { FullReplicaRemoteSnapshot } from '../src/replica-full/driver.js';
import type { ElementorElement } from '../src/wordpress/types.js';

const elements: ElementorElement[] = [{ id: 'outer', elType: 'container', settings: { css_classes: 'preserved' }, elements: [{ id: 'carousel1', elType: 'widget', widgetType: 'nested-carousel', settings: { speed: 300, loop: 'yes', slides_to_show: 4 }, elements: [{ id: 'slide1', elType: 'container', settings: {}, elements: [{ id: 'text1', elType: 'widget', widgetType: 'heading', settings: { title: 'Unchanged' }, elements: [] }] }] }, { id: 'carousel2', elType: 'widget', widgetType: 'nested-carousel', settings: { speed: 500 }, elements: [] }] }];
function snapshot(): FullReplicaRemoteSnapshot {
  const identity = { headerId: 'header_123', moduleKey: 'alder', owner: { ownerId: 'clonewp', runId: 'alder-run' }, targetOrigin: 'https://target.example' }, hash = 'a'.repeat(64), page = { pageId: 99, postType: 'page', status: 'draft', template: 'elementor_header_footer', runId: 'alder-run', bodyHash: hash, headerId: 'header_123', snapshotHash: hash };
  return { hash, receipts: {}, header: { hash, contract: {} as any, resources: {} as any, snapshot: { defaultHeaderId: 'default', presetReferences: [], otherReferences: [], globalHash: hash, module: { identity, name: 'Alder', header: {} as any, style: { id: 1, css: 'original' }, menus: {}, pages: { 99: page }, receipts: {} } } }, page: { pageId: 99, runId: 'alder-run', status: 'draft', template: 'elementor_header_footer', title: 'Alder', slug: 'alder', headerId: 'header_123', elements: structuredClone(elements), settings: { custom_css: 'unchanged' }, bodyHash: hash, built: true, flags: { footer: '1' }, publicUrl: 'https://target.example/alder/' } };
}

test('native motion patch changes only nested-carousel speed to numeric zero, including nested items', () => {
  const original = structuredClone(elements), patch = patchNativeCarouselMotion(elements); assert.deepEqual(patch.widgetIds, ['carousel1', 'carousel2']); assert.deepEqual(elements, original);
  const expected = structuredClone(elements); expected[0].elements[0].settings.speed = 0; expected[0].elements[1].settings.speed = 0; assert.deepEqual(patch.elements, expected);
  assert.deepEqual(patchNativeCarouselMotion(patch.elements), patch); assert.throws(() => patchNativeCarouselMotion([]), /widget_missing/);
});

test('motion boundary refuses any settings, CSS, unrelated element or protected native change', () => {
  const before = snapshot(), patch = patchNativeCarouselMotion(before.page!.elements), after = structuredClone(before); after.page!.elements = patch.elements; after.page!.bodyHash = 'b'.repeat(64); after.header.snapshot.module!.pages['99'].bodyHash = after.page!.bodyHash; after.header.snapshot.module!.pages['99'].snapshotHash = 'c'.repeat(64); assertNativeMotionBoundary(before, after, patch);
  for (const modify of [(value: FullReplicaRemoteSnapshot) => { value.page!.settings.custom_css = 'changed'; }, (value: FullReplicaRemoteSnapshot) => { value.page!.elements[0].settings.css_classes = 'changed'; }, (value: FullReplicaRemoteSnapshot) => { value.header.snapshot.globalHash = 'd'.repeat(64); }, (value: FullReplicaRemoteSnapshot) => { value.header.snapshot.module!.style!.css = 'changed'; }, (value: FullReplicaRemoteSnapshot) => { value.header.snapshot.module!.pages['99'].headerId = null; }]) {
    const changed = structuredClone(after); modify(changed); assert.throws(() => assertNativeMotionBoundary(before, changed, patch), /boundary_changed/);
  }
});
