import test from 'node:test';
import assert from 'node:assert/strict';
import { compileNative44, assertNative44Compilation, bindNative44CanvasShell } from '../src/native44/compiler.js';
import { native44Id, native44ModuleClass } from '../src/native44/adapters.js';
import { NATIVE44_CATALOG_HASH } from '../src/native44/catalog.js';
import { NATIVE44_SELECTION_RULES_HASH } from '../src/native44/selection-rules.js';
import { native44ProfileViewports } from '../src/native44/profile.js';
import { NATIVE44_TARGET_ENVIRONMENT, type Native44Component, type Native44Program } from '../src/native44/types.js';
import type { LegacySchema } from '../src/wordpress/types.js';
import type { ElementorElement } from '../src/planning/plan.js';
import { canvasShellCSS } from '../src/wordpress/canvas-shell.js';

const digest='b'.repeat(64),ref={path:'D:/cloneWP/tests/fixtures/desktop-compiler.json',sha256:digest};
const relation={childType:'container' as const,baseClass:'Elementor\\Modules\\NestedElements\\Base\\Widget_Nested_Base',sourceSha256:digest};
const widgetClass={_css_classes:{type:'text'}};
function schemas():Record<string,LegacySchema>{return{
  container:{type:'container',class:'Container',controls:{css_classes:{type:'text'},content_width:{type:'select',options:{full:'Full'}},width:{type:'slider',size_units:['px','%']}}},
  heading:{type:'heading',class:'Heading',controls:{...widgetClass,title:{type:'textarea'},_margin:{type:'dimensions',size_units:['px']}}},
  'text-editor':{type:'text-editor',class:'TextEditor',controls:{...widgetClass,editor:{type:'wysiwyg'},_animation:{type:'animation',frontend_available:true}}},
  wd_image_or_svg:{type:'wd_image_or_svg',class:'Image',controls:{...widgetClass,image:{type:'media'}}},
  html:{type:'html',class:'Html',controls:{...widgetClass,html:{type:'code'}}},
  wd_toggle:{type:'wd_toggle',class:'Toggle',controls:{...widgetClass,element_title:{type:'text'}},nativeChildContract:{...relation,policy:'fixed',count:1,childSettings:{_title:'Source content label',content_width:'full'}}},
  'nested-carousel':{type:'nested-carousel',class:'Carousel',controls:{...widgetClass,carousel_items:{type:'nested-elements-repeater',fields:[{name:'slide_title',type:'text'}]},infinite:{type:'switcher',options:{yes:'On',no:'Off'}},arrows:{type:'switcher',options:{yes:'On'}},pagination:{type:'select',options:{'':'None',bullets:'Dots'}}},nativeChildContract:{...relation,policy:'repeater',repeaterKey:'carousel_items',titleSettingKey:'slide_title'}},
  wd_banner_carousel:{type:'wd_banner_carousel',class:'Banners',controls:{...widgetClass,content_repeater:{type:'repeater',fields:[{name:'title',type:'text'},{name:'link',type:'url'}]}}},
  wd_products:{type:'wd_products',class:'Products',controls:{...widgetClass,post_type:{type:'select',options:{ids:'IDs'}},include:{type:'wd_autocomplete'},orderby:{type:'select',options:{date:'Date'}},items_per_page:{type:'number'}}},
};}
const title=(key='title'):Native44Component=>({kind:'native',key,widgetType:'heading',widgetSettings:{title:'A source title'}});
const layout=(key:string,children:Native44Component[]):Native44Component=>({kind:'composite',key,children});
function program(children:Native44Component[]):Native44Program{return{
  version:2,workflow:'block-replication',executionStrategy:'native44-css-handoff',replicationProfile:'desktop-browser-v1',selectionRulesHash:NATIVE44_SELECTION_RULES_HASH,
  taskId:'desktop-compiler',title:'Desktop compiler test',sourceUrl:'https://source.example/',componentCatalog:{...ref,sha256:NATIVE44_CATALOG_HASH},knowledge:{...ref,fingerprint:digest},targetEnvironment:{...NATIVE44_TARGET_ENVIRONMENT},sourceFacts:ref,componentPlan:ref,assetsManifest:ref,
  viewports:native44ProfileViewports('desktop-browser-v1'),blocks:[layout('section',children)],
};}
function options(s=schemas()){return{
  schemas:s,assets:[],catalog:{targetOrigin:'https://target.example',evidence:['catalog.json'],products:[1,2,3].map(id=>({id,name:`Product ${id}`,permalink:`https://target.example/p/${id}`,imageUrl:`https://target.example/${id}.png`}))},
  knowledge:{fingerprint:digest,controlsByWidget:Object.fromEntries(Object.entries(s).map(([type,schema])=>[type,new Set(Object.keys(schema.controls))]))},
};}
const flatten=(nodes:ElementorElement[]):ElementorElement[]=>nodes.flatMap(node=>[node,...flatten(node.elements)]);

test('desktop compiler emits leaf Widgets directly and places module classes on their own registered controls',()=>{
  const p=program([{...title(),widgetSettings:{title:'A source title',_css_classes:'existing-title',_margin:{unit:'px',top:4,right:0,bottom:6,left:0}}} as Native44Component]),compiled=compileNative44(p,options()),nodes=flatten(compiled.composition.elements);
  assert.equal(nodes.length,2);assert.deepEqual(nodes.map(node=>node.elType),['container','widget']);
  assert.equal(nodes[1].id,native44Id(p.taskId,'title'));assert.equal(nodes[1].settings._css_classes,`existing-title ${native44ModuleClass('title')}`);
  assert.deepEqual(nodes[1].settings._margin,{unit:'px',top:4,right:0,bottom:6,left:0});assert.equal(nodes[0].settings._margin,undefined);
  assert.equal(compiled.elementMap.title,nodes[1].id);assert.equal(compiled.widgetTargets.title,nodes[1].id);assert.equal(compiled.widgetTargets.section,undefined);
  assert.equal(Object.hasOwn(compiled.elementMap,'title-native'),false);assertNative44Compilation(compiled,compiled.composition);
});

test('desktop nested carousel keeps only explicitly planned slide Containers and stable Repeater rows',()=>{
  const p=program([{kind:'native-carousel',key:'hero',widgetType:'nested-carousel',widgetSettings:{carousel_items:[{_id:'abcdef1',slide_title:'First'},{_id:'abcdef2',slide_title:'Second'}]},slides:[layout('slide-one',[title('one')]),layout('slide-two',[title('two')])]}]);
  const compiled=compileNative44(p,options()),root=compiled.composition.elements[0],carousel=root.elements[0];
  assert.equal(carousel.widgetType,'nested-carousel');assert.equal(carousel.elements.length,2);assert.deepEqual(carousel.elements.map(node=>node.elType),['container','container']);assert.equal(flatten([root]).length,6);
  assert.equal(carousel.elements[0].elements[0].widgetType,'heading');assert.equal(compiled.widgetTargets.hero,carousel.id);
  const binding=compiled.bindings.find(row=>row.componentKey==='hero'&&row.settingPath==='carousel_items.0.slide_title');assert.equal(binding?.elementId,carousel.id);assert.equal(binding?.slot,'carousel_items[abcdef1].slide_title');
  assert.deepEqual(compiled.repeaterBindings?.find(row=>row.settingPath==='carousel_items.0.slide_title')?.repeaterRows,[{path:'carousel_items',rowId:'abcdef1'}]);
  assert.deepEqual(compileNative44(p,options()).composition,compiled.composition);
});

test('desktop compiler preserves the registered carousel loop and text entrance animation',()=>{
  const schema=schemas(),knowledge=options(schema).knowledge;
  knowledge.controlsByWidget['text-editor'].delete('_animation');
  knowledge.controlsByWidget['nested-carousel'].delete('loop');
  const carousel:Native44Component={kind:'native-carousel',key:'brands',widgetType:'nested-carousel',widgetSettings:{loop:'yes',arrows:'no',pagination:'none'},slides:[layout('slide-one',[title('one')]),layout('slide-two',[title('two')])]};
  const copy:Native44Component={kind:'native',key:'copyright',widgetType:'text-editor',widgetSettings:{editor:'Copyright',_animation:'fadeInUp'}};
  const compiled=compileNative44(program([carousel,copy]),{...options(schema),knowledge});
  const widgets=flatten(compiled.composition.elements).filter(node=>node.elType==='widget');
  assert.equal(widgets.find(node=>node.widgetType==='nested-carousel')?.settings.infinite,'yes');
  assert.equal(widgets.find(node=>node.widgetType==='nested-carousel')?.settings.arrows,'');
  assert.equal(widgets.find(node=>node.widgetType==='nested-carousel')?.settings.pagination,'');
  assert.equal(widgets.find(node=>node.widgetType==='text-editor')?.settings._animation,'fadeInUp');
  assert.throws(()=>compileNative44(program([{...carousel,widgetSettings:{loop:'yes',infinite:'no'}}]),{...options(schema),knowledge}),/loop alias conflicts/);
});

test('desktop fixed child layout defaults preserve the real child Container without naming it',()=>{
  const p=program([{kind:'native',key:'toggle',widgetType:'wd_toggle',widgetSettings:{element_title:'Details'},children:[layout('content',[title()])]}]),compiled=compileNative44(p,options()),toggle=compiled.composition.elements[0].elements[0],content=toggle.elements[0];
  assert.equal(toggle.widgetType,'wd_toggle');assert.equal(content.elType,'container');assert.equal(content.settings.content_width,'full');assert.equal(content.elements[0].widgetType,'heading');
  assert.equal(content.settings._title,undefined);assert.equal(compiled.editorLabels,undefined);assert.equal(compiled.elementMap.content,content.id);assertNative44Compilation(compiled,compiled.composition);
});

test('legacy editor titles never become Navigator aliases and content stays intact',()=>{
  const p=program([{...title(),editorTitle:'Main headline'}]);p.blocks[0].editorTitle='Services section';
  const compiled=compileNative44(p,options()),[root,widget]=flatten(compiled.composition.elements);assert.equal(root.settings._title,undefined);assert.equal(widget.settings._title,undefined);
  assert.equal(compiled.editorLabels,undefined);assert.equal(JSON.parse(compiled.plan.compositionJson).elements[0].settings._title,undefined);
  widget.settings._title='Changed after compilation';assert.throws(()=>assertNative44Compilation(compiled,compiled.composition),/exact current-process/);
  const raw=program([{...title(),widgetSettings:{title:'Title',_title:'Caller supplied raw title'}} as Native44Component]);assert.throws(()=>compileNative44(raw,options()),/intersection.*heading\._title/);
});

test('native translated Navigator names omit aliases and nested fallback without changing render settings, identities or bindings',()=>{
  const p=program([
    title(),
    {kind:'native',key:'toggle',widgetType:'wd_toggle',widgetSettings:{element_title:'Details'},children:[layout('content',[title('details')])]},
    {kind:'native-carousel',key:'hero',widgetType:'nested-carousel',widgetSettings:{carousel_items:[{_id:'abcdef1',slide_title:'First'}]},slides:[layout('slide',[title('slide-title')])]},
    {kind:'native-products',key:'products',widgetType:'wd_products',widgetSettings:{},query:{ids:[1],evidence:['query.json']}},
  ]);
  p.blocks[0].editorTitle='Section alias';if(p.blocks[0].kind==='composite')p.blocks[0].children[0].editorTitle='Heading alias';
  const legacy=compileNative44(p,options()),native=structuredClone(p);native.editorNaming='native-translated-v1';
  const strip=(nodes:Native44Component[]):void=>{for(const node of nodes){delete node.editorTitle;if(node.kind==='composite'||node.kind==='native')strip(node.children??[]);else if(node.kind==='native-carousel')strip(node.slides??[]);}};strip(native.blocks);
  const compiled=compileNative44(native,options());
  assert.equal(compiled.editorNaming,'native-translated-v1');assert.equal(compiled.editorLabels,undefined);
  assert.ok(flatten(compiled.composition.elements).every(node=>!Object.hasOwn(node.settings,'_title')));
  const rendered=structuredClone(legacy.composition);for(const node of flatten(rendered.elements))delete node.settings._title;
  assert.deepEqual(compiled.composition,rendered);
  for(const key of ['elementMap','widgetTargets','moduleClasses','bindings','repeaterBindings','queryReceipts','sections','sectionIds','usedTypes'] as const)assert.deepEqual(compiled[key],legacy[key]);
  assert.deepEqual(compiled.nestedChildMetadata,legacy.nestedChildMetadata);assertNative44Compilation(compiled,compiled.composition);
  assert.deepEqual(JSON.parse(compiled.plan.compositionJson),compiled.composition);
  // Legacy contracts remain readable, but never reintroduce aliases.
  assert.deepEqual(compileNative44(p,options()).composition,legacy.composition);
  delete compiled.editorNaming;assert.throws(()=>assertNative44Compilation(compiled,compiled.composition),/exact current-process/);
});

test('native translated naming rejects custom aliases instead of replacing them with invented Chinese names',()=>{
  for(const target of ['container','widget'] as const){
    const p=program([title()]);p.editorNaming='native-translated-v1';
    if(target==='container')p.blocks[0].editorTitle='自定义容器';else if(p.blocks[0].kind==='composite')p.blocks[0].children[0].editorTitle='Custom heading';
    assert.throws(()=>compileNative44(p,options()),/native translated.*editorTitle/i);
  }
  const p=program([title()]);p.editorNaming='native-translated-v1';
  const injected={...options(),knowledge:{...options().knowledge,validateSettings:(type:string,value:Record<string,unknown>)=>type==='heading'?{...value,_title:'Injected label'}:value}};
  assert.throws(()=>compileNative44(p,injected),/native translated.*_title/i);
});

test('desktop compiler proof seals profile, selection rules and editor metadata as well as the tree',()=>{
  for(const field of ['profile','rules','labels'] as const){
    const compiled=compileNative44(program([{...title(),editorTitle:'Verified headline'}]),options());
    assert.equal(compiled.replicationProfile,'desktop-browser-v1');assert.equal(compiled.selectionRulesHash,NATIVE44_SELECTION_RULES_HASH);
    if(field==='profile')delete compiled.replicationProfile;
    if(field==='rules')compiled.selectionRulesHash='0'.repeat(64);
    if(field==='labels')compiled.editorLabels=[{elementId:compiled.composition.elements[0].id,title:'Unsealed replacement'}];
    assert.throws(()=>assertNative44Compilation(compiled,compiled.composition),/current-process/);
  }
});

test('desktop Canvas shell is profile specific and cannot accept the historical mobile shell',()=>{
  const source='@media (max-width: 1024px){.sticky-toolbar-on{padding-bottom:55px}@media (min-width: 1025px){.wd-toolbar{display:none}}',compiled=compileNative44(program([title()]),options()),css=canvasShellCSS(77,source,'desktop-browser-v1'),historicalCss=canvasShellCSS(77,source);
  assert.match(css,/@media \(min-width: 1025px\)/);assert.doesNotMatch(css,/max-width/);assert.match(historicalCss,/@media \(max-width: 1024px\)/);
  assert.throws(()=>bindNative44CanvasShell(compiled,{pageId:77,enabled:true,css:historicalCss}),/exact fixed owned Canvas shell/);
  bindNative44CanvasShell(compiled,{pageId:77,enabled:true,css});assert.equal(compiled.composition.pageSettings?.custom_css,css);assertNative44Compilation(compiled,compiled.composition);
});

test('desktop HTML exception proof and bindings refer to the emitted HTML Widget without a wrapper',()=>{
  const node:Native44Component={kind:'html-static',key:'local-semantics',template:'<nav><details><summary data-cwp-text="label"></summary><a data-cwp-link="destination"><span data-cwp-text="entry"></span></a></details></nav>',css:'details > summary{color:#004cdb}',slots:{text:{label:'Choose destination',entry:'Destination'},media:{},links:{destination:{url:'https://source.example/destination/'}}},exception:{reason:'unsupported-local-semantics',summary:'This local disclosure and link ownership needs one semantic relationship.',candidates:[{widgetType:'wd_list',limitation:'The required disclosure relationship cannot be represented by this content model.',evidence:[ref]}]}};
  const p=program([node]),compiled=compileNative44(p,options()),widget=compiled.composition.elements[0].elements[0];assert.equal(widget.widgetType,'html');assert.equal(widget.elements.length,0);
  assert.equal(compiled.htmlProofs[0].elementId,widget.id);assert.equal(compiled.widgetTargets[node.key],widget.id);assert.equal(compiled.elementMap[node.key],widget.id);assert.ok(compiled.bindings.every(row=>row.elementId===widget.id));assertNative44Compilation(compiled,compiled.composition);
});

test('desktop product receipts use real directly emitted product IDs and preserve disjoint frozen queries',()=>{
  const p=program([1,2].map(id=>({kind:'native-products',key:`products-${id}`,widgetType:'wd_products',widgetSettings:{},query:{ids:[id],evidence:[`query-${id}.json`]}}))),compiled=compileNative44(p,options()),widgets=compiled.composition.elements[0].elements;
  assert.deepEqual(widgets.map(widget=>widget.widgetType),['wd_products','wd_products']);assert.equal(flatten(compiled.composition.elements).length,3);
  for(const[index,widget]of widgets.entries()){assert.equal(compiled.queryReceipts[index].elementId,widget.id);assert.equal(compiled.widgetTargets[`products-${index+1}`],widget.id);assert.deepEqual(widget.settings.include,[index+1]);}
});

test('desktop setting Repeaters bind link URLs to actual setting paths and stable row identities',()=>{
  const p=program([{kind:'native-carousel',key:'banners',widgetType:'wd_banner_carousel',widgetSettings:{content_repeater:[{_id:'123abcd',title:'One',link:{url:'https://source.example/one/'}},{_id:'123abce',title:'Two',link:{url:'https://source.example/two/'}}]}}]),compiled=compileNative44(p,options()),widget=compiled.composition.elements[0].elements[0],binding=compiled.bindings.find(row=>row.settingPath==='content_repeater.0.link.url');
  assert.equal(binding?.elementId,widget.id);assert.equal(binding?.slot,'content_repeater[123abcd].link.url');assert.equal(binding?.value,'https://source.example/one/');assert.ok(!compiled.bindings.some(row=>row.settingPath?.endsWith('._id')));
});

test('desktop compiler does not copy Container settings or accept unregistered class controls on Widgets',()=>{
  const p=program([{...title(),settings:{width:{unit:'px',size:700}}}]);assert.throws(()=>compileNative44(p,options()),/composite|container/i);
  const classes=program([{...title(),widgetSettings:{title:'Title',_css_classes:'bad.class'}} as Native44Component]);assert.throws(()=>compileNative44(classes,options()),/module classes/);
  const s=schemas();delete s.heading.controls._css_classes;assert.throws(()=>compileNative44(program([title()]),options(s)),/registered heading class control/);
  const slide=program([{kind:'native-carousel',key:'hero',widgetType:'nested-carousel',widgetSettings:{},slides:[title('wrong-child')]}]);assert.throws(()=>compileNative44(slide,options()),/explicit composite|container/i);
});

test('historical no-profile compilation retains wrapper tree, suffix IDs, classes and top-level binding paths',()=>{
  const p=program([title()]);delete p.replicationProfile;delete p.selectionRulesHash;p.viewports=[{name:'desktop',width:1920,height:1080,stage:'desktop'},{name:'mobile',width:390,height:844,stage:'responsive'}];
  const compiled=compileNative44(p,options()),root=compiled.composition.elements[0],wrapper=root.elements[0],widget=wrapper.elements[0];
  assert.equal(flatten([root]).length,3);assert.equal(root.id,native44Id(p.taskId,'section'));assert.equal(wrapper.id,native44Id(p.taskId,'title'));assert.equal(wrapper.settings.css_classes,native44ModuleClass('title'));assert.equal(widget.id,native44Id(p.taskId,'title-native'));
  assert.equal(widget.settings._css_classes,undefined);assert.equal(compiled.elementMap.title,wrapper.id);assert.equal(compiled.elementMap['title-native'],widget.id);assert.equal(compiled.widgetTargets.title,widget.id);
  assert.deepEqual(compiled.bindings,[{componentKey:'title',elementId:widget.id,kind:'native',settingPath:'title',value:'A source title'}]);assert.equal(compiled.editorLabels,undefined);
});
