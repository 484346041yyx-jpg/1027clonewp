import { validatePlan, validateRegisteredChildren, validateRegisteredSettings, type ElementorElement } from '../planning/plan.js';
import { renderStaticHTML } from '../replica-v2/html.js';
import { assertAllowedWidget } from './catalog.js';
import { adaptNative44Children, adaptNative44Products, adaptNative44Posts, native44Id, native44ModuleClass, normalizeRepeaterFields, validateNative44Carousel, validateNative44ResourceBindings } from './adapters.js';
import { native44Children, walkNative44, type Native44Compiled, type Native44CompileOptions, type Native44Component, type Native44Program } from './types.js';
import { validateNative44Program } from './validate.js';
import { prepareCoreProductBindings, assertCoreProductPageRuntime } from './current-product.js';
import { assertProgramNativeWidget } from './product-extension.js';
import { assertProductRuntimeCapability } from '../wordpress/current-product-runtime.js';
import { adaptNative44Categories } from './native-categories.js';
import { adaptNativeRelatedProductComponent } from './native-related-products.js';
import { relatedProductsQueryKey } from '../wordpress/related-products.js';
import type { ControlInfo, LegacySchema } from '../wordpress/types.js';
import { createHash } from 'node:crypto';
import { canvasShellCSS, type CanvasShellProof } from '../wordpress/canvas-shell.js';
import { pendingFormValidationProjection, assertNative44PendingFormCapability, assertPendingFormAttributeAuthorization, bindPendingFormAttributeAuthorization, native44PendingFormBinding, type PendingFormCapability, type PendingFormAttributeAuthorization } from './pending-form.js';

const compiledProofs=new WeakMap<object,string>();
const compiledPendingForms=new WeakMap<object,Array<{capability:PendingFormCapability;authorization:PendingFormAttributeAuthorization}>>();
const compilationDigest=(proof:Native44Compiled,composition:unknown)=>createHash('sha256').update(JSON.stringify({composition,replicationProfile:proof.replicationProfile,selectionRulesHash:proof.selectionRulesHash,editorNaming:proof.editorNaming,editorLabels:proof.editorLabels,pendingFormBindings:proof.pendingFormBindings,articleListPolicy:proof.articleListPolicy,postQueryReceipts:proof.postQueryReceipts,categoryQueryReceipts:proof.categoryQueryReceipts,relatedProductBindings:proof.relatedProductBindings,currentProductBinding:proof.currentProductBinding})).digest('hex');
function assertPendingCompilation(proof:Native44Compiled,schemas?:Record<string,LegacySchema>):void{
  const permits=compiledPendingForms.get(proof)??[],elements=new Map<string,ElementorElement>();
  const walk=(nodes:ElementorElement[])=>{for(const node of nodes){elements.set(node.id,node);walk(node.elements);}};walk(proof.composition.elements);
  if(proof.replicationProfile==='desktop-browser-v1'&&[...elements.values()].filter(node=>node.widgetType==='form').length!==permits.length)throw Error('Desktop native forms require exact pending compiler authorizations');
  const expected=permits.map(({capability,authorization})=>{
    const element=elements.get(authorization.elementId);if(!element||element.widgetType!=='form')throw Error('Pending form compiler owner is missing');
    assertPendingFormAttributeAuthorization(authorization,'form',element.settings,element.id,schemas?.form);
    return native44PendingFormBinding(capability,authorization,element.settings);
  });
  if(JSON.stringify(expected)!==JSON.stringify(proof.pendingFormBindings??[]))throw Error('Pending form compiler candidate receipts changed');
}
export function assertNative44Compilation(proof:Native44Compiled|undefined,composition:unknown):void{
  if(!proof||!compiledProofs.has(proof)||compiledProofs.get(proof)!==compilationDigest(proof,composition))throw new Error('Native44 writes require the exact current-process full-document compiler proof');
  assertPendingCompilation(proof);
}
export function assertNative44PendingFormCompilation(proof:Native44Compiled,schemas?:Record<string,LegacySchema>):void{assertNative44Compilation(proof,proof.composition);assertPendingCompilation(proof,schemas);}
/** The sole post-compilation change: exact existing Canvas shell, checked again by the writer. */
export function bindNative44CanvasShell(compiled:Native44Compiled,shell:CanvasShellProof):Native44Compiled{
  assertNative44Compilation(compiled,compiled.composition);
  if(shell.enabled&&shell.css){
    const expected=canvasShellCSS(shell.pageId,'@media (max-width: 1024px){.sticky-toolbar-on{padding-bottom:55px}@media (min-width: 1025px){.wd-toolbar{display:none}}',compiled.replicationProfile);
    if(shell.css!==expected)throw new Error('Native44 compiler accepts only the exact fixed owned Canvas shell');
    compiled.composition.pageSettings={...compiled.composition.pageSettings,custom_css:shell.css};compiled.plan={...compiled.plan,compositionJson:JSON.stringify(compiled.composition)};compiledProofs.set(compiled,compilationDigest(compiled,compiled.composition));
  }
  return compiled;
}

export function usedNative44WidgetTypes(program: Native44Program): string[] {
  return [...new Set(['container',...walkNative44(program.blocks).flatMap(node=>node.kind==='html-static'?['html']:'widgetType'in node?[node.widgetType]:[])])];
}
export function referencedNative44Assets(program: Native44Program): Set<string> {
  const keys=new Set<string>();const scan=(value:unknown):void=>{if(Array.isArray(value))value.forEach(scan);else if(value&&typeof value==='object'){const r=value as Record<string,unknown>;if(typeof r.$asset==='string')keys.add(r.$asset);else Object.values(r).forEach(scan);}};
  for(const node of walkNative44(program.blocks)){scan(node.settings);if('widgetSettings'in node)scan(node.widgetSettings);if(node.kind==='html-static')for(const media of Object.values(node.slots.media)){keys.add(media.assetKey);media.responsive?.forEach(item=>keys.add(item.assetKey));}}return keys;
}
function repeaterIdentities(settings:Record<string,unknown>,controls:Record<string,ControlInfo>,taskId:string,path:string):Record<string,unknown>{
  const result=structuredClone(settings);
  for(const[key,value]of Object.entries(result)){
    const control=controls[key];if(!control||!['repeater','nested-elements-repeater','form-fields-repeater','fields_map'].includes(control.type)||!Array.isArray(value))continue;
    const fields=normalizeRepeaterFields(control),seen=new Set<string>(),aliases=new Set<string>();result[key]=value.map((row,i)=>{if(!row||typeof row!=='object'||Array.isArray(row))throw new Error(`Invalid native44 repeater row: ${path}.${key}.${i}`);const r=row as Record<string,unknown>,rawId=r._id;if(rawId!==undefined&&(typeof rawId!=='string'||!/^[a-zA-Z0-9_-]{1,64}$/.test(rawId)||aliases.has(rawId)))throw new Error(`Invalid or duplicate native44 repeater identity: ${path}.${key}.${i}`);if(typeof rawId==='string')aliases.add(rawId);const id=typeof rawId==='string'&&/^[a-f0-9]{7}$/.test(rawId)?rawId:native44Id(taskId,`${path}.${key}.${rawId??i}`);if(seen.has(id))throw new Error(`Invalid or duplicate native44 repeater identity: ${path}.${key}.${i}`);seen.add(id);return{...repeaterIdentities(r,fields,taskId,`${path}.${key}.${id}`),_id:id};});
  }return result;
}
/** One full document for the task's frozen profile. Never creates stage projections. */
export function compileNative44(input: Native44Program, options: Native44CompileOptions): Native44Compiled {
  const {schemas,assets,knowledge,catalog}=options;
  const projection=pendingFormValidationProjection(input,schemas,options.pendingForms??[]);
  const program=validateNative44Program(projection);
  if (program.currentRecord) {
    if (!options.currentProduct || !options.targetOrigin) throw Error('current_product_provider_required');
    const bindings = prepareCoreProductBindings(program, { provider: options.currentProduct, targetOrigin: options.targetOrigin, schemas, controlsByWidget: knowledge.controlsByWidget });
    assertCoreProductPageRuntime(bindings, options.currentProductRuntime, program.currentRecord, options.targetOrigin);
  } else if (options.currentProduct) throw Error('current_product_provider_unused');
  // Restore only the exact permit-bound settings after default strict validation.
  const originalNodes=walkNative44(input.blocks);
  for(const node of walkNative44(program.blocks))if(node.kind==='native'&&node.pendingForm){const original=originalNodes.find(row=>row.key===node.key);if(original?.kind==='native'){node.widgetSettings=structuredClone(original.widgetSettings);node.sourceFactIds=structuredClone(original.sourceFactIds);}}
  const compact=program.replicationProfile==='desktop-browser-v1';
  if(knowledge.fingerprint!==program.knowledge.fingerprint)throw new Error('Native44 knowledge fingerprint differs from the program');
  const pendingNodes=walkNative44(program.blocks).filter(node=>node.kind==='native'&&node.pendingForm);
  const pendingByKey=new Map((options.pendingForms??[]).map(capability=>[capability.componentKey,capability]));
  if(pendingByKey.size!==(options.pendingForms?.length??0)||pendingByKey.size!==pendingNodes.length||[...pendingByKey.keys()].some(key=>!pendingNodes.some(node=>node.key===key)))throw Error('Pending form capabilities must match only the exact declared components');
  for(const node of pendingNodes)if(node.kind==='native')assertNative44PendingFormCapability(program,node,schemas,pendingByKey.get(node.key));
  const formAuthorizations:Array<{capability:PendingFormCapability;authorization:PendingFormAttributeAuthorization}>=[];
  const assetMap=new Map<string,typeof assets[number]>();for(const asset of assets){if(assetMap.has(asset.key)||!Number.isSafeInteger(asset.attachmentId)||asset.attachmentId<1||!/^[a-f0-9]{64}$/.test(asset.sha256))throw new Error('Native44 imported media needs unique task keys and proven attachment identities');const url=new URL(asset.url);if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw new Error('Invalid native44 imported media URL');assetMap.set(asset.key,asset);}
  for(const key of referencedNative44Assets(program))if(!assetMap.has(key))throw new Error(`Unresolved native44 task asset: ${key}`);
  const directImages=new Map<string,typeof assets[number]>();
  for(const slot of options.directImageSlots??[]){
    const node=walkNative44(program.blocks).find(row=>row.key===slot.componentKey),asset=assetMap.get(slot.assetKey);
    if(directImages.has(slot.componentKey)||!asset||node?.kind!=='native'||node.widgetType!=='wd_image_or_svg'||JSON.stringify(node.widgetSettings.image)!==JSON.stringify({$asset:slot.assetKey}))throw new Error(`Invalid native44 direct image slot: ${slot.componentKey}`);
    directImages.set(slot.componentKey,asset);
  }
  const allowedMedia=[...assets,...[...directImages.values()].map(asset=>({...asset,attachmentId:0}))];
  const out:Native44Compiled={...(compact?{replicationProfile:program.replicationProfile,selectionRulesHash:program.selectionRulesHash,...(program.editorNaming?{editorNaming:program.editorNaming}:{})}:{}),composition:{elements:[],pageSettings:{hide_title:'yes',background_background:'classic',background_color:'#FFFFFF'}},plan:{}as Native44Compiled['plan'],elementMap:{},widgetTargets:{},sectionIds:[],sections:[],usedTypes:[],htmlProofs:[],bindings:[],queryReceipts:[],moduleClasses:{}};
  if(program.currentRecord && options.currentProductRuntime) { const runtime=assertProductRuntimeCapability(options.currentProductRuntime,program.currentRecord,options.targetOrigin!);out.currentProductBinding={productId:runtime.productId,contextKey:program.currentRecord.contextKey,targetOrigin:runtime.targetOrigin,pageId:runtime.pageId,runId:runtime.runId}; }
  if(program.articleListPolicy)out.articleListPolicy=program.articleListPolicy;
  if(walkNative44(program.blocks).some(node=>node.kind==='native-posts'))out.postQueryReceipts=[];
  if(walkNative44(program.blocks).some(node=>node.kind==='native-categories'))out.categoryQueryReceipts=[];
  const relatedNodes=walkNative44(program.blocks).filter(node=>node.kind==='native-related-products');
  if(relatedNodes.length){
    if(!program.currentRecord||!options.targetOrigin||!options.relatedQualification||options.relatedQualification.extensionSha256!==program.componentExtension?.sha256)throw Error('native_related_product_current_qualification_required');
    assertProductRuntimeCapability(options.currentProductRuntime,program.currentRecord,options.targetOrigin);out.relatedProductBindings=[];
  }else if(options.relatedProducts?.length)throw Error('native_related_product_provider_unused');
  const ids=new Set<string>(),used=new Set<string>(),queried=new Set<number>();
  const resolve=(value:unknown):unknown=>{if(Array.isArray(value))return value.map(resolve);if(value&&typeof value==='object'){const r=value as Record<string,unknown>;if(Object.hasOwn(r,'$asset')){const asset=typeof r.$asset==='string'?assetMap.get(r.$asset):undefined;if(!asset||Object.keys(r).length!==1)throw new Error('Malformed or unresolved native44 media slot');return{id:asset.attachmentId,url:asset.url};}return Object.fromEntries(Object.entries(r).map(([key,v])=>[key,resolve(v)]));}return value;};
  const native=(key:string,type:string,inputSettings:Record<string,unknown>,children:ElementorElement[],depth:number,componentKey=key):ElementorElement=>{
    assertProgramNativeWidget(type,program.componentExtension);const schema=schemas[type],local=knowledge.controlsByWidget[type];if(!schema?.controls||!local)throw new Error(`Native44 local/live widget contract unavailable: ${type}/${componentKey}`);
    const settingsInput={...inputSettings};
    if(type==='nested-carousel'&&Object.hasOwn(settingsInput,'loop')){
      if(Object.hasOwn(settingsInput,'infinite')||!['yes','no'].includes(String(settingsInput.loop))||!local.has('infinite')||schema.controls.infinite?.type!=='switcher')throw new Error(`Native44 carousel loop alias conflicts with registered infinite control: ${componentKey}`);
      settingsInput.infinite=settingsInput.loop;delete settingsInput.loop;
    }
    if(type==='nested-carousel'&&settingsInput.arrows==='no'&&schema.controls.arrows?.type==='switcher')settingsInput.arrows='';
    if(type==='nested-carousel'&&settingsInput.pagination==='none'&&schema.controls.pagination?.options&&Object.hasOwn(schema.controls.pagination.options,''))settingsInput.pagination='';
    if(type==='wd_testimonials'&&settingsInput.layout==='carousel'&&schema.controls.layout?.options&&Object.hasOwn(schema.controls.layout.options,'slider'))settingsInput.layout='slider';
    if(type==='wd_testimonials'&&settingsInput.stars_rating==='5'&&schema.controls.stars_rating?.type==='switcher')settingsInput.stars_rating='yes';
    if(type==='wd_testimonials')for(const field of ['slides_per_view','slides_per_view_tablet','slides_per_view_mobile'])if(typeof settingsInput[field]==='string'&&/^[1-8]$/.test(settingsInput[field])&&schema.controls[field]?.type==='slider')settingsInput[field]={unit:'px',size:Number(settingsInput[field]),sizes:[]};
    if(type==='wd_testimonials'&&typeof settingsInput.speed==='string'&&/^[0-9]{1,6}$/.test(settingsInput.speed)&&schema.controls.speed?.type==='number')settingsInput.speed=Number(settingsInput.speed);
    const entranceAnimation=type==='text-editor'&&settingsInput._animation==='fadeInUp'&&schema.controls._animation?.type==='animation'&&schema.controls._animation.frontend_available===true?'fadeInUp':undefined;
    if(entranceAnimation)delete settingsInput._animation;
    let settings=repeaterIdentities(settingsInput,schema.controls,program.taskId,key);
    const direct=type==='wd_image_or_svg'?directImages.get(componentKey):undefined;
    if(direct){if(type!=='wd_image_or_svg'||(settings.image as {id?:number;url?:string}|undefined)?.id!==direct.attachmentId||(settings.image as {url?:string}|undefined)?.url!==direct.url)throw new Error(`Native44 direct image owner changed: ${componentKey}`);settings.image={id:0,url:direct.url};}
    for(const field of Object.keys(settings)){if(!local.has(field))throw new Error(`Native44 setting is outside the researched local/live intersection: ${type}.${field}`);if(field==='custom_css'&&settings[field])throw new Error(`Native44 CSS belongs in the one page CSS handoff: ${componentKey}`);}
    settings=knowledge.validateSettings?.(type,settings)??settings;
    if(entranceAnimation)settings._animation=entranceAnimation;
    if(Object.hasOwn(settings,'_title'))throw new Error(`Native translated Navigator names cannot use a custom _title: ${componentKey}`);
    for(const field of Object.keys(settings))if(!(local.has(field)||field==='_animation'&&entranceAnimation===settings[field])||!schema.controls[field])throw new Error(`Solved native44 setting is outside the local/live intersection: ${type}.${field}`);
    const id=native44Id(program.taskId,key),capability=type==='form'?pendingByKey.get(componentKey):undefined;
    const pendingFormAuthorization=capability?bindPendingFormAttributeAuthorization(capability,id,settings,schema):undefined;
    validateRegisteredSettings(type,settings,schema,{allowedMedia,...(pendingFormAuthorization?{pendingFormAuthorization}:{})});validateRegisteredChildren(type,settings,children.map(child=>child.elType==='container'?'container':child.widgetType??''),schema);
    if(capability&&pendingFormAuthorization)formAuthorizations.push({capability,authorization:pendingFormAuthorization});
    if(ids.has(id))throw new Error(`Duplicate native44 generated identity: ${key}`);ids.add(id);used.add(type);out.elementMap[key]=id;
    return{id,elType:type==='container'?'container':'widget',...(type==='container'?{isInner:depth>0}:{widgetType:type}),settings,elements:children};
  };
  // The desktop profile places its stable module class on the element that is
  // actually emitted. Never translate Container layout fields into Widget
  // fields: widgetSettings must pass that Widget's own local/live contract.
  const moduleSettings=(node:Native44Component,type:string,settings:Record<string,unknown>):Record<string,unknown>=>{
    const classKey=['css_classes','_css_classes'].find(key=>schemas[type]?.controls[key]&&knowledge.controlsByWidget[type]?.has(key));
    if(!classKey)throw new Error(`Native44 stable module classes require the actual registered ${type} class control: ${node.key}`);
    for(const name of ['css_classes','_css_classes'])if(settings[name]!==undefined&&(typeof settings[name]!=='string'||!/^[a-zA-Z0-9_\s-]*$/.test(settings[name] as string)))throw new Error(`Invalid native module classes: ${node.key}`);
    const moduleClass=native44ModuleClass(node.key);out.moduleClasses[node.key]=moduleClass;
    return{...settings,[classKey]:[settings[classKey]??'',moduleClass].filter(Boolean).join(' ')};
  };
  const bindNativeSettings=(componentKey:string,elementId:string,settings:Record<string,unknown>,controls:Record<string,ControlInfo>):void=>{
    const visit=(value:unknown,control:ControlInfo|undefined,path:string,slot:string,repeaterRows:Array<{path:string;rowId:string}>=[]):void=>{
      if(typeof value==='string'){out.bindings.push({componentKey,elementId,kind:'native',settingPath:path,slot,value});if(repeaterRows.length)(out.repeaterBindings??=[]).push({componentKey,elementId,settingPath:path,repeaterRows});return;}
      if(Array.isArray(value)){
        const isRepeater=control&&['repeater','nested-elements-repeater','form-fields-repeater','fields_map'].includes(control.type),fields=isRepeater?normalizeRepeaterFields(control):undefined;
        value.forEach((row,index)=>{
          if(fields&&row&&typeof row==='object'&&!Array.isArray(row)){
            const record=row as Record<string,unknown>,identity=record._id;if(typeof identity!=='string')throw new Error(`Native44 binding repeater row lacks identity: ${componentKey}/${path}.${index}`);
            for(const[name,child]of Object.entries(record))if(name!=='_id')visit(child,fields[name],`${path}.${index}.${name}`,`${slot}[${identity}].${name}`,[...repeaterRows,{path,rowId:identity}]);
          }else visit(row,undefined,`${path}.${index}`,`${slot}.${index}`,repeaterRows);
        });return;
      }
      if(value&&typeof value==='object')for(const[name,child]of Object.entries(value))visit(child,undefined,`${path}.${name}`,`${slot}.${name}`,repeaterRows);
    };
    for(const[name,value]of Object.entries(settings))visit(value,controls[name],name,name);
  };
  const fixedChildSettings=(node:Extract<Native44Component,{kind:'native'|'native-carousel'}>,schema:LegacySchema,childNodes:Native44Component[]):Record<string,unknown>|undefined=>{
    if(schema.nativeChildContract?.policy!=='fixed')return;
    const{_title:editorTitle,...layoutDefaults}=schema.nativeChildContract.childSettings??{};
    if(editorTitle!==undefined){if(typeof editorTitle!=='string'||editorTitle.length>500)throw new Error(`Invalid source-declared nested editor title: ${node.widgetType}/${node.key}`);(out.nestedChildMetadata??=[]).push({parentComponentKey:node.key,widgetType:node.widgetType,childComponentKeys:childNodes.map(child=>child.key),editorTitle,sourceSha256:schema.nativeChildContract.sourceSha256});}
    return layoutDefaults;
  };
  const compileCompact=(node:Native44Component,depth:number,inherited?:Record<string,unknown>):ElementorElement=>{
    if(node.kind==='composite')return native(node.key,'container',moduleSettings(node,'container',resolve({...inherited,...node.settings})as Record<string,unknown>),node.children.map(child=>compileCompact(child,depth+1)),depth);
    if(inherited||node.settings&&Object.keys(node.settings).length)throw new Error(`Desktop native44 layout settings require an explicit composite container: ${node.key}`);
    let widget:ElementorElement;
    if(node.kind==='html-static'){
      const id=native44Id(program.taskId,node.key),proof=renderStaticHTML(node,program.taskId,id,assets,'final');out.htmlProofs.push(proof);out.bindings.push(...proof.bindings);
      widget=native(node.key,'html',moduleSettings(node,'html',{html:proof.html}),[],depth);
    }else if(node.kind==='native-products'){
      const schema=schemas[node.widgetType];if(!schema)throw new Error(`Registered product adapter unavailable: ${node.widgetType}`);
      const adapted=adaptNative44Products(node,schema,catalog,queried,program.taskId,native44Id(program.taskId,node.key));
      widget=native(node.key,node.widgetType,moduleSettings(node,node.widgetType,resolve(adapted.settings)as Record<string,unknown>),[],depth);out.queryReceipts.push(...adapted.receipts);
      bindNativeSettings(node.key,widget.id,widget.settings,schema.controls);
    }else if(node.kind==='native-related-products'){
      const schema=schemas['woocommerce-product-related'],provider=options.relatedProducts?.find(p=>p.queryKey===relatedProductsQueryKey(node.query));
      if(!schema||!provider||!options.relatedQualification||!program.currentRecord||!options.targetOrigin)throw Error('native_related_product_adapter_inputs_required');
      const adapted=adaptNativeRelatedProductComponent(node,{provider,selection:program.currentRecord,query:node.query,targetOrigin:options.targetOrigin,schema,qualification:options.relatedQualification});
      widget=native(node.key,node.widgetType,moduleSettings(node,node.widgetType,adapted.settings),[],depth);out.relatedProductBindings!.push(adapted);
      bindNativeSettings(node.key,widget.id,widget.settings,schema.controls);
    }else if(node.kind==='native-categories'){
      const schema=schemas.wd_product_categories;if(!schema)throw Error(`Registered categories adapter unavailable: ${node.key}`);
      const adapted=adaptNative44Categories(node,schema,options.categories,native44Id(program.taskId,node.key),options.targetOrigin);
      widget=native(node.key,node.widgetType,moduleSettings(node,node.widgetType,adapted.settings),[],depth);out.categoryQueryReceipts!.push(adapted.receipt);
      bindNativeSettings(node.key,widget.id,widget.settings,schema.controls);
    }else if(node.kind==='native-posts'){
      const schema=schemas.wd_blog;if(!schema)throw Error(`Registered blog adapter unavailable: ${node.key}`);
      const adapted=adaptNative44Posts(node,schema,options.posts,native44Id(program.taskId,node.key),options.targetOrigin);
      widget=native(node.key,node.widgetType,moduleSettings(node,node.widgetType,adapted.settings),[],depth);out.postQueryReceipts!.push(adapted.receipt);
      bindNativeSettings(node.key,widget.id,widget.settings,schema.controls);
    }else{
      const schema=schemas[node.widgetType];if(!schema)throw new Error(`Registered native component unavailable: ${node.widgetType}`);
      if(node.kind==='native-carousel')validateNative44Carousel(node,schema);
      if(node.kind==='native')validateNative44ResourceBindings(node.widgetType,node.widgetSettings,node.resources,options.targetOrigin??catalog?.targetOrigin,node.pendingForm?{program,node,schemas,capability:pendingByKey.get(node.key)}:undefined);
      const childNodes=native44Children(node);if(childNodes.some(child=>child.kind!=='composite'))throw new Error(`Desktop native44 nested Widget children require explicit composite containers: ${node.key}`);
      const inputSettings=resolve(node.widgetSettings)as Record<string,unknown>,settings=adaptNative44Children(node.widgetType,inputSettings,childNodes.map(child=>child.key),schema,program.taskId,node.key),fixed=fixedChildSettings(node,schema,childNodes);
      widget=native(node.key,node.widgetType,moduleSettings(node,node.widgetType,settings),childNodes.map(child=>compileCompact(child,depth+1,fixed)),depth);
      bindNativeSettings(node.key,widget.id,widget.settings,schema.controls);
    }
    out.widgetTargets[node.key]=widget.id;return widget;
  };
  const compile=(node:Native44Component,depth:number,inherited?:Record<string,unknown>):ElementorElement=>{
    const outer=resolve({...inherited,...node.settings})as Record<string,unknown>,moduleClass=native44ModuleClass(node.key),classKey=['css_classes','_css_classes'].find(key=>schemas.container?.controls[key]&&knowledge.controlsByWidget.container?.has(key));
    if(!classKey)throw new Error('Native44 stable module classes require the actual registered container class control');
    const originalClass=outer[classKey];if(originalClass!==undefined&&(typeof originalClass!=='string'||!/^[a-zA-Z0-9_\s-]*$/.test(originalClass)))throw new Error(`Invalid native module classes: ${node.key}`);
    outer[classKey]=[originalClass??'',moduleClass].filter(Boolean).join(' ');out.moduleClasses[node.key]=moduleClass;
    let content:ElementorElement[];
    if(node.kind==='composite')content=node.children.map(child=>compile(child,depth+1));
    else if(node.kind==='html-static'){
      const key=`${node.key}-content`,id=native44Id(program.taskId,key),proof=renderStaticHTML(node,program.taskId,id,assets,'final');out.htmlProofs.push(proof);out.bindings.push(...proof.bindings);content=[native(key,'html',{html:proof.html},[],depth+1,node.key)];out.widgetTargets[node.key]=id;
    }else if(node.kind==='native-products'){
      const key=`${node.key}-products`,schema=schemas[node.widgetType];if(!schema)throw new Error(`Registered product adapter unavailable: ${node.widgetType}`);
      const adapted=adaptNative44Products(node,schema,catalog,queried,program.taskId,native44Id(program.taskId,key));content=[native(key,node.widgetType,resolve(adapted.settings)as Record<string,unknown>,[],depth+1,node.key)];out.queryReceipts.push(...adapted.receipts);out.widgetTargets[node.key]=content[0].id;
    }else if(node.kind==='native-posts'){
      throw Error('Native posts cannot reinterpret a historical wrapper program');
    }else if(node.kind==='native-categories'){
      throw Error('Native categories cannot reinterpret a historical wrapper program');
    }else if(node.kind==='native-related-products'){
      throw Error('Native related products cannot reinterpret a historical wrapper program');
    }else{
      const schema=schemas[node.widgetType];if(!schema)throw new Error(`Registered native component unavailable: ${node.widgetType}`);
      if(node.kind==='native-carousel')validateNative44Carousel(node,schema);
      if(node.kind==='native')validateNative44ResourceBindings(node.widgetType,node.widgetSettings,node.resources,options.targetOrigin??catalog?.targetOrigin);
      const childNodes=native44Children(node),inputSettings=resolve(node.widgetSettings)as Record<string,unknown>,settings=adaptNative44Children(node.widgetType,inputSettings,childNodes.map(child=>child.key),schema,program.taskId,node.key);
      let fixed:Record<string,unknown>|undefined;
      if(schema.nativeChildContract?.policy==='fixed'){
        // Widget_Nested_Base default children may carry an editor Navigator
        // label that is not a registered Container control. Keep that exact
        // source-backed label as metadata; real layout defaults still undergo
        // the normal local/live control intersection. Program settings never
        // enter this separation and cannot use it to smuggle unknown fields.
        const{_title:editorTitle,...layoutDefaults}=schema.nativeChildContract.childSettings??{};
        if(editorTitle!==undefined){if(typeof editorTitle!=='string'||editorTitle.length>500)throw new Error(`Invalid source-declared nested editor title: ${node.widgetType}/${node.key}`);(out.nestedChildMetadata??=[]).push({parentComponentKey:node.key,widgetType:node.widgetType,childComponentKeys:childNodes.map(child=>child.key),editorTitle,sourceSha256:schema.nativeChildContract.sourceSha256});}
        fixed=layoutDefaults;
      }
      const key=`${node.key}-native`,widget=native(key,node.widgetType,settings,childNodes.map(child=>compile(child,depth+2,fixed)),depth+1,node.key);content=[widget];
      out.widgetTargets[node.key]=widget.id;
      for(const[path,value]of Object.entries(settings))if(typeof value==='string')out.bindings.push({componentKey:node.key,elementId:widget.id,kind:'native',settingPath:path,value});
    }
    return native(node.key,'container',outer,content,depth);
  };
  out.composition.elements=program.blocks.map(node=>compact?compileCompact(node,0):compile(node,0));
  out.plan={title:program.title,mode:'legacy-verified',compositionJson:JSON.stringify(out.composition),mappings:Object.entries(out.elementMap).map(([sourceId,targetId])=>({sourceId,targetId})),unsupported:[],rationale:compact?'Fixed native44 component contracts; desktop content units; explicit layout containers; read-only CSS handoff.':'Fixed native44 component contracts; native panel content; complete responsive tree; read-only CSS handoff.'};
  const checked=validatePlan(out.plan,{mode:'legacy-verified',widgetSchemas:schemas,maxElements:2500,allowedMedia,htmlProofs:out.htmlProofs,pendingFormAuthorizations:formAuthorizations.map(row=>row.authorization)});out.plan=checked.plan;out.composition=checked.composition as Native44Compiled['composition'];out.elementMap=checked.elementMap;
  // Legacy editorTitle/source labels remain readable contract metadata only.
  // Every compilation leaves Navigator naming to the registered native component.
  if(formAuthorizations.length){
    const elements=new Map<string,ElementorElement>();const index=(nodes:ElementorElement[])=>{for(const node of nodes){elements.set(node.id,node);index(node.elements);}};index(out.composition.elements);
    const final=formAuthorizations.map(({capability,authorization})=>{const element=elements.get(authorization.elementId)!;return{capability,authorization:bindPendingFormAttributeAuthorization(capability,element.id,element.settings,schemas.form)};});
    compiledPendingForms.set(out,final);out.pendingFormBindings=final.map(({capability,authorization})=>native44PendingFormBinding(capability,authorization,elements.get(authorization.elementId)!.settings));
  }
  const collect=(node:ElementorElement):string[]=>[node.id,...node.elements.flatMap(collect)];out.sections=out.composition.elements.map((node,index)=>({key:program.blocks[index].key,targetId:node.id,elementIds:collect(node)}));out.sectionIds=out.sections.map(s=>s.targetId);out.usedTypes=[...used];compiledProofs.set(out,compilationDigest(out,out.composition));assertPendingCompilation(out);return out;
}
export function preflightNative44(program:Native44Program,options:Omit<Native44CompileOptions,'assets'>):{passed:true;usedTypes:string[];symbolicAssets:string[];components:number}{
  const keys=[...referencedNative44Assets(program)],assets=keys.map((key,index)=>({key,attachmentId:index+1,url:`https://asset-preflight.invalid/${key}`,sourceUrl:`https://asset-preflight.invalid/${key}`,sha256:'0'.repeat(64),mimeType:'image/png'}));const compiled=compileNative44(program,{...options,assets});return{passed:true,usedTypes:compiled.usedTypes,symbolicAssets:keys,components:walkNative44(program.blocks).length};
}
