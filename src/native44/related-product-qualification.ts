import { createHash } from 'node:crypto';
import { z } from 'zod';
import { normalizeImportedControl } from '../../tools/import-native44-knowledge.js';
import type { Native44ComponentKnowledge, Native44Condition, Native44Control } from './knowledge.js';
import { NATIVE_RELATED_PRODUCT_CLASS, NATIVE_RELATED_PRODUCT_TYPE } from './related-product-extension.js';
import { nativeProductRequestPHP } from '../wordpress/native-product-request.js';

const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const record = (value: unknown): value is Record<string, any> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
function condition(raw: unknown): Native44Condition | null {
  if (!record(raw) || !Object.keys(raw).length) return null;
  const aliases: Record<string, string> = { '==': 'equals', '===': 'equals', '!=': 'not-equals', '!==': 'not-equals', in: 'in', '!in': 'not-in', contains: 'contains', '!contains': 'not-contains', '>': 'greater-than', '>=': 'greater-than-or-equal', '<': 'less-than', '<=': 'less-than-or-equal' };
  if (Array.isArray(raw.terms)) return { type: 'group', operator: raw.relation === 'or' ? 'or' : 'and', terms: raw.terms.map((term: any) => {
    if (term.terms) return condition(term)!;
    if (typeof term.name !== 'string' || !aliases[term.operator ?? '==']) throw Error('related_knowledge_condition_unverified');
    return { type: 'predicate', field: term.name, operator: aliases[term.operator ?? '=='], value: term.value, scope: 'component' };
  }) };
  return { type: 'group', operator: 'and', terms: Object.entries(raw).map(([field, value]) => ({ type: 'predicate', field: field.endsWith('!') ? field.slice(0, -1) : field, operator: Array.isArray(value) ? field.endsWith('!') ? 'not-in' : 'in' : field.endsWith('!') ? 'not-equals' : 'equals', value, scope: 'component' })) };
}

/** Current registration is source knowledge, not saved/rendered qualification. */
export function relatedProductKnowledgeFromRegistration(registration: unknown): Native44ComponentKnowledge {
  if (!record(registration)) throw Error('related_knowledge_registration_missing');
  const row = registration.widgets?.find((w: any) => w.name === NATIVE_RELATED_PRODUCT_TYPE && w.class === NATIVE_RELATED_PRODUCT_CLASS), source = registration.sources?.[NATIVE_RELATED_PRODUCT_TYPE];
  if (!row || typeof source?.source !== 'string' || !source.file?.endsWith('/elementor-pro/modules/woocommerce/widgets/product-related.php') || !record(source.controls)) throw Error('related_knowledge_registration_identity');
  const sourceSha256 = sha(source.source), registrationSha256 = sha(JSON.stringify(registration));
  const controls: Native44Control[] = Object.entries(source.controls).map(([id, c]) => {
    if (!record(c) || typeof c.type !== 'string') throw Error(`related_knowledge_control_missing: ${id}`);
    const simple = condition(c.condition), compound = condition(c.conditions), terms = [simple, compound].filter(Boolean) as Native44Condition[];
    const options = record(c.options) ? Object.entries(c.options).map(([value, label]) => ({ value, label: typeof label === 'string' ? label : record(label) && typeof label.title === 'string' ? label.title : value })) : [];
    const selectors = record(c.selectors) ? c.selectors : null;
    return normalizeImportedControl({ id, scope: 'component', type: c.type, label: typeof c.label === 'string' ? c.label : null, panel: { tab: c.tab, section: c.section }, valueDomain: { type: c.type, options, ...(c.min !== undefined ? { min: c.min } : {}), ...(c.max !== undefined ? { max: c.max } : {}), ...(c.step !== undefined ? { step: c.step } : {}), ...(c.range ? { range: c.range } : {}), ...(Array.isArray(c.size_units) ? { size_units: c.size_units } : {}) }, ...(Object.hasOwn(c, 'default') ? { defaultValue: c.default } : {}), responsive: Boolean(c.is_responsive), responsiveDefaults: {}, devices: [], condition: terms.length === 2 ? { type: 'group', operator: 'and', terms } : terms[0] ?? null, effectTargets: { selectors, selectorsDictionary: c.selectors_dictionary ?? null, prefixClass: c.prefix_class ?? null, frontendAvailable: c.frontend_available ?? null, renderType: c.render_type ?? null }, jsonPath: `settings.${id}`, effectClass: selectors ? 'selector-css' : c.prefix_class !== undefined ? 'direct-class' : 'save-normalized', sourceEvidence: { packageId: 'elementor-pro', entry: source.file, sourceSha256, match: 'current-registered-stack', ownership: 'Widget own and inherited Products_Base/common controls; no invented direct declaration ownership' }, runtimeEvidence: { source: 'actual-target-widget-registration', registrationSha256 }, savePolicy: 'runtime-save-readback-required', repeater: null }, new Set<string>());
  });
  for (const id of ['posts_per_page', 'columns', 'orderby', 'order']) if (!controls.some(c => c.id === id)) throw Error('related_knowledge_query_controls_missing');
  return {
    componentType: NATIVE_RELATED_PRODUCT_TYPE, title: 'Product Related', controls,
    semanticSlots: { count: ['posts_per_page'], layout: ['columns', 'columns_tablet', 'columns_mobile'], ordering: ['orderby', 'order'] },
    usage: { suitableFor: ['Current product native WooCommerce related products'], unsuitableFor: ['Static source product IDs', 'Ordinary page without native product request'], contentModel: 'resource-query', primaryContentFields: [], repeaterKeys: [], resourceDependencies: ['current-product', 'native-related-products'], panelEditing: 'Actual Elementor Pro controls', pageCss: 'Task-scoped layout only; native product data remains dynamic', interactionRequirements: ['Two real product requests', 'Actual theme carousel behavior when selected by native template'], restrictions: ['Separate additive qualification required; registration does not authorize generation', 'No include/product_id/query override or global display conditions'] },
    sourceOwnership: { widgetClass: NATIVE_RELATED_PRODUCT_CLASS, sourceSha256, registrationSha256, inheritedControlsIncluded: true },
    renderModel: { owner: 'current-woocommerce-related-products', calls: ['wc_get_related_products', 'wc_get_template(single-product/related.php)'], themeTemplateDeterminesCarousel: true },
    runtimeAssets: { native: true, ownership: 'Elementor Pro widget plus active WooCommerce theme template' }, runtimeIdentity: { widgetType: NATIVE_RELATED_PRODUCT_TYPE, widgetClass: NATIVE_RELATED_PRODUCT_CLASS, sourceSha256 },
    modes: controls.filter(c => c.valueDomain?.options?.length).map(c => ({ controlId: c.id, values: c.valueDomain!.options!.map(o => o.value) })),
    evidence: { sourceStudied: true, targetRegistered: false, usageVerified: 'source-only', resourceBlocked: ['qualification-pending'], historicalEnvironmentFingerprint: registrationSha256, historicalCore: 'not-applicable-new-component', targetCore: 'current-registration', effectRecordCount: 0, interactionAttempts: 0, interactionChanged: 0, runtimeRetestRequired: ['Native save/readback', 'Two current-product request renders', 'Actual carousel and desktop/phone screenshots'], records: [] },
  };
}

export const RELATED_QUALIFICATION_RUN_ID = 'huaqi-product-layout-jiangubottle-20261028-related-qualification';
export const RELATED_QUALIFICATION_V2_RUN_ID = 'huaqi-product-layout-jiangubottle-20261028-related-qualification-v2';
export const RELATED_CACHE_INVALIDATION_SOURCE_SHA256 = 'dcd328c52e46c0b0d6fcdf2ab79b66a639cf27840171df0d76a781816510f118';
const identitySchema = z.object({
  targetOrigin: z.literal('https://jiangubottle.com'), pageId: z.number().int().positive(),
  runId: z.enum([RELATED_QUALIFICATION_RUN_ID, RELATED_QUALIFICATION_V2_RUN_ID]), productId: z.number().int().positive(),
  sourceSha256: z.string().regex(/^[a-f0-9]{64}$/), templateSha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export type RelatedQualificationIdentity = z.infer<typeof identitySchema>;

/** Fixed qualification tree, not an alternate arbitrary production writer. */
export function relatedQualificationElements() {
  return [{ id: '9b0d001', elType: 'container', settings: { content_width: 'full' }, elements: [
    { id: '9b0d002', elType: 'widget', widgetType: 'wd_single_product_title', settings: {}, elements: [] },
    { id: '9b0d003', elType: 'widget', widgetType: NATIVE_RELATED_PRODUCT_TYPE, settings: { posts_per_page: 6, columns: 3, columns_tablet: 3, columns_mobile: 2, orderby: 'date', order: 'desc', show_heading: 'yes' }, elements: [] },
  ] }];
}
function qualificationPHP(identityInput: RelatedQualificationIdentity, action: 'inspect' | 'save', expectedHash?: string, operationId?: string, intentSha256?: string): string {
  const identity = identitySchema.parse(identityInput);
  const v2 = identity.runId === RELATED_QUALIFICATION_V2_RUN_ID;
  const v2Protection = `
$proofFound=false;foreach(($GLOBALS['wp_filter']['save_post_woodmart_layout']->callbacks??[])as$callbacks)foreach($callbacks as$callback){$f=$callback['function'];if(is_array($f)&&is_object($f[0])&&get_class($f[0])==='XTS\\Modules\\Parts_Css_Files'&&$f[1]==='delete_all_meta'){$r=new ReflectionMethod($f[0],$f[1]);$lines=file($r->getFileName());$methodSource=implode('',array_slice($lines,$r->getStartLine()-1,$r->getEndLine()-$r->getStartLine()+1));if(hash('sha256',$methodSource)!=='${RELATED_CACHE_INVALIDATION_SOURCE_SHA256}')throw new RuntimeException('related_cache_invalidation_source_changed');$proofFound=true;}}
if(!$proofFound)throw new RuntimeException('related_cache_invalidation_hook_missing');
$cacheProof=['class'=>'XTS\\Modules\\Parts_Css_Files','method'=>'delete_all_meta','hook'=>'save_post_woodmart_layout','sourceSha256'=>'${RELATED_CACHE_INVALIDATION_SOURCE_SHA256}','excludedDerivedMetaKeys'=>['wd_page_css_files','wd_page_css_files_mobile'],'scope'=>'Derived cache only; all business rows remain protected'];
$protectionParts=static function()use($i){global $wpdb;$parts=[];$digest=static fn($v)=>hash('sha256',serialize($v));
foreach(['wd_layouts_conditions','active_plugins','stylesheet','template','xts-woodmart-options','woodmart_options']as$key){$parts['option:'.$key]=$digest($wpdb->get_results($wpdb->prepare("SELECT option_name,option_value,autoload FROM {$wpdb->options} WHERE option_name=%s ORDER BY option_name",$key),ARRAY_A));}
$meta=static function($ids)use($wpdb){if(!$ids)return[];$list=implode(',',array_map('intval',$ids));return $wpdb->get_results("SELECT meta_id,post_id,meta_key,meta_value FROM {$wpdb->postmeta} WHERE post_id IN ($list) AND meta_key NOT IN ('wd_page_css_files','wd_page_css_files_mobile') ORDER BY meta_id",ARRAY_A);};
foreach([910,911]as$menu){$relations=$wpdb->get_results($wpdb->prepare("SELECT tr.object_id,tr.term_taxonomy_id,tr.term_order FROM {$wpdb->term_relationships} tr INNER JOIN {$wpdb->term_taxonomy} tt ON tr.term_taxonomy_id=tt.term_taxonomy_id WHERE tt.taxonomy='nav_menu' AND tt.term_id=%d ORDER BY tr.object_id,tr.term_taxonomy_id",$menu),ARRAY_A);$ids=array_map(static fn($r)=>(int)$r['object_id'],$relations);$list=$ids?implode(',',$ids):'0';$parts['menu:'.$menu.':relations']=$digest($relations);$parts['menu:'.$menu.':posts']=$digest($wpdb->get_results("SELECT * FROM {$wpdb->posts} WHERE ID IN ($list) ORDER BY ID",ARRAY_A));$parts['menu:'.$menu.':meta']=$digest($meta($ids));$parts['menu:'.$menu.':term']=$digest($wpdb->get_results($wpdb->prepare("SELECT t.*,tt.taxonomy,tt.description,tt.parent,tt.count FROM {$wpdb->terms} t INNER JOIN {$wpdb->term_taxonomy} tt ON t.term_id=tt.term_id WHERE t.term_id=%d AND tt.taxonomy='nav_menu' ORDER BY tt.term_taxonomy_id",$menu),ARRAY_A));}
$pid=(int)$i['productId'];$parts['product:post']=$digest($wpdb->get_results($wpdb->prepare("SELECT * FROM {$wpdb->posts} WHERE ID=%d",$pid),ARRAY_A));$parts['product:meta']=$digest($meta([$pid]));ksort($parts,SORT_STRING);return $parts;};
`;
  if (action === 'save' && (!/^[a-f0-9]{64}$/.test(expectedHash ?? '') || !/^[a-zA-Z0-9_-]{4,100}$/.test(operationId ?? '') || !/^[a-f0-9]{64}$/.test(intentSha256 ?? ''))) throw Error('related_qualification_write_intent_missing');
  const encoded = Buffer.from(JSON.stringify({ ...identity, action, expectedHash, operationId, intentSha256, elements: relatedQualificationElements() })).toString('base64');
  const code = `
$i=json_decode(base64_decode('${encoded}'),true);$id=$i['pageId'];$run=$i['runId'];
if(untrailingslashit(home_url('/'))!==$i['targetOrigin']||get_post_type($id)!=='woodmart_layout'||get_post_status($id)!=='draft'||get_post_meta($id,'wd_layout_type',true)!=='single_product'||get_post_meta($id,'_clonewp_run_id',true)!==$run||!current_user_can('edit_post',$id)){throw new RuntimeException('related_qualification_owned_draft_required');}
$owned=get_posts(['post_type'=>'woodmart_layout','post_status'=>'any','fields'=>'ids','numberposts'=>2,'meta_key'=>'_clonewp_run_id','meta_value'=>$run]);if(count($owned)!==1||(int)$owned[0]!==$id){throw new RuntimeException('related_qualification_unique_owner');}
$conditions=get_option('wd_layouts_conditions',[]);foreach((array)$conditions as $layouts){if(!empty($layouts[$id])){throw new RuntimeException('related_qualification_no_global_conditions');}}
$p=\\Elementor\\Plugin::$instance;$doc=$p->documents->get($id);if(!$doc||!$doc->is_built_with_elementor()){throw new RuntimeException('related_qualification_native_document_missing');}
$widget=$p->widgets_manager->get_widget_types('woocommerce-product-related');if(!$widget||get_class($widget)!=='ElementorPro\\Modules\\Woocommerce\\Widgets\\Product_Related'){throw new RuntimeException('related_qualification_registered_widget_changed');}
$reflection=new ReflectionClass($widget);$sourceHash=hash_file('sha256',$reflection->getFileName());$template=wc_locate_template('single-product/related.php');$templateHash=is_file($template)?hash_file('sha256',$template):'';
if($sourceHash!==$i['sourceSha256']||$templateHash!==$i['templateSha256']){throw new RuntimeException('related_qualification_source_changed');}
${v2 ? v2Protection + "$protected=static function()use($protectionParts){return hash('sha256',serialize($protectionParts()));};" : "$protected=static function()use($i){return hash('sha256',serialize([get_option('wd_layouts_conditions'),get_option('active_plugins'),get_option('stylesheet'),get_option('template'),get_option('xts-woodmart-options'),get_option('woodmart_options'),wp_get_nav_menu_items(910),wp_get_nav_menu_items(911),get_post($i['productId']),get_post_meta($i['productId'])]));};"}
$snapshot=static function()use($doc,$id,$run,$sourceHash,$templateHash,$protected${v2 ? ',$protectionParts,$cacheProof' : ''}){$elements=$doc->get_elements_data();$settings=$doc->get_settings();${v2 ? "$parts=$protectionParts();$guard=hash('sha256',serialize($parts));" : '$guard=$protected();'}$receipts=get_post_meta($id,'_clonewp_related_qualification_receipts',true);return ['pageId'=>$id,'runId'=>$run,'status'=>'draft','elements'=>$elements,'settings'=>$settings,'sourceSha256'=>$sourceHash,'templateSha256'=>$templateHash,'protectedHash'=>$guard,${v2 ? "'protectionVersion'=>2,'protectedParts'=>$parts,'cacheInvalidationProof'=>$cacheProof," : ''}'hash'=>hash('sha256',serialize([$id,$run,$elements,$settings,$sourceHash,$templateHash,$guard])),'receipts'=>is_array($receipts)?$receipts:[]];};
$before=$snapshot();
if($i['action']==='inspect'){return $before;}
if($before['hash']!==$i['expectedHash']||count($before['elements'])!==0){throw new RuntimeException('related_qualification_expected_empty_state_changed');}
require_once ABSPATH.'wp-admin/includes/post.php';if(wp_check_post_lock($id)){throw new RuntimeException('related_qualification_another_user_editing');}
$receipts=$before['receipts'];if(isset($receipts[$i['operationId']])||array_filter($receipts,static fn($r)=>($r['state']??'')!=='complete')){throw new RuntimeException('related_qualification_reconcile_before_retry');}
$root=$p->elements_manager->create_element_instance($i['elements'][0]);if(!$root){throw new RuntimeException('related_qualification_native_factory_missing');}$elements=[$root->get_raw_data()];
$receipts[$i['operationId']]=['state'=>'started','intentSha256'=>$i['intentSha256'],'beforeHash'=>$before['hash']${v2 ? ",'protectionVersion'=>2,'protectedParts'=>$before['protectedParts'],'cacheInvalidationProof'=>$before['cacheInvalidationProof']" : ''}];update_post_meta($id,'_clonewp_related_qualification_receipts',$receipts);
if(!$doc->save(['elements'=>$elements,'settings'=>$before['settings']])){throw new RuntimeException('related_qualification_native_save_failed');}
$actual=$doc->get_elements_data();$find=function($nodes)use(&$find){$out=[];foreach($nodes as$n){if(($n['elType']??'')==='widget')$out[]=['id'=>$n['id'],'widgetType'=>$n['widgetType'],'settings'=>$n['settings']];$out=array_merge($out,$find($n['elements']??[]));}return$out;};$widgets=$find($actual);
if(count($widgets)!==2||$widgets[0]['widgetType']!=='wd_single_product_title'||$widgets[1]['widgetType']!=='woocommerce-product-related'||($widgets[1]['settings']['posts_per_page']??null)!==6||($widgets[1]['settings']['columns_mobile']??null)!==2||isset($widgets[1]['settings']['include'])||isset($widgets[1]['settings']['product_id'])||$protected()!==$before['protectedHash']){throw new RuntimeException('related_qualification_native_readback_mismatch');}
update_post_meta($id,'_clonewp_related_qualification_kind','native-related-component-v1');$receipts[$i['operationId']]['state']='complete';$receipts[$i['operationId']]['savedTreeSha256']=hash('sha256',serialize($actual));update_post_meta($id,'_clonewp_related_qualification_receipts',$receipts);
return ['saved'=>true,'readbackMatched'=>true,'widgets'=>$widgets,'snapshot'=>$snapshot()];`;
  const readOnlyCode = action === 'inspect' ? code.slice(0, code.indexOf('$before=$snapshot();')) + '$before=$snapshot();return $before;' : code;
  return nativeProductRequestPHP(identity.productId, readOnlyCode);
}
export const relatedQualificationInspectPHP = (identity: RelatedQualificationIdentity) => qualificationPHP(identity, 'inspect');
export const relatedQualificationSavePHP = (identity: RelatedQualificationIdentity, expectedHash: string, operationId: string, persistedIntentSha256: string) => qualificationPHP(identity, 'save', expectedHash, operationId, persistedIntentSha256);

export const RELATED_CONDITIONS_CACHE_SOURCE_SHA256 = 'a6df79030b6127c838de356ea5cb7966f404a22aef6a5b5bbebec3d5bab9e7b5';
export const RELATED_V2_RECONCILE_OPERATION = 'save_82e0f9bc647b4a01b210f0348aa0d483';
export const RELATED_V2_RECONCILE_INTENT_SHA256 = 'ffcf796da5cfbd0c97fcc56cf5cb795f0a842dd1126d5e86a0909f201a6f2b6f';
/** Only the two associative identity maps are sorted. Lists and condition fields are untouched. */
export const RELATED_CONDITIONS_MAP_NORMALIZER_PHP = `$normalizeBindingMaps=static function($value){if(!is_array($value))throw new RuntimeException('related_conditions_type_map_invalid');foreach($value as$type=>$bindings){if(!is_string($type)||!is_array($bindings))throw new RuntimeException('related_conditions_id_map_invalid');foreach($bindings as$post_id=>$conditions)if(!is_int($post_id)||$post_id<1||!is_array($conditions))throw new RuntimeException('related_conditions_binding_invalid');ksort($bindings,SORT_STRING);$value[$type]=$bindings;}ksort($value,SORT_STRING);return $value;};`;
/** Exact one-incident read-only reconciliation. Does not call regenerate/save/update or finish receipts. */
export function relatedQualificationCacheReconciliationPHP(identityInput: RelatedQualificationIdentity, expected: {operationId:string;intentSha256:string;beforeHash:string;protectedParts:Record<string,string>}) {
  const identity=identitySchema.parse(identityInput);
  if(identity.runId!==RELATED_QUALIFICATION_V2_RUN_ID||identity.pageId!==21869||expected.operationId!==RELATED_V2_RECONCILE_OPERATION||expected.intentSha256!==RELATED_V2_RECONCILE_INTENT_SHA256||expected.beforeHash!=='0f4b0461c4ab0c6abecdee1de295c51d40a8c6b5da5454559ecdc180717831e7'||Object.keys(expected.protectedParts).length!==16||Object.values(expected.protectedParts).some(v=>!/^([a-f0-9]{64})$/.test(v)))throw Error('related_cache_reconciliation_exact_incident_required');
  const payload=Buffer.from(JSON.stringify({identity,expected})).toString('base64');
  const inspect=relatedQualificationInspectPHP(identity);
  return nativeProductRequestPHP(identity.productId,`
$input=json_decode(base64_decode('${payload}'),true);$expected=$input['expected'];$snapshot=(static function(){${inspect}})();
$receipt=$snapshot['receipts'][$expected['operationId']]??null;
if(!$receipt||$receipt['state']!=='started'||$receipt['intentSha256']!==$expected['intentSha256']||$receipt['beforeHash']!==$expected['beforeHash']||$receipt['protectionVersion']!==2||$receipt['protectedParts']!==$expected['protectedParts'])throw new RuntimeException('related_cache_reconciliation_original_receipt_mismatch');
$changes=[];foreach($expected['protectedParts']as$key=>$value){if(!array_key_exists($key,$snapshot['protectedParts']))throw new RuntimeException('related_cache_reconciliation_part_missing');if($snapshot['protectedParts'][$key]!==$value)$changes[]=$key;}
if($changes!==['option:wd_layouts_conditions']||count($snapshot['protectedParts'])!==16)throw new RuntimeException('related_cache_reconciliation_other_business_change');
$tree=$snapshot['elements'];$root=$tree[0]??null;$a=$root['elements'][0]??null;$b=$root['elements'][1]??null;
$keys=static function($node,$allowed){if(!is_array($node))return false;foreach(array_keys($node)as$key)if(!in_array($key,$allowed,true))return false;return true;};
if(count($tree)!==1||!$keys($root,['id','elType','settings','elements','isInner'])||($root['isInner']??false)!==false||$root['id']!=='9b0d001'||$root['elType']!=='container'||$root['settings']!==['content_width'=>'full']||count($root['elements'])!==2||!$keys($a,['id','elType','settings','elements','widgetType'])||!$keys($b,['id','elType','settings','elements','widgetType'])||$a['id']!=='9b0d002'||$a['elType']!=='widget'||$a['widgetType']!=='wd_single_product_title'||$a['settings']!==[]||$a['elements']!==[]||$b['id']!=='9b0d003'||$b['elType']!=='widget'||$b['widgetType']!=='woocommerce-product-related'||$b['elements']!==[]||$b['settings']!==['posts_per_page'=>6,'columns'=>3,'columns_tablet'=>3,'columns_mobile'=>2,'orderby'=>'date','order'=>'desc','show_heading'=>'yes'])throw new RuntimeException('related_cache_reconciliation_fixed_tree_mismatch');
$r=new ReflectionClass('XTS\\Modules\\Layouts\\Conditions_Cache');if(hash_file('sha256',$r->getFileName())!=='${RELATED_CONDITIONS_CACHE_SOURCE_SHA256}')throw new RuntimeException('related_cache_reconciliation_cache_source_changed');
// Exact source algorithm, without constructing a cache object or invoking its mutators.
$query=new WP_Query(['posts_per_page'=>-1,'post_type'=>'woodmart_layout','fields'=>'ids','meta_key'=>'wd_layout_conditions','suppress_filters'=>true]);$rebuilt=[];
foreach($query->posts as$post_id){$conditions=get_post_meta($post_id,'wd_layout_conditions',true);$type=get_post_meta($post_id,'wd_layout_type',true);if($type){if(!isset($rebuilt[$type]))$rebuilt[$type]=[];$rebuilt[$type][$post_id]=$conditions;}}
$cache=get_option('wd_layouts_conditions',[]);$rawStrictMatch=$cache===$rebuilt;${RELATED_CONDITIONS_MAP_NORMALIZER_PHP}
if($normalizeBindingMaps($cache)!==$normalizeBindingMaps($rebuilt))throw new RuntimeException('related_cache_reconciliation_strict_binding_map_mismatch');
$orderClause='';if(preg_match('/ORDER BY (.+?)(?: LIMIT|$)/s',$query->request,$orderMatch))$orderClause=$orderMatch[1];$hasIdTieBreak=(bool)preg_match('/\\bID\\b/i',$orderClause);
global $wpdb;$owned=$wpdb->get_col("SELECT DISTINCT p.ID FROM {$wpdb->posts} p INNER JOIN {$wpdb->postmeta} m ON p.ID=m.post_id WHERE p.post_type='woodmart_layout' AND m.meta_key='_clonewp_run_id' AND m.meta_value LIKE 'huaqi-product-layout-jiangubottle-20261028%'");
foreach($cache as$type=>$bindings)foreach((array)$bindings as$post_id=>$conditions)if(in_array((int)$post_id,[21866,21869],true)||($type==='single_product'&&in_array((string)$post_id,array_map('strval',$owned),true)))throw new RuntimeException('related_cache_reconciliation_qualification_binding_present');
$raw=$wpdb->get_results("SELECT p.ID,p.post_status,p.post_type,m.meta_id,m.meta_key,m.meta_value FROM {$wpdb->posts} p LEFT JOIN {$wpdb->postmeta} m ON p.ID=m.post_id AND m.meta_key IN ('wd_layout_conditions','wd_layout_type','_clonewp_run_id') WHERE p.post_type='woodmart_layout' ORDER BY p.ID,m.meta_id",ARRAY_A);
$after=(static function(){${inspect}})();if($after['hash']!==$snapshot['hash']||$after['receipts']!==$snapshot['receipts']||$after['protectedParts']!==$snapshot['protectedParts'])throw new RuntimeException('related_cache_reconciliation_changed_during_read');
return ['saved'=>true,'readbackMatched'=>true,'snapshot'=>$snapshot,'reconciled'=>true,'nativeCacheReconciliation'=>['version'=>1,'kind'=>'exact-native-derived-conditions-cache-reconciliation','pageId'=>21869,'operationId'=>$expected['operationId'],'intentSha256'=>$expected['intentSha256'],'originalServerReceiptState'=>'started','serverReceiptUnchanged'=>true,'originalCacheValueChanged'=>true,'unchangedBusinessPartCount'=>15,'changedDerivedPart'=>'option:wd_layouts_conditions','cacheSourceSha256'=>'${RELATED_CONDITIONS_CACHE_SOURCE_SHA256}','mapKeyOrderNormalized'=>true,'rawStrictMatch'=>$rawStrictMatch,'strictBindingMapMatched'=>true,'nativeQuerySqlSha256'=>hash('sha256',$query->request),'nativeQueryOrderBy'=>$orderClause,'nativeQueryHasIdTieBreak'=>$hasIdTieBreak,'cacheValueSha256'=>hash('sha256',serialize($cache)),'rebuiltValueSha256'=>hash('sha256',serialize($rebuilt)),'rawLayoutBindingsSha256'=>hash('sha256',serialize($raw)),'rawLayoutBindingRowCount'=>count($raw),'beforeProtectedParts'=>$expected['protectedParts'],'currentProtectedParts'=>$snapshot['protectedParts'],'qualificationBindingsAbsent'=>true,'remoteWrites'=>0]];
`);
}
