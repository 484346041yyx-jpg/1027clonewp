import {buildNative44StyleCapabilities,findNative44StyleCapability} from '../src/native44/style-capabilities.js';
import {analyzeComponentModel} from '../src/native44/component-model.js';
import {nativeProductRequestPHP} from '../src/wordpress/native-product-request.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {existsSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {productRuntimeCapability,assertProductRuntimeCapability,productRuntimeReadPHP,CURRENT_PRODUCT_DOCUMENT_RUNTIME,type ProductRuntimeObservation} from '../src/wordpress/current-product-runtime.js';
import {nativeProductPreviewPHP} from '../src/wordpress/native-product-preview.js';
import {NATIVE44_ALL_TYPES,NATIVE44_CATALOG_HASH,CORE_SINGLE_PRODUCT_TYPES} from '../src/native44/catalog.js';
import {assertProgramNativeWidget,currentProductExtension,readProductExtension} from '../src/native44/product-extension.js';
import {loadNative44Knowledge,toNative44CompilerKnowledge,native44KnowledgeIdentity} from '../src/native44/knowledge.js';
import {compileNative44} from '../src/native44/compiler.js';
import {readCurrentProductProvider,CORE_PRODUCT_ADAPTERS} from '../src/native44/current-product.js';
import {currentProductFixture} from './fixtures/current-product.js';
import {NATIVE44_TARGET_ENVIRONMENT,type Native44Program} from '../src/native44/types.js';
import {readCurrentRelease,loadComponentRegistry} from '../src/components/registry.js';
const root='D:/cloneWP',origin='https://target.example',selection={recordType:'product' as const,productId:81001,contextKey:'currentProduct'};
const expected={targetOrigin:origin,pageId:90001,runId:'synthetic-run',productId:selection.productId,contextKey:selection.contextKey};
const observation=():ProductRuntimeObservation=>({version:1,runtime:CURRENT_PRODUCT_DOCUMENT_RUNTIME,...expected,readAt:new Date().toISOString(),postType:'woodmart_layout',layoutType:'single_product',providerClass:'XTS\\Modules\\Layouts\\Single_Product',sourceSha256:'a'.repeat(64),previewProductId:999,conditionsApplied:false,versions:{}});
test('native context proof cannot be serialized, moved to another template, product or origin, or reused after expiry',()=>{
 const o=observation(),cap=productRuntimeCapability(o,expected);assert.equal(assertProductRuntimeCapability(cap,selection,origin).previewProductId,999);
 assert.throws(()=>assertProductRuntimeCapability(structuredClone(cap),selection,origin));assert.throws(()=>assertProductRuntimeCapability(cap,{...selection,productId:99},origin));assert.throws(()=>assertProductRuntimeCapability(cap,selection,origin,90002));assert.throws(()=>assertProductRuntimeCapability(cap,selection,'https://other.example'));
 const stale=productRuntimeCapability({...o,readAt:new Date(Date.now()-16*60e3).toISOString()},expected);assert.throws(()=>assertProductRuntimeCapability(stale,selection,origin),/stale/);
 assert.throws(()=>productRuntimeCapability({...o,postType:'page' as any},expected));assert.throws(()=>productRuntimeCapability({...o,conditionsApplied:true as any},expected));
});
test('actual PHP rejects ordinary Pages, wrong layout kinds/owners and display conditions without writing anything',t=>{
 const php=path.join(root,'.cache/php-8.3/php.exe');if(!existsSync(php)){t.skip('PHP unavailable');return;}
 const code=productRuntimeReadPHP(90001,'synthetic-run',81001,'currentProduct');const exec=(extra={})=>{const r=spawnSync(php,[path.join(root,'tests/fixtures/native-product-runtime.php')],{cwd:root,input:JSON.stringify({code,...extra}),encoding:'utf8',windowsHide:true});assert.equal(r.status,0,r.stderr);assert.equal(r.stderr,'');return JSON.parse(r.stdout);};
 assert.equal(exec().postType,'woodmart_layout');assert.equal(exec({postType:'page'}).error,'native_product_template_owner');assert.equal(exec({layoutType:'archive'}).error,'native_product_template_owner');assert.equal(exec({runId:'other-run'}).error,'native_product_template_owner');assert.equal(exec({conditions:{single_product:{90001:{include:'all'}}}}).error,'native_product_template_has_display_conditions');
 const scoped=nativeProductRequestPHP(81001,'return true;');assert.match(scoped,/finally/);assert.match(scoped,/wp_the_query/);assert.doesNotMatch(scoped,/wp_insert|wp_update|update_option|update_post_meta/);
 assert.doesNotMatch(code,/wp_insert|wp_update|update_option|update_post_meta|add_to_cart/);
 const preview=nativeProductPreviewPHP(90001,'synthetic-run',81001,'currentProduct');assert.match(preview,/finally/);assert.match(preview,/woodmart_get_post_content/);assert.match(preview,/remove_filter/);assert.doesNotMatch(preview,/wp_insert|wp_update|update_option|update_post_meta/);
});
test('qualified additive knowledge reaches the existing compiler while an unchanged 44 task cannot acquire new widgets',async()=>{
 const extension=(await currentProductExtension(root))??JSON.parse(await readFile(path.join(root,'data/native-product/extension-staged.json'),'utf8')).extension;assert.ok(extension);const extra=await readProductExtension(extension,root);assert.equal(extra.index.baseCatalogHash,NATIVE44_CATALOG_HASH);assert.equal(extra.index.types.length,12);assert.equal(NATIVE44_ALL_TYPES.length,44);
 for(const type of CORE_SINGLE_PRODUCT_TYPES){assert.throws(()=>assertProgramNativeWidget(type));assert.doesNotThrow(()=>assertProgramNativeWidget(type,extension));}
 assert.throws(()=>assertProgramNativeWidget('invented_widget',extension));assert.throws(()=>assertProgramNativeWidget(CORE_SINGLE_PRODUCT_TYPES[0],{...extension,sha256:'f'.repeat(64)}));
 const knowledge=await loadNative44Knowledge(['container',...CORE_SINGLE_PRODUCT_TYPES],undefined,extension),baseline=JSON.parse(await readFile(path.join(root,'data/native-product/target-baseline.json'),'utf8'));
 const base=await loadNative44Knowledge(['container']);const container=base.components.container.controls;
 const schemas={...baseline.schemas,container:{type:'container',class:'SyntheticContainer',controls:Object.fromEntries(container.map(c=>[c.id,{type:c.type??'text'}]))}};
 const ref={path:'synthetic.json',sha256:'a'.repeat(64)};const program:Native44Program={version:2,workflow:'block-replication',executionStrategy:'native44-css-handoff',componentModelPolicy:'unified-components-v1',componentExtension:extension,currentRecord:selection,taskId:'native-product-test',title:'Synthetic',sourceUrl:'https://source.example/',componentCatalog:{...ref,sha256:NATIVE44_CATALOG_HASH},knowledge:{...ref,fingerprint:knowledge.index.fingerprint},targetEnvironment:{...NATIVE44_TARGET_ENVIRONMENT},sourceFacts:ref,componentPlan:ref,assetsManifest:ref,viewports:[{name:'desktop',width:1920,height:1080,stage:'desktop'}],blocks:CORE_SINGLE_PRODUCT_TYPES.map((type,i)=>({kind:'native',key:'core'+i,widgetType:type,sourceFactIds:['syntheticFact'],widgetSettings:type==='wd_single_product_tabs'?{enable_reviews:''}:{},model:{data:{source:'current-record',recordType:'product',contextKey:'currentProduct',field:CORE_PRODUCT_ADAPTERS[type].field,evidenceFactIds:['syntheticFact']}}}))};
 const capabilities=buildNative44StyleCapabilities(knowledge);assert.deepEqual(findNative44StyleCapability(capabilities,'wd_single_product_title','typography_font_size_mobile')?.declaredDevices,['mobile']);assert.equal(analyzeComponentModel(program).executable,true);assert.throws(()=>compileNative44({...program,currentRecord:undefined},{schemas,assets:[],knowledge:toNative44CompilerKnowledge(knowledge,schemas)}),/native_product_requires_current_record_template/);
 const provider=await readCurrentProductProvider({readTargetProduct:async()=>currentProductFixture()},selection,origin),runtime=productRuntimeCapability(observation(),expected);
 const compiled=compileNative44(program,{schemas,assets:[],knowledge:toNative44CompilerKnowledge(knowledge,schemas),targetOrigin:origin,currentProduct:provider,currentProductRuntime:runtime});assert.equal(compiled.currentProductBinding?.pageId,90001);for(const type of CORE_SINGLE_PRODUCT_TYPES)assert.ok(compiled.usedTypes.includes(type));
 const json=JSON.stringify(compiled.composition);assert.ok(!json.includes('Synthetic target product'));assert.ok(!json.includes('23.50'));assert.ok(!json.includes('81001'));
 assert.equal((await native44KnowledgeIdentity(root)).componentExtension,undefined);assert.equal((await native44KnowledgeIdentity(root,{componentExtension:extension})).componentExtension?.sha256,extension.sha256);
 const old=await readCurrentRelease(root,{componentExtension:null}),now=await readCurrentRelease(root,{componentExtension:extension});assert.equal(old.componentSet.types.length,44);assert.equal(now.componentSet.types.length,56);assert.equal(now.componentSet.catalog.sha256,old.componentSet.catalog.sha256);const registry=await loadComponentRegistry(root,undefined,{componentExtension:extension});assert.equal(registry.entries.length,56);assert.equal(registry.adapters[0].widgetTypes.length,56);
});
