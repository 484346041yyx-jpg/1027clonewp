import test from 'node:test';
import assert from 'node:assert/strict';
import { createNative44CSSModel, updateNative44CSSModel, compileNative44CSSModel, importLegacyNative44CSSModel, native44CSSModelEffectKey, native44CSSModelRuleHash, type Native44CSSModelRule } from '../src/native44/css-model.js';
import { hashV2 } from '../src/replica-v2/journal.js';
import { buildNative44PageCSS } from '../src/native44/css-handoff.js';
import { consolidateNative44CSS } from '../src/native44/consolidate-css.js';
const identity = { taskId: 'task-one', runId: 'run-one', pageId: 77, replicationProfile: 'desktop-browser-v1' as const, modules: [{ key: 'header', className: 'cwp-header' }] };
const rule = (overrides: Partial<Native44CSSModelRule> = {}): Native44CSSModelRule => ({ id: 'search-font', moduleKey: 'header', slot: 'search-label', selector: '.search-label', property: 'font-size', responsibility: 'css', value: '14px', reason: 'Match the frozen source search-label geometry.', evidence: ['source-packet-header'], ...overrides });

test('model replacement compiles one effective property and never emits superseded patches', () => {
  const initial = createNative44CSSModel({ ...identity, rules: [rule()] });
  const next = updateNative44CSSModel(initial, [{ kind: 'replace', id: 'search-font', expectedHash: native44CSSModelRuleHash(initial.rules[0]), rule: rule({ value: '16px', reason: 'Current source evidence requires a 16px label.' }) }]);
  const compiled = compileNative44CSSModel(next);
  assert.match(compiled.css, /font-size:16px|font-size: 16px/); assert.doesNotMatch(compiled.css, /14px/);
  assert.equal(compiled.counts.currentRules, 1); assert.equal(compiled.counts.supersededRules, 1); assert.equal(initial.rules[0].value, '14px');
  assert.equal(compileNative44CSSModel(next).sha256, compiled.sha256);
  assert.throws(() => updateNative44CSSModel(next, [{ kind: 'replace', id: 'search-font', expectedHash: native44CSSModelRuleHash(initial.rules[0]), rule: rule({ value: '18px' }) }]), /expected_rule_changed/);
});
test('different IDs and slots cannot silently introduce a second current physical effect', () => {
  assert.throws(() => createNative44CSSModel({ ...identity, rules: [rule(), rule({ id: 'patch-two', slot: 'another-slot', value: '16px' })] }), /current_rule_conflict/);
  const model = createNative44CSSModel({ ...identity, rules: [rule()] });
  assert.throws(() => updateNative44CSSModel(model, [{ kind: 'add', rule: rule({ id: 'patch-two', value: '16px' }) }]), /current_rule_conflict/);
  assert.throws(() => updateNative44CSSModel(model, [{ kind: 'replace', id: 'search-font', expectedHash: native44CSSModelRuleHash(model.rules[0]), rule: rule({ selector: '.other' }) }]), /replacement_identity_changed/);
});
test('explicit fallback groups are retained while removed rules stay only in history', () => {
  const fallback = rule({ property: 'display', value: undefined, fallback: { id: 'layout-compatibility', values: ['block', 'flex'] } });
  const model = createNative44CSSModel({ ...identity, rules: [fallback] }), compiled = compileNative44CSSModel(model);
  assert.match(compiled.css, /display: ?block;[\s\S]*display: ?flex/);
  const removed = updateNative44CSSModel(model, [{ kind: 'remove', id: fallback.id, expectedHash: native44CSSModelRuleHash(fallback), reason: 'The native layout now owns this declaration.', evidence: ['native-layout-proof'] }]);
  assert.doesNotMatch(compileNative44CSSModel(removed).css, /display/); assert.equal(removed.history[0].action, 'removed');
  assert.throws(() => createNative44CSSModel({ ...identity, rules: [rule({ fallback: { id: 'ambiguous', values: ['14px', '16px'] } })] }), /css_responsibility_invalid/);
});
test('native responsibility is distinct from CSS and checks the actual native control', () => {
  const native = rule({ responsibility: 'native', value: undefined, native: { elementId: 'abc1234', controlId: 'typography_font_size', expectedValue: { unit: 'px', size: 14 } } });
  const model = createNative44CSSModel({ ...identity, rules: [native] });
  const elements = [{ id: 'abc1234', elType: 'widget' as const, widgetType: 'button', settings: { css_classes: 'cwp-header', typography_font_size: { unit: 'px', size: 14 } }, elements: [] }];
  assert.doesNotMatch(compileNative44CSSModel(model, { elements }).css, /font-size/);
  assert.equal(compileNative44CSSModel(model, { elements }).css, compileNative44CSSModel(model).css);
  assert.throws(() => compileNative44CSSModel(model, { elements: [{ ...elements[0], settings: { ...elements[0].settings, typography_font_size: { unit: 'px', size: 16 } } }] }), /native_control_mismatch/);
});
test('the model reuses safe selector, desktop and content guards', () => {
  for (const unsafe of [rule({ selector: '+ .outside' }), rule({ media: '(max-width: 768px)' }), rule({ property: 'content', value: '"0"' }), rule({ property: 'display', value: 'none' }), rule({ property: 'background', value: 'url(https://unbound.test/asset.png)' })]) assert.throws(() => createNative44CSSModel({ ...identity, rules: [unsafe] }));
});

test('single-pass model compile preserves the established cascade and validates native-only owners', () => {
  const rules = [rule({ property: 'display', value: undefined, fallback: { id: 'compat', values: ['block', 'flex'] } }), rule({ id: 'media', selector: '.other', property: 'color', value: 'red', media: '(min-width: 1200px)' })];
  const model = createNative44CSSModel({ ...identity, rules });
  const oldPipeline = buildNative44PageCSS({ ...identity, canvasCss: '', rules: rules.flatMap(item => (item.fallback?.values ?? [item.value!]).map(value => ({ moduleKey: item.moduleKey, selector: item.selector, media: item.media, declarations: { [item.property]: value }, reason: item.reason, evidence: item.evidence }))) });
  const compiled = compileNative44CSSModel(model);
  assert.equal(compiled.css, consolidateNative44CSS(oldPipeline.css).css);
  assert.deepEqual(compiled.work, { validationPasses: 1, consolidationPasses: 1 });
  const native = rule({ responsibility: 'native', value: undefined, native: { elementId: 'abc1234', controlId: 'size', expectedValue: 14 } });
  assert.throws(() => compileNative44CSSModel(createNative44CSSModel({ ...identity, rules: [native] }), { elements: [{ id: 'abc1234', elType: 'widget', widgetType: 'button', settings: { size: 14 }, elements: [] }] }), /owner is missing/);
  assert.throws(() => createNative44CSSModel({ ...identity, rules: [{ ...native, selector: '+ .outside' }] }), /cannot escape/);
  assert.throws(() => createNative44CSSModel({ ...identity, rules: [{ ...native, media: '(max-width: 768px)' }] }), /mobile/);
});
test('legacy adoption requires exact bytes and explicit decisions for obsolete patches versus fallbacks', () => {
  const css = '.elementor-77 .cwp-header .search-label{font-size:14px}.elementor-77 .cwp-header .search-label{font-size:16px}';
  const adoption = { css, sha256: hashV2(css), reason: 'Explicit adoption of the reviewed page stylesheet.', evidence: ['reviewed-css-file'] };
  assert.throws(() => importLegacyNative44CSSModel(identity, { ...adoption, sha256: 'a'.repeat(64) }), /legacy_source_invalid/);
  assert.throws(() => importLegacyNative44CSSModel(identity, adoption), /legacy_duplicate_decision_required/);
  const key = native44CSSModelEffectKey(rule());
  const model = importLegacyNative44CSSModel(identity, { ...adoption, duplicateDecisions: { [key]: { kind: 'current-value', value: '16px', reason: 'The later reviewed correction replaced the earlier patch.', evidence: ['reviewed-computed-style'] } } });
  assert.equal(model.rules.length, 1); assert.doesNotMatch(compileNative44CSSModel(model).css, /14px/);
});
test('sealed legacy content accepts font faces but cannot hide an old stylesheet or global rules', () => {
  const css = '@font-face{font-family:Source;src:url(https://fonts.test/source.woff2)}.elementor-77 .cwp-header .search-label{font-size:14px}';
  const input = { css, sha256: hashV2(css), reason: 'Explicit adoption retaining the source font declaration.', evidence: ['reviewed-css-file'] };
  const model = importLegacyNative44CSSModel(identity, input); assert.match(compileNative44CSSModel(model).css, /@font-face/);
  assert.throws(() => createNative44CSSModel({ ...identity, sealedAtRules: [{ id: 'old-patches', css: '.elementor-77 .cwp-header{color:red}', sha256: hashV2('.elementor-77 .cwp-header{color:red}'), reason: input.reason, evidence: input.evidence }] }), /sealed_not_font_face/);
  const escaped = 'body{color:red}'; assert.throws(() => importLegacyNative44CSSModel(identity, { ...input, css: escaped, sha256: hashV2(escaped) }), /legacy_selector_unowned/);
});
test('legacy deduplication retains the last declaration position across competing selectors', () => {
  const css = '.elementor-77 .cwp-header .a{color:red}.elementor-77 .cwp-header .b{color:blue}.elementor-77 .cwp-header .a{color:red}', input = { css, sha256: hashV2(css), reason: 'Explicit adoption with stable cascade ordering.', evidence: ['reviewed-css-file'] };
  const compiled = compileNative44CSSModel(importLegacyNative44CSSModel(identity, input));
  assert.ok(compiled.css.indexOf('.b') < compiled.css.indexOf('.a')); assert.equal((compiled.css.match(/color: ?red/g) ?? []).length, 1);
  const ambiguous = css.replace(/color:red(?=})/g, 'color:green').replace('color:green', 'color:red'), key = native44CSSModelEffectKey(rule({ selector: '.a', property: 'color' }));
  assert.throws(() => importLegacyNative44CSSModel(identity, { ...input, css: ambiguous, sha256: hashV2(ambiguous), duplicateDecisions: { [key]: { kind: 'fallback', id: 'color-compatibility', reason: 'Preserve an explicitly claimed compatibility fallback group.', evidence: ['browser-compatibility-proof'] } } }), /legacy_fallback_order_ambiguous/);
});
