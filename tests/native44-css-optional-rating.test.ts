import test from 'node:test';
import assert from 'node:assert/strict';
import { buildNative44PageCSS, canonicalNative44CSS, type Native44CSSRule } from '../src/native44/css-handoff.js';

const source = 'source-facts.json#/desktop-products/observed-no-rating';
const target = 'native-product-observation.json#/desktop-products/optional-star-rating';
const rating = (): Native44CSSRule => ({ moduleKey: 'products', selector: '.star-rating', declarations: { display: 'none !important' }, reason: 'Both source desktop observations omit rating decoration; actual native target cards add this optional wrapper.', evidence: [source, target], optionalPresentation: 'product-rating', optionalPresentationEvidence: { sourceAbsence: source, targetOptionality: target } });
const build = (rule: Native44CSSRule) => buildNative44PageCSS({ pageId: 42, modules: [{ key: 'products', className: 'cwp-products' }], canvasCss: '', rules: [rule] });

test('explicit optional rating omission is limited to one known wrapper in the actual page module', () => {
  const result = build(rating());
  assert.match(canonicalNative44CSS(result.css), /\.elementor-42 \.cwp-products \.star-rating\{display:none!important\}/);
  assert.deepEqual(result.selectorMap[0].evidence, [source, target]);
  const plain = rating(); plain.declarations.display = 'none';
  assert.doesNotThrow(() => build(plain));
});

test('rating exception cannot hide prices, names, images, descendants or arbitrary selector lists', () => {
  for (const selector of [undefined, '', '.price', '.wd-entities-title', 'img', '.star-rating,.price', '.star-rating .price', '.star-rating > *', '.star-rating + .price', '.star-rating:not(.required)', '.star-rating::before', '.star-rating:has(.price)', '.star-rating,body']) {
    assert.throws(() => build({ ...rating(), selector }), /exact \.star-rating selector/);
  }
  assert.throws(() => build({ ...rating(), observedDecoration: true }), /exact \.star-rating selector/);
  assert.throws(() => build({ ...rating(), moduleKey: 'unowned' }), /Unbound/);
  assert.throws(() => build({ ...rating(), optionalPresentation: 'product-price' as 'product-rating' }), /Unsupported/);
});

test('rating exception cannot turn into opacity, collapse, injection or an open-ended hide allowance', () => {
  const forbidden: Array<Record<string, string>> = [
    { opacity: '0' }, { height: '0px' }, { visibility: 'hidden' },
    { display: 'none', opacity: '0' }, { display: 'none', height: '0px' },
    { display: 'none', color: 'red' }, { display: 'var(--hidden)' },
    { display: 'none; color:red' }, { display: 'contents' }, { display: 'no ne' },
  ];
  for (const declarations of forbidden) assert.throws(() => build({ ...rating(), declarations }), /only permits display:none/);
  const ordinary = rating(); delete ordinary.optionalPresentation; delete ordinary.optionalPresentationEvidence;
  assert.throws(() => build(ordinary), /cannot hide required content/);
});

test('optional rating omission requires distinct references bound to the actual rule evidence', () => {
  assert.throws(() => build({ ...rating(), evidence: [] }), /unevidenced/);
  assert.throws(() => build({ ...rating(), optionalPresentationEvidence: undefined }), /bound source-absence/);
  assert.throws(() => build({ ...rating(), evidence: [source] }), /bound source-absence/);
  for (const proof of [
    { sourceAbsence: '', targetOptionality: target },
    { sourceAbsence: source, targetOptionality: source },
    { sourceAbsence: 'unbound-source.json', targetOptionality: target },
    { sourceAbsence: source, targetOptionality: target, allowHide: true },
  ]) assert.throws(() => build({ ...rating(), optionalPresentationEvidence: proof }), /bound source-absence/);
  const missingDeclaration = rating(); delete missingDeclaration.optionalPresentation;
  assert.throws(() => build(missingDeclaration), /requires its explicit/);
});
