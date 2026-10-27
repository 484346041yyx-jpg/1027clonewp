import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { native44Id, native44ModuleClass } from '../src/native44/adapters.js';
import type { Native44Program } from '../src/native44/types.js';
import { assertNativeImageCSS, defaultNativeImagePolicy, nativeImageSlots, verifyNativeImageChecks, type NativeImageCheck } from '../src/replica-full/native-image-policy.js';

const policy = defaultNativeImagePolicy();
// This unit fixture exercises media/CSS traversal only; task/knowledge validation is covered at preparation boundaries.
const program = { taskId: 'photos', replicationProfile: 'desktop-browser-v1', blocks: [{ key: 'hero', kind: 'composite', settings: { background_background: 'classic', background_image: { $asset: 'hero_photo' } }, children: [{ kind: 'native', key: 'hero_photo', widgetType: 'image', widgetSettings: { image: { $asset: 'portrait' } } }] }] } as unknown as Native44Program;
const root = `:page .${native44ModuleClass('hero')}`;

test('new native media policy rejects CSS photos, custom-property bypass and native image masking, while preserving decorative gradients and descendant colors', () => {
  for (const css of [`${root}{background-image:url('__ASSET_hero_photo__')}`, `${root}::before{background:url(https://target.example/photo.jpg)}`, `${root}::after{content:url(https://target.example/photo.jpg)}`, `${root}{--photo:url(photo.jpg);background-image:var(--photo)}`, `${root}{background-image:image-set('photo.jpg' 1x)}`, `${root}{background:none}`, `${root}{background-image:linear-gradient(red,blue)}`]) {
    assert.throws(() => assertNativeImageCSS(policy, program, css), /native_image_css_/);
  }
  assertNativeImageCSS(policy, program, `${root}{background-color:#fff;background-size:cover}${root}::before{background-image:linear-gradient(red,transparent)}${root} .card{background:white}`);
  assertNativeImageCSS(undefined, program, `${root}{background-image:url(old-frozen-photo.jpg)}`);
  const custom = structuredClone(program); custom.blocks[0].settings!.custom_css = `${root}{background-image:url(hidden.jpg)}`;
  assert.throws(() => assertNativeImageCSS(policy, custom, ''), /css_photo_requires_native_control/);
});

test('CSS photo exceptions bind exact owned components and only describe an unsupported native control', () => {
  const exception = { version: 1 as const, mode: 'native-first' as const, cssExceptions: [{ componentKey: 'hero', reason: 'native-control-unavailable' as const, summary: 'The installed native control cannot express this unsupported layer.', evidence: [{ path: 'control-contract.json', sha256: 'a'.repeat(64) }] }] };
  assertNativeImageCSS(exception, program, `${root}::before{background-image:url(photo.jpg)}`);
  assert.throws(() => assertNativeImageCSS(exception, program, ':page .unowned{background-image:url(photo.jpg)}'), /css_photo_requires_native_control/);
  assert.throws(() => assertNativeImageCSS({ ...exception, cssExceptions: [{ ...exception.cssExceptions[0], componentKey: 'unowned' }] }, program, ''), /exception_scope/);
  assert.throws(() => assertNativeImageCSS({ ...exception, cssExceptions: [{ ...exception.cssExceptions[0], reason: 'faster' }] } as any, program, ''), /Invalid/);
});

test('native media inventory binds image and container controls to actual compiler IDs without editing the legacy compiler', () => {
  assert.deepEqual(nativeImageSlots(program), [
    { componentKey: 'hero', elementId: native44Id('photos', 'hero'), settingPath: 'background_image', assetKey: 'hero_photo' },
    { componentKey: 'hero_photo', elementId: native44Id('photos', 'hero_photo'), settingPath: 'image', assetKey: 'portrait' },
  ]);
});

test('image acceptance needs a current native panel image, a different rendered media and restoration bound to actual saved controls', async () => {
  const files = new Map<string, Buffer>(), screenshotBytes = await sharp({ create: { width: 600, height: 300, channels: 3, background: '#123456' } }).png().toBuffer();
  const put = (name: string, value: unknown) => { const bytes = Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value)); files.set(name, bytes); return { path: name, sha256: createHash('sha256').update(bytes).digest('hex') }; };
  const screenshot = put('panel.png', screenshotBytes), fingerprint = 'a'.repeat(64), now = Date.now(), slots = nativeImageSlots(program), checks: NativeImageCheck[] = [];
  const currentElements = slots.map((slot, i) => ({ id: slot.elementId, settings: { [slot.settingPath]: { id: 10 + i, url: `https://target.example/${i}-original.jpg` } }, elements: [] }));
  for (const [i, slot] of slots.entries()) {
    const observe = (stage: string, replacement: boolean, offset: number) => put(`${i}-${stage}.json`, { version: 1, kind: 'clonewp-native-image-observation', pageId: 9, fingerprint, elementId: slot.elementId, settingPath: slot.settingPath, observedAt: new Date(now + offset).toISOString(), panelMedia: { id: replacement ? 50 + i : 10 + i, url: `https://target.example/${i}-${replacement ? 'replacement' : 'original'}.jpg` }, renderedImageUrl: `https://target.example/${i}-${replacement ? 'replacement' : 'original'}-1024x500.jpg`, screenshot });
    checks.push({ componentKey: slot.componentKey, elementId: slot.elementId, settingPath: slot.settingPath, before: observe('before', false, -3000), replacement: observe('replacement', true, -2000), restored: observe('restored', false, -1000) });
  }
  const input = { policy, program, checks, currentElements, pageId: 9, fingerprint, observedAt: new Date(now).toISOString(), targetOrigin: 'https://target.example', base: '.', read: async (ref: { path: string; sha256: string }) => { const bytes = files.get(ref.path)!; assert.equal(createHash('sha256').update(bytes).digest('hex'), ref.sha256); return { filename: ref.path, bytes }; } };
  await verifyNativeImageChecks(input);
  await assert.rejects(verifyNativeImageChecks({ ...input, checks: checks.slice(1) }), /checks_incomplete/);
  await assert.rejects(verifyNativeImageChecks({ ...input, currentElements: [] }), /current_control_missing/);
  await assert.rejects(verifyNativeImageChecks({ ...input, checks: checks.map(row => ({ ...row, restored: row.replacement })) }), /swap_or_restore_missing/);
  await assert.rejects(verifyNativeImageChecks({ ...input, fingerprint: 'b'.repeat(64) }), /observation_identity/);
  const repeated = structuredClone(program);
  if (repeated.blocks[0].kind !== 'composite') throw Error('fixture');
  repeated.blocks[0].children.push({ kind: 'native', key: 'hero_second_photo', widgetType: 'image', widgetSettings: { image: { $asset: 'another_portrait' } } });
  const repeatedSlot = nativeImageSlots(repeated).at(-1)!;
  const thirdSaved = { id: repeatedSlot.elementId, settings: { image: { id: 80, url: 'https://target.example/another.jpg', size: 'full' } }, elements: [] };
  // Two image widgets share one control implementation: preserve all slots, swap only the existing representative.
  await verifyNativeImageChecks({ ...input, program: repeated, currentElements: [...currentElements, thirdSaved] });
  await assert.rejects(verifyNativeImageChecks({ ...input, program: repeated }), /current_control_missing/);
  const directPolicy = { ...policy, directImageSlots: [{ componentKey: 'hero_photo', assetKey: 'portrait' }] };
  const directElements = structuredClone(currentElements); directElements[1].settings.image.id = 0;
  const directCheck = { ...checks[1] };
  for (const stage of ['before', 'restored'] as const) directCheck[stage] = put(`direct-${stage}.json`, { version: 1, kind: 'clonewp-native-image-observation', pageId: 9, fingerprint, elementId: slots[1].elementId, settingPath: 'image', observedAt: new Date(now + (stage === 'before' ? -3000 : -1000)).toISOString(), panelMedia: { id: 0, url: 'https://target.example/1-original.jpg' }, renderedImageUrl: 'https://target.example/1-original.jpg', screenshot });
  await verifyNativeImageChecks({ ...input, policy: directPolicy, currentElements: directElements, checks: [checks[0], directCheck] });
  await assert.rejects(verifyNativeImageChecks({ ...input, currentElements: directElements }), /current_control_missing/);
  const frozen = { ...input, policy: undefined, checks: undefined, currentElements: undefined }; await verifyNativeImageChecks(frozen);
});
