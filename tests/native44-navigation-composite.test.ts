import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNative44DisclosureNavigation } from '../src/native44/navigation-composite.js';
import { walkNative44 } from '../src/native44/types.js';

const input = { key: 'navigation', label: 'Shop', panels: [{ key: 'a', title: 'Category A', overview: { label: 'See all', url: 'https://example.org/a/' }, columns: [{ title: 'Section', links: [{ label: 'First item', url: 'https://example.org/a/first' }] }] }, { key: 'b', title: 'Category B', columns: [{ links: [{ label: 'Second item', url: 'https://example.org/b/' }] }] }], footerLinks: [{ label: 'Contact', url: 'https://example.org/contact/' }] };
test('disclosure navigation preserves all destinations in editable native controls', () => {
  const tree = createNative44DisclosureNavigation(input), nodes = walkNative44([tree]);
  assert.ok(nodes.every(node => node.kind === 'native' || node.kind === 'composite'));
  assert.equal(new Set(nodes.map(node => node.key)).size, nodes.length);
  const accordion = nodes.find(node => node.kind === 'native' && node.widgetType === 'nested-accordion');
  assert.equal(accordion?.kind === 'native' && accordion.widgetSettings.default_state, 'all_collapsed');
  const tabs = nodes.find(node => node.kind === 'native' && node.widgetType === 'nested-tabs');
  assert.equal(tabs?.kind === 'native' && tabs.children?.length, 2);
  assert.equal(tabs?.kind === 'native' && tabs.widgetSettings.breakpoint_selector, 'none');
  for (const url of ['https://example.org/a/', 'https://example.org/a/first', 'https://example.org/b/', 'https://example.org/contact/']) assert.ok(JSON.stringify(tree).includes(url));
  assert.deepEqual(input.panels[0].columns[0].links, [{ label: 'First item', url: 'https://example.org/a/first' }]);
});
test('navigation refuses executable links, markup labels and duplicate panel identities', () => {
  assert.throws(() => createNative44DisclosureNavigation({ ...input, footerLinks: [{ label: 'Bad', url: 'javascript:alert(1)' }] }));
  assert.throws(() => createNative44DisclosureNavigation({ ...input, footerLinks: [{ label: 'Bad', url: 'https://user:password@example.org/' }] }));
  assert.throws(() => createNative44DisclosureNavigation({ ...input, label: '<script>bad</script>' }));
  assert.throws(() => createNative44DisclosureNavigation({ ...input, panels: [input.panels[0], input.panels[0]] }), /duplicate_panel/);
});
