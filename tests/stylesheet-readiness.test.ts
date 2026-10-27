import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { chromium, type Browser } from 'playwright';
import { installStylesheetReadiness } from '../src/verification/stylesheet-readiness.js';
import { captureTarget, createScopedContext } from '../src/verification/capture-target.js';

let browser: Browser;
test.before(async () => { browser = await chromium.launch({ headless: true }); });
test.after(async () => { await browser.close(); });
async function server(t: TestContext, handler: (req: IncomingMessage, res: ServerResponse) => void) {
  const server = createServer(handler); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
  const address = server.address(); assert.ok(address && typeof address === 'object'); return `http://127.0.0.1:${address.port}`;
}
async function directory(t: TestContext) {
  const cache = 'D:/cloneWP/.cache'; await mkdir(cache, { recursive: true }); const directory = await mkdtemp(path.join(cache, 'test-stylesheet-readiness-'));
  t.after(async () => { const resolved = path.resolve(directory), relative = path.relative(path.resolve(cache), resolved); assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative)); await rm(resolved, { recursive: true, force: true }); });
  return directory;
}
async function observe(t: TestContext, url: string, options: { timeoutMs?: number; quietMs?: number; requiredStyleScope?: string } = {}) {
  const context = await createScopedContext(browser, url), page = await context.newPage(); t.after(async () => { await context.close(); });
  const observer = await installStylesheetReadiness(page, { expectedOrigin: new URL(url).origin, ...options });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  const report = await observer.wait(); observer.dispose(); return { page, report };
}
const html = (body: string) => `<!doctype html><html><head><title>Owned fixture</title></head><body>${body}</body></html>`;
const box = '<main class="elementor"><section data-id="1111111" data-element_type="container"><h1>Actual CSS measurement</h1></section></main>';

test('actual delayed stylesheet loading completes before capture measures or invokes its presentation inspector', async t => {
  const url = await server(t, (req, res) => {
    if (req.url === '/delayed.css') { setTimeout(() => { res.writeHead(200, { 'Content-Type': 'text/css' }); res.end('[data-id="1111111"]{height:123px;background:rgb(10,120,30)}'); }, 650); return; }
    res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(html(box + '<script>addEventListener("DOMContentLoaded",()=>{const link=document.createElement("link");link.rel="stylesheet";link.href="/delayed.css";document.head.append(link)})</script>'));
  });
  let inspectedHeight = 0;
  const result = (await captureTarget({ previewUrl: url + '/', runDir: await directory(t), viewports: [{ name: 'desktop', width: 700, height: 500 }], browser, elementMap: { root: { targetId: '1111111', kind: 'container' } }, inspectPage: async page => { inspectedHeight = await page.locator('[data-id="1111111"]').evaluate(node => node.getBoundingClientRect().height); } }))[0];
  assert.equal(inspectedHeight, 123); assert.equal(result.elements[0].rect.height, 123); assert.equal(result.elements[0].style['background-color'], 'rgb(10, 120, 30)');
  const readiness = (result as typeof result & { stylesheetReadiness: any }).stylesheetReadiness;
  assert.equal(readiness.ready, true); assert.equal(readiness.reloads, 0); assert.equal(readiness.attempts[0].links[0].sheetAvailable, true);
  assert.ok(readiness.attempts[0].durationMs >= 500); assert.equal(readiness.visualFidelityProven, false);
});

test('real permanent 404 retains both failed attempts and named gaps; capture cannot silently accept stable unstyled DOM', async t => {
  let navigations = 0;
  const url = await server(t, (req, res) => {
    if (req.url === '/missing.css') { res.writeHead(404, { 'Content-Type': 'text/css', 'Cache-Control': 'no-store' }); res.end(''); return; }
    navigations++; res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' }); res.end(html('<link rel="stylesheet" href="/missing.css">' + box));
  });
  const dir = await directory(t);
  await assert.rejects(captureTarget({ previewUrl: url + '/', runDir: dir, viewports: [{ name: 'desktop', width: 700, height: 500 }], browser, elementMap: { root: '1111111' } }), /stylesheet-readiness-failed:.*stylesheet-http-error/);
  assert.equal(navigations, 2);
  const report = JSON.parse(await readFile(path.join(dir, 'verification/target/desktop-stylesheet-readiness.json'), 'utf8'));
  assert.equal(report.ready, false); assert.equal(report.reloads, 1); assert.equal(report.attempts.length, 2); assert.equal(report.recovered, false);
  for (const attempt of report.attempts) assert.ok(attempt.gaps.some((gap: any) => gap.code === 'stylesheet-http-error' && gap.status === 404));
  assert.equal(report.attempts[0].documentUrlSha256, report.attempts[1].documentUrlSha256);
  await assert.rejects(readFile(path.join(dir, 'verification/target/desktop.json')));
});

test('one exact-URL retry may recover an actual CSS error without erasing its first failure receipt', async t => {
  let styles = 0;
  const url = await server(t, (req, res) => {
    if (req.url === '/transient.css') { styles++; res.writeHead(styles === 1 ? 503 : 200, { 'Content-Type': 'text/css', 'Cache-Control': 'no-store' }); res.end(styles === 1 ? '' : 'h1{font-size:37px}'); return; }
    res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' }); res.end(html('<link rel="stylesheet" href="/transient.css">' + box));
  });
  const { page, report } = await observe(t, url + '/?preview=true');
  assert.equal(report.ready, true); assert.equal(report.reloads, 1); assert.equal(report.recovered, true); assert.equal(report.attempts[0].ready, false); assert.equal(report.attempts[1].ready, true);
  assert.ok(report.attempts[0].gaps.some(gap => gap.status === 503)); assert.equal(await page.locator('h1').evaluate(node => getComputedStyle(node).fontSize), '37px');
  assert.equal(page.url(), url + '/?preview=true'); assert.ok(!JSON.stringify(report).includes('preview=true'));
});

test('a legitimate page without external CSS and disabled/nonmatching media links has explicit not-applicable scope', async t => {
  const url = await server(t, (req, res) => {
    if (req.url?.endsWith('.css')) { res.writeHead(404, { 'Content-Type': 'text/css' }); res.end(''); return; }
    res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(html('<link rel="stylesheet" media="print" href="/print.css"><link rel="stylesheet" disabled href="/disabled.css">' + box));
  });
  const { report } = await observe(t, url + '/');
  assert.equal(report.ready, true); assert.equal(report.status, 'not-applicable'); assert.equal(report.reloads, 0); assert.equal(report.visualFidelityProven, false);
  assert.ok(report.attempts[0].links.every(link => link.state === 'ignored')); assert.equal(report.attempts[0].applicableLinkCount, 0);
});

test('an unresolved CSS request times out with a named gap and does not authorize an error-recovery reload', async t => {
  let navigations = 0;
  const url = await server(t, (req, res) => {
    if (req.url === '/pending.css') return;
    navigations++; res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(html(box + '<script>addEventListener("DOMContentLoaded",()=>{const link=document.createElement("link");link.rel="stylesheet";link.href="/pending.css";document.head.append(link)})</script>'));
  });
  const { report } = await observe(t, url + '/', { timeoutMs: 400, quietMs: 50 });
  assert.equal(report.ready, false); assert.equal(report.reloads, 0); assert.equal(navigations, 1); assert.ok(report.gaps.some(gap => gap.code === 'stylesheet-timeout'));
});

test('cross-origin CSS is observed without reading its CSSOM rules or sending target Cookie/Authorization headers', async t => {
  const foreignHeaders: IncomingMessage['headers'][] = [];
  let observed: IncomingMessage['headers'] | undefined;
  const foreign = await server(t, (req, res) => { observed = req.headers; foreignHeaders.push(req.headers); res.writeHead(200, { 'Content-Type': 'text/css' }); res.end('h1{font-size:29px}'); });
  const target = await server(t, (_req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(html(`<link rel="stylesheet" href="${foreign}/external.css?private=never-persist">` + box)); });
  const publicContext = await browser.newContext(); t.after(async () => { await publicContext.close(); }); await publicContext.addInitScript('globalThis.__name=(target)=>target');
  const page = await publicContext.newPage(), observer = await installStylesheetReadiness(page, { expectedOrigin: target });
  await page.goto(target + '/', { waitUntil: 'domcontentloaded' }); const report = await observer.wait(); observer.dispose();
  assert.equal(report.ready, true); assert.equal(await page.locator('h1').evaluate(node => getComputedStyle(node).fontSize), '29px');
  assert.equal(observed?.authorization, undefined); assert.equal(observed?.cookie, undefined);
  assert.ok(!/auth-secret|cookie-secret|never-persist/.test(JSON.stringify(report)));
  // Even a caller adding a global credential must either receive public CSS
  // through the existing route guard or get an explicit CSS failure, never leak.
  const context = await createScopedContext(browser, target + '/', { cookies: [{ name: 'owned-session', value: 'cookie-secret', domain: '127.0.0.1', path: '/', httpOnly: true, secure: false, sameSite: 'Lax', expires: -1 }] });
  t.after(async () => { await context.close(); }); await context.setExtraHTTPHeaders({ Authorization: 'Bearer auth-secret' });
  const second = await context.newPage(), protectedObserver = await installStylesheetReadiness(second, { expectedOrigin: target });
  await second.goto(target + '/', { waitUntil: 'domcontentloaded' }); const protectedReport = await protectedObserver.wait(); protectedObserver.dispose();
  for (const headers of foreignHeaders) { assert.equal(headers.authorization, undefined); assert.equal(headers.cookie, undefined); }
  if (!protectedReport.ready) assert.ok(protectedReport.gaps.some(gap => ['stylesheet-link-error', 'stylesheet-network-error'].includes(gap.code)));
  assert.ok(!/auth-secret|cookie-secret|never-persist/.test(JSON.stringify(protectedReport)));
});

test('all links loaded cannot substitute for the required actual native document CSS scope or exact owner token', async t => {
  let navigations=0;
  const url=await server(t,(req,res)=>{
    if(req.url==='/post-471.css'){res.writeHead(200,{'Content-Type':'text/css','Cache-Control':'no-store'});res.end('.elementor-4710 h1{color:red}.x[data-value=".elementor-471"]{color:blue}:not(.elementor-471){font-size:14px}div\\.elementor-471{margin:0}');return;}
    navigations++;res.writeHead(200,{'Content-Type':'text/html','Cache-Control':'no-store'});res.end(html('<link rel="stylesheet" href="/post-471.css">'+box));
  });
  const{report}=await observe(t,url+'/',{requiredStyleScope:'.elementor-471'});
  assert.equal(navigations,2);assert.equal(report.ready,false);assert.equal(report.reloads,1);assert.equal(report.attempts.length,2);
  for(const attempt of report.attempts){assert.ok(attempt.links.every(link=>link.state==='loaded'));assert.equal(attempt.documentStyleScope?.status,'missing');assert.equal(attempt.documentStyleScope?.matches.length,0);assert.ok(attempt.gaps.some(gap=>gap.code==='stylesheet-document-scope-missing'));}
});

test('an actual inline owned scope can recover a missing declaration once without guessing CSS filenames or geometry',async t=>{
  let navigations=0;
  const url=await server(t,(_req,res)=>{navigations++;res.writeHead(200,{'Content-Type':'text/html','Cache-Control':'no-store'});res.end(html((navigations>1?'<style>@media(min-width:1px){@supports(display:grid){:where(.elementor-983) h1{color:rgb(25,80,150)}}}</style>':'')+box.replace('class="elementor"','class="elementor elementor-983"')));});
  const{page,report}=await observe(t,url+'/?preview=secret-never-record',{requiredStyleScope:'.elementor-983'});
  assert.equal(report.ready,true);assert.equal(report.status,'ready');assert.equal(report.recovered,true);assert.equal(report.reloads,1);assert.equal(report.attempts[0].documentStyleScope?.status,'missing');
  const proof=report.attempts[1].documentStyleScope!;assert.equal(proof.status,'observed');assert.equal(proof.matches.length,1);assert.ok(proof.matches[0].rulePath.length>=3);assert.match(proof.matches[0].selectorSha256,/^[a-f\d]{64}$/);assert.match(proof.matches[0].ruleSha256,/^[a-f\d]{64}$/);
  assert.equal(await page.locator('h1').evaluate(node=>getComputedStyle(node).color),'rgb(25, 80, 150)');assert.ok(!JSON.stringify(report).includes('secret-never-record'));
});

test('an external imported CSSOM rule proves the exact class scope even when its class token is escaped',async t=>{
  const url=await server(t,(req,res)=>{if(req.url?.startsWith('/theme.css')){res.writeHead(200,{'Content-Type':'text/css'});res.end('@import url("/native.css?private=not-persisted");');return;}if(req.url?.startsWith('/native.css')){res.writeHead(200,{'Content-Type':'text/css'});res.end('@media(min-width:1px){.elementor-\\34 71 h1{font-size:31px}}');return;}res.writeHead(200,{'Content-Type':'text/html'});res.end(html('<link rel="stylesheet" href="/theme.css">'+box.replace('class="elementor"','class="elementor elementor-471"')));});
  const{page,report}=await observe(t,url+'/',{requiredStyleScope:'.elementor-471'});assert.equal(report.ready,true);assert.equal(report.reloads,0);const proof=report.attempts[0].documentStyleScope!;assert.equal(proof.status,'observed');assert.ok(proof.matches[0].resource?.endsWith('/native.css'));assert.equal(await page.locator('h1').evaluate(node=>getComputedStyle(node).fontSize),'31px');assert.ok(!JSON.stringify(report).includes('not-persisted'));
});

test('required scope stays missing on a genuinely unstyled document while optional ordinary pages stay not applicable',async t=>{
  const url=await server(t,(_req,res)=>{res.writeHead(200,{'Content-Type':'text/html','Cache-Control':'no-store'});res.end(html(box));});
  const optional=await observe(t,url+'/');assert.equal(optional.report.status,'not-applicable');assert.equal(optional.report.ready,true);
  const required=await observe(t,url+'/',{requiredStyleScope:'.native-page-22'});assert.equal(required.report.ready,false);assert.equal(required.report.status,'failed');assert.equal(required.report.reloads,1);assert.ok(required.report.attempts.every(attempt=>attempt.documentStyleScope?.status==='missing'));
});

test('inaccessible cross-origin scope remains unobserved despite loaded CSS and actual paint; no stylesheet credentials are persisted',async t=>{
  const foreign=await server(t,(_req,res)=>{res.writeHead(200,{'Content-Type':'text/css'});res.end('.elementor-748 h1{color:rgb(55,66,77)}');});
  const target=await server(t,(_req,res)=>{res.writeHead(200,{'Content-Type':'text/html','Cache-Control':'no-store'});res.end(html(`<link rel="stylesheet" href="${foreign}/font.css?token=never-save-this">`+box.replace('class="elementor"','class="elementor elementor-748"')));});
  const context=await browser.newContext();t.after(async()=>{await context.close();});await context.addInitScript('globalThis.__name=(target)=>target');const page=await context.newPage(),observer=await installStylesheetReadiness(page,{expectedOrigin:target,requiredStyleScope:'.elementor-748'});await page.goto(target+'/',{waitUntil:'domcontentloaded'});const report=await observer.wait();observer.dispose();
  assert.equal(report.ready,false);assert.equal(report.reloads,1);assert.equal(await page.locator('h1').evaluate(node=>getComputedStyle(node).color),'rgb(55, 66, 77)');
  for(const attempt of report.attempts){assert.ok(attempt.links.every(link=>link.state==='loaded'));assert.equal(attempt.documentStyleScope?.status,'unobserved');assert.ok(attempt.documentStyleScope!.inaccessibleStylesheets.length>0);assert.ok(attempt.gaps.some(gap=>gap.code==='stylesheet-document-scope-unobserved'));}
  assert.ok(!JSON.stringify(report).includes('never-save-this'));
});
