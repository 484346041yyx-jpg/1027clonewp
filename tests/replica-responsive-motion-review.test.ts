import test from 'node:test';
import assert from 'node:assert/strict';
import { compareCarouselMotion, sampleCarouselMotionFrame, verifyPhoneMotionSource } from '../src/replica-responsive/motion-review.js';
import type { Native44Program } from '../src/native44/types.js';
import type { ResponsivePlan } from '../src/replica-responsive/contract.js';

test('phone carousel motion compares slide step, card width and spacing across states', () => {
  const before = { viewportWidth: 375, activeIndex: 0, items: [{ index: 0, x: 0, width: 225 }, { index: 1, x: 245, width: 225 }] };
  const after = { viewportWidth: 375, activeIndex: 1, items: [{ index: 0, x: -245, width: 225 }, { index: 1, x: 0, width: 225 }] };
  assert.deepEqual(compareCarouselMotion(before, after, before, after), []);
  assert.ok(compareCarouselMotion(before, after, before, { ...after, activeIndex: 2 }).includes('slide step'));
  assert.ok(compareCarouselMotion(before, after, before, { ...after, items: [{ index: 0, x: -416, width: 225 }, { index: 1, x: -171, width: 225 }] }).includes('after item 1 geometry'));
  assert.ok(compareCarouselMotion(before, after, { ...before, items: [{ index: 0, x: 0, width: 225 }, { index: 1, x: 225, width: 225 }] }, after).includes('before item 1 geometry'));
});

test('motion sampler records browser card positions relative to its viewport', () => {
  const element = (x: number, width: number) => ({ getBoundingClientRect: () => ({ x, width }) }) as unknown as Element;
  assert.deepEqual(sampleCarouselMotionFrame(element(24, 327), [{ index: 0, element: element(24, 225) }, { index: 1, element: element(269, 225) }], 0),
    { viewportWidth: 327, activeIndex: 0, items: [{ index: 0, x: 0, width: 225 }, { index: 1, x: 245, width: 225 }] });
});

test('v4 carousel source evidence fails before remote work when a native carousel lacks motion captures', async () => {
  const program = { blocks: [{ key: 'categories', kind: 'composite', children: [{ key: 'style-carousel', kind: 'native-carousel', widgetType: 'nested-carousel', widgetSettings: {} }] }] } as unknown as Native44Program;
  const plan = { sections: [{ key: 'categories', mode: 'shared' }], viewports: [{ width: 390, height: 844 }, { width: 430, height: 932 }] } as ResponsivePlan;
  await assert.rejects(verifyPhoneMotionSource({ taskId: 'task', sourceUrl: 'https://source.example/', plan, program, packets: [], read: async () => { throw Error('unexpected read'); } }), /source_missing/);
});
