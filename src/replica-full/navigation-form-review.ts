import { parseFragment } from 'parse5';
import { native44Id } from '../native44/adapters.js';
import { compileNavigationFormHtml, type NavigationFormSpec } from './navigation-form/index.js';

function fail(code: string): never { throw Error(`replica_full_navigation_form_review_${code}`); }
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
function tree(node: any): unknown {
  if (node.nodeName === '#text') return node.value.trim() ? { text: node.value.replace(/\s+/g, ' ').trim() } : null;
  return { tag: node.tagName, attrs: [...(node.attrs ?? [])].map((item: any) => [item.name, item.value]).sort((a, b) => a[0].localeCompare(b[0])), children: (node.childNodes ?? []).map(tree).filter(Boolean) };
}
export function navigationFormSelector(form: NavigationFormSpec, taskId: string): string { return '#clonewp-nav-' + native44Id(taskId, 'navigation-form:' + form.key); }
/** Parse actual target DOM, allowing active forms only when their whole subtree equals the typed compiler. */
export function assertNavigationFormDOM(actualForms: any[], forms: NavigationFormSpec[], sourceUrl: string, taskId: string): void {
  if (actualForms.length !== forms.length) fail('form_count');
  for (const form of forms) {
    const expected = (parseFragment(compileNavigationFormHtml(form, sourceUrl, taskId)) as any).childNodes.find((node: any) => node.tagName === 'form');
    const id = navigationFormSelector(form, taskId).slice(1), found = actualForms.filter(node => node.attrs?.some((item: any) => item.name === 'id' && item.value === id));
    if (!expected || found.length !== 1 || !same(tree(found[0]), tree(expected))) fail('form_dom_changed');
  }
}
export interface NavigationReviewAction { kind: string; selector: string; expectedOutcome: string }
export function assertNavigationFormInteraction(form: NavigationFormSpec, action: NavigationReviewAction, states: Array<{ state: Record<string, unknown> }>, sourceUrl: string, targetOrigin: string, taskId: string): void {
  if (action.kind !== 'form' || action.selector !== navigationFormSelector(form, taskId) || action.expectedOutcome !== 'navigated') fail('interaction_action');
  const before = states[0]?.state, after = states[1]?.state;
  if (!before || !after || after.method !== 'GET' || after.submitted !== true || typeof before.url !== 'string' || typeof after.url !== 'string') fail('interaction_state');
  const initial = new URL(before.url), actual = new URL(after.url), expected = new URL(form.action);
  // WordPress may canonicalize the public GET action by adding one trailing slash.
  const destinationPathMatches = actual.pathname === expected.pathname || actual.pathname === expected.pathname + '/';
  if (initial.origin !== targetOrigin || initial.username || initial.password || actual.origin !== new URL(sourceUrl).origin || actual.origin !== expected.origin || !destinationPathMatches || actual.username || actual.password || actual.hash || [...actual.searchParams].length !== form.fields.length) fail('interaction_navigation');
  let changed = false;
  for (const field of form.fields) {
    const value = before['select:' + field.name];
    if (typeof value !== 'string' || !field.options.some(option => option.value === value) || actual.searchParams.getAll(field.name).length !== 1 || actual.searchParams.get(field.name) !== value) fail('interaction_selected_value');
    if (value !== field.options[0].value) changed = true;
  }
  if (!changed && form.fields.some(field => field.options.length > 1)) fail('interaction_selection_unproven');
}
