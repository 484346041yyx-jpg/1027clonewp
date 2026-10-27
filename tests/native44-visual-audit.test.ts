import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeNative44Captures, fingerprintNative44Snapshot, validateNative44CompareManifest, type Native44Capture, type Native44CompareManifest } from '../src/native44/compare.js';
import { compareNative44VisualModules, opaqueSolidBackground, visiblePaint } from '../src/native44/visual-audit.js';
import type { Native44VisualModule } from '../src/native44/contracts.js';

const hash = 'a'.repeat(64);
const link = (background = 'rgba(0, 0, 0, 0)', width = 140, borderBottomWidth = '0px', afterContent = '""') => ({ width, height: 26, background, color: 'rgb(18, 18, 18)', borderBottomWidth, beforeContent: 'none', afterContent });
const source: Native44VisualModule = { solidBackground: 'rgb(255, 255, 255)', progress: [{ x: 758, width: 388, height: 2, background: 'rgb(230, 230, 230)', fillFraction: .43 }], arrows: [{ side: 'prev', x: 35, width: 44, height: 44, background: 'rgb(255, 255, 255)', color: 'rgb(18, 18, 18)', borderRadius: '50%', iconWidth: 18, iconHeight: 18 }], mediaGeometry: [{ x: 102, y: 30, width: 48, height: 48 }], texts: [
  { text: 'Why Shop Wigs.com?', color: 'rgb(18, 18, 18)', fontSize: '37.5px', lineHeight: '46.8px', x: 760 },
  { text: 'Shop with Confidence', color: 'rgb(18, 18, 18)', fontSize: '15.3px', lineHeight: '26.2px', control: link('rgba(0, 0, 0, 0)', 154) },
  { text: 'Shop All Envy', color: 'rgb(18, 18, 18)', fontSize: '11.9px', lineHeight: '22px', control: link() },
] };
const target: Native44VisualModule = { solidBackground: 'rgb(250, 248, 245)', progress: [{ x: 176, width: 1552, height: 3, background: 'rgb(231, 231, 231)', fillFraction: .2 }], arrows: [{ side: 'prev', x: 0, width: 44, height: 44, background: 'rgb(255, 255, 255)', color: 'rgb(18, 18, 18)', borderRadius: '50%', iconWidth: 6, iconHeight: 6 }], mediaGeometry: [{ x: 0, y: 30, width: 48, height: 48 }], texts: [
  { text: 'Why Shop Wigs.com?', color: 'rgb(36, 36, 36)', fontSize: '44px', lineHeight: '48.4px', x: 195 },
  { text: 'Shop with Confidence', color: 'rgb(255, 255, 255)', fontSize: '13px', lineHeight: '15.6px', control: link('rgb(97, 206, 112)', 230) },
  { text: 'Shop All Envy', color: 'rgb(17, 17, 17)', fontSize: '12px', lineHeight: '16.8px', control: link('rgba(0, 0, 0, 0)', 114, '1px', 'none') },
] };

test('generic visual audit catches effective paint, type and different control treatments', () => {
  const rows = compareNative44VisualModules(source, target);
  assert.ok(rows.some(row => /effective section background/.test(row.detail)));
  assert.ok(rows.some(row => /carousel progress/.test(row.detail) && /width/.test(row.detail)));
  assert.ok(rows.some(row => /carousel prev arrow/.test(row.detail) && /iconWidth/.test(row.detail)));
  assert.ok(rows.some(row => /visible image\/icon/.test(row.detail) && /x 102 -> 0/.test(row.detail)));
  assert.ok(rows.some(row => row.text === 'Why Shop Wigs.com?' && /text color/.test(row.detail) && /font size/.test(row.detail)));
  assert.ok(rows.some(row => row.text === 'Why Shop Wigs.com?' && /horizontal placement/.test(row.detail)));
  assert.ok(rows.some(row => row.text === 'Shop with Confidence' && /control background/.test(row.detail) && /control width/.test(row.detail)));
  assert.ok(rows.some(row => row.text === 'Shop All Envy' && /underline construction differs/.test(row.detail)));
  assert.equal(opaqueSolidBackground({ 'background-color': 'rgba(0, 0, 0, 0)', 'background-image': 'none' }), undefined);
  assert.equal(opaqueSolidBackground({ 'background-color': 'rgb(255, 255, 255)', 'background-image': 'linear-gradient(red, blue)' }), null);
});

test('frozen tasks remain unchanged; explicit new visual contract blocks rendered mismatches', () => {
  const snapshot = fingerprintNative44Snapshot({ hash, elements: [], settings: {} });
  const manifest: Native44CompareManifest = { ...snapshot, version: 1, strategy: 'native44-css-handoff', taskId: 'fixture', runId: 'fixture-run', pageId: 42, sourceUrl: 'https://source.test/', targetUrl: 'https://target.test/', widgetTypes: ['heading'], canvasCss: '', cssRules: [], modules: [{ key: 'section', className: 'cwp-section', sourceSelector: '.section', targetSelector: '.elementor-42 .cwp-section', required: true }] };
  const capture: Native44Capture = { viewport: 'desktop-wide', width: 1920, height: 1080, clientWidth: 1905, devicePixelRatio: 1, source: { screenshot: 'source.png', sha256: hash, modules: [{ key: 'section', count: 1, visible: true, visual: source }] }, target: { screenshot: 'target.png', sha256: hash, modules: [{ key: 'section', count: 1, visible: true, visual: target }] } };
  assert.deepEqual(analyzeNative44Captures(manifest, [capture]).gaps, []);
  const current = { ...manifest, reviewWorkflow: 'whole-page-after-css-v1' as const, visualAuditVersion: 1 as const };
  assert.ok(analyzeNative44Captures(current, [capture]).gaps.some(gap => gap.blocking && /effective section background/.test(gap.detail)));
  assert.doesNotThrow(() => validateNative44CompareManifest(current));
  const generic = { ...current, visualAuditVersion: 2 as const };
  assert.ok(analyzeNative44Captures(generic, [capture]).gaps.some(gap => /Generic painted-region samples are missing/.test(gap.detail)));
  assert.doesNotThrow(() => validateNative44CompareManifest(generic));
  assert.throws(() => validateNative44CompareManifest({ ...manifest, visualAuditVersion: 1 }), /visual audit contract/);
});

test('class-independent paint layers catch arbitrary decorative controls and regions', () => {
  const layer = { x: 30, y: 12, width: 180, height: 48, background: 'rgb(255, 255, 255)', backgroundImage: 'none' as const, borderWidth: '1px', borderColor: 'rgb(0, 0, 0)', borderRadius: '8px', boxShadow: 'none', opacity: '1' };
  const previous = { ...source, paintLayers: [layer] };
  const next = { ...source, paintLayers: [{ ...layer, background: 'rgb(235, 235, 235)', borderRadius: '0px' }] };
  assert.ok(compareNative44VisualModules(previous, next, true).some(row => /painted region/.test(row.detail) && /background, radius/.test(row.detail)));
  assert.ok(compareNative44VisualModules(previous, { ...source, paintLayers: [] }, true).some(row => /missing or displaced/.test(row.detail)));
  assert.ok(!compareNative44VisualModules(previous, next).some(row => /painted region/.test(row.detail)));
  assert.equal(visiblePaint({ 'background-color': 'rgba(0, 0, 0, 0)', 'border-width': '0px 1px 0px 0px', 'border-style': 'solid', 'box-shadow': 'none' }), true);
  assert.equal(visiblePaint({ 'background-color': 'rgba(0, 0, 0, 0)', 'border-width': '0px', 'border-style': 'none', 'box-shadow': 'none' }), false);
});

test('phone typography audit rejects one-line rendering and a winning nowrap rule', () => {
  const one = { ...source, texts: [{ text: 'Why Shop Wigs.com?', color: 'rgb(18, 18, 18)', fontSize: '32px', lineHeight: '41px', width: 327, height: 82, lineCount: 2, whiteSpace: 'normal' }] };
  const two = { ...one, texts: [{ ...one.texts[0], height: 41, lineCount: 1, whiteSpace: 'nowrap' }] };
  assert.ok(compareNative44VisualModules(one, two, false, true).some(row => /rendered lines 2 -> 1/.test(row.detail) && /white-space/.test(row.detail)));
  assert.equal(compareNative44VisualModules(one, two, false, false).length, 0);
  assert.ok(compareNative44VisualModules(one, { ...one, texts: [{ ...one.texts[0], height: undefined }] }, false, true).some(row => /evidence missing/.test(row.detail)));
});
