import test from 'node:test';
import assert from 'node:assert/strict';
import { compileNative44, assertNative44Compilation, bindNative44CanvasShell, referencedNative44Assets } from '../src/native44/compiler.js';
import { validateNative44Program } from '../src/native44/validate.js';
import { NATIVE44_ALL_TYPES, NATIVE44_CATALOG_HASH } from '../src/native44/catalog.js';
import { NATIVE44_TARGET_ENVIRONMENT, type Native44Program, type Native44Component } from '../src/native44/types.js';
import type { LegacySchema } from '../src/wordpress/types.js';
import { WordPressClient } from '../src/wordpress/client.js';
import { canvasShellCSS } from '../src/wordpress/canvas-shell.js';
import { loadNative44Knowledge, toNative44CompilerKnowledge } from '../src/native44/knowledge.js';

const digest='a'.repeat(64),ref={path:'D:/cloneWP/test-fixture.json',sha256:digest};
function program(blocks:Native44Component[]):Native44Program{return{version:2,workflow:'block-replication',executionStrategy:'native44-css-handoff',taskId:'native44-test',title:'Native44 test',sourceUrl:'https://source.example/',componentCatalog:{...ref,sha256:NATIVE44_CATALOG_HASH},knowledge:{...ref,fingerprint:digest},targetEnvironment:{...NATIVE44_TARGET_ENVIRONMENT},sourceFacts:ref,componentPlan:ref,assetsManifest:ref,viewports:[{name:'desktop',width:1920,height:1080,stage:'desktop'},{name:'mobile',width:390,height:844,stage:'responsive'}],blocks};}
const text=(key='title'):Native44Component=>({kind:'native',key,role:'heading',widgetType:'heading',widgetSettings:{title:'Pets & products'}});
const relation={childType:'container' as const,baseClass:'Elementor\\Modules\\NestedElements\\Base\\Widget_Nested_Base',sourceSha256:digest};
const fields=(names:string[])=>Object.fromEntries(names.map(name=>[name,{type:name==='include'?'wd_autocomplete':name==='title'?'text':'select',...(name==='post_type'?{options:{ids:'IDs',product:'Product'}}:name==='orderby'?{options:{date:'Date'}}:{})}]));
function schemas():Record<string,LegacySchema>{return{
  container:{type:'container',class:'Container',controls:{css_classes:{type:'text'},content_width:{type:'select',options:{full:'Full'}},width:{type:'slider',size_units:['px','%']},width_mobile:{type:'slider',size_units:['px','%']}}},
  heading:{type:'heading',class:'Heading',controls:{title:{type:'textarea'}}},
  wd_image_or_svg:{type:'wd_image_or_svg',class:'Image',controls:{image:{type:'media'}}},
  wd_toggle:{type:'wd_toggle',class:'Toggle',controls:{element_title:{type:'text'}},nativeChildContract:{...relation,policy:'fixed',count:1,childSettings:{content_width:'full'}}},
  'nested-carousel':{type:'nested-carousel',class:'NestedCarousel',controls:{carousel_items:{type:'nested-elements-repeater',fields:[{name:'slide_title',type:'text'}]},slides_to_show:{type:'select',options:{'1':'One','2':'Two'}}},nativeChildContract:{...relation,policy:'repeater',repeaterKey:'carousel_items',titleSettingKey:'slide_title'}},
  wd_nested_carousel:{type:'wd_nested_carousel',class:'WdNestedCarousel',controls:{slides:{type:'nested-elements-repeater',fields:[{name:'slide_title',type:'text'}]},slides_per_view:{type:'slider',size_units:['px']}},nativeChildContract:{...relation,policy:'repeater',repeaterKey:'slides',titleSettingKey:'slide_title'}},
  wd_banner_carousel:{type:'wd_banner_carousel',class:'Banner',controls:{content_repeater:{type:'repeater',fields:[{name:'title',type:'text'}]}}},
  wd_products:{type:'wd_products',class:'Products',controls:{...fields(['post_type','include','orderby']),items_per_page:{type:'number'}}},
  'woocommerce-products':{type:'woocommerce-products',class:'WooProducts',controls:{query_post_type:{type:'select',options:{by_id:'IDs'}},query_posts_ids:{type:'query'},query_orderby:{type:'select',options:{date:'Date'}},query_order:{type:'select',options:{desc:'Descending'}},columns:{type:'number',default:2},rows:{type:'number',default:2}}},
  wd_products_tabs:{type:'wd_products_tabs',class:'ProductsTabs',controls:{items_per_page:{type:'number'},tabs_items:{type:'repeater',fields:fields(['title','post_type','include','orderby'])}}},
};}
function options(s=schemas()){return{schemas:s,assets:[],catalog:{targetOrigin:'https://target.example',evidence:['catalog.json'],products:[1,2,3,4].map(id=>({id,name:`Product ${id}`,permalink:`https://target.example/p/${id}`,imageUrl:`https://target.example/${id}.png`}))},knowledge:{fingerprint:digest,controlsByWidget:Object.fromEntries(Object.entries(s).map(([key,value])=>[key,new Set(Object.keys(value.controls))]))}};}
test('native44 compiles independently editable native content with full responsive settings in one tree',()=>{
  const p=program([{kind:'composite',key:'card',settings:{width:{unit:'px',size:500},width_mobile:{unit:'%',size:100}},children:[text()]}]),compiled=compileNative44(p,options());
  assert.deepEqual(compiled.usedTypes.sort(),['container','heading']);assert.deepEqual(compiled.composition.elements[0].settings.width_mobile,{unit:'%',size:100});assert.equal(compiled.htmlProofs.length,0);assert.match(compiled.moduleClasses.card,/^cwp-n44-/);assertNative44Compilation(compiled,compiled.composition);
});
test('native44 rejects all out-of-set widgets and generic product/HTML bypasses',()=>{
  for(const widgetType of ['image','spacer','shortcode','unknown'])assert.throws(()=>validateNative44Program(program([{kind:'native',key:'bad',widgetType,widgetSettings:{}}])),/not_allowed/);
  for(const widgetType of ['wd_products','woocommerce-products','wd_products_tabs'])assert.throws(()=>validateNative44Program(program([{kind:'native',key:'bad',widgetType,widgetSettings:{}}])),/query adapter/);
  assert.throws(()=>validateNative44Program(program([{kind:'native',key:'bad',widgetType:'html',widgetSettings:{}}])),/typed html-static/);
});
test('native44 rejects ordinary content disguised as an HTML exception',()=>{
  const html={kind:'html-static' as const,key:'bad',template:'<div><h2 data-cwp-text="title"></h2></div>',css:'',slots:{text:{title:'Heading'},media:{},links:{}},exception:{reason:'unsupported-content-model' as const,summary:'Native candidate cannot express this local content model.',candidates:[{widgetType:'heading',limitation:'The implementation lacks a required semantic relationship.',evidence:[ref]}]}};
  assert.throws(()=>validateNative44Program(program([html])),/must use native/);
  assert.throws(()=>validateNative44Program(program([{...html,role:'heading'}])),/editable native/);
  assert.throws(()=>validateNative44Program(program([{...html,template:'<div></div>',exception:{...html.exception,candidates:[{...html.exception.candidates[0],limitation:'Spacing differs from the reference image and should be fixed.'}]}}])),/styling difference/);
});
test('native44 local and installed controls stay separate and intersect',()=>{
  const o=options();o.knowledge.controlsByWidget.heading.delete('title');assert.throws(()=>compileNative44(program([text()]),o),/researched local\/live intersection/);
  const o2=options();assert.throws(()=>compileNative44(program([{...text(),kind:'native',widgetType:'heading',widgetSettings:{title:'Good',unknown:'Bad'}}]),o2),/intersection/);
});
test('native44 converts stable repeater aliases to Elementor identities without accepting duplicates',()=>{
  const component:Native44Component={kind:'native-carousel',key:'banner',widgetType:'wd_banner_carousel',widgetSettings:{content_repeater:[{_id:'source-one',title:'First'},{_id:'source-two',title:'Second'}]}};
  const compiled=compileNative44(program([component]),options());
  const rows=compiled.composition.elements[0].elements[0].settings.content_repeater as Array<{_id:string}>;
  assert.equal(rows.length,2);assert.ok(rows.every(row=>/^[a-f0-9]{7}$/.test(row._id)));assert.notEqual(rows[0]._id,rows[1]._id);
  assert.throws(()=>compileNative44(program([{...component,widgetSettings:{content_repeater:[{_id:'same',title:'First'},{_id:'same',title:'Second'}]}}]),options()),/duplicate native44 repeater identity/);
});
test('native44 fixed toggle children are not treated as a repeater',()=>{
  const compiled=compileNative44(program([{kind:'native',key:'toggle',widgetType:'wd_toggle',widgetSettings:{element_title:'Read more'},children:[{kind:'composite',key:'toggle-content',children:[text()]}]}]),options());
  const widget=compiled.composition.elements[0].elements[0];assert.equal(widget.elements.length,1);assert.equal(widget.elements[0].settings.content_width,'full');assert.deepEqual(Object.keys(widget.settings),['element_title']);
  assert.throws(()=>compileNative44(program([{kind:'native',key:'toggle',widgetType:'wd_toggle',widgetSettings:{element_title:'Read more'},children:[]}]),options()),/Fixed native child count/);
});

test('native44 separates only verified fixed-child editor labels from real layout defaults',()=>{
  const s=schemas();s.wd_toggle.nativeChildContract={...relation,policy:'fixed',count:1,childSettings:{_title:'Toggle content',content_width:'full'}};
  const p=program([{kind:'native',key:'toggle',widgetType:'wd_toggle',widgetSettings:{element_title:'Shop'},children:[{kind:'composite',key:'toggle-content',children:[text()]}]}]);
  const compiled=compileNative44(p,options(s)),child=compiled.composition.elements[0].elements[0].elements[0];
  assert.equal(child.settings.content_width,'full');assert.equal(Object.hasOwn(child.settings,'_title'),false);
  assert.deepEqual(compiled.nestedChildMetadata,[{parentComponentKey:'toggle',widgetType:'wd_toggle',childComponentKeys:['toggle-content'],editorTitle:'Toggle content',sourceSha256:digest}]);
  const explicit=structuredClone(p);(explicit.blocks[0] as Extract<Native44Component,{kind:'native'}>).children![0].settings={_title:'Caller supplied'};
  assert.throws(()=>compileNative44(explicit,options(s)),/intersection.*container\._title/);
  s.wd_toggle.nativeChildContract={...relation,policy:'fixed',count:1,childSettings:{_title:'Toggle content',content_width:'full',unregistered_layout:'must fail'}};
  assert.throws(()=>compileNative44(p,options(s)),/intersection.*container\.unregistered_layout/);
});
test('native44 nested carousel adapters use distinct source-backed repeater and display fields',()=>{
  const compiled=compileNative44(program([{kind:'native-carousel',key:'el',widgetType:'nested-carousel',widgetSettings:{slides_to_show:'1'},slides:[text('el-one'),text('el-two')]},{kind:'native-carousel',key:'wd',widgetType:'wd_nested_carousel',widgetSettings:{slides_per_view:{unit:'px',size:1}},slides:[text('wd-one'),text('wd-two')]}]),options());
  const [el,wd]=compiled.composition.elements.map(root=>root.elements[0]);assert.equal((el.settings.carousel_items as unknown[]).length,2);assert.equal(wd.settings.carousel_items,undefined);assert.equal((wd.settings.slides as unknown[]).length,2);assert.deepEqual(wd.settings.slides_per_view,{unit:'px',size:1});
});
test('native44 setting repeater carousel has real items and no fake child containers',()=>{
  const compiled=compileNative44(program([{kind:'native-carousel',key:'banner',widgetType:'wd_banner_carousel',widgetSettings:{content_repeater:[{title:'First'},{title:'Second'}]}}]),options());
  const widget=compiled.composition.elements[0].elements[0];assert.equal(widget.elements.length,0);const rows=widget.settings.content_repeater as Array<{_id:string}>;assert.notEqual(rows[0]._id,rows[1]._id);
  assert.throws(()=>compileNative44(program([{kind:'native-carousel',key:'banner',widgetType:'wd_banner_carousel',widgetSettings:{content_repeater:[{title:'Only'}]}}]),options()),/at least two/);
});
test('native44 product adapters have distinct query fields and one receipt per tab',()=>{
  const compiled=compileNative44(program([{kind:'native-products',key:'wd',widgetType:'wd_products',widgetSettings:{},query:{ids:[1],evidence:['row-one.json']}},{kind:'native-products',key:'woo',widgetType:'woocommerce-products',widgetSettings:{columns:2,rows:1},query:{ids:[2],evidence:['row-two.json']}},{kind:'native-products',key:'tabs',widgetType:'wd_products_tabs',widgetSettings:{},tabs:[{key:'one',title:'One',query:{ids:[3],evidence:['tab-one.json']}},{key:'two',title:'Two',query:{ids:[4],evidence:['tab-two.json']}}]}]),options());
  const [wd,woo,tabs]=compiled.composition.elements.map(root=>root.elements[0]);assert.deepEqual(wd.settings.include,[1]);assert.equal(wd.settings.query_posts_ids,undefined);assert.deepEqual(woo.settings.query_posts_ids,[2]);assert.equal(woo.settings.include,undefined);assert.equal((tabs.settings.tabs_items as unknown[]).length,2);assert.equal(compiled.queryReceipts.length,4);assert.deepEqual(compiled.queryReceipts.filter(r=>r.collectionPath).map(r=>r.collectionPath),['tabs_items.0','tabs_items.1']);
});
test('native44 rejects insufficient target resources, overlapping products and query filters',()=>{
  assert.throws(()=>compileNative44(program([{kind:'native-products',key:'bad',widgetType:'wd_products',widgetSettings:{},query:{ids:[88],evidence:['actual.json']}}]),options()),/Insufficient/);
  assert.throws(()=>compileNative44(program([1,2].map(i=>({kind:'native-products',key:`row${i}`,widgetType:'wd_products',widgetSettings:{},query:{ids:[1],evidence:['actual.json']}}))),options()),/overlapping/);
  assert.throws(()=>compileNative44(program([{kind:'native-products',key:'bad',widgetType:'wd_products',widgetSettings:{sale:'yes'},query:{ids:[1],evidence:['actual.json']}}]),options()),/query filter/);
});
test('native44 reuses one asset file at multiple display positions',()=>{
  const p=program(['one','two'].map(key=>({kind:'native',key,widgetType:'wd_image_or_svg',widgetSettings:{image:{$asset:'logo'}}}))),o={...options(),assets:[{key:'logo',attachmentId:10,url:'https://target.example/logo.png',sourceUrl:'https://source.example/logo.png',sha256:digest,mimeType:'image/png'}]};
  assert.deepEqual([...referencedNative44Assets(p)],['logo']);const compiled=compileNative44(p,o);assert.equal(compiled.composition.elements.length,2);assert.deepEqual(compiled.composition.elements.map(root=>root.elements[0].settings.image),[{id:10,url:'https://target.example/logo.png'},{id:10,url:'https://target.example/logo.png'}]);
});
test('only the exact cropped native image slot may bypass WordPress srcset with its imported URL',()=>{
  const p=program(['cropped','square'].map(key=>({kind:'native',key,widgetType:'wd_image_or_svg',widgetSettings:{image:{$asset:'photo'}}}))),asset={key:'photo',attachmentId:10,url:'https://target.example/photo.webp',sourceUrl:'https://source.example/photo.webp',sha256:digest,mimeType:'image/webp'};
  const input={...options(),assets:[asset],directImageSlots:[{componentKey:'cropped',assetKey:'photo'}]};
  const compiled=compileNative44(p,input);
  assert.deepEqual(compiled.composition.elements.map(root=>root.elements[0].settings.image),[{id:0,url:asset.url},{id:10,url:asset.url}]);
  assert.throws(()=>compileNative44(p,{...input,directImageSlots:[{componentKey:'missing',assetKey:'photo'}]}),/Invalid native44 direct image slot/);
  assert.throws(()=>compileNative44(p,{...input,directImageSlots:[{componentKey:'cropped',assetKey:'other'}]}),/Invalid native44 direct image slot/);
});
test('native44 writer proof rejects persisted copies and later mutations; permits exact Canvas shell',()=>{
  const compiled=compileNative44(program([text()]),options());assert.throws(()=>assertNative44Compilation(structuredClone(compiled),compiled.composition),/current-process/);
  const shell={pageId:77,enabled:true,css:canvasShellCSS(77,'@media (max-width: 1024px){.sticky-toolbar-on{padding-bottom:55px}@media (min-width: 1025px){.wd-toolbar{display:none}}')};bindNative44CanvasShell(compiled,shell);assertNative44Compilation(compiled,compiled.composition);compiled.composition.elements[0].settings.css_classes='mutated';assert.throws(()=>assertNative44Compilation(compiled,compiled.composition),/current-process/);
});
test('native44 client blocks discovery and lazy schemas outside the 44 before any network call',async()=>{
  let calls=0;const client=new WordPressClient({targetUrl:'https://target.example',username:'fixture',applicationPassword:'fixture',executionStrategy:'native44-css-handoff',allowedWidgetTypes:NATIVE44_ALL_TYPES,fetch:async()=>{calls++;throw new Error('Must not fetch');}});
  await assert.rejects(client.discoverCapabilities(['image']),/not_allowed/);await assert.rejects(client.getWidgetSchema('spacer'),/not_allowed/);assert.equal(calls,0);
  assert.throws(()=>new WordPressClient({targetUrl:'https://target.example',username:'fixture',applicationPassword:'fixture',executionStrategy:'native44-css-handoff',allowedWidgetTypes:['container','heading']}),/exact fixed 44/);
});
test('native44 compiler consumes the imported per-component knowledge without casting it into a live schema',async()=>{
  const loaded=await loadNative44Knowledge(['container','heading']),p=program([text()]);p.knowledge.fingerprint=loaded.index.fingerprint;
  const s=schemas(),compiled=compileNative44(p,{...options(s),knowledge:toNative44CompilerKnowledge(loaded,s)});
  assert.equal(compiled.composition.elements[0].elements[0].settings.title,'Pets & products');assert.equal(compiled.htmlProofs.length,0);
});
