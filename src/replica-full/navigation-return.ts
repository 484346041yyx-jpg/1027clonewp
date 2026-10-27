import { canonicalV2 } from '../replica-v2/journal.js';
import { native44Id } from '../native44/adapters.js';
import type { ElementorElement } from '../wordpress/types.js';
import type { FullReplicaRemoteSnapshot } from './driver.js';
import { compileNavigationFormHtml, navigationFormWidgetId, parseNavigationForms, type NavigationFormSpec } from './navigation-form/index.js';

/** Exact prior suffix accepted only for a guarded, explicit owned-form revision. */
export const NAVIGATION_RETURN_V1_RUNTIME = '<script data-clonewp-navigation-return="v1">(()=>{if(window.__clonewpNavigationReturnV1)return;window.__clonewpNavigationReturnV1=true;window.addEventListener("pageshow",event=>{if(event.persisted)window.location.reload();});})();</script>';
export const NAVIGATION_RETURN_RUNTIME = '<script data-clonewp-navigation-return="v2">(()=>{const marker=document.currentScript;const mark=(name,value)=>marker?.setAttribute("data-"+name,String(value));const navigationType=()=>window.performance?.getEntriesByType?.("navigation")?.[0]?.type||"unknown";mark("executed",true);mark("pageshow-persisted","unobserved");mark("navigation-type",navigationType());if(window.__clonewpNavigationReturnV2)return;window.__clonewpNavigationReturnV2=true;let requested=false;const reload=()=>{if(requested)return;requested=true;mark("reload-requested",true);window.location.reload();};window.addEventListener("pageshow",event=>{const type=navigationType();mark("pageshow-persisted",event.persisted===true);mark("navigation-type",type);if(event.persisted===true||type==="back_forward")reload();});if(document.readyState==="complete"&&navigationType()==="back_forward")reload();})();</script>';
export const NAVIGATION_RETURN_VERSION = 'history-return-reload-v2';
function fail(code: string): never { throw Error(`replica_full_navigation_return_${code}`); }
const same = (a: unknown, b: unknown) => canonicalV2(a) === canonicalV2(b);
export interface NavigationReturnPatch { elements: ElementorElement[]; widgetIds: string[]; changedWidgetIds: string[] }
/** Append only the trusted fixed return handler to each existing, exact typed form widget. */
export function compileNavigationReturnPatch(input: ElementorElement[], forms: NavigationFormSpec[], sourceUrl: string, taskId: string): NavigationReturnPatch {
  const specs = parseNavigationForms(forms, sourceUrl), elements = structuredClone(input), widgetIds = specs.map(form => navigationFormWidgetId(taskId, form));
  const expected = new Map(specs.map(form => [navigationFormWidgetId(taskId, form), { slot: native44Id(taskId, form.slotComponentKey), html: compileNavigationFormHtml(form, sourceUrl, taskId) }])), ids = new Set<string>(), found = new Set<string>(), changed = new Set<string>();
  const visit = (nodes: ElementorElement[], parent?: ElementorElement): void => {
    if (!Array.isArray(nodes)) fail('tree');
    for (const node of nodes) {
      if (!node || typeof node !== 'object' || typeof node.id !== 'string' || ids.has(node.id) || !Array.isArray(node.elements) || !node.settings || typeof node.settings !== 'object' || Array.isArray(node.settings)) fail('tree'); ids.add(node.id);
      const form = expected.get(node.id);
      if (form) {
        if (node.elType !== 'widget' || node.widgetType !== 'html' || node.elements.length || parent?.elType !== 'container' || parent.id !== form.slot) fail('form_owner');
        if (node.settings.html === form.html || node.settings.html === form.html + NAVIGATION_RETURN_V1_RUNTIME) { node.settings.html = form.html + NAVIGATION_RETURN_RUNTIME; changed.add(node.id); }
        else if (node.settings.html !== form.html + NAVIGATION_RETURN_RUNTIME) fail('form_changed');
        found.add(node.id);
      }
      visit(node.elements, node);
    }
  };
  visit(elements); if (found.size !== widgetIds.length) fail('form_missing');
  return { elements, widgetIds, changedWidgetIds: widgetIds.filter(id => changed.has(id)) };
}
export function assertNavigationReturnBoundary(before: FullReplicaRemoteSnapshot, after: FullReplicaRemoteSnapshot, patch: NavigationReturnPatch, forms: NavigationFormSpec[], sourceUrl: string, taskId: string): void {
  const a = before.page, b = after.page, identity = before.header.snapshot.module?.identity;
  if (!a || !b || !identity || a.status !== 'draft' || b.status !== 'draft' || a.runId !== identity.owner.runId || a.headerId !== null && a.headerId !== identity.headerId) fail('owned_draft');
  const { elements: _a, bodyHash: _b, ...priorPage } = a, { elements: _c, bodyHash: _d, ...nextPage } = b;
  if (!same(priorPage, nextPage) || !same(b.elements, patch.elements) || !same(compileNavigationReturnPatch(a.elements, forms, sourceUrl, taskId), patch) || !same(before.header.contract, after.header.contract) || !same(before.header.resources, after.header.resources)) fail('page_boundary');
  const prior = structuredClone(before.header.snapshot), next = structuredClone(after.header.snapshot), p = prior.module?.pages[String(a.pageId)], q = next.module?.pages[String(a.pageId)];
  if (!p || !q) fail('native_page'); p.bodyHash = q.bodyHash; p.snapshotHash = q.snapshotHash;
  if (!same(prior, next)) fail('header_boundary');
}

/** Pure trusted PHP compiler; the enclosing full adapter owns all mutation protection. */
export const navigationReturnPhpHelpers = `
$navigationReturnPatch=static function($elements,$forms,$sourceUrl,$taskId)use($navigationFormPatch){
  $bad=static function($code){throw new RuntimeException('full_navigation_return_'.$code);};$runtime=base64_decode('${Buffer.from(NAVIGATION_RETURN_RUNTIME).toString('base64')}');$legacyRuntime=base64_decode('${Buffer.from(NAVIGATION_RETURN_V1_RUNTIME).toString('base64')}');
  $slots=[];foreach($forms as $form)$slots[]=['id'=>substr(hash('sha256','clonewp-native44:'.$taskId.':'.$form['slotComponentKey']),0,7),'elType'=>'container','settings'=>[],'elements'=>[]];
  $compiled=$navigationFormPatch($slots,$forms,$sourceUrl,$taskId);$expected=[];
  foreach($compiled['elements'] as $slot){$widget=$slot['elements'][0];$expected[$widget['id']]=['slot'=>$slot['id'],'html'=>$widget['settings']['html']];}
  $seen=[];$found=[];$changed=[];
  $visit=function($nodes,$parent=null)use(&$visit,&$seen,&$found,&$changed,$expected,$runtime,$legacyRuntime,$bad){if(!is_array($nodes)||!array_is_list($nodes))$bad('tree');foreach($nodes as &$node){if(!is_array($node)||!is_string($node['id']??null)||isset($seen[$node['id']])||!is_array($node['settings']??null)||!is_array($node['elements']??null)||!array_is_list($node['elements']))$bad('tree');$id=$node['id'];$seen[$id]=true;if(isset($expected[$id])){$form=$expected[$id];if(($node['elType']??null)!=='widget'||($node['widgetType']??null)!=='html'||$node['elements']||($parent['elType']??null)!=='container'||($parent['id']??null)!==$form['slot'])$bad('form_owner');if(($node['settings']['html']??null)===$form['html']||($node['settings']['html']??null)===$form['html'].$legacyRuntime){$node['settings']['html']=$form['html'].$runtime;$changed[$id]=true;}elseif(($node['settings']['html']??null)!==$form['html'].$runtime)$bad('form_changed');$found[$id]=true;}$node['elements']=$visit($node['elements'],['id'=>$id,'elType'=>$node['elType']??null]);}unset($node);return $nodes;};
  $elements=$visit($elements);if(count($found)!==count($compiled['widgetIds']))$bad('form_missing');$changedIds=[];foreach($compiled['widgetIds'] as $id)if(isset($changed[$id]))$changedIds[]=$id;
  return ['elements'=>$elements,'widgetIds'=>$compiled['widgetIds'],'changedWidgetIds'=>$changedIds];
};
`;
