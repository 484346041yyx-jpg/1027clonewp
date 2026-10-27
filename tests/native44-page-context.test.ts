import test from 'node:test';
import assert from 'node:assert/strict';
import { NATIVE44_ALL_TYPES, assertAllowedWidget } from '../src/native44/catalog.js';
import { NATIVE44_PAGE_CONTEXT_RULES, native44ContainerAdvice, native44ContextResponsibilityAdvice, native44PageContextAdvice, type Native44ContextResponsibility, type Native44PageRole } from '../src/native44/page-context.js';

test('page context knowledge recommends only the frozen44 and keeps all peripheral widgets reference-only',()=>{
  const before=[...NATIVE44_ALL_TYPES];
  for(const role of Object.keys(NATIVE44_PAGE_CONTEXT_RULES.responsibilities) as Native44ContextResponsibility[]){
    const advice=native44ContextResponsibilityAdvice(role);advice.candidates.forEach(type=>assert.doesNotThrow(()=>assertAllowedWidget(type)));
    for(const type of advice.referenceOnlyWidgets)assert.throws(()=>assertAllowedWidget(type),/not_allowed/);
    if(advice.status==='capability-gap')assert.deepEqual(advice.candidates,[]);
    assert.ok(advice.requiredEvidence.length);assert.ok(advice.restrictions.length);
  }
  assert.deepEqual(NATIVE44_ALL_TYPES,before);assert.equal(NATIVE44_ALL_TYPES.length,44);assert.equal(NATIVE44_PAGE_CONTEXT_RULES.outside44Policy,'reference-only-never-discover-compile-or-write');
});

test('archive advice distinguishes dynamic results, filters and toolbars from fixed marketing queries',()=>{
  const archive=native44PageContextAdvice('archive');assert.equal(archive.supportsArchiveTemplate,false);assert.equal(archive.writeBoundary,'owned-draft-page-only');
  for(const role of ['archive-results','archive-filters','archive-toolbar'] as const){const advice=archive.responsibilities.find(item=>item.role===role)!;assert.equal(advice.status,'capability-gap');assert.deepEqual(advice.candidates,[]);assert.ok(advice.dependencies.includes('current-archive-query'));}
  const fixed=native44ContextResponsibilityAdvice('marketing-products');assert.deepEqual(fixed.candidates,['wd_products','woocommerce-products']);assert.equal(fixed.status,'context-dependent');assert.match(fixed.restrictions.join(' '),/固定 ID.*不证明/);
  const sidebar=native44ContextResponsibilityAdvice('existing-sidebar');assert.deepEqual(sidebar.candidates,['wd_sidebar']);assert.match(sidebar.restrictions.join(' '),/侧栏存在不证明/);
});

test('single product advice cannot substitute static widgets, product collection tabs or list services for dynamic product roles',()=>{
  const detail=native44PageContextAdvice('single-product');assert.equal(detail.supportsSingleProductTemplate,false);assert.match(detail.limits.join(' '),/普通草稿不能冒充单品模板/);
  const price=native44ContextResponsibilityAdvice('single-product-price');assert.equal(price.status,'capability-gap');assert.match(price.restrictions.join(' '),/禁止.*静态补价格/);
  assert.deepEqual(native44ContextResponsibilityAdvice('single-product-purchase').candidates,[]);assert.ok(native44ContextResponsibilityAdvice('single-product-purchase').prohibitedSubstitutes?.includes('button'));
  const tabs=native44ContextResponsibilityAdvice('single-product-tabs');assert.ok(tabs.prohibitedSubstitutes?.includes('wd_products_tabs'));assert.match(tabs.restrictions.join(' '),/商品集合查询/);
  assert.deepEqual(native44ContextResponsibilityAdvice('product-collection-tabs').candidates,['wd_products_tabs']);assert.deepEqual(native44ContextResponsibilityAdvice('static-content-tabs').candidates,['nested-tabs']);
  assert.ok(native44ContextResponsibilityAdvice('single-product-compare-action').prohibitedSubstitutes?.includes('wd_compare'));assert.deepEqual(native44ContextResponsibilityAdvice('compare-content').candidates,['wd_compare']);
  assert.ok(native44ContextResponsibilityAdvice('single-product-wishlist-action').prohibitedSubstitutes?.includes('wd_wishlist'));assert.deepEqual(native44ContextResponsibilityAdvice('wishlist-content').candidates,['wd_wishlist']);
});

test('role guidance requires observed ownership and context, never URL, brand, record ID or template-name inference',()=>{
  const advice=native44PageContextAdvice('unresolved');assert.deepEqual(advice.responsibilities,[]);assert.match(advice.limits.join(' '),/不能凭 URL.*商品 ID.*猜/);
  assert.deepEqual(NATIVE44_PAGE_CONTEXT_RULES.roleIdentification,['actual-source-ownership','observed-query-context','current-record-context']);
  assert.throws(()=>native44PageContextAdvice('https://example.test/product/a/' as Native44PageRole),/Unknown.*page role/);
  assert.throws(()=>native44ContextResponsibilityAdvice('wd_single_product_price' as Native44ContextResponsibility),/Unknown.*responsibility/);
  const serialized=JSON.stringify(NATIVE44_PAGE_CONTEXT_RULES);assert.doesNotMatch(serialized,/https?:\/\/|10146|776|308|primevapeoutlet|petsupermarket/i);
});

test('page context advice copies do not mutate reusable selection knowledge or grant write capabilities',()=>{
  const first=native44ContextResponsibilityAdvice('navigation-list') as unknown as {candidates:string[];requiredEvidence:string[]};first.candidates.push('button');first.requiredEvidence.splice(0);const next=native44ContextResponsibilityAdvice('navigation-list');assert.deepEqual(next.candidates,['wd_list','wd_extra_menu_list']);assert.ok(next.requiredEvidence.length);
  for(const role of ['landing','archive','single-product','unresolved'] as const){const advice=native44PageContextAdvice(role);assert.equal(advice.supportsArchiveTemplate,false);assert.equal(advice.supportsSingleProductTemplate,false);assert.equal(advice.writeBoundary,'owned-draft-page-only');}
});

test('container guidance retains real responsibilities and nested contracts while rejecting leaf and DOM layer heuristics',()=>{
  for(const purpose of NATIVE44_PAGE_CONTEXT_RULES.containers.retainFor)assert.equal(native44ContainerAdvice({purpose,evidence:['Actual layout or registered contract evidence']}).decision,'retain');
  assert.equal(native44ContainerAdvice({purpose:'registered-nested-child-contract',evidence:['Actual fixed count proof'],duplicatesParent:true}).decision,'retain');
  assert.equal(native44ContainerAdvice({runtimeDomWrapperOnly:true,purpose:'visual-module-ownership',evidence:['Widget internal wrapper']}).decision,'not-an-elementor-container');
  assert.equal(native44ContainerAdvice({duplicatesParent:true}).decision,'review-redundant-plan-wrapper');assert.equal(native44ContainerAdvice({}).decision,'needs-evidence');assert.equal(native44ContainerAdvice({purpose:'centered-max-width',evidence:[]}).decision,'needs-evidence');
  assert.ok(NATIVE44_PAGE_CONTEXT_RULES.containers.forbiddenHeuristics.includes('one-container-per-leaf'));assert.ok(NATIVE44_PAGE_CONTEXT_RULES.containers.forbiddenHeuristics.includes('delete-by-depth-or-layer-count'));
});
