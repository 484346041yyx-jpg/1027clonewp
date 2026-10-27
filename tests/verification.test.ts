import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import { chromium, type Route } from 'playwright';
import { captureTarget, compareElement, compareEvidence, createScopedContext, normalizeBindings, unverifiedEditability, verifyNativeEditor, verifyPage } from '../src/verification/index.js';
import { selectNativeWidget } from '../src/verification/editability.js';
import { createPixelDiagnostic } from '../src/verification/pixel-diagnostic.js';
import { handleScopedRoute } from '../src/verification/capture-target.js';
import type { SourceElementEvidence, TargetElementEvidence, TargetViewportEvidence } from '../src/verification/types.js';

const source: SourceElementEvidence = {
  id: 'source-title', kind: 'text', directText: 'Editable title', text: 'Editable title',
  style: { 'font-size': '32px', 'font-family': 'Arial, sans-serif', 'font-weight': '700', 'line-height': '40px', 'color': 'rgb(0, 0, 0)' },
  rect: { x: 0, y: 0, width: 500, height: 40 },
};
const target: TargetElementEvidence = {
  sourceId: source.id, targetId: 'title', selector: '[data-id="title"]', found: true, count: 1, nativeElement: true,
  text: 'Editable title', visible: true, rect: source.rect, contentRect: source.rect, style: source.style, images: [],
};
function measurement(elements = [target]): TargetViewportEvidence {
  return { name: 'desktop', width: 500, height: 400, url: 'https://site.test/?preview=true', title: 'Fixture', pageHeight: 400, screenshotPath: 'target.png', evidencePath: 'target.json', elements, overflow: [], clipping: [], imageFailures: [], consoleErrors: [], pageErrors: [], responseStatus: 200 };
}

test('geometry and typography agreement does not create mismatches', () => {
  assert.deepEqual(compareElement(source, target, 'desktop'), []);
});
test('quoted generic font names require actual equal glyph-font proof',()=>{
 const generic={...source,style:{...source.style,'font-family':'system-ui'}};
 const named={...target,style:{...target.style,'font-family':'"system-ui", sans-serif'}};
 assert(compareElement(generic,named,'desktop').some(issue=>issue.code==='typography-font-family'));
 const fonts=[{familyName:'Segoe UI',postScriptName:'SegoeUI',isCustomFont:false,glyphCount:14}];
 assert.deepEqual(compareElement({...generic,renderedFonts:fonts},{...named,fontText:'Editable title',renderedFonts:fonts},'desktop'),[]);
 assert(compareElement({...generic,renderedFonts:fonts},{...named,fontText:'Editable title',renderedFonts:[{...fonts[0],familyName:'Arial',postScriptName:'ArialMT'}]},'desktop').some(issue=>issue.code==='rendered-font-mismatch'));
});
test('container aggregate text does not invent unused parent typography',()=>{
 assert.deepEqual(compareElement({...source,kind:'container',directText:'',style:{'font-family':'system-ui'},text:'Editable title'},{...target,style:{'font-family':'"Roboto", sans-serif'}},'desktop'),[]);
});
test('same-size same-text button cannot pass changed background, radius, border and shadow',()=>{
 const style={...source.style,'background-color':'rgb(0, 0, 255)','border-radius':'0px','box-shadow':'none','border-top-width':'0px','border-top-style':'none','padding-top':'10px'};
 const correctSource={...source,kind:'button',style};
 assert.deepEqual(compareElement(correctSource,{...target,style},'desktop'),[]);
 const bad={...target,style:{...style,'background-color':'rgb(255, 0, 0)','border-radius':'16px','box-shadow':'rgb(0, 0, 0) 0px 3px 6px 0px','border-top-width':'2px','border-top-style':'solid','padding-top':'20px'}};
 for(const code of ['paint-background-color','paint-border-radius','paint-box-shadow','paint-border-top-width','paint-padding-top']) assert(compareElement(correctSource,bad,'desktop').some(issue=>issue.code===code),code);
});
test('equivalent native wrapper paint is measured instead of a transparent inner text box',()=>{
 const style={...source.style,'background-color':'rgb(0, 0, 255)','border-radius':'8px','box-shadow':'none'};
 const original={...source,kind:'button',style};
 const rendered={...target,style:{...style,'background-color':'rgba(0, 0, 0, 0)','border-radius':'0px'},paintLayers:[{rect:source.rect,role:'root' as const,effectiveOpacity:1,style},{rect:source.rect,role:'content' as const,effectiveOpacity:1,style:{...style,'background-color':'rgba(0, 0, 0, 0)','border-radius':'0px'}}]};
 assert.deepEqual(compareElement(original,rendered,'desktop'),[]);
});
test('container spacer can represent padding only with proved identical descendant geometry',()=>{
 const root:SourceElementEvidence={id:'root',parentId:null,kind:'container',style:{'padding-top':'25px'},rect:{x:0,y:0,width:500,height:400}};
 const child={...source,parentId:'root',rect:{...source.rect,y:25}};
 const rootTarget:TargetElementEvidence={...target,sourceId:'root',targetId:'root-target',text:'',rect:root.rect,contentRect:root.rect,style:{'padding-top':'0px'}};
 const childTarget={...target,rect:child.rect,contentRect:child.rect};
 const original={viewports:[{name:'desktop',width:500,height:400,elements:[root,child]}]};
 assert(!compareEvidence(original,[measurement([rootTarget,childTarget])],['root',source.id]).issues.some(issue=>issue.code==='paint-padding-top'));
 assert(compareEvidence(original,[measurement([rootTarget,{...childTarget,contentRect:{...child.rect,y:35}}])],['root',source.id]).issues.some(issue=>issue.code==='paint-padding-top'));
});
test('missing content, changed geometry and default typography are concrete repair evidence', () => {
  const issues = compareElement(source, { ...target, text: 'Wrong content', contentRect: { ...target.rect, x: 100, width: 200 }, style: { ...target.style, 'font-size': '16px', color: 'rgb(255, 0, 0)' } }, 'desktop');
  for (const code of ['content-missing','geometry-x','geometry-width','typography-font-size','typography-color']) assert(issues.some(issue => issue.code === code));
});
test('painted RGB/RGBA text color accounts for actual element opacity without losing fidelity',()=> {
  const transparentSource={...source,style:{...source.style,opacity:'0.6'},effectiveOpacity:0.6};
  const equivalentTarget={...target,style:{...target.style,color:'rgba(0, 0, 0, 0.6)',opacity:'1'},effectiveOpacity:1};
  assert.deepEqual(compareElement(transparentSource,equivalentTarget,'desktop'),[]);
  assert(compareElement(transparentSource,{...equivalentTarget,style:{...equivalentTarget.style,color:'rgb(0, 0, 0)'}},'desktop').some(issue=>issue.code==='typography-color'));
  assert(compareElement(transparentSource,{...equivalentTarget,effectiveOpacity:0.6},'desktop').some(issue=>issue.code==='typography-color'));
});
test('inherited ancestor opacity is measured and missing ancestor evidence is not silently accepted',()=> {
  const child={...source,parentId:'parent',style:{...source.style,opacity:'1'}};
  const parent:SourceElementEvidence={id:'parent',parentId:null,kind:'container',style:{opacity:'0.6'},rect:source.rect};
  const equivalent={...target,style:{...target.style,color:'rgba(0, 0, 0, 0.6)'},effectiveOpacity:1};
  const full=compareEvidence({viewports:[{name:'desktop',width:500,height:400,elements:[child,parent]}]},[measurement([equivalent])],[source.id]);
  assert.deepEqual(full.issues,[]);
  const incomplete=compareEvidence({viewports:[{name:'desktop',width:500,height:400,elements:[child]}]},[measurement([equivalent])],[source.id]);
  assert(incomplete.issues.some(issue=>issue.code==='source-ancestor-opacity-unverified'));
});
test('logical start/end alignment resolves through the measured writing direction',()=> {
  const rtlSource={...source,style:{...source.style,'text-align':'start',direction:'rtl'}};
  assert.deepEqual(compareElement(rtlSource,{...target,style:{...target.style,'text-align':'right',direction:'rtl'}},'desktop'),[]);
  assert(compareElement(rtlSource,{...target,style:{...target.style,'text-align':'left',direction:'rtl'}},'desktop').some(issue=>issue.code==='typography-text-align'));
});
test('unmapped source atoms and missing responsive verification cannot pass', () => {
  const report = compareEvidence({ complete: true, viewports: [
    { name: 'desktop', width: 500, height: 400, elements: [source, { ...source, id: 'unmapped' }] },
    { name: 'mobile', width: 390, height: 844, elements: [source] },
  ] }, [measurement()], ['source-title','unmapped']);
  assert(report.issues.some(issue => issue.code === 'unmapped-element'));
  assert(report.issues.some(issue => issue.code === 'target-viewport-missing'));
  assert.deepEqual(report.coverage, [{ viewport: 'desktop', expected: 2, matched: 1 }]);
});
test('one dynamic or login screen cannot be mistaken for a verified page', () => {
  const report = compareEvidence({ viewports: [{ name: 'desktop', width: 500, height: 400, elements: [source] }] }, [
    { ...measurement(), url: 'https://site.test/wp-login.php', responseStatus: 403, imageFailures: [{ url: 'https://site.test/missing.png', alt: '' }], pageErrors: ['ReferenceError: widget is undefined'] },
  ], [source.id]);
  for (const code of ['preview-login-redirect','preview-http-error','page-image-unloaded','frontend-exception']) assert(report.issues.some(issue => issue.code === code));
});
test('mapping rejects duplicate ownership and invalid targets', () => {
  assert.throws(() => normalizeBindings([{sourceId:'a',targetId:'one'},{sourceId:'a',targetId:'two'}]), /repeated/);
  assert.throws(() => normalizeBindings({a: {}}), /no target/);
});
test('native structure alone is explicitly unverified editor editability', () => {
  const report = unverifiedEditability();
  assert.equal(report.status, 'unverified');
  assert.equal(report.issues[0].status, 'unverified');
});
test('HTML widget appearance cannot certify native atom editability', () => {
  assert(compareElement(source, { ...target, widgetType: 'html.default' }, 'desktop').some(issue => issue.code === 'html-widget-substitution' && issue.severity === 'error'));
});

test('native links preserve resolved destinations and fragments', () => {
  const linkedSource = { ...source, kind: 'link', link: { href: '/contact#faq' } };
  const comparisonOptions = { sourceBaseUrl: 'https://source.test/catalog/', targetBaseUrl: 'https://target.test/?preview=true' };
  assert(compareElement(linkedSource, { ...target, href: 'https://source.test/contact#other' }, 'desktop', comparisonOptions).some(issue => issue.code === 'link-destination'));
  assert(compareElement(linkedSource, { ...target, href: '/contact#faq' }, 'desktop', comparisonOptions).some(issue => issue.code === 'link-destination'));
  assert(!compareElement(linkedSource, { ...target, href: 'https://source.test/contact#faq' }, 'desktop', comparisonOptions).some(issue => issue.code === 'link-destination'));
});

test('a same-sized wrong image fails despite correct geometry, alt text and crop', () => {
  const imageSource: SourceElementEvidence = { id:'photo',kind:'image',style:{},rect:{x:0,y:0,width:40,height:40},image:{url:'https://source.test/photo.png',alt:'Photo',objectFit:'cover',objectPosition:'50% 50%'} };
  const imageTarget: TargetElementEvidence = { ...target,sourceId:'photo',targetId:'image',text:'',rect:imageSource.rect,contentRect:imageSource.rect,style:{},images:[{url:'https://target.test/uploads/wrong.png',complete:true,naturalWidth:40,naturalHeight:40,rect:imageSource.rect,alt:'Photo',objectFit:'cover',objectPosition:'50% 50%'}] };
  const assetMap = [{sourceUrl:'https://source.test/photo.png',url:'https://target.test/uploads/photo.png',attachmentId:123,variants:['https://target.test/uploads/photo-40x40.png']}];
  assert(compareElement(imageSource,imageTarget,'desktop',{assetMap}).some(issue => issue.code === 'image-resource-mismatch' && issue.severity === 'error'));
  assert(compareElement(imageSource,imageTarget,'desktop').some(issue => issue.code === 'image-resource-unverified' && issue.severity === 'error'));
  const registeredVariant = { ...imageTarget,images:[{...imageTarget.images[0],url:'https://target.test/uploads/photo-40x40.png'}] };
  assert.deepEqual(compareElement(imageSource,registeredVariant,'desktop',{assetMap}),[]);
  const guessedVariant = { ...imageTarget,images:[{...imageTarget.images[0],url:'https://target.test/uploads/photo-39x39.png'}] };
  assert(compareElement(imageSource,guessedVariant,'desktop',{assetMap}).some(issue => issue.code === 'image-resource-mismatch'));
});
test('imported SVG icons and backgrounds cannot pass with same-sized substitutes',()=> {
  const iconSource:SourceElementEvidence={id:'source-icon',kind:'icon',style:{},rect:source.rect};
  const iconTarget={...target,sourceId:'source-icon',text:'',style:{},media:[]};
  const expectedMediaURLs={'source-icon':['https://target.test/uploads/logo.svg'],'source-background':['https://target.test/uploads/background.png']};
  assert(compareElement(iconSource,iconTarget,'desktop',{expectedMediaURLs}).some(issue=>issue.code==='mapped-media-missing'));
  assert.deepEqual(compareElement(iconSource,{...iconTarget,media:[{url:expectedMediaURLs['source-icon'][0],origin:'image'}]},'desktop',{expectedMediaURLs}),[]);
  const backgroundSource={...iconSource,id:'source-background',kind:'container',style:{'background-image':'url("https://source.test/background.png")'}};
  const fakeForeground={...iconTarget,sourceId:'source-background',media:[{url:expectedMediaURLs['source-background'][0],origin:'image' as const}]};
  assert(compareElement(backgroundSource,fakeForeground,'desktop',{expectedMediaURLs}).some(issue=>issue.code==='mapped-media-missing'));
  assert.deepEqual(compareElement(backgroundSource,{...fakeForeground,media:[{url:expectedMediaURLs['source-background'][0],origin:'pseudo'}]},'desktop',{expectedMediaURLs}),[]);
});
test('a frozen SVG opacity effect must not be applied a second time by native image opacity',()=> {
  const sourceImage:SourceElementEvidence={id:'logo',kind:'image',style:{opacity:'0.55'},effectiveOpacity:0.55,rect:{x:0,y:0,width:40,height:40},image:{url:'https://source.test/logo.svg',objectFit:'contain',objectPosition:'50% 50%'}};
  const targetImage:TargetElementEvidence={...target,sourceId:'logo',targetId:'image',text:'',rect:sourceImage.rect,contentRect:sourceImage.rect,style:{opacity:'0.55'},effectiveOpacity:0.55,images:[{url:'https://target.test/logo.png',complete:true,naturalWidth:40,naturalHeight:40,rect:sourceImage.rect,alt:'',objectFit:'contain',objectPosition:'50% 50%'}]};
  const assetMap=[{sourceUrl:'https://source.test/logo.svg',url:'https://target.test/logo.png',attachmentId:123,bakedOpacity:0.55}];
  assert(compareElement(sourceImage,targetImage,'desktop',{assetMap}).some(issue=>issue.code==='image-opacity-double-baked'));
  assert.deepEqual(compareElement(sourceImage,{...targetImage,style:{opacity:'1'},effectiveOpacity:1},'desktop',{assetMap}),[]);
});

test('a nonfunctional FAQ cannot pass from matching expanded DOM state alone', () => {
  const faqSource = { ...source,kind:'button' };
  const faqTarget = { ...target,expanded:'false',disabled:false };
  const evidence = { url:'https://source.test/',viewports:[{name:'desktop',width:500,height:400,elements:[faqSource],interactions:[{sourceNodeId:source.id,tag:'button',role:'button',text:'Editable title',expanded:'false',controls:'faq-panel',disabled:false}]}] };
  const comparison = compareEvidence(evidence,[measurement([faqTarget])],[source.id]);
  assert(comparison.issues.some(issue => issue.code === 'interaction-unverified' && issue.status === 'unverified' && issue.severity === 'error'));
  assert.equal(comparison.issues.some(issue => issue.severity === 'error'),true);
});

async function fixture(handler: (request: IncomingMessage, response: ServerResponse) => void): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer(handler);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Fixture server has no port.');
  return { url: `http://127.0.0.1:${address.port}`, close: async () => { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); } };
}

test('browser captures actual desktop/mobile computed styles and failed image evidence', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'clonewp-verify-'));
  const site = await fixture((request, response) => {
    if (request.url === '/missing.png') { response.writeHead(404); response.end('Missing'); return; }
    response.setHeader('Content-Type', 'text/html');
    response.end('<!doctype html><html><head><title>Verification fixture</title><style>body{margin:0}.elementor-heading-title{margin:0;font-family:Arial;font-size:32px;line-height:40px}@media(max-width:400px){.elementor-heading-title{font-size:24px;line-height:30px}}</style></head><body><main class="elementor" data-elementor-type="wp-page"><div data-id="title" class="elementor-element"><h1 class="elementor-heading-title">Editable title</h1></div><img src="/missing.png" width="20" height="20" alt="broken"></main></body></html>');
  });
  try {
    const result = await captureTarget({ previewUrl: site.url, runDir: directory, viewports: [{name:'desktop',width:500,height:400},{name:'mobile',width:390,height:844}], elementMap: { 'source-title': { targetId: 'title', kind: 'text' } } });
    assert.equal(result.length, 2);
    assert.equal(result[0].elements[0].style['font-size'], '32px');
    assert.equal(result[1].elements[0].style['font-size'], '24px');
    assert.equal(result[0].elements[0].nativeElement, true);
    assert.equal(result[0].imageFailures.length, 1);
    assert.equal((await sharp(result[1].screenshotPath).metadata()).width, 390);
  } finally { await site.close(); await rm(directory, { recursive: true, force: true }); }
});

test('draft preview comparison removes admin chrome only and retains native page spacing', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'clonewp-adminbar-'));
  const site = await fixture((_request,response) => {
    response.setHeader('Content-Type','text/html');
    response.end('<!doctype html><html><head><style>html{margin-top:32px!important}body{margin:0}#wpadminbar{position:fixed;top:0;height:32px;width:100%;background:black}.elementor{padding-top:20px;padding-left:40px}h1{margin:0;font:700 32px/40px Arial}</style></head><body><div id="wpadminbar">Admin toolbar</div><main class="elementor"><div class="elementor-element" data-id="title"><h1>Editable title</h1></div></main></body></html>');
  });
  try {
    const [measurement] = await captureTarget({previewUrl:site.url,runDir:directory,viewports:[{name:'desktop',width:500,height:400}],elementMap:{[source.id]:{targetId:'title',kind:'text'}}});
    assert.equal(measurement.previewChromeAdjusted,true);
    assert.equal(measurement.elements[0].rect.x,40);
    assert.equal(measurement.elements[0].rect.y,20);
    assert.equal(measurement.elements[0].style['font-size'],'32px');
  } finally { await site.close(); await rm(directory,{recursive:true,force:true}); }
});
test('canvas shell records page identity, body spacing and only visible theme toolbars',async()=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'clonewp-canvas-shell-'));
 const site=await fixture((_request,response)=>{response.setHeader('Content-Type','text/html');response.end('<!doctype html><body class="page page-id-123" style="padding-bottom:53px"><main class="elementor"><div class="elementor-element" data-id="title"><h1>Editable title</h1></div></main><div class="wd-toolbar" style="height:20px">Visible toolbar</div><div class="wd-toolbar" style="display:none">Hidden toolbar</div></body>');});
 try{const [result]=await captureTarget({previewUrl:site.url,runDir:directory,viewports:[{name:'desktop',width:500,height:400}],elementMap:{[source.id]:'title'}});assert.deepEqual(result.canvasShell,{bodyPageId:123,bodyPaddingBottom:'53px',visibleToolbarCount:1});}
 finally{await site.close();await rm(directory,{recursive:true,force:true});}
});

test('real safe FAQ behavior toggles state and content, restores, and can pass interaction checks', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'clonewp-faq-'));
  const site = await fixture((_request,response) => {
    response.setHeader('Content-Type','text/html');
    response.end('<!doctype html><html><head><style>body{margin:0}.elementor-element{font:700 32px/40px Arial;color:black}.elementor-tab-title{height:40px}.elementor-tab-content{display:none;height:50px}</style></head><body><main class="elementor"><div class="elementor-element elementor-widget-accordion" data-id="title" data-widget_type="accordion.default"><div class="elementor-accordion"><div class="elementor-accordion-item"><div class="elementor-tab-title" role="button" aria-expanded="false" aria-controls="faq-content" onclick="const next=this.getAttribute(\'aria-expanded\')!==\'true\';this.setAttribute(\'aria-expanded\',String(next));document.getElementById(\'faq-content\').style.display=next?\'block\':\'none\';window.toggleClicks=(window.toggleClicks||0)+1">Editable title</div><div id="faq-content" class="elementor-tab-content">Answer</div></div></div></div></main></body></html>');
  });
  const interaction = {sourceNodeId:source.id,tag:'button',role:'button',text:'Editable title',expanded:'false',controls:'original-faq-content',controlledContentText:'Answer',disabled:false};
  try {
    const [targetViewport] = await captureTarget({previewUrl:site.url,runDir:directory,viewports:[{name:'desktop',width:500,height:400}],elementMap:{[source.id]:{targetId:'title',kind:'button'}},sourceInteractions:{desktop:[interaction]}});
    const behavior = targetViewport.interactions![0];
    assert.equal(behavior.status,'verified',behavior.error ?? 'The safe FAQ should verify.');
    assert.equal(behavior.before!.contentVisible,false);
    assert.equal(behavior.after!.contentVisible,true);
    assert.equal(behavior.restoration!.contentVisible,false);
    assert.equal(behavior.restoration!.expanded,'false');
    assert.equal(behavior.restored,true);
    assert.equal(behavior.controlledContentText,'Answer');
    const report = compareEvidence({url:site.url,viewports:[{name:'desktop',width:500,height:400,elements:[{...source,kind:'button'}],interactions:[interaction]}]},[targetViewport],[source.id]);
    assert(!report.issues.some(issue => issue.code.startsWith('interaction-')));
    assert.deepEqual(report.issues,[]);
    const wrongAnswer=compareEvidence({url:site.url,viewports:[{name:'desktop',width:500,height:400,elements:[{...source,kind:'button'}],interactions:[{...interaction,controlledContentText:'Different answer'}]}]},[targetViewport],[source.id]);
    assert(wrongAnswer.issues.some(issue=>issue.code==='interaction-controlled-content'&&issue.severity==='error'));
  } finally { await site.close(); await rm(directory,{recursive:true,force:true}); }
});

test('a visually correct inert FAQ records failed click behavior and cannot pass', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'clonewp-inert-faq-'));
  const site = await fixture((_request,response) => {
    response.setHeader('Content-Type','text/html');
    response.end('<!doctype html><body style="margin:0"><main class="elementor"><div class="elementor-element" data-id="title" data-widget_type="accordion.default"><div class="elementor-accordion"><div class="elementor-accordion-item"><div class="elementor-tab-title" role="button" aria-expanded="false" aria-controls="faq-content">Editable title</div><div id="faq-content" class="elementor-tab-content" style="display:none">Answer</div></div></div></div></main></body>');
  });
  const interaction = {sourceNodeId:source.id,tag:'button',role:'button',text:'Editable title',expanded:'false',controls:'faq-content',disabled:false};
  try {
    const [targetViewport] = await captureTarget({previewUrl:site.url,runDir:directory,viewports:[{name:'desktop',width:500,height:400}],elementMap:{[source.id]:'title'},sourceInteractions:{desktop:[interaction]}});
    assert.equal(targetViewport.interactions![0].status,'failed');
    assert.equal(targetViewport.interactions![0].restored,true);
    const report = compareEvidence({url:site.url,viewports:[{name:'desktop',width:500,height:400,elements:[source],interactions:[interaction]}]},[targetViewport],[source.id]);
    assert(report.issues.some(issue => issue.code==='interaction-behavior-failed' && issue.severity==='error'));
  } finally { await site.close(); await rm(directory,{recursive:true,force:true}); }
});

test('exclusive FAQ validation restores an initially open sibling as well as the tested item', async () => {
  const directory=await mkdtemp(path.join(os.tmpdir(),'clonewp-exclusive-faq-'));
  const site=await fixture((_request,response)=> {
    response.setHeader('Content-Type','text/html');
    response.end('<!doctype html><body style="margin:0"><main class="elementor"><div class="elementor-element" data-id="title" data-widget_type="accordion.default"><div class="elementor-accordion"><div class="elementor-accordion-item"><div class="elementor-tab-title" role="button" aria-expanded="false" aria-controls="answer-a">Editable title</div><div id="answer-a" style="display:none">Answer A</div></div><div class="elementor-accordion-item"><div class="elementor-tab-title" role="button" aria-expanded="true" aria-controls="answer-b">Previously open</div><div id="answer-b">Answer B</div></div></div></div></main><script>document.querySelectorAll(".elementor-tab-title").forEach(control=>control.onclick=()=>{const next=control.getAttribute("aria-expanded")!=="true";document.querySelectorAll(".elementor-tab-title").forEach(item=>{item.setAttribute("aria-expanded","false");document.getElementById(item.getAttribute("aria-controls")).style.display="none"});control.setAttribute("aria-expanded",String(next));document.getElementById(control.getAttribute("aria-controls")).style.display=next?"block":"none"})</script></body>');
  });
  try {
    const [result]=await captureTarget({previewUrl:site.url,runDir:directory,viewports:[{name:'desktop',width:500,height:400}],elementMap:{[source.id]:'title'},sourceInteractions:{desktop:[{sourceNodeId:source.id,tag:'button',role:'button',text:'Editable title',expanded:'false',controls:'answer-a',disabled:false}]}});
    const evidence=result.interactions![0];
    assert.equal(evidence.status,'verified',evidence.error ?? 'Exclusive FAQ should restore its whole scope.');
    assert.equal(evidence.restored,true);
    const sibling=evidence.scopeRestoration!.find(item=>item.text==='Previously open');
    assert.equal(sibling!.before.expanded,'true');
    assert.equal(sibling!.after.expanded,'true');
    assert.equal(sibling!.after.contentVisible,true);
  } finally {await site.close();await rm(directory,{recursive:true,force:true});}
});

test('matching visual fixture still requires editor modification evidence before overall acceptance', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'clonewp-pass-'));
  const site = await fixture((_request, response) => {
    response.setHeader('Content-Type', 'text/html');
    response.end('<!doctype html><html><head><style>body{margin:0}h1{margin:0;font:700 32px/40px Arial;color:rgb(0,0,0)}</style></head><body><main class="elementor" data-elementor-type="wp-page"><div class="elementor-element" data-id="title"><h1>Editable title</h1></div></main></body></html>');
  });
  try {
    const report = await verifyPage({ previewUrl: site.url, runDir: directory, source: { complete: true, viewports: [{name:'desktop',width:500,height:400,elements:[source]}] }, elementMap: { [source.id]: { targetId: 'title', kind: 'text' } }, expectedSourceIds: [source.id], pixelDiagnostics: false });
    assert.equal(report.visualPassed, true);
    assert.equal(report.passed, false);
    assert.equal(report.status, 'needs-review');
    assert.equal(report.editability.status, 'unverified');
  } finally { await site.close(); await rm(directory, { recursive: true, force: true }); }
});

test('browser authentication rejects wider cookie scope and never uses authorization headers', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    await assert.rejects(createScopedContext(browser, 'https://target.example.test/', { cookies: [{ name: 'session', value: 'fixture-only', domain: '.example.test', path: '/', expires: -1, httpOnly: true, secure: true, sameSite: 'Lax' }] }), /exact target hostname/);
  } finally { await browser.close(); }
});

test('scoped route catches fetch, continue, fulfill and abort errors without leaking authenticated call logs', async () => {
  const origin = new URL('https://target.example.test/');
  const sensitiveFailure = new Error('route.fetch timeout; Cookie: fixture-auth-secret; Authorization: fixture-auth-header');
  for (const failure of ['fetch', 'fulfill', 'continue'] as const) {
    let aborts = 0; let fetchOptions: unknown; let continueOptions: { headers?: Record<string, string> } | undefined;
    const route = {
      request: () => ({ url: () => failure === 'continue' ? 'https://external.example.test/image.png' : origin.href, isNavigationRequest: () => failure !== 'continue', headers: () => ({ Cookie: 'fixture-auth-secret', authorization: 'fixture-auth-header', Accept: 'image/png' }) }),
      fetch: async (options: unknown) => { fetchOptions = options; if (failure === 'fetch') throw sensitiveFailure; return { headers: () => ({}), status: () => 200 }; },
      fulfill: async () => { throw sensitiveFailure; },
      continue: async (options: { headers?: Record<string, string> }) => { continueOptions = options; throw sensitiveFailure; },
      abort: async () => { aborts++; throw new Error('Context already closed; fixture-auth-secret'); },
    } as unknown as Route;
    assert.equal(await handleScopedRoute(route, origin), undefined); assert.equal(aborts, 1);
    if (failure !== 'continue') assert.deepEqual(fetchOptions, { maxRedirects: 0, timeout: 45000 });
    else assert.deepEqual(continueOptions, { headers: { Accept: 'image/png' } });
  }
});

test('scoped route blocks foreign authenticated navigation and redirects without continuing them', async () => {
  const origin = new URL('https://target.example.test/');
  for (const foreignNavigation of [true, false]) {
    let fetches = 0, aborts = 0, fulfills = 0, continues = 0;
    const route = {
      request: () => ({ url: () => foreignNavigation ? 'https://other.example.test/' : origin.href, isNavigationRequest: () => true }),
      fetch: async () => { fetches++; return { headers: () => ({ location: 'https://other.example.test/' }), status: () => 302 }; },
      abort: async () => { aborts++; }, fulfill: async () => { fulfills++; }, continue: async () => { continues++; },
    } as unknown as Route;
    await handleScopedRoute(route, origin);
    assert.equal(fetches, foreignNavigation ? 0 : 1); assert.equal(aborts, 1); assert.equal(fulfills, 0); assert.equal(continues, 0);
  }
});

test('failed authenticated navigation becomes a controlled capture error, with no unhandled route rejection or cookie headers', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'clonewp-navigation-failure-'));
  const site = await fixture((request) => { request.socket.destroy(); });
  try {
    await assert.rejects(captureTarget({ previewUrl: site.url, runDir: directory, viewports: [{ name: 'desktop', width: 500, height: 400 }], elementMap: { [source.id]: 'title' }, auth: { cookies: [{ name: 'wordpress_logged_in_fixture', value: 'fixture-auth-secret', domain: '127.0.0.1', path: '/', expires: -1, httpOnly: true, secure: false, sameSite: 'Lax' }] } }), (error: unknown) => {
      assert.ok(error instanceof Error); assert.equal(error.message, 'Target preview navigation failed or timed out; authentication details are omitted.');
      assert.doesNotMatch(error.message, /fixture-auth-secret|Cookie:|Authorization:|Call log:/i); return true;
    });
  } finally { await site.close(); await rm(directory, { recursive: true, force: true }); }
});

test('pixel diagnostic preserves shared coordinates and reports unequal heights without a success score', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'clonewp-pixel-'));
  try {
    const sourcePath = path.join(directory, 'source.png'), targetPath = path.join(directory, 'target.png');
    await sharp({ create: { width: 4, height: 6, channels: 3, background: '#000000' } }).png().toFile(sourcePath);
    await sharp({ create: { width: 4, height: 4, channels: 3, background: '#ffffff' } }).png().toFile(targetPath);
    const diagnostic = await createPixelDiagnostic(sourcePath, targetPath, path.join(directory, 'heatmap.png'));
    assert.equal(diagnostic.comparedHeight, 4);
    assert.equal(diagnostic.sourceHeight, 6);
    assert.equal(diagnostic.meanAbsoluteChannelDifference, 255);
    assert(!('passed' in diagnostic));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('editor UI fixture saves a real control change, confirms frontend and restores its owned snapshot', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'clonewp-editor-'));
  let title = 'Editable title', saves = 0, restores = 0;
  const site = await fixture((request, response) => {
    response.setHeader('Content-Type', 'text/html');
    if (request.url === '/save') {
      let body = '';
      request.on('data', chunk => { body += chunk; });
      request.on('end', () => { title = body; saves++; response.end('Saved'); });
      return;
    }
    if (request.url?.startsWith('/wp-admin/post.php')) {
      response.end('<!doctype html><body><div id="elementor-panel"><textarea data-setting="title">Editable title</textarea><button onclick="fetch(\'/save\',{method:\'POST\',body:document.querySelector(\'textarea\').value})">Save Draft</button></div><iframe id="elementor-preview-iframe" src="/?preview=true" style="width:800px;height:600px"></iframe></body>');
      return;
    }
    response.end(`<!doctype html><body><main class="elementor" data-elementor-type="wp-page"><div class="elementor-element" data-id="title"><h1 class="elementor-heading-title">${title}</h1></div></main></body>`);
  });
  try {
    const report = await verifyNativeEditor({ editorUrl: `${site.url}/wp-admin/post.php?post=17&action=elementor`, previewUrl: `${site.url}/?preview=true`, pageId: 17, runDir: directory, widgetMap: { [source.id]: { targetId: 'title', kind: 'heading' } }, requiredFields: ['title'], restore: async () => { title = 'Editable title'; restores++; return true; } });
    assert.equal(report.status, 'verified');
    assert.equal(report.checks[0].frontendConfirmed, true);
    assert.equal(report.checks[0].restored, true);
    assert.equal(saves, 1);
    assert.equal(restores, 1);
    assert.equal(title, 'Editable title');
  } finally { await site.close(); await rm(directory, { recursive: true, force: true }); }
});

test('editor selection uses observed native Navigator row when iframe clicks do not open the inspector', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'clonewp-navigator-'));
  let title = 'Editable title';
  const site = await fixture((request,response) => {
    response.setHeader('Content-Type','text/html; charset=utf-8');
    if (request.url === '/save') {
      let body=''; request.on('data',chunk => { body+=chunk; }); request.on('end',()=> { title=body; response.end('Saved'); }); return;
    }
    if (request.url?.startsWith('/wp-admin/post.php')) {
      response.end('<!doctype html><body><div id="elementor-panel" style="display:none"><textarea data-setting="title">Editable title</textarea><button onclick="fetch(\'/save\',{method:\'POST\',body:document.querySelector(\'textarea\').value})">保存草稿</button></div><div id="elementor-navigator"><button id="elementor-navigator__toggle-all" data-elementor-action="expand" onclick="document.querySelector(\'.elementor-navigator__element\').style.display=\'block\'">展开所有元素</button><div class="elementor-navigator__element" data-id="title" style="display:none"><div class="elementor-navigator__item" onclick="document.getElementById(\'elementor-panel\').style.display=\'block\'">标题</div></div></div><iframe id="elementor-preview-iframe" src="/?preview=true" style="width:800px;height:600px"></iframe></body>'); return;
    }
    response.end(`<!doctype html><body><main class="elementor"><div data-id="title"><h1 class="elementor-heading-title">${title}</h1></div></main></body>`);
  });
  try {
    const report=await verifyNativeEditor({editorUrl:`${site.url}/wp-admin/post.php?post=17&action=elementor`,previewUrl:`${site.url}/?preview=true`,pageId:17,runDir:directory,widgetMap:{[source.id]:{targetId:'title',kind:'heading'}},requiredFields:['title'],restore:async()=> {title='Editable title';return true;}});
    assert.equal(report.status,'verified',JSON.stringify(report.issues));
    assert.equal(report.checks[0].frontendConfirmed,true);
    assert.equal(report.checks[0].restored,true);
  } finally { await site.close(); await rm(directory,{recursive:true,force:true}); }
});

test('native Navigator selection expands only collapsed ancestors despite a stale expand-all attribute', async () => {
  const site = await fixture((request, response) => {
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (request.url === '/frame') {
      response.end('<!doctype html><body><div data-id="title"><h1>Native title</h1></div><div data-id="image"><img src="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2230%22 height=%2230%22/%3E" width="30" height="30"></div></body>');
      return;
    }
    response.end(`<!doctype html><body>
      <script>
        const counters={global:0,carets:0,selected:[]};
        window.__navigatorSelectionCounters=counters;
        function expand(button){
          counters.carets++;
          const item=button.parentElement, children=item.nextElementSibling;
          item.classList.toggle('elementor-active');
          setTimeout(()=>children.style.display=item.classList.contains('elementor-active')?'block':'none',300);
        }
        function select(id){counters.selected.push(id)}
        function globalToggle(){counters.global++;document.querySelectorAll('.elementor-navigator__elements').forEach(e=>e.style.display=counters.global%2?'block':'none')}
      </script>
      <div id="elementor-navigator">
        <button id="elementor-navigator__toggle-all" data-elementor-action="expand" onclick="globalToggle()">Expand all</button>
        <div class="elementor-navigator__element" data-id="header">
          <div class="elementor-navigator__item"><button class="elementor-navigator__element__list-toggle" onclick="expand(this)">Open header</button></div>
          <div class="elementor-navigator__elements" style="display:none"><div class="elementor-navigator__element" data-id="title"><div class="elementor-navigator__item" onclick="select('title')">Title</div></div></div>
        </div>
        <div class="elementor-navigator__element" data-id="hero">
          <div class="elementor-navigator__item"><button class="elementor-navigator__element__list-toggle" onclick="expand(this)">Open hero</button></div>
          <div class="elementor-navigator__elements" style="display:none"><div class="elementor-navigator__element" data-id="hero-visual">
            <div class="elementor-navigator__item"><button class="elementor-navigator__element__list-toggle" onclick="expand(this)">Open visual</button></div>
            <div class="elementor-navigator__elements" style="display:none"><div class="elementor-navigator__element" data-id="image"><div class="elementor-navigator__item" onclick="select('image')">Image</div></div></div>
          </div></div>
        </div>
      </div>
      <iframe id="elementor-preview-iframe" src="/frame" style="width:600px;height:300px"></iframe>
    </body>`);
  });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(site.url);
    const frame = page.frameLocator('#elementor-preview-iframe');
    await frame.locator('[data-id="title"]').waitFor({ state: 'visible' });
    for (const id of ['title', 'image', 'title']) await selectNativeWidget(frame.locator(`[data-id="${id}"]`), page);
    const facts = await page.evaluate(() => ({
      counters: (window as unknown as { __navigatorSelectionCounters: { global: number; carets: number; selected: string[] } }).__navigatorSelectionCounters,
      attribute: document.querySelector('#elementor-navigator__toggle-all')?.getAttribute('data-elementor-action'),
      expanded: [...document.querySelectorAll('.elementor-navigator__item.elementor-active')].length,
    }));
    assert.deepEqual(facts.counters, { global: 0, carets: 3, selected: ['title', 'image', 'title'] });
    assert.equal(facts.attribute, 'expand');
    assert.equal(facts.expanded, 3);
  } finally { await browser.close(); await site.close(); }
});

test('a page without headings proves native text-editor content and color editing through its HTML tab',async()=> {
  const directory=await mkdtemp(path.join(os.tmpdir(),'clonewp-no-heading-'));
  let state={content:'<p>Editable body &amp; text</p>',color:'#000000'};
  const site=await fixture((request,response)=> {
    response.setHeader('Content-Type','text/html; charset=utf-8');
    if(request.url==='/save'){let body='';request.on('data',chunk=>{body+=chunk});request.on('end',()=>{state=JSON.parse(body);response.end('Saved')});return;}
    if(request.url?.startsWith('/wp-admin/post.php')){
      response.end('<!doctype html><body><div id="elementor-panel"><button class="wp-switch-editor switch-html" onclick="document.querySelector(\'textarea\').style.display=\'block\'">Text</button><textarea data-setting="editor" class="elementor-wp-editor" style="display:none">&lt;p&gt;Editable body &amp;amp; text&lt;/p&gt;</textarea><button data-tab="style">Style</button><div class="elementor-control-text_color"><button class="pcr-button" onclick="document.querySelector(\'.pcr-app\').style.display=\'block\'">Choose color</button></div><button onclick="fetch(\'/save\',{method:\'POST\',body:JSON.stringify({content:document.querySelector(\'textarea\').value,color:document.querySelector(\'.pcr-result\').value})})">Save Draft</button></div><div class="pcr-app" style="display:none"><input class="pcr-result" value="#000000"></div><iframe id="elementor-preview-iframe" src="/?preview=true" style="width:800px;height:600px"></iframe></body>');return;
    }
    response.end(`<!doctype html><body><main class="elementor"><div data-id="bodytext" data-widget_type="text-editor.default" class="elementor-element"><div class="elementor-widget-container" style="color:${state.color}">${state.content}</div></div></main></body>`);
  });
  try{
    const report=await verifyNativeEditor({editorUrl:`${site.url}/wp-admin/post.php?post=17&action=elementor`,previewUrl:`${site.url}/?preview=true`,pageId:17,runDir:directory,widgetMap:{'source-body':'bodytext'},restore:async()=>{state={content:'<p>Editable body &amp; text</p>',color:'#000000'};return true;}});
    assert.equal(report.status,'verified',JSON.stringify(report.issues));
    assert.deepEqual(report.requiredFields,['content','style']);
    assert.deepEqual(report.verifiedFields,['content','style']);
    assert.deepEqual(state,{content:'<p>Editable body &amp; text</p>',color:'#000000'});
  }finally{await site.close();await rm(directory,{recursive:true,force:true});}
});

test('editor UI fixture refuses Publish-only controls and restores the temporary modification', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'clonewp-publish-'));
  let publishes = 0, restores = 0;
  const site = await fixture((request, response) => {
    response.setHeader('Content-Type', 'text/html');
    if (request.url === '/publish') publishes++;
    if (request.url?.startsWith('/wp-admin/post.php')) {
      response.end('<!doctype html><body><div id="elementor-panel"><textarea data-setting="title">Editable title</textarea><button onclick="fetch(\'/publish\')">Publish</button></div><iframe id="elementor-preview-iframe" src="/?preview=true" style="width:800px;height:600px"></iframe></body>');
      return;
    }
    response.end('<!doctype html><body><main class="elementor"><div data-id="title"><h1>Editable title</h1></div></main></body>');
  });
  try {
    const report = await verifyNativeEditor({ editorUrl: `${site.url}/wp-admin/post.php?post=17&action=elementor`, previewUrl: `${site.url}/?preview=true`, pageId: 17, runDir: directory, widgetMap: { [source.id]: { targetId: 'title', kind: 'heading' } }, restore: async () => { restores++; return true; } });
    assert.equal(report.status, 'failed');
    assert.equal(publishes, 0);
    assert.equal(restores, 1);
    assert(report.issues.some(issue => /Publish button was not used/.test(issue.message)));
  } finally { await site.close(); await rm(directory, { recursive: true, force: true }); }
});

test('editor UI fixture verifies all requested title, image and native style fields and restores each', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'clonewp-fields-'));
  let state = { title: 'Editable title', color: '#000000', image: '/original.svg' }, saves = 0;
  const site = await fixture((request, response) => {
    if (request.url === '/original.svg' || request.url === '/replacement.svg') {
      response.setHeader('Content-Type','image/svg+xml');
      response.end('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="green"/></svg>');
      return;
    }
    response.setHeader('Content-Type', 'text/html');
    if (request.url === '/save') {
      let body = '';
      request.on('data', chunk => { body += chunk; });
      request.on('end', () => { state = JSON.parse(body); saves++; response.end('Saved'); });
      return;
    }
    if (request.url?.startsWith('/wp-admin/post.php')) {
      response.end(`<!doctype html><body>
        <div id="elementor-panel">
          <textarea data-setting="title">Editable title</textarea>
          <button data-tab="style">Style</button>
          <div class="elementor-control-title_color"><button class="pcr-button" onclick="document.querySelector('.pcr-app').style.display='block'">Choose color</button></div>
          <div class="elementor-control-image"><button class="elementor-control-media__preview" onclick="document.querySelector('.media-modal').style.display='block'">Choose image</button></div>
          <input id="image-value" value="/original.svg" type="hidden">
          <button onclick="fetch('/save',{method:'POST',body:JSON.stringify({title:document.querySelector('textarea').value,color:document.querySelector('.pcr-result').value,image:document.querySelector('#image-value').value})})">Save Draft</button>
        </div>
        <div class="pcr-app" style="display:none"><input class="pcr-result" value="#000000"></div>
        <div class="media-modal" style="display:none"><button class="attachment" data-id="2">Replacement image</button><button class="media-button-select" onclick="document.querySelector('#image-value').value='/replacement.svg';document.querySelector('.media-modal').style.display='none'">Insert Media</button></div>
        <iframe id="elementor-preview-iframe" src="/?preview=true" style="width:800px;height:600px"></iframe>
      </body>`);
      return;
    }
    response.end(`<!doctype html><body><main class="elementor" data-elementor-type="wp-page"><div class="elementor-element" data-id="title"><h1 class="elementor-heading-title" style="color:${state.color}">${state.title}</h1></div><div class="elementor-element" data-id="image"><img src="${state.image}" width="40" height="40"></div></main></body>`);
  });
  try {
    const report = await verifyNativeEditor({ editorUrl: `${site.url}/wp-admin/post.php?post=17&action=elementor`, previewUrl: `${site.url}/?preview=true`, pageId: 17, runDir: directory,
      widgetMap: { [source.id]: { targetId: 'title', kind: 'heading' }, 'source-image': { targetId: 'image', kind: 'image' } },
      imageReplacement: { attachmentId: 2, url: `${site.url}/replacement.svg` },
      restore: async () => { state = {title:'Editable title',color:'#000000',image:'/original.svg'}; return true; },
    });
    assert.equal(report.status, 'verified', JSON.stringify(report.issues));
    assert.deepEqual(report.requiredFields, ['title','style','image']);
    assert.deepEqual([...report.verifiedFields!].sort(), ['image','style','title']);
    assert.equal(saves, 3);
    assert.deepEqual(state, {title:'Editable title',color:'#000000',image:'/original.svg'});
  } finally { await site.close(); await rm(directory, { recursive: true, force: true }); }
});
