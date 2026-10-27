import { createHash } from 'node:crypto';

/** This contract describes the separate Header Builder experiment. It is not a
 * WordPress adapter and does not extend the existing Elementor writer. */
export type HeaderJson = null | boolean | number | string | HeaderJson[] | { [key: string]: HeaderJson };
export interface HeaderOwner { ownerId: string; runId: string }
export type HeaderElementType = 'root' | 'row' | 'column' | 'logo' | 'main-menu' | 'account' | 'cart' | 'spacer';
export interface HeaderPlanNode { key: string; type: HeaderElementType; children: HeaderPlanNode[] }
export interface WoodmartHeaderPlan {
  version: 1;
  targetOrigin: string;
  explicitHeaderId: string;
  expectedDefaultHeaderId: string;
  menuName: string;
  owner: HeaderOwner;
  /** Semantic layout only; the adapter must verify the actual WHB schema. */
  tree: HeaderPlanNode;
  preservedComponentPageIds: number[];
  preservedMenuIds: number[];
}
export interface HeaderMenuItem {
  key: string;
  parentKey: string | null;
  title: string;
  url: string;
}
export interface HeaderExplicitReference { kind: 'page' | 'post' | 'product' | 'layout' | 'other'; id: string }
export interface HeaderIsolationAudit {
  targetOrigin: string;
  headerId: string;
  defaultHeaderId: string;
  /** Each list contains references to headerId. Empty lists with incomplete
   * coverage cannot establish isolation. The actual reader supplies evidence. */
  coverage: { explicitReferences: 'complete' | 'unknown'; presets: 'complete' | 'unknown'; cssJs: 'complete' | 'unknown' };
  explicitReferences: HeaderExplicitReference[];
  presetReferences: string[];
  cssJsReferences: string[];
}
export interface OwnedHeaderTestPage extends HeaderOwner { pageId: number }
export type HeaderWriteResource =
  | { kind: 'woodmart-header'; id: string }
  | { kind: 'wordpress-menu' | 'test-page'; id: string }
  | { kind: 'default-header-pointer'; id: 'active' };
export interface HeaderWriteIntent {
  version: 1;
  resource: HeaderWriteResource;
  owner: HeaderOwner;
  beforeHash: string;
  afterHash: string;
}
export type HeaderWriteReconciliation = {
  state: 'before' | 'after' | 'conflict';
  currentHash: string;
  /** Reconciliation never authorizes a retry by itself. In the before state,
   * the caller must recheck ownership, isolation and the CAS precondition. */
  retryAllowed: false;
  nextAction: 'recheck-preconditions' | 'accept-readback-no-retry' | 'stop-no-retry';
};

const elementTypes = new Set<HeaderElementType>(['root', 'row', 'column', 'logo', 'main-menu', 'account', 'cart', 'spacer']);
const keyPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;
const headerIdPattern = /^(?:header_[1-9]\d*|default_header)$/;
const hashPattern = /^[a-f0-9]{64}$/;
function fail(code: string): never { throw new Error(`woodmart_header_${code}`); }
function record(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
function exactKeys(value: Record<string, unknown>, keys: string[]): void {
  if (Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) fail('shape_invalid');
}
function text(value: unknown, max = 200): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max && value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value);
}
function owner(value: unknown): asserts value is HeaderOwner {
  if (!record(value)) fail('owner_invalid');
  exactKeys(value, ['ownerId', 'runId']);
  if (!text(value.ownerId, 100) || !text(value.runId, 150) || !/^[A-Za-z0-9_-]+$/.test(value.ownerId) || !/^[A-Za-z0-9_-]+$/.test(value.runId)) fail('owner_invalid');
}
function positiveIds(value: unknown): asserts value is number[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 1000 || value.some(id => !Number.isSafeInteger(id) || id < 1) || new Set(value).size !== value.length) fail('preserved_ids_invalid');
}
export function headerTargetOrigin(value: unknown): string {
  if (!text(value, 2048)) fail('origin_invalid');
  let url: URL;
  try { url = new URL(value); } catch { return fail('origin_invalid'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/' || value !== url.origin && value !== `${url.origin}/`) fail('origin_invalid');
  return url.origin;
}

export function validateHeaderPlan(input: unknown): WoodmartHeaderPlan {
  if (!record(input)) fail('plan_invalid');
  exactKeys(input, ['version', 'targetOrigin', 'explicitHeaderId', 'expectedDefaultHeaderId', 'menuName', 'owner', 'tree', 'preservedComponentPageIds', 'preservedMenuIds']);
  if (input.version !== 1 || !text(input.explicitHeaderId) || !headerIdPattern.test(input.explicitHeaderId) || !text(input.expectedDefaultHeaderId) || !headerIdPattern.test(input.expectedDefaultHeaderId) || !text(input.menuName, 100)) fail('plan_invalid');
  const targetOrigin = headerTargetOrigin(input.targetOrigin);
  owner(input.owner);
  positiveIds(input.preservedComponentPageIds); positiveIds(input.preservedMenuIds);
  const seen = new Set<string>();
  const visit = (value: unknown, parent: HeaderElementType | null, depth: number): HeaderPlanNode => {
    if (!record(value) || depth > 4 || seen.size >= 100) fail('tree_invalid');
    exactKeys(value, ['key', 'type', 'children']);
    if (typeof value.key !== 'string' || !keyPattern.test(value.key) || seen.has(value.key) || !elementTypes.has(value.type as HeaderElementType) || !Array.isArray(value.children)) fail('tree_invalid');
    const type = value.type as HeaderElementType;
    if (parent === null ? type !== 'root' : parent === 'root' ? type !== 'row' : parent === 'row' ? type !== 'column' : parent !== 'column' || ['root', 'row', 'column'].includes(type)) fail('tree_hierarchy_invalid');
    if (['root', 'row', 'column'].includes(type) ? value.children.length < 1 : value.children.length > 0) fail('tree_hierarchy_invalid');
    seen.add(value.key);
    return { key: value.key, type, children: value.children.map(child => visit(child, type, depth + 1)) };
  };
  const tree = visit(input.tree, null, 0);
  return { version: 1, targetOrigin, explicitHeaderId: input.explicitHeaderId, expectedDefaultHeaderId: input.expectedDefaultHeaderId, menuName: input.menuName, owner: { ...input.owner }, tree, preservedComponentPageIds: [...input.preservedComponentPageIds], preservedMenuIds: [...input.preservedMenuIds] };
}

/** Menu destinations are explicit HTTPS links or safe relative links. This does
 * not infer a target taxonomy, copy source object IDs, or create menu items. */
export function validateHeaderMenuItems(input: unknown, targetOrigin: string): HeaderMenuItem[] {
  const origin = headerTargetOrigin(targetOrigin);
  if (!Array.isArray(input) || input.length < 1 || input.length > 200) fail('menu_invalid');
  const keys = new Set<string>();
  const items = input.map((value): HeaderMenuItem => {
    if (!record(value)) fail('menu_item_invalid');
    exactKeys(value, ['key', 'parentKey', 'title', 'url']);
    if (typeof value.key !== 'string' || !keyPattern.test(value.key) || keys.has(value.key) || value.parentKey !== null && (typeof value.parentKey !== 'string' || !keyPattern.test(value.parentKey)) || !text(value.title, 200) || !text(value.url, 2048)) fail('menu_item_invalid');
    const url = value.url;
    if (/\\|[\u0080-\u009f]|%0[0-9a-f]|%7f|%09/i.test(url) || url.startsWith('//') || /^[a-z][a-z\d+.-]*:/i.test(url) && !/^https:\/\//i.test(url)) fail('menu_url_invalid');
    let parsed: URL;
    try { parsed = new URL(url, `${origin}/`); } catch { return fail('menu_url_invalid'); }
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) fail('menu_url_invalid');
    keys.add(value.key);
    return { key: value.key, parentKey: value.parentKey as string | null, title: value.title, url };
  });
  const byKey = new Map(items.map(item => [item.key, item]));
  for (const item of items) {
    const ancestors = new Set([item.key]);
    let parent = item.parentKey;
    while (parent !== null) {
      if (ancestors.has(parent)) fail('menu_parent_cycle');
      const ancestor = byKey.get(parent); if (!ancestor) fail('menu_parent_missing');
      ancestors.add(parent); parent = ancestor.parentKey;
    }
  }
  return items;
}

/** Must be run against a fresh, complete audit again after any default-header
 * isolation step. A name such as "test" does not confer isolation. */
export function assertHeaderIsolation(planInput: unknown, audit: HeaderIsolationAudit, ownedTestPage?: OwnedHeaderTestPage): void {
  const plan = validateHeaderPlan(planInput);
  if (!record(audit) || headerTargetOrigin(audit.targetOrigin) !== plan.targetOrigin || audit.headerId !== plan.explicitHeaderId || audit.defaultHeaderId !== plan.expectedDefaultHeaderId) fail('isolation_identity_changed');
  if (!record(audit.coverage) || ['explicitReferences', 'presets', 'cssJs'].some(key => audit.coverage[key as keyof typeof audit.coverage] !== 'complete')) fail('reference_audit_incomplete');
  if (!Array.isArray(audit.explicitReferences) || !Array.isArray(audit.presetReferences) || !Array.isArray(audit.cssJsReferences)) fail('reference_audit_invalid');
  if (audit.defaultHeaderId === plan.explicitHeaderId) fail('default_header_must_be_isolated');
  if (ownedTestPage) {
    owner({ ownerId: ownedTestPage.ownerId, runId: ownedTestPage.runId });
    if (!Number.isSafeInteger(ownedTestPage.pageId) || ownedTestPage.pageId < 1 || ownedTestPage.ownerId !== plan.owner.ownerId || ownedTestPage.runId !== plan.owner.runId || plan.preservedComponentPageIds.includes(ownedTestPage.pageId)) fail('test_page_owner_invalid');
  }
  const otherReferences = audit.explicitReferences.filter(reference => {
    if (!record(reference) || !['page', 'post', 'product', 'layout', 'other'].includes(reference.kind) || !text(reference.id)) fail('reference_audit_invalid');
    return !ownedTestPage || reference.kind !== 'page' || reference.id !== String(ownedTestPage.pageId);
  });
  if (otherReferences.length || audit.presetReferences.length || audit.cssJsReferences.length) fail('header_has_other_references');
}

/** Strict JSON canonicalization is independent of property insertion order.
 * It rejects non-JSON values instead of silently dropping or normalizing them. */
export function canonicalHeaderJson(value: unknown): string {
  const ancestors = new Set<object>();
  let nodes = 0;
  const visit = (entry: unknown, depth: number): string => {
    if (++nodes > 20000 || depth > 64) fail('json_limit_exceeded');
    if (entry === null || typeof entry === 'boolean' || typeof entry === 'string') return JSON.stringify(entry);
    if (typeof entry === 'number') { if (!Number.isFinite(entry)) fail('json_invalid'); return JSON.stringify(entry); }
    if (!Array.isArray(entry) && !record(entry) || ancestors.has(entry as object)) fail('json_invalid');
    const object = entry as Record<string, unknown>;
    if (Object.getOwnPropertySymbols(object).length) fail('json_invalid');
    ancestors.add(object);
    const descriptors = Object.getOwnPropertyDescriptors(object);
    let result: string;
    if (Array.isArray(entry)) {
      if (Object.keys(entry).length !== entry.length || Object.keys(entry).some((key, i) => key !== String(i))) fail('json_invalid');
      result = `[${Array.from({ length: entry.length }, (_, index) => {
        const descriptor = descriptors[String(index)]; if (!descriptor || !('value' in descriptor)) fail('json_invalid');
        return visit(descriptor.value, depth + 1);
      }).join(',')}]`;
    } else {
      const keys = Object.keys(object).sort();
      if (Object.getOwnPropertyNames(object).length !== keys.length) fail('json_invalid');
      result = `{${keys.map(key => {
        const descriptor = descriptors[key]; if (['__proto__', 'constructor', 'prototype'].includes(key) || !descriptor || !('value' in descriptor)) fail('json_invalid');
        return `${JSON.stringify(key)}:${visit(descriptor.value, depth + 1)}`;
      }).join(',')}}`;
    }
    ancestors.delete(object);
    return result;
  };
  const canonical = visit(value, 0);
  if (Buffer.byteLength(canonical, 'utf8') > 4 * 1024 * 1024) fail('json_limit_exceeded');
  return canonical;
}
export function headerJsonHash(value: unknown): string {
  return createHash('sha256').update(canonicalHeaderJson(value), 'utf8').digest('hex');
}
function validateIntent(intent: HeaderWriteIntent): void {
  if (!record(intent) || intent.version !== 1 || !record(intent.resource) || !text(intent.resource.id) || !hashPattern.test(intent.beforeHash) || !hashPattern.test(intent.afterHash) || intent.beforeHash === intent.afterHash) fail('write_intent_invalid');
  owner(intent.owner);
  const resource = intent.resource;
  if (resource.kind === 'woodmart-header' ? !headerIdPattern.test(resource.id) : resource.kind === 'default-header-pointer' ? resource.id !== 'active' : !['wordpress-menu', 'test-page'].includes(resource.kind) || !/^[1-9]\d*$/.test(resource.id)) fail('write_intent_invalid');
}
export function prepareHeaderWriteIntent(resource: HeaderWriteResource, intentOwner: HeaderOwner, before: unknown, after: unknown): HeaderWriteIntent {
  const intent: HeaderWriteIntent = { version: 1, resource: { ...resource }, owner: { ...intentOwner }, beforeHash: headerJsonHash(before), afterHash: headerJsonHash(after) };
  validateIntent(intent); return intent;
}
/** Run immediately before a serial write. This is a CAS check, not authority to
 * write: the adapter must separately establish ownership and isolation. */
export function assertHeaderWritePrecondition(intent: HeaderWriteIntent, actualBefore: unknown): void {
  validateIntent(intent);
  if (headerJsonHash(actualBefore) !== intent.beforeHash) fail('write_precondition_changed');
}
export function reconcileHeaderWrite(intent: HeaderWriteIntent, actual: unknown): HeaderWriteReconciliation {
  validateIntent(intent);
  const currentHash = headerJsonHash(actual);
  if (currentHash === intent.afterHash) return { state: 'after', currentHash, retryAllowed: false, nextAction: 'accept-readback-no-retry' };
  if (currentHash === intent.beforeHash) return { state: 'before', currentHash, retryAllowed: false, nextAction: 'recheck-preconditions' };
  return { state: 'conflict', currentHash, retryAllowed: false, nextAction: 'stop-no-retry' };
}
