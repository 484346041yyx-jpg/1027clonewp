import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { chromium, type Browser } from 'playwright';
import { captureTarget } from '../src/verification/capture-target.js';

async function fixture(t: TestContext) {
  const server=createServer((_req,res)=>{res.writeHead(200,{'Content-Type':'text/html'});res.end('<!doctype html><html><head><style>html,body{margin:0;padding:0}.elementor{min-height:2500px}[data-id="1111111"]{height:300px;width:100%;background:#9ac}</style></head><body><main class="elementor"><section data-id="1111111" data-element_type="container">Original device facts</section></main></body></html>');});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));});
  const address=server.address();assert.ok(address&&typeof address==='object');
  const cache='D:/cloneWP/.cache';await mkdir(cache,{recursive:true});const runDir=await mkdtemp(path.join(cache,'test-capture-device-facts-'));
  t.after(async()=>{const absolute=path.resolve(runDir),relative=path.relative(path.resolve(cache),absolute);assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative));await rm(absolute,{recursive:true,force:true});});
  return{url:`http://127.0.0.1:${address.port}/`,runDir};
}

test('actual Chromium viewport tiles retain document client width, DOM boxes and the measured raster width',async t=>{
  const browser=await chromium.launch({headless:true,ignoreDefaultArgs:['--hide-scrollbars']});t.after(async()=>{await browser.close();});const f=await fixture(t);
  const result=(await captureTarget({browser,previewUrl:f.url,runDir:f.runDir,viewports:[{name:'tablet',width:900,height:500}],elementMap:{root:{targetId:'1111111',kind:'container'}}}))[0];
  const persisted=JSON.parse(await readFile(result.evidencePath,'utf8'));
  assert.equal(result.deviceFacts?.innerWidth,900);assert.equal(result.deviceFacts?.clientWidth,885);assert.equal(result.elements[0].rect.width,result.deviceFacts?.clientWidth);
  assert.deepEqual(persisted.deviceFacts,result.deviceFacts);assert.equal(persisted.screenshotGeometry.measurementFactsCaptured,'same-dom-measurement-before-screenshot');
  assert.equal(persisted.screenshotCapture.documentLayoutPreserved,true);assert.equal(persisted.screenshotCapture.passed,true);assert.equal(persisted.screenshotCapture.contentRaster.width,885);assert.equal(persisted.afterScreenshotFacts.clientWidth,885);
  assert.ok(persisted.afterScreenshotFacts);assert.ok((await readFile(result.screenshotPath)).length>1000);
});

test('actual post-screenshot browser metric changes remain separate diagnostics and cannot overwrite original measurement facts',async t=>{
  const browser=await chromium.launch({headless:true,ignoreDefaultArgs:['--hide-scrollbars']});t.after(async()=>{await browser.close();});const f=await fixture(t);
  // Produce the real screenshot, then induce a real browser viewport change at
  // that boundary. This deterministically tests the same overwrite hazard even
  // when a particular Chromium release restores its screenshot metrics quickly.
  const originalContext=browser.newContext.bind(browser);
  const boundaryBrowser=new Proxy(browser,{get(target,key){if(key==='newContext')return async(...args:Parameters<Browser['newContext']>)=>{const context=await originalContext(...args),originalCDP=context.newCDPSession.bind(context);context.newCDPSession=async page=>{const session=await originalCDP(page),send=session.send.bind(session);let changed=false;session.send=(async(method:string,params:unknown)=>{const value=await send(method as never,params as never);if(method==='Page.captureScreenshot'&&!changed){changed=true;await (page as import('playwright').Page).setViewportSize({width:930,height:500});}return value;})as typeof session.send;return session;};return context;};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});
  const result=(await captureTarget({browser:boundaryBrowser,previewUrl:f.url,runDir:f.runDir,viewports:[{name:'tablet',width:900,height:500}],elementMap:{root:{targetId:'1111111',kind:'container'}}}))[0];
  const persisted=JSON.parse(await readFile(result.evidencePath,'utf8'));
  assert.equal(result.deviceFacts?.innerWidth,900);assert.equal(result.deviceFacts?.clientWidth,885);assert.equal(result.elements[0].rect.width,885);
  assert.equal(persisted.afterScreenshotFacts.innerWidth,930);assert.equal(persisted.afterScreenshotFacts.clientWidth,915);
  assert.equal(persisted.screenshotGeometry.status,'changed-after-screenshot');assert.deepEqual(persisted.screenshotGeometry.changedFacts,['innerWidth','clientWidth']);
  assert.ok(persisted.screenshotGeometry.gaps.some((gap:{code:string})=>gap.code==='screenshot-layoutmetrics-changed'));assert.equal(persisted.screenshotCapture.passed,false);assert.ok((await readFile(result.screenshotPath)).length>1000);
});
