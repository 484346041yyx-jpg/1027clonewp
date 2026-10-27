import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page, type Route } from 'playwright';
import { normalizeBindings, targetSelector } from './bindings.js';
import { verifySafeToggles } from './interactions.js';
import {collectRenderedFonts} from '../capture/fonts.js';
import { installStylesheetReadiness, type StylesheetReadinessReport } from './stylesheet-readiness.js';
import { captureLayoutStableScreenshot } from './layout-stable-screenshot.js';
import type { ElementMap, ScopedBrowserAuth, SourceInteractionEvidence, TargetViewportEvidence, Viewport } from './types.js';
export interface NativeCarouselClipEvidence{selector:string;childRect:{x:number;y:number;width:number;height:number};childDomPath:string;carouselId:string;widgetType:string;windowRect:{x:number;y:number;width:number;height:number};windowDomPath:string;overflowX:string;documentWidth:number;viewportWidth:number;}
export interface ProvenLazyCatalogImageEvidence extends NativeCarouselClipEvidence{productId:number;url:string;currentSrc:string;srcAttribute:string;declaredURL:string;complete:boolean;naturalWidth:number;naturalHeight:number;requested:false;loading:string;deferredKind:'data-src'|'native-loading-lazy';}
export interface NativeScrollClipEvidence{selector:string;childRect:{x:number;y:number;width:number;height:number};childDomPath:string;ancestorId:string;ancestorType:string;windowRect:{x:number;y:number;width:number;height:number};windowDomPath:string;overflowX:string;scrollWidth:number;clientWidth:number;documentWidth:number;viewportWidth:number;}
export interface ProvenLazyNativeScrollImageEvidence extends NativeScrollClipEvidence{url:string;currentSrc:string;srcAttribute:string;declaredURL:string;complete:boolean;naturalWidth:number;naturalHeight:number;requested:false;loading:'lazy';deferredKind:'native-scroll-loading-lazy';}
export interface NativeCarouselControlBoxes{carouselId:string;widgetType:string;blockRootId?:string;nativeBlock:boolean;widgetRect:{x:number;y:number;width:number;height:number};blockRect?:{x:number;y:number;width:number;height:number};controls:Array<{kind:'previous'|'next'|'fraction';selector:string;rect:{x:number;y:number;width:number;height:number}}>}

/** Playwright route errors may contain request headers. Never let them escape the callback or enter diagnostics. */
export async function handleScopedRoute(route: Route, origin: URL,options:{readOnly?:boolean}={}): Promise<void> {
  const abortQuietly = async () => { try { await route.abort('blockedbyclient'); } catch { /* Request/context already closed. */ } };
  try {
    const request = route.request(), requested = new URL(request.url());
    if(options.readOnly&&!['GET','HEAD'].includes(request.method().toUpperCase())){await abortQuietly();return;}
    if (request.isNavigationRequest()) {
      if (requested.origin !== origin.origin) { await abortQuietly(); return; }
      // Fetch one same-origin hop only; authenticated redirects cannot leave the configured origin.
      const response = await route.fetch({ maxRedirects: 0, timeout: 45_000 });
      const location = response.headers().location;
      if (response.status() >= 300 && response.status() < 400 && location && new URL(location, requested).origin !== origin.origin) { await abortQuietly(); return; }
      await route.fulfill({ response }); return;
    }
    if (requested.origin !== origin.origin) {
      const headers = { ...request.headers() };
      for (const name of Object.keys(headers)) if (['cookie', 'authorization', 'proxy-authorization'].includes(name.toLowerCase())) delete headers[name];
      await route.continue({ headers }); return;
    }
    await route.continue();
  } catch {
    // A closed page, timeout, failed fulfill/continue, or malformed redirect only aborts this request.
    // In particular, do not stringify the caught route.fetch error: its call log can include cookies.
    await abortQuietly();
  }
}

/** CSS animation overrides do not stop JavaScript/jQuery slide animations. Wait for real restored geometry. */
async function awaitNativeLayoutSettled(page: Page, selectors: string[]): Promise<string | undefined> {
  let previous = '', stableSamples = 0;
  let last: { animated: number; clipped: Array<{ id: string; clientHeight: number; scrollHeight: number }>; signature: string } | undefined;
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    last = await page.evaluate(mappedSelectors => {
      const visible = (element: Element) => { const box = element.getBoundingClientRect(), css = getComputedStyle(element);
        for (let parent: Element | null = element; parent; parent = parent.parentElement) {
          if (getComputedStyle(parent).contentVisibility === 'hidden') return false;
          if (parent !== element && parent.tagName === 'DETAILS' && !parent.hasAttribute('open')) {
            const summary = Array.from(parent.children).find(child => child.tagName === 'SUMMARY');
            if (!summary?.contains(element)) return false;
          }
        }
        return box.width > 0 && box.height > 0 && css.display !== 'none' && css.visibility !== 'hidden'; };
      const controls = Array.from(document.querySelectorAll('.elementor-accordion .elementor-tab-title[aria-expanded="true"],.elementor-toggle .elementor-tab-title[aria-expanded="true"],.e-n-accordion .e-n-accordion-item-title[aria-expanded="true"],.e-n-accordion details[open] > summary'));
      const clipped: Array<{ id: string; clientHeight: number; scrollHeight: number }> = [];
      const answerBoxes: Array<[string, number, number, number, number]> = [];
      for (const control of controls) {
        const ids = (control.getAttribute('aria-controls') ?? '').split(/\s+/).filter(id => /^[\w:-]+$/.test(id));
        const candidates = ids.map(id => document.getElementById(id)).filter((element): element is HTMLElement => !!element);
        if (!candidates.length) {
          const parent = control.parentElement;
          const fallback = parent?.querySelector<HTMLElement>('.elementor-tab-content') ?? (control.tagName === 'SUMMARY' ? Array.from(parent?.children ?? []).find(element => element !== control) as HTMLElement | undefined : undefined);
          if (fallback) candidates.push(fallback);
        }
        for (const content of candidates) {
          const box = content.getBoundingClientRect();
          answerBoxes.push([content.id, box.height, content.clientHeight, content.scrollHeight, box.y]);
          if (!visible(content) || content.clientHeight + 2 < content.scrollHeight) clipped.push({ id: content.id || 'native-faq-answer', clientHeight: content.clientHeight, scrollHeight: content.scrollHeight });
        }
      }
      const jquery = (window as unknown as { jQuery?: (selector: string) => { length: number } }).jQuery;
      const jqueryAnimations = jquery ? jquery('.elementor-accordion :animated,.elementor-toggle :animated,.e-n-accordion :animated').length : 0;
      const browserAnimations = document.getAnimations().filter(animation => (animation.playState === 'running' || animation.pending) && animation.effect?.getComputedTiming().iterations !== Infinity).length;
      const round = (value: number) => Math.round(value * 10) / 10;
      const mapped = mappedSelectors.flatMap(selector => Array.from(document.querySelectorAll(selector)).map(element => { const rect = element.getBoundingClientRect(); return [round(rect.x), round(rect.y), round(rect.width), round(rect.height)]; }));
      return { animated: jqueryAnimations + browserAnimations, clipped, signature: JSON.stringify([document.documentElement.scrollHeight, document.documentElement.scrollWidth, mapped, answerBoxes.map(values => values.map(value => typeof value === 'number' ? round(value) : value))]) };
    }, selectors);
    if (!last.animated && !last.clipped.length && previous === last.signature) stableSamples++;
    else stableSamples = 0;
    if (stableSamples >= 4) return undefined;
    previous = last.signature;
    await page.waitForTimeout(100);
  }
  return `Native layout did not settle before final measurement: ${last?.animated ?? 0} active animations; clipped expanded FAQ content ${JSON.stringify(last?.clipped ?? [])}.`;
}

export async function createScopedContext(browser: Browser, previewUrl: string, auth?: ScopedBrowserAuth,device?:Pick<Viewport,'deviceProfile'|'deviceScaleFactor'>&{readOnly?:boolean}): Promise<BrowserContext> {
  const origin = new URL(previewUrl);
  if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password) throw new Error('Preview must be an HTTP(S) URL without embedded credentials.');
  const profile=device?.deviceProfile??'desktop',scale=device?.deviceScaleFactor??1;
  if(!['desktop','mobile','touch'].includes(profile)||!Number.isFinite(scale)||scale<1||scale>3)throw Error('Scoped target device profile or pixel ratio is unsupported.');
  const context = await browser.newContext({ deviceScaleFactor:scale,isMobile:profile==='mobile',hasTouch:profile!=='desktop', reducedMotion: 'reduce',serviceWorkers:'block' });
  // tsx/esbuild names nested functions with this helper before serializing page.evaluate.
  await context.addInitScript('Object.defineProperty(globalThis,"__name",{value:(target)=>target,configurable:true});');
  if (auth?.cookies?.length) {
    for (const cookie of auth.cookies) {
      const domain = cookie.domain.replace(/^\./, '').toLowerCase();
      if (origin.hostname.toLowerCase() !== domain) {
        await context.close();
        throw new Error('Browser authentication cookies must be scoped to the exact target hostname.');
      }
    }
    await context.addCookies(auth.cookies.map(cookie=>{
      const cookieURL=new URL(origin.origin);
      cookieURL.pathname=cookie.path.endsWith('/')?cookie.path:`${cookie.path}/__clonewp_scope__`;
      return {url:cookieURL.href,name:cookie.name,value:cookie.value,expires:cookie.expires,httpOnly:cookie.httpOnly,secure:cookie.secure,sameSite:cookie.sameSite};
    }));
  }
  await context.route('**/*', route => handleScopedRoute(route, origin,{readOnly:device?.readOnly}));
  if(device?.readOnly)await context.routeWebSocket('**/*',socket=>socket.close({code:1008,reason:'Read-only frontend verification'}));
  return context;
}

export async function captureTarget(options: {
  previewUrl: string;
  runDir: string;
  viewports: Viewport[];
  elementMap: ElementMap;
  auth?: ScopedBrowserAuth;
  browser?: Browser;
  sourceInteractions?: Record<string, SourceInteractionEvidence[]>;
  nativeRootIds?:string[];
  /** Exact compiled productQuery widget IDs, never inferred from a class name. */
  nativeCatalogIds?:string[];
  /** Actual owned native document identity; its own CSS must be present. */
  nativeDocumentId?:number;
  /** Read-only viewport workers are bounded; target document writes never run here. */
  concurrency?:1|2;
  /** Use the same normally animated page for real state evidence before still-image measurement. */
  inspectPage?:(page:Page,viewport:Viewport)=>Promise<void>;
}): Promise<TargetViewportEvidence[]> {
  const bindings = normalizeBindings(options.elementMap).map(binding => ({ ...binding, selector: targetSelector(binding) }));
  const ownedBrowser = !options.browser;
  const browser = options.browser ?? await chromium.launch({ headless: true });
  const contexts=new Map<string,Promise<BrowserContext>>();
  const directory = path.join(options.runDir, 'verification', 'target');
  if(new Set(options.viewports.map(view=>view.name)).size!==options.viewports.length)throw Error('Verification viewport names must be unique.');
  await mkdir(directory, { recursive: true });
  try {
    const results: TargetViewportEvidence[] = new Array(options.viewports.length);
    const captureViewport=async(viewport:Viewport,index:number)=>{
      if (!/^[a-zA-Z0-9_-]+$/.test(viewport.name) || viewport.width < 100 || viewport.height < 100) throw new Error('Invalid verification viewport.');
      const deviceKey=`${viewport.deviceProfile??'desktop'}:${viewport.deviceScaleFactor??1}`;
      let pendingContext=contexts.get(deviceKey);if(!pendingContext){pendingContext=createScopedContext(browser,options.previewUrl,options.auth,{...viewport,readOnly:true});contexts.set(deviceKey,pendingContext);}
      const context=await pendingContext,page = await context.newPage();
      try {
      if(options.inspectPage)await page.emulateMedia({reducedMotion:'no-preference'});
      const requestedImageURLs=new Set<string>();
      let blockedMutationRequests=0;
      page.on('request',request=>{if(request.resourceType()==='image')requestedImageURLs.add(request.url());});
      page.on('request',request=>{if(!['GET','HEAD'].includes(request.method().toUpperCase()))blockedMutationRequests++;});
      const consoleErrors: string[] = [], pageErrors: string[] = [];
      page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text().slice(0, 500)); });
      page.on('pageerror', error => pageErrors.push(error.message.slice(0, 500)));
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      if(options.nativeDocumentId!==undefined&&(!Number.isSafeInteger(options.nativeDocumentId)||options.nativeDocumentId<1))throw Error('Native stylesheet scope requires a real document ID');
      const stylesheetObserver = await installStylesheetReadiness(page, { expectedOrigin: new URL(options.previewUrl).origin,...(options.nativeDocumentId?{requiredStyleScope:'.elementor-'+options.nativeDocumentId}:{}) });
      const response = await page.goto(options.previewUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 }).catch(() => {
        throw new Error('Target preview navigation failed or timed out; authentication details are omitted.');
      });
      if (new URL(page.url()).origin !== new URL(options.previewUrl).origin) throw new Error('Target preview redirected to a different origin.');
      let stylesheetReadiness: StylesheetReadinessReport;
      try { stylesheetReadiness = await stylesheetObserver.wait(); } finally { stylesheetObserver.dispose(); }
      const stylesheetReadinessPath = path.join(directory, `${viewport.name}-stylesheet-readiness.json`);
      await writeFile(stylesheetReadinessPath, JSON.stringify(stylesheetReadiness, null, 2));
      if (!stylesheetReadiness.ready) throw new Error(`stylesheet-readiness-failed: ${stylesheetReadiness.gaps.map(gap => gap.code).join(', ')}; actual attempts retained in ${stylesheetReadinessPath}`);
      await page.evaluate(async () => {
        await document.fonts.ready;
        let previousHeight = 0;
        for (let step = 0; step < 60; step++) {
          const height = document.documentElement.scrollHeight;
          const y = Math.min(step * window.innerHeight * 0.8, height);
          window.scrollTo(0, y);
          await new Promise(resolve => setTimeout(resolve, 60));
          if (y >= height - window.innerHeight && height === previousHeight) break;
          previousHeight = height;
        }
        await Promise.all(Array.from(document.images).map(image => {
          if (image.complete) return Promise.resolve();
          return new Promise(resolve => {
            const timer = setTimeout(resolve, 4_000);
            image.addEventListener('load', () => { clearTimeout(timer); resolve(null); }, { once: true });
            image.addEventListener('error', () => { clearTimeout(timer); resolve(null); }, { once: true });
          });
        }));
        window.scrollTo(0, 0);
      });
      const previewChromeAdjusted = await page.locator('#wpadminbar').count() > 0;
      if(options.inspectPage){
        if(previewChromeAdjusted)await page.addStyleTag({content:'#wpadminbar{display:none!important}html{margin-top:0!important}'});
        await options.inspectPage(page,viewport);
        await page.mouse.move(0,0);await page.evaluate(()=>scrollTo(0,0));
        await page.emulateMedia({reducedMotion:'reduce'});
      }
      await page.addStyleTag({ content: `*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}${previewChromeAdjusted ? '#wpadminbar{display:none!important}html{margin-top:0!important}' : ''}` });
      const interactions = await verifySafeToggles(page, options.elementMap, options.sourceInteractions?.[viewport.name] ?? []);
      const settleFailure = await awaitNativeLayoutSettled(page, bindings.map(binding => binding.selector));
      if (settleFailure) pageErrors.push(settleFailure);
      // Measure after restored JavaScript-driven toggles settle, so the document and screenshot share geometry.
      const data = await page.evaluate(({ mappings,nativeRootIds,nativeCatalogIds,requestedImageURLs,deviceProfile }) => {
        const rect = (element: Element) => {
          const value = element.getBoundingClientRect();
          return { x: value.x + window.scrollX, y: value.y + window.scrollY, width: value.width, height: value.height };
        };
        // Retain raw boxes/paint even when content is skipped. Layout overflow
        // checks below include the principal box but never its skipped descendants.
        const visible = (element: Element, includeOwnContent = true) => {
          const box = element.getBoundingClientRect(), style = getComputedStyle(element);
          for (let parent: Element | null = element; parent; parent = parent.parentElement) {
            if ((parent !== element || includeOwnContent) && getComputedStyle(parent).contentVisibility === 'hidden') return false;
            if (parent !== element && parent.tagName === 'DETAILS' && !parent.hasAttribute('open')) {
              const summary = Array.from(parent.children).find(child => child.tagName === 'SUMMARY');
              if (!summary?.contains(element)) return false;
            }
          }
          return box.width > 0 && box.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) !== 0;
        };
        const properties = ['font-family','font-size','font-weight','font-style','line-height','letter-spacing','text-align','direction','text-transform','text-decoration-line','text-decoration-style','color','opacity','background-color','background-image','background-size','background-position','background-repeat','display','position','flex-direction','grid-template-columns','gap','padding-top','padding-right','padding-bottom','padding-left','margin-top','margin-right','margin-bottom','margin-left','border-radius','box-shadow','border-top-width','border-right-width','border-bottom-width','border-left-width','border-top-style','border-right-style','border-bottom-style','border-left-style','border-top-color','border-right-color','border-bottom-color','border-left-color','overflow-x','overflow-y','object-fit','object-position'];
        const domPath=(element:Element)=>{const parts:string[]=[];let current:Element|null=element;while(current){const parent:Element|null=current.parentElement;const siblings=parent?Array.from(parent.children).filter(item=>item.tagName===current!.tagName):[current];parts.unshift(`${current.tagName.toLowerCase()}:nth-of-type(${siblings.indexOf(current)+1})`);current=parent;}return parts.join(' > ');};
        const textElement = (element: Element, kind?: string) => {
          if (kind === 'container') return element;
          if (kind === 'image'||kind==='icon') return element.querySelector('img') ?? element;
          if (kind === 'button' || kind === 'link') return element.querySelector('a,button,.elementor-tab-title,.e-n-accordion-item-title,summary,.elementor-menu-toggle') ?? element;
          return element.querySelector('.elementor-heading-title,h1,h2,h3,h4,h5,h6,p') ?? element;
        };
        const elementEvidence = mappings.map(binding => {
          const found = Array.from(document.querySelectorAll(binding.selector));
          const element = found.find(element => visible(element)) ?? found[0];
          if (!element) return { sourceId: binding.sourceId, targetId: binding.targetId, selector: binding.selector, found: false, count: 0, nativeElement: false, text: '', visible: false, rect: { x: 0, y: 0, width: 0, height: 0 }, style: {}, images: [] };
          const content = textElement(element, binding.kind);
          const computed = getComputedStyle(content);
          let effectiveOpacity=1;
          for(let ancestor:Element|null=content;ancestor;ancestor=ancestor.parentElement) effectiveOpacity*=Number(getComputedStyle(ancestor).opacity);
          const style = Object.fromEntries(properties.map(property => [property, computed.getPropertyValue(property)]));
          const boxes:Array<{element:Element;role:'root'|'content'|'background'}>=[{element,role:'root'}];
          if(content!==element) boxes.push({element:content,role:'content'});
          for(let ancestor=content.parentElement;ancestor&&ancestor!==element&&element.contains(ancestor);ancestor=ancestor.parentElement) boxes.push({element:ancestor,role:'background'});
          for(const layer of Array.from(element.querySelectorAll(':scope > .elementor-background-overlay,:scope > .elementor-background-slideshow,:scope > .elementor-background-video-container')).slice(0,8)) boxes.push({element:layer,role:'background'});
          const paintLayers=boxes.map(box=>{const css=getComputedStyle(box.element);let layerOpacity=1;for(let node:Element|null=box.element;node;node=node.parentElement) layerOpacity*=Number(getComputedStyle(node).opacity);return {rect:rect(box.element),role:box.role,effectiveOpacity:layerOpacity,style:Object.fromEntries(properties.map(property=>[property,css.getPropertyValue(property)]))};});
          const images = (element.matches('img') ? [element] : Array.from(element.querySelectorAll('img'))).map(item => {
            const image = item as HTMLImageElement, imageStyle = getComputedStyle(image);
            return { url: image.currentSrc || image.src, currentSrc: image.currentSrc, srcAttribute: image.getAttribute('src')??'', dataSrcAttribute: image.getAttribute('data-src')??'', loading: image.getAttribute('loading')??'', complete: image.complete, naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight, rect: rect(image), objectFit: imageStyle.objectFit, objectPosition: imageStyle.objectPosition, alt: image.alt,domPath:domPath(image) };
          });
          const media: Array<{ url:string; origin:'image'|'background'|'pseudo'|'svg-image' }> = images.map(image => ({url:image.url,origin:'image'}));
          const extractURLs = (value:string) => Array.from(value.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*?))\s*\)/g)).map(match => match[1] ?? match[2] ?? match[3]).filter(Boolean);
          for (const layer of [element,...Array.from(element.querySelectorAll('*')).slice(0,1000)]) {
            for (const [pseudo,origin] of [[null,'background'],['::before','pseudo'],['::after','pseudo']] as const) {
              const computedLayer=getComputedStyle(layer,pseudo);
              for (const url of extractURLs(computedLayer.backgroundImage)) {
                try {media.push({url:new URL(url,location.href).href,origin});} catch { /* malformed CSS resources are not verified */ }
              }
            }
            if (layer.matches('svg image,svg use')) {
              const href=layer.getAttribute('href') ?? layer.getAttribute('xlink:href');
              if (href && !href.startsWith('#')) {try {media.push({url:new URL(href,location.href).href,origin:'svg-image'});} catch {}}
            }
          }
          const anchor = element.matches('a') ? element as HTMLAnchorElement : element.querySelector('a');
          const control = element.matches('a,button,input,summary,[aria-expanded]') ? element : element.querySelector('a,button,input,summary,[aria-expanded]');
          return { sourceId: binding.sourceId, targetId: binding.targetId, selector: binding.selector, found: true, count: found.length, nativeElement: !!element.closest('[data-elementor-type], .elementor') && !!(element.closest('[data-id]') || element.matches('[class*="elementor-element-"], [class*="e-"]')), widgetType: element.closest('[data-widget_type]')?.getAttribute('data-widget_type') ?? undefined, effectiveOpacity, fontDomPath:domPath(content),fontText:(content as HTMLElement).innerText??content.textContent??'',paintLayers,tag: element.tagName.toLowerCase(), text: (element as HTMLElement).innerText ?? element.textContent ?? '', visible: visible(element), rect: rect(element), contentRect: rect(content), style, images, media, href: anchor?.href, disabled: control ? control.hasAttribute('disabled') || control.getAttribute('aria-disabled') === 'true' : undefined, expanded: control?.getAttribute('aria-expanded') ?? undefined };
        });
        const overflow: Array<{ selector: string; rect: ReturnType<typeof rect> }> = [];
        const nativeCarouselClips:NativeCarouselClipEvidence[]=[];
        const nativeScrollClips:NativeScrollClipEvidence[]=[];
        const mappedIDs=new Set(mappings.map(binding=>binding.targetId).filter((id):id is string=>typeof id==='string'));
        const catalogIDs=new Set(nativeCatalogIds.filter(id=>/^[a-f0-9]{7}$/.test(id)&&mappedIDs.has(id)));
        type CatalogRuntime={root:Element;el:Element;wrapper:Element;slides:Element[];id:string;type:string};
        const catalogRuntimes:CatalogRuntime[]=[];
        for(const id of catalogIDs){
          const roots=document.querySelectorAll(`[data-id="${id}"][data-widget_type="wd_products.default"]`);
          if(roots.length!==1)continue;const root=roots[0];if(!visible(root)||!root.closest('[data-elementor-type],.elementor'))continue;
          for(const el of [root,...Array.from(root.querySelectorAll('*')).slice(0,2500)]){
            const instance=(el as Element&{swiper?:{initialized?:boolean;destroyed?:boolean;el?:unknown;wrapperEl?:unknown;slides?:unknown}}).swiper;
            if(instance?.initialized!==true||instance.destroyed===true||instance.el!==el||!(instance.wrapperEl instanceof Element)||!el.contains(instance.wrapperEl)||!root.contains(instance.wrapperEl))continue;
            // An image-gallery Swiper has no native product-card identities in its own wrapper.
            const cards=Array.from(instance.wrapperEl.querySelectorAll('.product-grid-item.product[data-id]')).filter(card=>/^\d+$/.test(card.getAttribute('data-id')??'')&&card.closest('[data-widget_type]')===root);
            if(cards.length){
              const actualSlides=instance.slides as ArrayLike<unknown>|undefined;
              const slides=actualSlides&&typeof actualSlides==='object'&&Number.isInteger(actualSlides.length)&&actualSlides.length<=2500?Array.from(actualSlides).filter((slide):slide is Element=>slide instanceof Element&&instance.wrapperEl instanceof Element&&instance.wrapperEl.contains(slide)):[];
              catalogRuntimes.push({root,el,wrapper:instance.wrapperEl,slides,id,type:'wd_products.default'});
            }
          }
        }
        const catalogClip=(element:Element,selector:string):NativeCarouselClipEvidence|undefined=>{
          const card=element.closest('.product-grid-item.product[data-id]');
          const runtime=catalogRuntimes.find(candidate=>{
            if(!candidate.root.contains(element)||!candidate.wrapper.contains(element))return false;
            if(card&&/^\d+$/.test(card.getAttribute('data-id')??'')&&candidate.wrapper.contains(card)&&card.closest('[data-widget_type]')===candidate.root)return true;
            // A real main-carousel slide wraps a product card; it is not inside one.
            // Exact instance.slides membership and an owned product descendant prove this parent boundary.
            return candidate.slides.includes(element)&&Array.from(element.querySelectorAll('.product-grid-item.product[data-id]')).some(child=>/^\d+$/.test(child.getAttribute('data-id')??'')&&child.closest('[data-widget_type]')===candidate.root);
          });if(!runtime)return;
          const documentWidth=document.documentElement.scrollWidth;if(documentWidth>innerWidth+4)return;
          for(let ancestor=element.parentElement;ancestor&&runtime.root.contains(ancestor);ancestor=ancestor.parentElement){
            const css=getComputedStyle(ancestor),box=ancestor.getBoundingClientRect();
            if(['hidden','clip'].includes(css.overflowX)&&ancestor.contains(runtime.wrapper)&&box.width>0&&box.height>0&&box.left>=-4&&box.right<=innerWidth+4)return{selector,childRect:rect(element),childDomPath:domPath(element),carouselId:runtime.id,widgetType:runtime.type,windowRect:rect(ancestor),windowDomPath:domPath(ancestor),overflowX:css.overflowX,documentWidth,viewportWidth:innerWidth};
            if(ancestor===runtime.root)break;
          }
        };
        const nativeScrollClip=(element:Element,selector:string):NativeScrollClipEvidence|undefined=>{
          for(let ancestor=element.parentElement;ancestor&&ancestor!==document.body;ancestor=ancestor.parentElement){
            const owner=ancestor.getAttribute('data-id'),type=ancestor.getAttribute('data-element_type'),css=getComputedStyle(ancestor),windowBox=ancestor.getBoundingClientRect(),html=ancestor as HTMLElement,documentWidth=document.documentElement.scrollWidth;
            if(!owner||!mappedIDs.has(owner)||type!=='container'||!visible(ancestor)||!ancestor.closest('[data-elementor-type],.elementor')||document.querySelectorAll(`[data-id="${owner}"]`).length!==1||!['auto','scroll'].includes(css.overflowX)||html.scrollWidth<=html.clientWidth+4)continue;
            if(documentWidth<=innerWidth+4&&windowBox.width>0&&windowBox.height>0&&windowBox.left>=-4&&windowBox.right<=innerWidth+4)return{selector,childRect:rect(element),childDomPath:domPath(element),ancestorId:owner,ancestorType:type,windowRect:rect(ancestor),windowDomPath:domPath(ancestor),overflowX:css.overflowX,scrollWidth:html.scrollWidth,clientWidth:html.clientWidth,documentWidth,viewportWidth:innerWidth};
            break;
          }
        };
        const clipping: Array<{ selector: string; axis: string; scrollSize: number; clientSize: number }> = [];
        for (const element of Array.from(document.querySelectorAll('[data-id], .elementor-widget, [class*="e-"]')).slice(0, 5000)) {
          if (!visible(element, false)) continue;
          const box = element.getBoundingClientRect(), style = getComputedStyle(element);
          const id = element.getAttribute('data-id');
          const selector = id ? `[data-id="${id}"]` : `${element.tagName.toLowerCase()}.${Array.from(element.classList).slice(0,2).join('.')}`;
          if (box.x < -4 || box.right > window.innerWidth + 4) {
            overflow.push({ selector, rect: rect(element) });
            let carousel:Element|null=null,clipWindow:Element|null=null;
            for(let ancestor=element.parentElement;ancestor;ancestor=ancestor.parentElement){
              if(!clipWindow&&ancestor.matches('.swiper,.swiper-container,.slick-list')&&['hidden','clip'].includes(getComputedStyle(ancestor).overflowX))clipWindow=ancestor;
              const type=ancestor.getAttribute('data-widget_type')?.split('.')[0],owner=ancestor.getAttribute('data-id');
              if(type&&/carousel|slider|^slides$/.test(type)&&owner&&mappedIDs.has(owner)&&ancestor.closest('[data-elementor-type],.elementor')){carousel=ancestor;break;}
            }
            if(carousel&&clipWindow&&carousel.contains(clipWindow)){
              const windowBox=clipWindow.getBoundingClientRect(),documentWidth=document.documentElement.scrollWidth;
              if(documentWidth<=innerWidth+4&&windowBox.width>0&&windowBox.height>0&&windowBox.left>=-4&&windowBox.right<=innerWidth+4)nativeCarouselClips.push({selector,childRect:rect(element),childDomPath:domPath(element),carouselId:carousel.getAttribute('data-id')!,widgetType:carousel.getAttribute('data-widget_type')!,windowRect:rect(clipWindow),windowDomPath:domPath(clipWindow),overflowX:getComputedStyle(clipWindow).overflowX,documentWidth,viewportWidth:innerWidth});
            }
            const productClip=catalogClip(element,selector);if(productClip)nativeCarouselClips.push(productClip);
            const scrollClip=nativeScrollClip(element,selector);if(scrollClip)nativeScrollClips.push(scrollClip);
          }
          const html = element as HTMLElement;
          if (['hidden','clip'].includes(style.overflowX) && html.scrollWidth > html.clientWidth + 4) clipping.push({ selector, axis: 'x', scrollSize: html.scrollWidth, clientSize: html.clientWidth });
          if (['hidden','clip'].includes(style.overflowY) && html.scrollHeight > html.clientHeight + 4) clipping.push({ selector, axis: 'y', scrollSize: html.scrollHeight, clientSize: html.clientHeight });
        }
        const publicImageURL=(value:string):string|undefined=>{
          if(!value)return;
          try{const url=new URL(value,location.href);if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.origin!==location.origin)return;url.hash='';return url.href;}catch{return;}
        };
        const provenLazyRows:Array<ProvenLazyCatalogImageEvidence|ProvenLazyNativeScrollImageEvidence>=[],requestedImages=new Set(requestedImageURLs.map(url=>publicImageURL(url)).filter((url):url is string=>!!url));
        const imageFailures = Array.from(document.images).filter(image => {
          if(!visible(image))return false;
          let drawableCurrentFrame=false;
          if(image.naturalWidth>0&&image.naturalHeight>0&&image.currentSrc){
            try{const current=new URL(image.currentSrc);drawableCurrentFrame=['http:','https:'].includes(current.protocol)&&!current.username&&!current.password;}catch{/* No observed drawable HTTP resource. */}
          }
          // HTMLImageElement.complete becomes false while a responsive replacement
          // request is pending. Positive intrinsic dimensions plus actual currentSrc
          // prove the previously decoded frame still paints; they do not prove the new candidate loaded.
          if(drawableCurrentFrame||image.complete&&image.naturalWidth>0&&image.naturalHeight>0)return false;
          const selector=domPath(image),proof=catalogClip(image,selector),declared=image.getAttribute('data-src')??'',srcAttribute=image.getAttribute('src')??'';
          const loading=(image.getAttribute('loading')??'').toLowerCase(),currentURL=publicImageURL(image.currentSrc),srcURL=publicImageURL(srcAttribute),dataURL=publicImageURL(declared);
          const dataDeferred=!!dataURL&&!image.currentSrc&&!srcAttribute&&!requestedImages.has(dataURL);
          const nativeURLs=[currentURL,srcURL,dataURL].filter((url):url is string=>!!url);
          // `loading=lazy src=...` is standard WordPress markup. It is deferred only
          // when this exact occurrence remains fully clipped and no declared/selected URL was requested.
          const nativeDeferred=loading==='lazy'&&!image.complete&&!!srcURL&&(!image.currentSrc||!!currentURL)&&(!declared||!!dataURL)&&nativeURLs.every(url=>!requestedImages.has(url));
          const declaredURL=nativeDeferred?(currentURL??srcURL):dataDeferred?dataURL:undefined;
          if(proof&&declaredURL&&image.naturalWidth===0&&image.naturalHeight===0){
            const box=rect(image),windowBox=proof.windowRect,offscreen=box.x+box.width<=windowBox.x||box.x>=windowBox.x+windowBox.width;
            if(offscreen){provenLazyRows.push({...proof,productId:Number(image.closest('.product-grid-item.product[data-id]')!.getAttribute('data-id')),url:image.currentSrc||image.src,currentSrc:image.currentSrc,srcAttribute,declaredURL,complete:image.complete,naturalWidth:image.naturalWidth,naturalHeight:image.naturalHeight,requested:false,loading,deferredKind:nativeDeferred?'native-loading-lazy':'data-src'});return false;}
          }
          if(nativeDeferred&&declaredURL&&image.naturalWidth===0&&image.naturalHeight===0){
            const scrollProof=nativeScrollClip(image,selector);
            if(scrollProof){
              const box=rect(image),windowBox=scrollProof.windowRect,offscreen=box.x+box.width<=windowBox.x||box.x>=windowBox.x+windowBox.width;
              if(offscreen){if(!nativeScrollClips.some(row=>row.ancestorId===scrollProof.ancestorId&&row.childDomPath===scrollProof.childDomPath))nativeScrollClips.push(scrollProof);provenLazyRows.push({...scrollProof,url:image.currentSrc||image.src,currentSrc:image.currentSrc,srcAttribute,declaredURL,complete:image.complete,naturalWidth:image.naturalWidth,naturalHeight:image.naturalHeight,requested:false,loading:'lazy',deferredKind:'native-scroll-loading-lazy'});return false;}
            }
          }
          return true;
        }).map(image => ({ url: image.currentSrc || image.src, alt: image.alt }));
        const nativeCarouselControlBoxes:NativeCarouselControlBoxes[]=[],rootIDs=new Set(nativeRootIds.filter(id=>mappedIDs.has(id)));
        for(const id of mappedIDs){
          const widget=document.querySelector(`[data-id="${id}"]`),type=widget?.getAttribute('data-widget_type');if(!widget||!type||!/carousel|slider|^slides$/.test(type.split('.')[0])||!visible(widget))continue;
          let block:Element|null=null;for(let ancestor=widget.parentElement;ancestor;ancestor=ancestor.parentElement){if(rootIDs.has(ancestor.getAttribute('data-id')??'')){block=ancestor;break;}}
          const controls:NativeCarouselControlBoxes['controls']=[];
          for(const[kind,selector]of[['previous','.elementor-swiper-button-prev,.swiper-button-prev,.slick-prev'],['next','.elementor-swiper-button-next,.swiper-button-next,.slick-next'],['fraction','.swiper-pagination-fraction,.elementor-swiper-pagination-fraction']]as const)for(const control of widget.querySelectorAll(selector))if(visible(control))controls.push({kind,selector:`${widget.getAttribute('data-id')}:${kind}`,rect:rect(control)});
          nativeCarouselControlBoxes.push({carouselId:id,widgetType:type,blockRootId:block?.getAttribute('data-id')??undefined,nativeBlock:!!block&&block.getAttribute('data-element_type')==='container'&&!!block.closest('[data-elementor-type],.elementor'),widgetRect:rect(widget),blockRect:block?rect(block):undefined,controls});
        }
        const pageClass=Array.from(document.body.classList).find(value=>/^page-id-\d+$/.test(value));
        const canvasShell={bodyPageId:pageClass?Number(pageClass.slice('page-id-'.length)):undefined,bodyPaddingBottom:getComputedStyle(document.body).paddingBottom,visibleToolbarCount:Array.from(document.querySelectorAll('.wd-toolbar')).filter(element=>visible(element)).length};
        // Freeze browser metrics in the same DOM measurement turn as the boxes.
        // Full-page screenshots can temporarily change Chromium layout metrics;
        // a later read must never replace these measurement-time facts.
        const deviceFacts={profile:deviceProfile,innerWidth,clientWidth:document.documentElement.clientWidth,devicePixelRatio,touch:navigator.maxTouchPoints>0,coarsePointer:matchMedia('(pointer:coarse)').matches};
        return { url: location.href, title: document.title, pageHeight: document.documentElement.scrollHeight,deviceFacts, elements: elementEvidence, overflow, clipping, imageFailures,canvasShell,nativeCarouselClips,nativeScrollClips,nativeCarouselControlBoxes,provenLazyRows };
      }, { mappings: bindings,nativeRootIds:options.nativeRootIds??[],nativeCatalogIds:options.nativeCatalogIds??[],requestedImageURLs:[...requestedImageURLs],deviceProfile:viewport.deviceProfile??'desktop' });
      const fontProof=await collectRenderedFonts(page,data.elements.filter(element=>element.found&&element.fontDomPath).map(element=>({id:element.sourceId,domPath:element.fontDomPath!,kind:bindings.find(binding=>binding.sourceId===element.sourceId)?.kind??'text',text:element.fontText})),{maxNodes:160,timeoutMs:5000,concurrency:4});
      const measuredElements=data.elements.map(element=>({...element,renderedFonts:fontProof.fontsById[element.sourceId]}));
      const screenshotPath = path.join(directory, `${viewport.name}.png`);
      const evidencePath = path.join(directory, `${viewport.name}.json`);
      const screenshotSelectors=options.nativeRootIds?.length?options.nativeRootIds.map(id=>`[data-id="${id}"]`):bindings.map(binding=>binding.selector);
      const screenshotCapture=await captureLayoutStableScreenshot(page,{path:screenshotPath,selectors:screenshotSelectors,maxPageHeight:35000});
      const afterScreenshotFacts=await page.evaluate(profile=>({profile,innerWidth,clientWidth:document.documentElement.clientWidth,devicePixelRatio,touch:navigator.maxTouchPoints>0,coarsePointer:matchMedia('(pointer:coarse)').matches}),viewport.deviceProfile??'desktop');
      const changedFacts=(Object.keys(data.deviceFacts)as Array<keyof typeof data.deviceFacts>).filter(key=>data.deviceFacts[key]!==afterScreenshotFacts[key]);
      const screenshotGeometry={measurementFactsCaptured:'same-dom-measurement-before-screenshot' as const,afterScreenshotFactsCaptured:'after-layout-preserving-viewport-tiles' as const,status:changedFacts.length?'changed-after-screenshot' as const:'unchanged' as const,changedFacts,gaps:[...screenshotCapture.gaps.map(gap=>({code:gap.code,message:gap.message})),...(changedFacts.length?[{code:'screenshot-layoutmetrics-changed',message:'Actual browser facts changed after screenshot capture. Original deviceFacts describe DOM measurement time; afterScreenshotFacts remain separate diagnostics.'}]:[])]};
      const evidence: TargetViewportEvidence & { stylesheetReadiness: StylesheetReadinessReport; afterScreenshotFacts: typeof afterScreenshotFacts; screenshotGeometry: typeof screenshotGeometry; screenshotCapture:typeof screenshotCapture } = { ...viewport, ...data,stylesheetReadiness,afterScreenshotFacts,screenshotGeometry,screenshotCapture,networkPolicy:{mode:'read-only',allowedMethods:['GET','HEAD'],blockedMutationRequests,webSocketsBlocked:true},elements:measuredElements,screenshotPath, evidencePath, consoleErrors:[...consoleErrors,...fontProof.warnings], pageErrors, responseStatus: response?.status() ?? null, previewChromeAdjusted, interactions };
      await writeFile(evidencePath, JSON.stringify(evidence, null, 2));
      results[index]=evidence;
      }finally{await page.close();}
    };
    let next=0;
    const concurrency=options.concurrency??1;
    if(concurrency!==1&&concurrency!==2)throw new Error('Read-only viewport concurrency must be 1 or 2.');
    const workers=Array.from({length:Math.min(concurrency,options.viewports.length)},async()=>{while(next<options.viewports.length){const index=next++;await captureViewport(options.viewports[index],index);}});
    // Wait for every worker before closing the shared authenticated context.
    const settled=await Promise.allSettled(workers);const failed=settled.find(result=>result.status==='rejected');
    if(failed?.status==='rejected')throw failed.reason;
    return results;
  } finally {
    await Promise.allSettled([...contexts.values()].map(async context=>{await(await context).close();}));
    if (ownedBrowser) await browser.close();
  }
}
