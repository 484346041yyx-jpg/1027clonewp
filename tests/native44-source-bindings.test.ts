import test from 'node:test';
import assert from 'node:assert/strict';
import { assertNative44SourceBindings } from '../src/native44/source-bindings.js';
import type { Native44Program } from '../src/native44/types.js';
import type { ComponentPlanV2 } from '../src/replica-v2/component-plan.js';
const program = { blocks: [{ key: 'dog-card', kind: 'native', widgetType: 'heading', widgetSettings: { title: 'Dog' } }, { key: 'cat-card', kind: 'native', widgetType: 'heading', widgetSettings: { title: '<strong>Cat</strong>' } }] } as unknown as Native44Program;
const plan = { requirements: [{ id: 'cat-title', componentId: 'cat-card', disposition: 'preserve', verification: { kind: 'text', expected: 'Cat' } }] } as unknown as ComponentPlanV2;
test('card text binds to its own native content, regardless of global text order', () => { assert.doesNotThrow(() => assertNative44SourceBindings(program, plan)); const wrong = structuredClone(plan); wrong.requirements[0].componentId = 'dog-card'; assert.throws(() => assertNative44SourceBindings(program, wrong), /owner/); });
test('an external entrance cannot be assigned to a different card with only the same caption', () => { const linked = structuredClone(program); (linked.blocks[0] as any).widgetSettings.link = { url: 'https://example.com/dog' }; const external = { requirements: [{ id: 'dog-link', componentId: 'cat-card', disposition: 'external', verification: { kind: 'external', expected: 'https://example.com/dog' } }] } as unknown as ComponentPlanV2; assert.throws(() => assertNative44SourceBindings(linked, external), /owner/); });
