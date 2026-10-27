import { createHash } from 'node:crypto';
import type { TargetCatalogEvidence } from '../wordpress/catalog-contract.js';
import type { ControlInfo, LegacySchema } from '../wordpress/types.js';
import { native44Usage } from './recipes.js';
import type { Native44Carousel, Native44Products, Native44Query, Native44QueryReceipt, Native44ResourceBinding } from './types.js';
import { assertNative44PendingFormCapability, type PendingFormNode, type PendingFormCapability } from './pending-form.js';
import type { Native44Program } from './types.js';
import type { Native44Posts, Native44PostQueryReceipt } from './types.js';
import { assertTargetPostsEvidence, normalizeTargetPostsQuery, type TargetPostsEvidence } from '../wordpress/posts-contract.js';

export const native44Id = (taskId: string, key: string) => createHash('sha256').update(`clonewp-native44:${taskId}:${key}`).digest('hex').slice(0,7);
export const native44ModuleClass = (key: string) => `cwp-n44-${createHash('sha256').update(key).digest('hex').slice(0,12)}`;
export function normalizeRepeaterFields(control?: ControlInfo): Record<string,ControlInfo> {
  if(!control?.fields||typeof control.fields!=='object')throw new Error('Native44 repeater lacks registered field definitions');
  const out:Record<string,ControlInfo>={};for(const[key,value]of Object.entries(control.fields)){if(!value||typeof value!=='object'||typeof(value as ControlInfo).type!=='string')continue;const field=value as ControlInfo&{name?:string};const name=field.name??(!Array.isArray(control.fields)?key:undefined);if(name)out[name]=field;}return out;
}
export function adaptNative44Children(type:string,settings:Record<string,unknown>,childKeys:string[],schema:LegacySchema,taskId:string,key:string):Record<string,unknown>{
  const usage=native44Usage(type),local=usage.nested,actual=schema.nativeChildContract;
  if(!local){if(childKeys.length&&type!=='container')throw new Error(`Widget does not support native child containers: ${type}/${key}`);return settings;}
  if(!actual||actual.policy!==local.policy||actual.childType!=='container'||actual.baseClass!=='Elementor\\Modules\\NestedElements\\Base\\Widget_Nested_Base'||!/^[a-f0-9]{64}$/.test(actual.sourceSha256))throw new Error(`Installed native child relationship is unproven: ${type}/${key}`);
  if(local.policy==='fixed'){
    if(actual.policy!=='fixed'||actual.count!==local.count||childKeys.length!==local.count)throw new Error(`Fixed native child count differs: ${type}/${key}`);return settings;
  }
  if(actual.policy!=='repeater'||actual.repeaterKey!==local.repeaterKey||actual.titleSettingKey!==local.titleSettingKey)throw new Error(`Local/live nested repeater contracts differ: ${type}/${key}`);
  if(!childKeys.length)throw new Error(`Nested repeater requires actual child containers: ${type}/${key}`);
  const supplied=settings[actual.repeaterKey];if(supplied!==undefined&&(!Array.isArray(supplied)||supplied.length!==childKeys.length))throw new Error(`Repeater rows do not match native child containers: ${type}/${key}`);
  return {...settings,[actual.repeaterKey]:supplied??childKeys.map((childKey,i)=>({_id:native44Id(taskId,`${key}:row:${childKey}`),[actual.titleSettingKey]:`Item ${i+1}`}))};
}
export function validateNative44Carousel(node:Native44Carousel,schema:LegacySchema):void{
  const usage=native44Usage(node.widgetType);
  if(usage.contentModel==='nested-repeater'){if(!node.slides?.length)throw new Error(`Native carousel requires real slides: ${node.key}`);return;}
  if(node.slides?.length)throw new Error(`Setting repeater carousel cannot accept nested slide containers: ${node.key}/${node.widgetType}`);
  const key=usage.primaryContentFields.find(field=>Array.isArray(node.widgetSettings[field])&&['repeater','nested-elements-repeater'].includes(schema.controls[field]?.type));
  if(!key||(node.widgetSettings[key]as unknown[]).length<2)throw new Error(`Carousel needs at least two actual registered repeater items: ${node.key}/${node.widgetType}`);
}
const nonempty=(v:unknown)=>v!==undefined&&v!==''&&v!==false&&v!=='no'&&(!Array.isArray(v)||v.length>0);
function forbidFilters(settings:Record<string,unknown>,key:string,prefix=''):void{
  for(const field of ['categories','product_cat','taxonomies','exclude','featured','sale','best_selling','stock_status','hide_outofstock','query_id','meta_query','tax_query','offset','paged','pagination','include_term_ids','exclude_ids','exclude_term_ids','related_ids','include','exclude','query_include','query_exclude']){
    const name=`${prefix}${field}`;
    if (field === 'pagination' && settings[name] === 'none') continue;
    if(nonempty(settings[name]))throw new Error(`Undeclared product query filter: ${key}/${name}`);
  }
}
function selected(query:Native44Query,catalog:TargetCatalogEvidence,used:Set<number>,key:string):number[]{
  if(!catalog.evidence.length||!catalog.products.length||new URL(catalog.targetOrigin).origin!==catalog.targetOrigin)throw new Error(`Actual target catalog proof is missing: ${key}`);
  if(query.ids.some(id=>!catalog.products.some(p=>p.id===id)))throw new Error(`Insufficient actual target products: ${key}`);
  const dateOrder=catalog.products.filter(p=>query.ids.includes(p.id)).map(p=>p.id);
  if(JSON.stringify(dateOrder)!==JSON.stringify(query.ids))throw new Error(`Product IDs must preserve verified catalog date order: ${key}`);
  if(!query.allowOverlap&&query.ids.some(id=>used.has(id)))throw new Error(`Unintentional overlapping product sets: ${key}`);
  query.ids.forEach(id=>used.add(id));return query.ids;
}
function mergeFrozen(settings:Record<string,unknown>,expected:Record<string,unknown>,key:string):Record<string,unknown>{
  for(const[name,value]of Object.entries(expected))if(Object.hasOwn(settings,name)&&JSON.stringify(settings[name])!==JSON.stringify(value))throw new Error(`Product setting conflicts with frozen query: ${key}/${name}`);return{...settings,...expected};
}
function requireControls(controls:Record<string,ControlInfo>,names:string[],key:string){for(const name of names)if(!controls[name])throw new Error(`Registered query adapter field unavailable: ${key}/${name}`);}
/** Every supported product widget has its own source-backed settings model. */
export function adaptNative44Products(node:Native44Products,schema:LegacySchema,catalog:TargetCatalogEvidence|undefined,used:Set<number>,taskId:string,elementId:string):{settings:Record<string,unknown>;receipts:Native44QueryReceipt[]}{
  if(!catalog)throw new Error(`Actual target WooCommerce catalog is required: ${node.key}`);
  const receipts:Native44QueryReceipt[]=[];
  const receipt=(query:Native44Query,ids:number[],settings:Record<string,unknown>,collectionPath?:string)=>receipts.push({componentKey:node.key,elementId,widgetType:node.widgetType,...(collectionPath?{collectionPath}:{}),provider:'target-woocommerce',targetOrigin:catalog.targetOrigin,productIds:ids,evidence:[...new Set([...catalog.evidence,...query.evidence])],settings});
  if(node.widgetType==='wd_products_tabs'){
    const tabs=node.tabs!;requireControls(schema.controls,['tabs_items','items_per_page'],node.key);const fields=normalizeRepeaterFields(schema.controls.tabs_items);requireControls(fields,['title','post_type','include','orderby'],node.key);
    if(new Set(tabs.map(tab=>tab.query.ids.length)).size!==1)throw new Error(`Product tabs share one registered items_per_page; unequal collection counts are unsupported: ${node.key}`);
    const rows=tabs.map((tab,index)=>{const ids=selected(tab.query,catalog,used,`${node.key}/${tab.key}`),input=tab.settings??{};forbidFilters(input,`${node.key}/${tab.key}`);const row=mergeFrozen(input,{_id:native44Id(taskId,`${node.key}:tab:${tab.key}`),title:tab.title,post_type:'ids',include:ids,orderby:'date'},`${node.key}/${tab.key}`);receipt(tab.query,ids,row,`tabs_items.${index}`);return row;});
    if(Object.hasOwn(node.widgetSettings,'tabs_items'))throw new Error(`Product tab rows are owned by their individual query adapters: ${node.key}`);
    return{settings:mergeFrozen(node.widgetSettings,{tabs_items:rows,items_per_page:tabs[0].query.ids.length},node.key),receipts};
  }
  const query=node.query!,ids=selected(query,catalog,used,node.key);
  if(node.widgetType==='wd_products'){
    requireControls(schema.controls,['post_type','include','items_per_page','orderby'],node.key);forbidFilters(node.widgetSettings,node.key);
    const settings=mergeFrozen(node.widgetSettings,{post_type:'ids',include:ids,items_per_page:ids.length,orderby:'date'},node.key);receipt(query,ids,settings);return{settings,receipts};
  }
  requireControls(schema.controls,['query_post_type','query_posts_ids','query_orderby','query_order','columns','rows'],node.key);forbidFilters(node.widgetSettings,node.key,'query_');
  const options=schema.controls.query_orderby.options??{};const orderby=Object.hasOwn(options,'date')?'date':Object.hasOwn(options,'post_date')?'post_date':undefined;if(!orderby)throw new Error(`WooCommerce date ordering is not registered: ${node.key}`);
  const columns=Number(node.widgetSettings.columns??schema.controls.columns.default),rows=Number(node.widgetSettings.rows??schema.controls.rows.default);if(!Number.isInteger(columns)||!Number.isInteger(rows)||columns<1||rows<1||columns*rows<ids.length)throw new Error(`WooCommerce rows/columns cannot display the frozen product set: ${node.key}`);
  const settings=mergeFrozen(node.widgetSettings,{query_post_type:'by_id',query_posts_ids:ids,query_orderby:orderby,query_order:'desc'},node.key);receipt(query,ids,settings);return{settings,receipts};
}

/** wd_blog owns the live query. The read-back IDs are evidence only and must
 * never become include IDs, so newly published target articles enter the list. */
export function adaptNative44Posts(node:Native44Posts,schema:LegacySchema,observations:TargetPostsEvidence[]|undefined,elementId:string,targetOrigin?:string):{settings:Record<string,unknown>;receipt:Native44PostQueryReceipt}{
  const query=normalizeTargetPostsQuery(node.query);
  if(query.categoryIds.length&&query.tagIds.length)throw Error(`Combined post category/tag query semantics are not verified: ${node.key}`);
  const evidence=observations?.find(item=>JSON.stringify(normalizeTargetPostsQuery(item.query))===JSON.stringify(query));
  if(!evidence?.evidence.length||!evidence.posts.length)throw Error(`Actual target published posts are required: ${node.key}`);
  assertTargetPostsEvidence(evidence,targetOrigin,node.query);
  const origin=new URL(evidence.targetOrigin).origin;
  if(origin!==evidence.targetOrigin||targetOrigin&&targetOrigin!==origin)throw Error(`Target post evidence origin differs: ${node.key}`);
  const ids=evidence.posts.map(post=>post.id);
  if(new Set(ids).size!==ids.length||ids.length>query.itemsPerPage||evidence.posts.some(post=>!Number.isSafeInteger(post.id)||post.id<1||post.status!=='publish'||new URL(post.permalink).origin!==origin||!post.title.trim()))throw Error(`Invalid target published post evidence: ${node.key}`);
  requireControls(schema.controls,['post_type','items_per_page','orderby','order','offset'],node.key);
  if(!Object.hasOwn(schema.controls.post_type.options??{},'post')||!Object.hasOwn(schema.controls.orderby.options??{},'date')||!Object.hasOwn(schema.controls.order.options??{},'DESC'))throw Error(`Registered latest-posts query model differs: ${node.key}`);
  // Query controls cannot conceal a second filter or convert latest posts into
  // a static ID list. All query inputs come from the typed target declaration.
  for(const name of ['post_type','include','exclude','taxonomies','orderby','order','offset','items_per_page','meta_key','post_status','query_id','query_include','query_exclude','meta_query','tax_query','paged','ajax_page'])if(Object.hasOwn(node.widgetSettings,name))throw Error(`Blog query settings are owned by the target posts adapter: ${node.key}/${name}`);
  const taxonomyIds=[...query.categoryIds,...query.tagIds];
  if(taxonomyIds.length)requireControls(schema.controls,['taxonomies'],node.key);
  const offsetType=schema.controls.offset.type;
  if(!['number','text'].includes(offsetType))throw Error(`Registered blog offset control differs: ${node.key}`);
  const settings={...node.widgetSettings,post_type:'post',items_per_page:query.itemsPerPage,orderby:'date',order:'DESC',offset:offsetType==='text'?String(query.offset):query.offset,...(taxonomyIds.length?{taxonomies:taxonomyIds}:{})};
  return{settings,receipt:{componentKey:node.key,elementId,widgetType:'wd_blog',provider:'target-wordpress-posts',targetOrigin:origin,query:structuredClone(node.query),observedPostIds:ids,evidence:[...new Set([...evidence.evidence,...node.query.evidence])],settings:structuredClone(settings)}};
}

const dataDependencies:Record<string,Native44ResourceBinding['kind'][]>={wd_products_brands:['brands'],wd_product_categories:['categories'],wd_blog:['posts'],wd_contact_form_7:['form'],wd_sidebar:['sidebar'],form:['form'],wd_wc_breadcrumb:['page-context'],wd_page_heading:['page-context'],wd_element_breadcrumbs:['page-context'],breadcrumbs:['page-context'],wd_wishlist:['wishlist'],wd_compare:['compare']};
/** Read-only declarations use the same dependency table as the write guard. */
export function native44ResourceDependencies(type:string):Native44ResourceBinding['kind'][] { return [...(dataDependencies[type]??[])]; }
/** These researched widgets remain in the 44-component catalog. The current
 * writer routes observed product/posts queries through their typed adapters;
 * strings claiming IDs or evidence cannot establish other live resources. */
export class Native44ResourceAdapterUnverifiedError extends Error {
  readonly code = 'native44_resource_adapter_unverified';
  readonly status = 'unverified';
  readonly capability = 'unsupported';
  constructor(readonly widgetType: string, readonly dependencies: Native44ResourceBinding['kind'][]) {
    super(`native44_resource_adapter_unverified: ${widgetType} requires ${dependencies.join(', ')}; the current desktop writer has no verified target resource/context adapter. This is an unsupported tool capability, not widget incompatibility or removal from the fixed 44 components.`);
    this.name = 'Native44ResourceAdapterUnverifiedError';
  }
}
/** Called locally, before target credentials or network access. It deliberately
 * does not accept a user-authored receipt as a replacement for a real adapter. */
export function assertNative44DesktopResourceSupport(type: string, resources?: Native44ResourceBinding[]): void {
  const dependencies = [...new Set([...(dataDependencies[type] ?? []), ...(resources ?? []).map(resource => resource.kind)])];
  if (dependencies.length) throw new Native44ResourceAdapterUnverifiedError(type, dependencies);
}
export function validateNative44ResourceBindings(type:string,settings:Record<string,unknown>,resources:Native44ResourceBinding[]|undefined,targetOrigin?:string,pending?:{program:Native44Program;node:PendingFormNode;schemas:Record<string,LegacySchema>;capability:PendingFormCapability|undefined}):void{
  if(pending){
    if(type!=='form'||pending.node.widgetType!==type||settings!==pending.node.widgetSettings||resources?.length)throw Error('Pending native form cannot waive other resources/settings');
    assertNative44PendingFormCapability(pending.program,pending.node,pending.schemas,pending.capability);return;
  }
  for(const kind of dataDependencies[type]??[]){const proof=resources?.find(r=>r.kind===kind);if(!proof?.evidence.length||!proof.ids.length||!targetOrigin||proof.targetOrigin!==targetOrigin)throw new Error(`Existing target resource proof required: ${type}/${kind}`);if(proof.settingPath){let actual:unknown=settings;for(const part of proof.settingPath.split('.'))actual=actual&&typeof actual==='object'?(actual as Record<string,unknown>)[part]:undefined;const values=Array.isArray(actual)?actual:[actual];if(values.length!==proof.ids.length||values.some((id,i)=>String(id)!==String(proof.ids[i])))throw new Error(`Resource settings differ from verified target IDs: ${type}/${proof.settingPath}`);}}
}
