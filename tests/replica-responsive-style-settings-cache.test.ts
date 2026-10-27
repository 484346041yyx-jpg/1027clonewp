import test from 'node:test';
import assert from 'node:assert/strict';
import { createMobileNativeStyleCSSValidator, assertMobileNativeStyleCSS } from '../src/replica-responsive/style-settings.js';

const effects = (property: string, value: string) => [{ selector: '{{WRAPPER}} .leaf', property, value }];

test('one private CSS index retains checks for every later owner, property and conflicting declaration', () => {
  const input = '@media(max-width:768px){:page .first .leaf{color:red;padding:1px 2px}:page .second .leaf{color:blue}:page .first .leaf{color:red}}';
  const validate = createMobileNativeStyleCSSValidator(input, 768);
  validate('first', effects('color', 'red'));
  validate('first', effects('padding-top', '1px'));
  validate('second', effects('color', 'blue'));
  assert.throws(() => validate('second', effects('color', 'red')), /css_overrides_native_mobile_value/);
  assert.throws(() => validate('first', effects('padding-left', '1px')), /css_overrides_native_mobile_value/);
  const conflict = createMobileNativeStyleCSSValidator(input + '@media(max-width:768px){:page .first .leaf{color:blue;color:red}}', 768);
  assert.throws(() => conflict('first', effects('color', 'red')), /css_overrides_native_mobile_value/);
});

test('CSS media range reachability and cache state never cross compile calls or mobile widths', () => {
  const input = '@media(min-width:769px){:page .owner .leaf{color:blue}}@media print{:page .owner .leaf{color:green}}';
  const narrow = createMobileNativeStyleCSSValidator(input, 768);
  assert.doesNotThrow(() => narrow('owner', effects('color', 'red')));
  assert.throws(() => createMobileNativeStyleCSSValidator(input, 900)('owner', effects('color', 'red')), /css_overrides_native_mobile_value/);
  assert.throws(() => createMobileNativeStyleCSSValidator(':page .owner .leaf{color:blue}', 768)('owner', effects('color', 'red')), /css_overrides_native_mobile_value/);
  assert.doesNotThrow(() => narrow('owner', effects('color', 'red')));
});

test('a cached validator preserves normalized selectors, unknown media and undefined shorthand rejection', () => {
  const cases = [
    { css: '@media (width <= 768px){:page .owner.owner .leaf{color:rgb(255,0,0)}}', effect: effects('color', '#ff0000'), invalid: false },
    { css: '@media(hover:hover){:page .owner .leaf{color:blue}}', effect: effects('color', 'red'), invalid: true },
    { css: '@media(max-width:768px){:page .owner .leaf{padding:var(--unknown)}}', effect: effects('padding-top', '1px'), invalid: true },
    { css: '@media(min-width:1000px){@media(max-width:500px){:page .owner .leaf{color:blue}}}', effect: effects('color', 'red'), invalid: false },
  ];
  for (const row of cases) {
    const validate = createMobileNativeStyleCSSValidator(row.css, 768);
    if (row.invalid) {
      assert.throws(() => validate('owner', row.effect), /css_overrides_native_mobile_value/);
      assert.throws(() => assertMobileNativeStyleCSS(row.css, 'owner', row.effect, 768), /css_overrides_native_mobile_value/);
    } else { validate('owner', row.effect); validate('owner', row.effect); }
  }
});

test('registered selector lists check every branch without splitting commas inside selector functions or attributes', () => {
  const effect = [{ selector: '{{WRAPPER}} .field, {{WRAPPER}} .subgroup label', property: 'font-size', value: '16px' }];
  const matching = createMobileNativeStyleCSSValidator('@media(max-width:768px){:page .owner .field,:page .owner .subgroup label{font-size:16px}}', 768);
  assert.doesNotThrow(() => matching('owner', effect));
  const conflict = createMobileNativeStyleCSSValidator('@media(max-width:768px){:page .owner .field{font-size:16px}:page .owner .subgroup label{font-size:18px}}', 768);
  assert.throws(() => conflict('owner', effect), /css_overrides_native_mobile_value/);
  const compound = createMobileNativeStyleCSSValidator(':page .owner :is(.first,.second)[data-label="a,b"]{color:blue}', 768);
  assert.throws(() => compound('owner', [{ selector: '{{WRAPPER}} :is(.first,.second)[data-label="a,b"], {{WRAPPER}} .other', property: 'color', value: 'red' }]), /css_overrides_native_mobile_value/);
  assert.throws(() => matching('owner', [{ selector: '{{WRAPPER}} [', property: 'font-size', value: '16px' }]));
});
