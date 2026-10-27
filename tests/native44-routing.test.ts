import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveCreationMode } from '../src/core/creation-mode.js';
import { NATIVE44_CATALOG_HASH } from '../src/native44/catalog.js';
import { NATIVE44_TARGET_ENVIRONMENT, type Native44Program } from '../src/native44/types.js';
import { checkNative44Environment } from '../src/native44/environment.js';
import type { PreflightReport } from '../src/wordpress/types.js';
const ref = { path: 'evidence.json', sha256: '1'.repeat(64) };
function program(): Native44Program { return { version: 2, workflow: 'block-replication', executionStrategy: 'native44-css-handoff', taskId: 'routing', title: 'Native44', sourceUrl: 'https://example.com/', componentCatalog: { ...ref, sha256: NATIVE44_CATALOG_HASH }, knowledge: { ...ref, fingerprint: '2'.repeat(64) }, targetEnvironment: NATIVE44_TARGET_ENVIRONMENT, sourceFacts: ref, componentPlan: ref, assetsManifest: ref, viewports: [{ name: 'desktop', width: 1920, height: 1080, stage: 'desktop' }], blocks: [{ key: 'title', kind: 'native', role: 'heading', widgetType: 'heading', widgetSettings: { title: 'Editable' } }] }; }
test('native44 routing never obtains widgets outside the exact set', () => {
  const input = program(); input.blocks = [{ key: 'picture', kind: 'native', widgetType: 'image', widgetSettings: {} }];
  assert.throws(() => resolveCreationMode(input), /44|component|allowed|unknown/i);
});
test('knowledge versions remain provenance while actual platform source contracts are required', () => {
  const preflight = { blockers: [], plugins: [{ plugin: 'elementor/elementor', status: 'active', version: '3.35.4' }, { plugin: 'elementor-pro/elementor-pro', status: 'active', version: '3.35.1' }, { plugin: 'woodmart-core/woodmart-core', status: 'active', version: '1.1.8' }], themes: [{ stylesheet: 'woodmart-child', status: 'active', version: '1.0.0' }] } as unknown as PreflightReport;
  const pending=checkNative44Environment(preflight,{versions:{...NATIVE44_TARGET_ENVIRONMENT,activeTemplate:'woodmart'}});
  assert.equal(pending.matched,false);assert.equal(pending.platformReady,true);assert.match(pending.blockers.join(' '),/contracts have not been observed|source contract/);
  const previous = checkNative44Environment(preflight, { versions: { ...NATIVE44_TARGET_ENVIRONMENT, activeTemplate: 'other' } });
  assert.equal(previous.matched, false); assert.match(previous.blockers.join(' '), /parent theme/);
});
