import { randomUUID } from 'node:crypto';
import { headerJsonHash } from '../contract.js';
import { headerModuleElementId } from './compiler.js';
import { assertNativeHeaderMenuBindings } from './menu-binding.js';
import { compileAdaptiveHeaderModule as compileHeaderModule, adaptiveHeaderCSS, adaptiveHeaderEnvironmentCSS, splitResponsiveHeaderStyles, responsiveHeaderPageCSS } from '../../replica-responsive/header.js';
import { modulePlanHash, orderHeaderMenuItems } from './contract.js';
import { compileHeaderModuleStyles } from './styles.js';
import { withHeaderBundleLock, saveHeaderBundleState, persistHeaderIntent, type HeaderBundle, type HeaderPendingIntent } from './bundle.js';
import type { HeaderModuleDriver, HeaderRemoteSnapshot, HeaderModuleInspection } from './wordpress.js';
import { prepareHeaderMenuContentLocal,assertHeaderMenuRetirement } from './menu-content.js';
import type { ImportedAssetV2 } from '../../replica-v2/types.js';
import { compileSimpleDropdownCSS } from './simple-dropdown.js';
import { compileHeaderHoverCSS } from './hover-effects.js';

export type HeaderModuleAction = 'reserve' | 'menu' | 'menu-content' | 'style' | 'header' | 'create-page' | 'bind';
export interface HeaderModuleOperationResult {
  status: 'confirmed' | 'unchanged' | 'write-unknown' | 'conflict';
  action: string;
  operationId?: string;
  hash?: string;
  result?: unknown;
  needsVisualReview: boolean;
}
// Only an exact confirmed in-process response can feed the next provision step.
// No cross-command or serialized snapshot cache is accepted here.
const confirmedResponses=new WeakMap<HeaderModuleOperationResult,HeaderModuleInspection>();
function fail(code: string): never { throw new Error(`woodmart_header_service_${code}`); }
function hash(value: unknown): string { return headerJsonHash(value); }
function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function same(a: unknown, b: unknown): boolean { return hash(a) === hash(b); }

/** Styles travel with the header's own native HTML Block, never with a page. */
export function compileBundleStyles(bundle: HeaderBundle): string {
  const wrapper = headerModuleElementId(bundle.plan.moduleKey, 'module-styles');
  const parts=splitResponsiveHeaderStyles(bundle.plan.style.css);
  const module=(bundle.state.confirmed?.snapshot as HeaderRemoteSnapshot|undefined)?.module;
  const menus=bundle.plan.menus??[];
  const dropdownIds:Record<string,Record<string,number>>={};
  for(const menu of menus)if(menu.dropdowns?.length&&module?.menus[menu.key])dropdownIds[menu.key]=Object.fromEntries(module.menus[menu.key].items.map(item=>[item.key,item.id]));
  const dropdownCSS=module&&menus.every(menu=>!menu.dropdowns?.length||module.menus[menu.key])?compileSimpleDropdownCSS(menus,dropdownIds):'';
  const hoverCSS=compileHeaderHoverCSS(bundle.plan,key=>headerModuleElementId(bundle.plan.moduleKey,key));
  const compiled=compileHeaderModuleStyles({
    ...bundle.plan.style,
    css: `${parts.headerCSS}${bundle.plan.layout.mobile ? '\n' + adaptiveHeaderCSS(bundle.plan) : ''}\n${dropdownCSS}\n${hoverCSS}\n:header .whb-${wrapper}{display:contents}`,
  }, bundle.state.identity).css;
  const environment=adaptiveHeaderEnvironmentCSS(bundle.plan,bundle.state.identity.headerId);
  if(!parts.menuCSS)return compiled+environment;
  const pages=Object.values(module?.pages??{}),page=pages[0];
  if(!bundle.plan.layout.mobile||pages.length!==1||!module||!same(module.identity,bundle.state.identity)||!page||page.runId!==bundle.state.identity.owner.runId||page.postType!=='page'||page.template!=='elementor_header_footer'||page.headerId!==bundle.state.identity.headerId)fail('header_menu_override_owned_bound_page_required');
  return compiled+environment+responsiveHeaderPageCSS({...bundle.plan,layout:{...bundle.plan.layout,mobile:{...bundle.plan.layout.mobile,menuCSS:parts.menuCSS}}},page.pageId,bundle.state.identity.headerId);
}

function checkObservation(bundle: HeaderBundle, observation: HeaderModuleInspection): void {
  if (!/^[a-f0-9]{64}$/.test(observation.hash) || !/^[a-f0-9]{64}$/.test(observation.snapshot.globalHash)) fail('snapshot_invalid');
  if (observation.contract.targetOrigin !== bundle.plan.targetOrigin || observation.resources.targetOrigin !== bundle.plan.targetOrigin) fail('target_changed');
  if (observation.snapshot.module && !same(observation.snapshot.module.identity, bundle.state.identity)) fail('ownership_changed');
  if (observation.snapshot.defaultHeaderId === bundle.state.identity.headerId || observation.snapshot.presetReferences.length || observation.snapshot.otherReferences.length) fail('header_not_isolated');
  if (bundle.plan.menuBindingPolicy && observation.contract.menuBindingVersion !== 1) fail('menu_native_contract_required');
  if (observation.snapshot.module?.header) assertNativeHeaderMenuBindings(bundle.plan, observation.snapshot.module.header, observation.contract, observation.resources, key => headerModuleElementId(bundle.plan.moduleKey, key));
}
function checkCurrentBase(bundle: HeaderBundle, observation: HeaderModuleInspection): void {
  if (bundle.state.pending) fail('reconciliation_required');
  checkObservation(bundle, observation);
  // Changes elsewhere on the site are protected within each operation, rather
  // than freezing an unrelated menu for the lifetime of this module.
  if (bundle.state.confirmed) {
    const previous = bundle.state.confirmed.snapshot as HeaderRemoteSnapshot;
    if (!same(previous.module, observation.snapshot.module)) fail('remote_module_changed_checkpoint_required');
  }
}

function expectedMenu(bundle: HeaderBundle, payload: unknown): unknown {
  if (!record(payload)) return null;
  return orderHeaderMenuItems(payload.items, bundle.plan.targetOrigin).map(item => ({
    key: item.key, parentKey: item.parentKey, title: item.title,
    url: new URL(item.url, `${bundle.plan.targetOrigin}/`).href,
  }));
}
function menuPayload(bundle: HeaderBundle, menu: HeaderBundle['plan']['menus'][number]): unknown {
  const images = bundle.plan.menuItemMedia?.filter(binding => binding.menuKey === menu.key).map(binding => { const mediaId = bundle.mediaIds[binding.mediaKey]; if (!Number.isSafeInteger(mediaId) || mediaId < 1) fail('menu_media_unresolved'); return { itemKey: binding.itemKey, mediaId }; });
  return { key: menu.key, name: menu.name, items: orderHeaderMenuItems(menu.items, bundle.plan.targetOrigin), ...(images ? { images } : {}) };
}
function matchesDesired(bundle: HeaderBundle, pending: HeaderPendingIntent, snapshot: HeaderRemoteSnapshot): boolean {
  const module = snapshot.module, payload = pending.payload;
  if (!module || !same(module.identity, bundle.state.identity) || !record(payload)) return false;
  switch (pending.action) {
    case 'reserve': return true;
    case 'menu': {
      const menu = module.menus[String(payload.key)];
      return Boolean(menu && menu.name === payload.name && (!Array.isArray(payload.images) || menu.items.every(item => item.imageId === ((payload.images as Array<{ itemKey: string; mediaId: number }>).find(image => image.itemKey === item.key)?.mediaId ?? 0))) && same(menu.items.map(item => ({
        key: item.key, parentKey: item.parentKey, title: item.title,
        url: new URL(item.url, `${bundle.plan.targetOrigin}/`).href,
      })), expectedMenu(bundle, payload)));
    }
    case 'style': return module.style?.css === payload.css;
    case 'menu-content': {
      const content = module.menuContent?.[String(payload.key)], item = module.menus[String(payload.menuKey)]?.items.find(item => item.key === payload.itemKey);
      return Boolean(content && content.name === payload.name && content.menuKey === payload.menuKey && content.itemKey === payload.itemKey && content.programHash === payload.programHash && same(content.elements, payload.elements) && same(content.settings, payload.settings) && item?.content?.blockId === content.id && item.content.documentHash === content.documentHash && (payload.version!==2 || same(item.content.dropdown,payload.dropdown) && (!Array.isArray(payload.retireChildren)||!module.menus[String(payload.menuKey)].items.some(i=>(payload.retireChildren as string[]).includes(i.key)))));
    }
    case 'header': return same(module.header, payload.raw);
    case 'create-page': {
      const receipt = module.receipts[pending.operationId];
      const result = receipt?.result;
      const id = record(result) ? result.pageId : null;
      const page = module.pages[String(id)];
      return Boolean(page && page.status === 'draft' && page.template === 'elementor_header_footer' && page.runId === bundle.plan.owner.runId && page.headerId === null);
    }
    case 'bind': {
      const page = module.pages[String(payload.pageId)];
      return Boolean(page && page.headerId === bundle.state.identity.headerId && page.bodyHash === payload.expectedBodyHash && page.status === 'draft' && page.template === 'elementor_header_footer');
    }
    default: return false;
  }
}

/** Prove an independent edit did not also rewrite another module responsibility. */
function unchangedOutsideAction(before: HeaderRemoteSnapshot, after: HeaderRemoteSnapshot, pending: HeaderPendingIntent): boolean {
  if (before.globalHash !== after.globalHash || before.defaultHeaderId !== after.defaultHeaderId) return false;
  const a = before.module, b = after.module;
  if (!b) return false;
  if (!a) return pending.action === 'reserve' && !Object.keys(b.menus).length && !b.style && !b.header && !Object.keys(b.pages).length && !Object.keys(b.menuContent ?? {}).length;
  if (!same(a.identity, b.identity)) return false;
  if (pending.action !== 'header' && !same(a.header, b.header)) return false;
  if (pending.action !== 'style' && !same(a.style, b.style)) return false;
  if (pending.action !== 'menu-content' && !same(a.menuContent ?? null, b.menuContent ?? null)) return false;
  if (pending.action === 'menu-content') {
    const key = record(pending.payload) ? String(pending.payload.key) : '', menuKey = record(pending.payload) ? String(pending.payload.menuKey) : '', itemKey = record(pending.payload) ? String(pending.payload.itemKey) : '';
    const without = (value: typeof a.menuContent) => Object.fromEntries(Object.entries(value ?? {}).filter(([k]) => k !== key));
    if (!same(without(a.menuContent), without(b.menuContent))) return false;
    const retired=record(pending.payload)&&pending.payload.version===2&&Array.isArray(pending.payload.retireChildren)?pending.payload.retireChildren as string[]:[];
    // WordPress renumbers the returned menu_order after filtering trashed items.
    // Preserve the exact remaining sequence and fields, rather than those derived numbers.
    const menusWithoutBinding = (menus: typeof a.menus) => Object.fromEntries(Object.entries(menus).map(([k, menu]) => [k, { ...menu, items: menu.items.filter(item=>k!==menuKey||!retired.includes(item.key)).map(item => {const normalized={...item};if(k===menuKey&&retired.length)delete (normalized as Partial<typeof item>).order;if(k!==menuKey||item.key!==itemKey)return normalized;const {content:_content,...rest}=normalized;return rest;}) }]));
    if (!same(menusWithoutBinding(a.menus), menusWithoutBinding(b.menus))) return false;
  }
  if (!['menu', 'menu-content'].includes(pending.action) && !same(a.menus, b.menus)) return false;
  if (pending.action === 'menu') {
    const key = record(pending.payload) ? String(pending.payload.key) : '';
    const without = (menus: typeof a.menus) => Object.fromEntries(Object.entries(menus).filter(([k]) => k !== key));
    if (!same(without(a.menus), without(b.menus))) return false;
  }
  if (pending.action === 'create-page') {
    if (!Object.keys(a.pages).every(key => same(a.pages[key], b.pages[key]))) return false;
    if (Object.keys(b.pages).length !== Object.keys(a.pages).length + 1) return false;
  } else if (pending.action === 'bind') {
    const id = record(pending.payload) ? String(pending.payload.pageId) : '';
    if (!same(Object.keys(a.pages).sort(), Object.keys(b.pages).sort())) return false;
    if (!Object.keys(a.pages).every(key => {
      if (key !== id) return same(a.pages[key], b.pages[key]);
      const prior = a.pages[key], next = b.pages[key];
      return prior.bodyHash === next.bodyHash && prior.template === next.template && prior.runId === next.runId && prior.status === next.status;
    })) return false;
  } else if (!same(a.pages, b.pages)) return false;
  return true;
}

async function inspect(bundle: HeaderBundle, driver: HeaderModuleDriver): Promise<HeaderModuleInspection> {
  const observed = await driver.inspect(bundle.state.identity, bundle.mediaIds);
  checkObservation(bundle, observed);
  return observed;
}

function preflightNativePlan(bundle: HeaderBundle, observed: HeaderModuleInspection): void {
  // Pure compilation needs bindings even before WordPress allocates the new
  // menu/style IDs. These placeholders are used only for type/domain checking;
  // they are never persisted as resources, sent to WordPress, or called proof.
  const menus = { ...observed.resources.menus };
  bundle.plan.menus.forEach((menu, index) => {
    menus[menu.key] ??= { id: Number.MAX_SAFE_INTEGER - index, slug: `cw-validation-${hash(menu.key).slice(0, 12)}` };
  });
  compileHeaderModule(bundle.plan, bundle.state.identity.headerId, observed.contract, {
    ...observed.resources, menus,
    styleBlockId: observed.resources.styleBlockId > 0 ? observed.resources.styleBlockId : Number.MAX_SAFE_INTEGER,
  });
}

async function submit(bundle: HeaderBundle, driver: HeaderModuleDriver, before: HeaderModuleInspection, action: HeaderModuleAction, payload: unknown, publishedRevision?:import('./wordpress.js').HeaderPublishedRevision): Promise<HeaderModuleOperationResult> {
  checkCurrentBase(bundle, before);
  const pending: HeaderPendingIntent = { operationId: randomUUID(), action, payload, beforeHash: before.hash, planHash: modulePlanHash(bundle.plan), createdAt: new Date().toISOString(),...(publishedRevision?{publishedRevision}:{}) };
  const intent = await persistHeaderIntent(bundle, pending);
  await saveHeaderBundleState(bundle, { ...bundle.state, confirmed: { hash: before.hash, snapshot: before.snapshot }, pending });
  try {
    const response = await driver.mutate(bundle.state.identity, { operationId: pending.operationId, expectedHash: before.hash, action, payload,...(publishedRevision?{publishedRevision}:{}) }, {
      runId: bundle.plan.owner.runId, operationId: pending.operationId, resource: `header-module/${bundle.plan.moduleKey}`,
      expectedSnapshotSha256: before.hash, persistedIntentSha256: intent.sha256,
    });
    checkObservation(bundle, { ...before, ...response });
    const receipt = response.snapshot.module?.receipts[pending.operationId];
    if (!receipt || receipt.state !== 'complete' || receipt.action !== action || receipt.payloadHash !== hash(payload) || !matchesDesired(bundle, pending, response.snapshot) || !unchangedOutsideAction(before.snapshot, response.snapshot, pending)) fail('readback_mismatch');
    await saveHeaderBundleState(bundle, { ...bundle.state, confirmed: { hash: response.hash, snapshot: response.snapshot }, pending: null, revision: bundle.state.revision + 1 });
    const result:HeaderModuleOperationResult={ status: 'confirmed', action, operationId: pending.operationId, hash: response.hash, result: response.result, needsVisualReview: true };
    const module=response.snapshot.module!;
    confirmedResponses.set(result,{...before,...response,resources:{...before.resources,menus:Object.fromEntries(Object.entries(module.menus).map(([key,menu])=>[key,{id:menu.id,slug:menu.slug}])),styleBlockId:module.style?.id??0}});
    return result;
  } catch {
    // The pending intent remains durable, even when the write happened and only
    // the response was lost. No later mutation is allowed to bypass it.
    return { status: 'write-unknown', action, operationId: pending.operationId, needsVisualReview: true };
  }
}

export async function inspectHeaderModule(directory: string, driver: HeaderModuleDriver): Promise<HeaderModuleInspection> {
  return withHeaderBundleLock(directory, bundle => inspect(bundle, driver));
}

/** Each confirmed step is durable; partial/unknown creation never starts again. */
export async function provisionHeaderModule(directory: string, driver: HeaderModuleDriver, imported?: ImportedAssetV2[]): Promise<HeaderModuleOperationResult[]> {
  return withHeaderBundleLock(directory, async bundle => {
    compileBundleStyles(bundle); // Pure validation before any remote allocation.
    if (bundle.plan.menuContent) await prepareHeaderMenuContentLocal(bundle.plan.menuContent);
    let observed = await inspect(bundle, driver); checkCurrentBase(bundle, observed);
    preflightNativePlan(bundle, observed);
    bundle.plan.menus.forEach(menu => menuPayload(bundle, menu));
    const content = bundle.plan.menuContent ? await (driver.prepareMenuContent ? driver.prepareMenuContent(bundle.state.identity, bundle.plan.menuContent, bundle.directory, imported) : Promise.reject(Error('woodmart_header_service_menu_content_adapter_required'))) : [];
    const results: HeaderModuleOperationResult[] = [];
    const step = async (action: HeaderModuleAction, payload: unknown): Promise<boolean> => {
      const result = await submit(bundle, driver, observed, action, payload); results.push(result);
      if (result.status !== 'confirmed') return false;
      const confirmed=confirmedResponses.get(result);if(!confirmed)fail('confirmed_response_snapshot_missing');confirmedResponses.delete(result);
      observed=confirmed;checkCurrentBase(bundle, observed);return true;
    };
    if (!observed.snapshot.module && !await step('reserve', { name: bundle.plan.name, ...(content.length ? { menuContent: true } : {}) })) return results;
    for (const menu of bundle.plan.menus) {
      const prior = observed.snapshot.module!.menus[menu.key];
      if (!prior) { if (!await step('menu', menuPayload(bundle, menu))) return results; }
      else if (!matchesDesired(bundle, { operationId: '', action: 'menu', payload: menuPayload(bundle, menu), beforeHash: observed.hash, planHash: modulePlanHash(bundle.plan), createdAt: '' }, observed.snapshot)) fail('existing_menu_differs_use_update');
    }
    for (const payload of content) {
      const prior = observed.snapshot.module!.menuContent?.[payload.key];
      if (!prior) { if (!await step('menu-content', payload)) return results; }
      else if (!matchesDesired(bundle, { operationId: '', action: 'menu-content', payload, beforeHash: observed.hash, planHash: modulePlanHash(bundle.plan), createdAt: '' }, observed.snapshot)) fail('existing_menu_content_differs_use_update');
    }
    const css = compileBundleStyles(bundle);
    if (!observed.snapshot.module!.style) { if (!await step('style', { css })) return results; }
    else if (observed.snapshot.module!.style.css !== css) fail('existing_style_differs_use_update');
    const raw = compileHeaderModule(bundle.plan, bundle.state.identity.headerId, observed.contract, observed.resources);
    if (!observed.snapshot.module!.header) await step('header', { raw });
    else if (!same(observed.snapshot.module!.header, raw)) fail('existing_header_differs_use_update');
    if (!results.length) results.push({ status: 'unchanged', action: 'provision', hash: observed.hash, needsVisualReview: true });
    return results;
  });
}

export async function updateHeaderModule(directory: string, driver: HeaderModuleDriver, part: 'header' | 'style' | 'menu' | 'menu-content', menuKey?: string, publishedPageId?:number): Promise<HeaderModuleOperationResult> {
  return withHeaderBundleLock(directory, async bundle => {
    const contentPlan = part === 'menu-content' ? bundle.plan.menuContent?.find(item => item.key === menuKey) : undefined;
    if (part === 'menu-content') { if (!contentPlan || !driver.prepareMenuContent) fail('menu_content_adapter_required'); await prepareHeaderMenuContentLocal([contentPlan]); }
    const observed = await inspect(bundle, driver); checkCurrentBase(bundle, observed);
    if (!observed.snapshot.module?.header) fail('module_not_provisioned');
    const page=publishedPageId===undefined?undefined:observed.snapshot.module.pages[String(publishedPageId)];
    if(publishedPageId!==undefined&&(!page||page.status!=='publish'||page.runId!==bundle.plan.owner.runId||page.headerId!==bundle.state.identity.headerId))fail('published_revision_owned_bound_page_required');
    const publishedRevision=page?{pageId:page.pageId,bodyHash:page.bodyHash,snapshotHash:page.snapshotHash}:undefined;
    let payload: unknown;
    if (part === 'header') payload = { raw: compileHeaderModule(bundle.plan, bundle.state.identity.headerId, observed.contract, observed.resources) };
    else if (part === 'style') payload = { css: compileBundleStyles(bundle) };
    else if (part === 'menu-content') payload = (await driver.prepareMenuContent!(bundle.state.identity, [contentPlan!], bundle.directory))[0];
    else {
      const menu = bundle.plan.menus.find(item => item.key === menuKey); if (!menu) fail('menu_key_missing');
      payload = menuPayload(bundle, menu);
    }
    const pending = { operationId: '', action: part, payload, beforeHash: observed.hash, planHash: modulePlanHash(bundle.plan), createdAt: '' };
    if (matchesDesired(bundle, pending, observed.snapshot)) return { status: 'unchanged', action: part, hash: observed.hash, needsVisualReview: true };
    if(part==='menu-content'&&record(payload)&&payload.version===2)assertHeaderMenuRetirement(observed.snapshot.module.menus[String(payload.menuKey)].items,String(payload.itemKey),(payload.retireChildren??[]) as string[]);
    return submit(bundle, driver, observed, part, payload,publishedRevision);
  });
}

export async function createHeaderModulePage(directory: string, driver: HeaderModuleDriver, input: { title: string; slug: string }): Promise<HeaderModuleOperationResult> {
  if (!input.title.trim() || input.title.length > 200 || !/^[a-z0-9][a-z0-9-]{0,119}$/.test(input.slug)) fail('page_input_invalid');
  return withHeaderBundleLock(directory, async bundle => {
    const observed = await inspect(bundle, driver); checkCurrentBase(bundle, observed);
    if (!observed.snapshot.module?.header) fail('module_not_provisioned');
    return submit(bundle, driver, observed, 'create-page', input);
  });
}

export async function bindHeaderModulePage(directory: string, driver: HeaderModuleDriver, pageId: number): Promise<HeaderModuleOperationResult> {
  if (!Number.isSafeInteger(pageId) || pageId < 1) fail('page_id_invalid');
  return withHeaderBundleLock(directory, async bundle => {
    const observed = await inspect(bundle, driver); checkCurrentBase(bundle, observed);
    const page = observed.snapshot.module?.pages[String(pageId)];
    if (!page || page.status !== 'draft' || page.template !== 'elementor_header_footer' || page.runId !== bundle.plan.owner.runId || page.headerId && page.headerId !== bundle.state.identity.headerId) fail('owned_full_width_draft_required');
    if (page.headerId === bundle.state.identity.headerId) return { status: 'unchanged', action: 'bind', hash: observed.hash, needsVisualReview: true };
    return submit(bundle, driver, observed, 'bind', { pageId, expectedBodyHash: page.bodyHash });
  });
}

export async function reconcileHeaderModule(directory: string, driver: HeaderModuleDriver): Promise<HeaderModuleOperationResult> {
  return withHeaderBundleLock(directory, async bundle => {
    const pending = bundle.state.pending; if (!pending) fail('no_pending_intent');
    const observed = await inspect(bundle, driver), receipt = observed.snapshot.module?.receipts[pending.operationId];
    const before = bundle.state.confirmed?.snapshot as HeaderRemoteSnapshot | undefined;
    if (receipt?.state === 'complete' && receipt.action === pending.action && receipt.payloadHash === hash(pending.payload) && matchesDesired(bundle, pending, observed.snapshot) && before && unchangedOutsideAction(before, observed.snapshot, pending)) {
      await saveHeaderBundleState(bundle, { ...bundle.state, pending: null, confirmed: { hash: observed.hash, snapshot: observed.snapshot }, revision: bundle.state.revision + 1 });
      return { status: 'confirmed', action: pending.action, operationId: pending.operationId, hash: observed.hash, result: receipt.result, needsVisualReview: true };
    }
    if (observed.hash === pending.beforeHash) {
      // Before-state is confirmed, but this never resends the old operation.
      await saveHeaderBundleState(bundle, { ...bundle.state, pending: null, confirmed: { hash: observed.hash, snapshot: observed.snapshot } });
      return { status: 'unchanged', action: pending.action, hash: observed.hash, needsVisualReview: true };
    }
    return { status: 'conflict', action: pending.action, operationId: pending.operationId, hash: observed.hash, needsVisualReview: true };
  });
}

/** An explicit local checkpoint accepts reviewed manual edits; it writes no WP. */
export async function checkpointHeaderModule(directory: string, driver: HeaderModuleDriver, expectedHash: string): Promise<{ hash: string; remoteWrites: 0 }> {
  if (!/^[a-f0-9]{64}$/.test(expectedHash)) fail('checkpoint_hash_invalid');
  return withHeaderBundleLock(directory, async bundle => {
    if (bundle.state.pending) fail('reconciliation_required');
    const observed = await inspect(bundle, driver);
    if (observed.hash !== expectedHash || !observed.snapshot.module) fail('checkpoint_changed');
    await saveHeaderBundleState(bundle, { ...bundle.state, confirmed: { hash: observed.hash, snapshot: observed.snapshot } });
    return { hash: observed.hash, remoteWrites: 0 };
  });
}
