import path from 'node:path';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import sharp from 'sharp';
import type { Page } from 'playwright';

interface Box { x: number; y: number; width: number; height: number }
interface LayoutCoordinateRow {
  index: number; parentIndex: number | null; tag: string; id: string; className: string;
  frame: 'owned-header-relative' | 'viewport-fixed-subtree' | 'document'; fixedRootIndex: number | null;
  rawViewportBox: Box; normalizedBox: Box;
  position: string; display: string; visibility: string; opacity: string; suppressed: boolean;
}
interface LayoutFacts {
  innerWidth: number; innerHeight: number; clientWidth: number; clientHeight: number;
  scrollWidth: number; scrollHeight: number; devicePixelRatio: number; scrollX: number; scrollY: number;
  tracked: Array<{ selector: string; position: string; box: Box; documentY: number }>;
  overlays: Array<{ node: string; position: 'fixed' | 'sticky'; box: Box; top: string; bottom: string; left: string; right: string; ownPosition?: string; anchoredAncestorIndex?: number }>;
  runningAnimations: number; elementCount: number; inventoryTruncated: boolean;
  /** Present only on explicit owned-header observations; every bounded DOM row
   * stays retained, including suppressed or offscreen fixed subtrees. */
  layoutCoordinateRows?: LayoutCoordinateRow[];
}
export interface LayoutScreenshotGap { code: string; message: string; tile?: number }
export interface LayoutStableScreenshotReceipt {
  version: 1; method: 'scroll-viewport-cdp-no-beyond'; pngPath: string; receiptPath: string;
  documentLayoutPreserved: boolean; complete: boolean; seamless: boolean; passed: boolean;
  before: LayoutFacts; after: LayoutFacts; restored: LayoutFacts;
  originalScrollRestored: boolean; contentRaster: { width: number; height: number; scale: number; scaleBasis: 'actual-png-viewport-ratio'; measuredDevicePixelRatio: number };
  selectorCoverage: { requested: number; uniqueRequested: number; tracked: number; maximumTracked: 80 };
  tiles: Array<{ index: number; requestedScrollY: number; actualScrollY: number; documentTop: number; documentHeight: number; cropTopPx: number; rasterWidth: number; rasterHeight: number; before: LayoutFacts; after: LayoutFacts; settled: boolean; ownedHeaderFrame?: OwnedHeaderFrame }>;
  gaps: LayoutScreenshotGap[];
  constraints: { domOrCSSMutations: 0; viewportOverrides: 0; captureBeyondViewport: false; fromSurface: true; omittedScrollbarPixels: number; timeModel: 'Sequential real viewport frames, not one simultaneous frame' };
  limitations: string[];
  preparation?: { initial: LayoutFacts; layoutRefreshes: number; discardedFrames: number; maximumRefreshes: number };
  metrics: { durationMs: number; layoutSamples: number; scrollCommands: number; screenshots: number; preparationCalls: number; preparationMs: number };
  /** Explicitly opted-in, measured top-header composition. The header remains
   * in every real viewport; only its first document-top occurrence is adopted. */
  ownedHeaderComposition?: {
    kind: 'single-owned-top-header-overlap-v1'; ownerSelector: string; headerSelector: string;
    headerPresentation: 'real-document-top-once'; rawFramesRetained: true;
    headerHeightCSS: number; overlapPixels: number;
    layoutCoordinateFrames?: 'header-relative-fixed-subtree-viewport-normal-document-v1';
    coverage: { expectedRows: number; observedRows: number; gapFree: boolean; nonOverlapping: boolean; unoccluded: boolean; integralScrollOrigins: boolean };
  };
}
export interface OwnedTopHeaderScreenshotOption { ownerSelector: string; headerSelector: string }
interface OwnedHeaderFrame {
  rawScreenshot: { path: string; sha256: string; width: number; height: number };
  receiptPath: string; crop: { left: 0; top: number; width: number; height: number };
  destination: { left: 0; top: number; bottomExclusive: number };
  scrollOriginPixels: { x: number; y: number }; headerBottomViewportPixels: number;
  firstDocumentFrame: boolean; retainedHeaderOccurrence: boolean; adoptedPixelsUnoccluded: boolean;
}
export interface LayoutStableScreenshotOptions {
  path: string; selectors?: string[]; maxTiles?: number; maxPageHeight?: number; timeoutMs?: number; settleTimeoutMs?: number;
  prepareFrame?: () => Promise<void | { resourceStateChanged: boolean }>; maxPreparationRefreshes?: number;
  /** No generic overlay exemption. A unique, owned, normal-flow top header may
   * become sticky/fixed; other overlays and layout changes remain blockers. */
  ownedTopHeader?: OwnedTopHeaderScreenshotOption;
}

/** Capture actual viewport frames without Chromium's beyond-viewport scrollbar
 * suppression/reflow. Only scrolling is changed and restored. Overlay, motion,
 * lazy-layout and scroll-snap limitations are reported rather than painted away. */
export async function captureLayoutStableScreenshot(page: Page, options: LayoutStableScreenshotOptions): Promise<LayoutStableScreenshotReceipt> {
  if (options.ownedTopHeader !== undefined) return captureOwnedTopHeaderScreenshot(page, options);
  const maxTiles=options.maxTiles??80,maxPageHeight=options.maxPageHeight??30_000,timeoutMs=options.timeoutMs??45_000,settleTimeoutMs=options.settleTimeoutMs??1000,requestedSelectors=options.selectors??['body'],maximumRefreshes=options.maxPreparationRefreshes??2;
  if(!path.isAbsolute(options.path)||path.extname(options.path).toLowerCase()!=='.png'||!Number.isInteger(maxTiles)||maxTiles<1||maxTiles>100||!Number.isFinite(maxPageHeight)||maxPageHeight<1||maxPageHeight>60_000||!Number.isFinite(timeoutMs)||timeoutMs<1000||timeoutMs>60_000||!Number.isFinite(settleTimeoutMs)||settleTimeoutMs<50||settleTimeoutMs>3000||!Array.isArray(requestedSelectors)||requestedSelectors.length>2500||requestedSelectors.some(selector=>typeof selector!=='string'||!selector.trim()||selector.length>500))throw Error('Invalid bounded layout screenshot options');
  if(!Number.isInteger(maximumRefreshes)||maximumRefreshes<0||maximumRefreshes>3||options.prepareFrame!==undefined&&typeof options.prepareFrame!=='function')throw Error('Invalid bounded frame preparation options');
  const metrics={durationMs:0,layoutSamples:0,scrollCommands:0,screenshots:0,preparationCalls:0,preparationMs:0};
  const uniqueSelectors=[...new Set(requestedSelectors)],selectors=uniqueSelectors.slice(0,80),selectorCoverage={requested:requestedSelectors.length,uniqueRequested:uniqueSelectors.length,tracked:selectors.length,maximumTracked:80 as const};
  const sample=async():Promise<LayoutFacts>=>{metrics.layoutSamples++;return page.evaluate(selectors=>{
    const nodes=Array.from(document.body.querySelectorAll('*')),overlays:LayoutFacts['overlays']=[];
    for(let index=0;index<Math.min(nodes.length,12_000);index++){
      const node=nodes[index],css=getComputedStyle(node);if(css.position!=='fixed'&&css.position!=='sticky')continue;const measured=node.getBoundingClientRect(),box={x:measured.x,y:measured.y,width:measured.width,height:measured.height};
      if(box.width<=0||box.height<=0||css.display==='none'||css.visibility==='hidden'||Number(css.opacity)===0||box.x>=innerWidth||box.x+box.width<=0||box.y>=innerHeight||box.y+box.height<=0)continue;
      overlays.push({node:`${node.tagName.toLowerCase()}:document-descendant-${index}`,position:css.position,box,top:css.top,bottom:css.bottom,left:css.left,right:css.right});
    }
    const tracked=selectors.flatMap(selector=>Array.from(document.querySelectorAll(selector)).slice(0,20).map(node=>{const measured=node.getBoundingClientRect(),box={x:measured.x,y:measured.y,width:measured.width,height:measured.height};return{selector,position:getComputedStyle(node).position,box,documentY:box.y+scrollY};}));
    return{innerWidth,innerHeight,clientWidth:document.documentElement.clientWidth,clientHeight:document.documentElement.clientHeight,scrollWidth:document.documentElement.scrollWidth,scrollHeight:document.documentElement.scrollHeight,devicePixelRatio,scrollX,scrollY,tracked,overlays,runningAnimations:document.getAnimations().filter(animation=>animation.playState==='running'||animation.pending).length,elementCount:nodes.length,inventoryTruncated:nodes.length>12_000};
  },selectors);};
  const round=(number:number)=>Math.round(number*64)/64;
  const layoutSignature=(facts:LayoutFacts)=>JSON.stringify([facts.innerWidth,facts.innerHeight,facts.clientWidth,facts.clientHeight,facts.scrollWidth,facts.scrollHeight,facts.devicePixelRatio,facts.tracked.map(item=>[item.selector,item.position,round(item.box.x),round(item.box.width),round(item.box.height),['fixed','sticky'].includes(item.position)?null:round(item.documentY)])]);
  const frameSignature=(facts:LayoutFacts)=>JSON.stringify([layoutSignature(facts),round(facts.scrollX),round(facts.scrollY),facts.overlays.map(item=>[item.node,item.position,...Object.values(item.box).map(round)])]);
  const initial=await sample(),started=Date.now(),gaps:LayoutScreenshotGap[]=[],tiles:LayoutStableScreenshotReceipt['tiles']=[],pieces:Array<{input:Buffer;left:number;top:number}>=[];let before=initial,layoutRefreshes=0,discardedFrames=0;
  const gap=(code:string,message:string,tile?:number)=>{if(!gaps.some(item=>item.code===code&&item.tile===tile))gaps.push({code,message,...(tile===undefined?{}:{tile})});};
  if(before.innerWidth<100||before.innerHeight<100||before.clientWidth<1||before.scrollHeight<1||before.devicePixelRatio<1||before.devicePixelRatio>3)throw Error('Unsupported actual browser geometry for layout screenshot');
  let captureHeight=Math.min(before.scrollHeight,Math.floor(maxPageHeight));
  if(before.clientWidth*captureHeight*before.devicePixelRatio**2>120_000_000)throw Error('Actual document exceeds bounded layout screenshot raster budget');
  if(captureHeight<before.scrollHeight)gap('screenshot-page-height-limit','Only the actual bounded document prefix is captured. Original scrollHeight remains recorded and omitted document rows are not certified.');
  if(uniqueSelectors.length>selectors.length)gap('screenshot-tracked-selector-bound','The actual requested selector set exceeded 80 unique tracked selectors; its bounded geometry scope is recorded and cannot certify every requested owner.');
  if(before.scrollWidth>before.clientWidth)gap('screenshot-horizontal-overflow','The actual document is wider than its visible content viewport; horizontal overflow is not silently invented or rescaled into this vertical raster.');
  if(before.inventoryTruncated)gap('screenshot-overlay-inventory-bounded','The fixed/sticky candidate scan exceeded its explicit element bound.');
  if(before.scrollX!==0)gap('screenshot-horizontal-scroll-origin','The original page is horizontally scrolled; only its actual visible horizontal viewport can be captured.');
  // CDP captures the real compositor raster. Its pixel/CSS ratio may differ
  // from an emulated devicePixelRatio, so derive crop scale from actual pixels.
  let scale=before.devicePixelRatio,rasterWidth=Math.round(before.clientWidth*scale),rasterHeight=Math.round(captureHeight*scale);
  const session=await page.context().newCDPSession(page);
  let cursor=0,after=before,restored=before,layoutPreserved=true,unexpected:unknown;
  try{
    while(cursor<captureHeight&&tiles.length<maxTiles&&Date.now()-started<timeoutMs){
      const index=tiles.length,requestedScrollY=Math.min(cursor,Math.max(0,before.scrollHeight-before.innerHeight));
      metrics.scrollCommands++;
      await page.evaluate(({x,y})=>scrollTo({left:x,top:y,behavior:'instant'}),{x:before.scrollX,y:requestedScrollY});
      let readiness:void|{resourceStateChanged:boolean}=undefined;
      if(options.prepareFrame){const preparing=Date.now();metrics.preparationCalls++;readiness=await options.prepareFrame();metrics.preparationMs+=Date.now()-preparing;}
      let state=await sample(),previous=frameSignature(state),stable=0;const settling=Date.now();
      while(Date.now()-settling<settleTimeoutMs&&Date.now()-started<timeoutMs){await page.waitForTimeout(50);const next=await sample(),signature=frameSignature(next);stable=signature===previous&&!next.runningAnimations?stable+1:0;previous=signature;state=next;if(stable>=2)break;}
      const settled=stable>=2;
      if(readiness?.resourceStateChanged&&settled&&state.scrollHeight!==before.scrollHeight&&layoutSignature(state)!==layoutSignature(before)&&layoutRefreshes<maximumRefreshes&&state.innerWidth===before.innerWidth&&state.innerHeight===before.innerHeight&&state.clientWidth===before.clientWidth&&state.clientHeight===before.clientHeight&&state.scrollWidth===before.scrollWidth&&state.devicePixelRatio===before.devicePixelRatio){
        // Lazy work may grow an earlier region. Re-capture the complete real
        // document from its new stable baseline, never stretch or reuse tiles.
        discardedFrames+=tiles.length;layoutRefreshes++;before={...state,scrollX:initial.scrollX,scrollY:initial.scrollY};captureHeight=Math.min(before.scrollHeight,Math.floor(maxPageHeight));
        if(before.clientWidth*captureHeight*before.devicePixelRatio**2>120_000_000)throw Error('Prepared document exceeds bounded layout screenshot raster budget');
        rasterWidth=Math.round(before.clientWidth*scale);rasterHeight=Math.round(captureHeight*scale);cursor=0;tiles.length=0;pieces.length=0;continue;
      }
      if(!settled)gap('screenshot-scroll-or-animation-unsettled','Real scrolling/layout/animation did not stabilize within the bounded per-frame observation.',index);
      if(state.runningAnimations)gap('screenshot-active-animation','Actual animations are running; sequential viewport frames cannot prove one coherent simultaneous state.',index);
      if(state.overlays.length)gap('screenshot-fixed-sticky-overlay','Actual fixed/sticky candidates can cover or repeat document content across scroll frames. They were recorded and left unchanged; this composition is not certified seamless.',index);
      if(state.inventoryTruncated)gap('screenshot-overlay-inventory-bounded','The fixed/sticky candidate scan exceeded its explicit element bound.',index);
      if(layoutSignature(state)!==layoutSignature(before)){layoutPreserved=false;gap('screenshot-layout-changed','The actual CSS viewport or tracked document layout changed during scrolling; no expected geometry was substituted.',index);}
      const available=Math.min(captureHeight-cursor,state.scrollY+state.innerHeight-cursor),cropCSS=cursor-state.scrollY;
      if(available<=0||cropCSS<0){gap('screenshot-scroll-coverage-gap','Actual scroll positioning did not expose the next uncaptured document rows.',index);break;}
      metrics.screenshots++;const response=await session.send('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false}),pixels=Buffer.from(response.data,'base64'),information=await sharp(pixels).metadata();
      if(!tiles.length&&information.width&&information.height){const actualScale=information.width/state.innerWidth;if(actualScale>0&&actualScale<=3&&Math.abs(actualScale-information.height/state.innerHeight)<.001){scale=actualScale;rasterWidth=Math.round(before.clientWidth*scale);rasterHeight=Math.round(captureHeight*scale);}}
      const cropTopPx=Math.round(cropCSS*scale),targetTopPx=Math.round(cursor*scale),heightPx=Math.min(rasterHeight-targetTopPx,Math.round(available*scale));
      if(!information.width||!information.height||Math.abs(information.width-state.innerWidth*scale)>.5||cropTopPx<0||cropTopPx+heightPx>information.height||rasterWidth>information.width){gap('screenshot-raster-geometry-mismatch','Actual screenshot pixels do not agree with the observed CSS viewport/raster crop.',index);break;}
      after=await sample();
      if(layoutSignature(after)!==layoutSignature(before)){layoutPreserved=false;gap('screenshot-layout-changed','The real viewport screenshot changed CSS layout metrics; the artifact is diagnostic only.',index);}
      if(frameSignature(state)!==frameSignature(after))gap('screenshot-frame-changed-during-capture','The actual scroll/overlay/layout state changed between frame observation and capture completion.',index);
      pieces.push({input:await sharp(pixels).extract({left:0,top:cropTopPx,width:rasterWidth,height:heightPx}).png().toBuffer(),left:0,top:targetTopPx});
      tiles.push({index,requestedScrollY,actualScrollY:state.scrollY,documentTop:cursor,documentHeight:available,cropTopPx,rasterWidth:information.width,rasterHeight:information.height,before:state,after,settled});
      cursor+=available;
    }
    if(cursor<before.scrollHeight)gap('screenshot-incomplete-coverage','The explicit tile/time/scroll bounds stopped capture before every original document row was observed.');
  }catch(error){unexpected=error;gap('screenshot-capture-failed','A real viewport screenshot or browser observation failed; raw errors are omitted.');}
  finally{
    await session.detach().catch(()=>undefined);
    try{metrics.scrollCommands++;await page.evaluate(({x,y})=>scrollTo({left:x,top:y,behavior:'instant'}),{x:initial.scrollX,y:initial.scrollY});await page.waitForTimeout(50);restored=await sample();}
    catch{gap('screenshot-scroll-restore-failed','The original real scroll position could not be observed after restoration.');}
  }
  const originalScrollRestored=Math.abs(restored.scrollX-initial.scrollX)<.5&&Math.abs(restored.scrollY-initial.scrollY)<.5;
  if(!originalScrollRestored)gap('screenshot-scroll-restore-failed','The original real scroll position was not restored.');
  if(layoutSignature(restored)!==layoutSignature(before)){layoutPreserved=false;gap('screenshot-layout-changed-after-restore','The actual document layout did not return to its original measured geometry after scroll restoration.');}
  await mkdir(path.dirname(options.path),{recursive:true});
  // Unobserved rows stay transparent in a diagnostic artifact; they are never
  // filled from expected CSS, an old screenshot or source imagery.
  await sharp({create:{width:rasterWidth,height:rasterHeight,channels:4,background:{r:0,g:0,b:0,alpha:0}}}).composite(pieces).png().toFile(options.path);
  const complete=cursor>=before.scrollHeight&&!unexpected,seamless=complete&&gaps.length===0,receiptPath=`${options.path}.layout.json`;
  metrics.durationMs=Date.now()-started;
  const receipt:LayoutStableScreenshotReceipt={version:1,method:'scroll-viewport-cdp-no-beyond',pngPath:options.path,receiptPath,documentLayoutPreserved:layoutPreserved,complete,seamless,passed:layoutPreserved&&originalScrollRestored&&seamless,before,after,restored,originalScrollRestored,contentRaster:{width:rasterWidth,height:rasterHeight,scale,scaleBasis:'actual-png-viewport-ratio',measuredDevicePixelRatio:before.devicePixelRatio},selectorCoverage,tiles,gaps,...(options.prepareFrame?{preparation:{initial,layoutRefreshes,discardedFrames,maximumRefreshes}}:{}),metrics,constraints:{domOrCSSMutations:0,viewportOverrides:0,captureBeyondViewport:false,fromSurface:true,omittedScrollbarPixels:Math.round((before.innerWidth-before.clientWidth)*scale),timeModel:'Sequential real viewport frames, not one simultaneous frame'},limitations:['Only actual visible horizontal content is captured; browser scrollbar chrome is cropped using measured clientWidth.','Fixed/sticky overlays remain untouched and are named gaps rather than erased or silently duplicated as verified content.','CSS/JavaScript content may change between real scroll frames; observed instability prevents seamless certification.','Tracked selector geometry, running Web Animations and candidate overlays are observed; this is not a proof that all hidden application state is frozen.']};
  await writeFile(receiptPath,JSON.stringify(receipt,null,2));return receipt;
}

interface HeaderFacts {
  ownerMatches: number; headerMatches: number; sameOwner: boolean; sameHeader: boolean; owned: boolean;
  box: Box; position: string; top: string; overflowX: string; overflowY: string;
  visible: boolean; contentOverflows: boolean; unboundedPaint: boolean;
  paintConcerns: Array<{ node: string; reason: string }>;
  bodyOverlapsTopFootprint: boolean;
}
interface HeaderLayoutFacts extends LayoutFacts { header: HeaderFacts; observedContentHash: string; observedLayoutHash: string; observedPresentationHash: string }

/** Playwright serializes this trusted local callback's source, not its module
 * closure. Keep transpiler name metadata lexical without adding page globals.
 * The wrapper body is text so esbuild cannot lift its helper out again. */
function ownedHeaderBrowserCallback<T extends (...args: any[]) => any>(callback: T): T {
  const source = Function.prototype.toString.call(callback);
  if (source.includes('[native code]') || source.length > 100_000) throw Error('Owned-header observation callback must have bounded JavaScript source');
  return new Function(`return function clonewpOwnedHeaderObservation(...args) {
    const __name = (target, value) => Object.defineProperty(target, "name", { value, configurable: true });
    return (${source})(...args);
  };`)() as T;
}

/** Independent opt-in path: the legacy capture and receipt fields retain their
 * existing behavior. No pixels are generated for the header or its obscured
 * body: overlap exposes those body rows in a different actual viewport. */
async function captureOwnedTopHeaderScreenshot(page: Page, options: LayoutStableScreenshotOptions): Promise<LayoutStableScreenshotReceipt> {
  const policy = options.ownedTopHeader!, maxTiles = options.maxTiles ?? 80, maxPageHeight = options.maxPageHeight ?? 30_000;
  const timeoutMs = options.timeoutMs ?? 45_000, settleTimeoutMs = options.settleTimeoutMs ?? 1000;
  const requestedSelectors = options.selectors ?? ['body'];
  if (!policy || Object.keys(policy).sort().join(',') !== 'headerSelector,ownerSelector' || [policy.ownerSelector, policy.headerSelector].some(value => typeof value !== 'string' || !value.trim() || value.length > 500) ||
    !path.isAbsolute(options.path) || path.extname(options.path).toLowerCase() !== '.png' || !Number.isInteger(maxTiles) || maxTiles < 1 || maxTiles > 100 ||
    !Number.isFinite(maxPageHeight) || maxPageHeight < 1 || maxPageHeight > 60_000 || !Number.isFinite(timeoutMs) || timeoutMs < 1000 || timeoutMs > 60_000 ||
    !Number.isFinite(settleTimeoutMs) || settleTimeoutMs < 50 || settleTimeoutMs > 3000 || !Array.isArray(requestedSelectors) || requestedSelectors.length > 2500 ||
    requestedSelectors.some(selector => typeof selector !== 'string' || !selector.trim() || selector.length > 500) ||
    options.prepareFrame !== undefined && typeof options.prepareFrame !== 'function' || options.maxPreparationRefreshes !== undefined && (!Number.isInteger(options.maxPreparationRefreshes) || options.maxPreparationRefreshes < 0 || options.maxPreparationRefreshes > 3)) throw Error('Invalid bounded owned-top-header screenshot options');
  const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
  const uniqueSelectors = [...new Set(requestedSelectors)], selectors = uniqueSelectors.slice(0, 80);
  const selectorCoverage = { requested: requestedSelectors.length, uniqueRequested: uniqueSelectors.length, tracked: selectors.length, maximumTracked: 80 as const };
  const ownerHandle = await page.$(policy.ownerSelector), headerHandle = await page.$(policy.headerSelector);
  const metrics = { durationMs: 0, layoutSamples: 0, scrollCommands: 0, screenshots: 0, preparationCalls: 0, preparationMs: 0 };
  const sample = async (): Promise<HeaderLayoutFacts> => {
    metrics.layoutSamples++;
    const raw = await page.evaluate(ownedHeaderBrowserCallback(({ selectors, policy, ownerHandle, headerHandle }: {
      selectors: string[]; policy: OwnedTopHeaderScreenshotOption; ownerHandle: Element | null; headerHandle: Element | null;
    }) => {
      const owners = document.querySelectorAll(policy.ownerSelector), headers = document.querySelectorAll(policy.headerSelector);
      const header = headers[0], owner = owners[0], nodes = Array.from(document.body.querySelectorAll('*'));
      const css = header ? getComputedStyle(header) : null, measured = header?.getBoundingClientRect();
      const box = measured ? { x: measured.x, y: measured.y, width: measured.width, height: measured.height } : { x: 0, y: 0, width: 0, height: 0 };
      const round = (value: number) => Math.round(value * 64) / 64;
      const overlays: LayoutFacts['overlays'] = [], normalLayout: unknown[] = [], presentation: unknown[] = [], content: string[] = [], paintConcerns: HeaderFacts['paintConcerns'] = [], layoutCoordinateRows: LayoutCoordinateRow[] = [];
      let contentOverflows = false, unboundedPaint = false, bodyOverlapsTopFootprint = false, contentLength = 0, inventoryTruncated = nodes.length > 12_000;
      const rootSuppressed = [document.documentElement, document.body].some(node => { const style = getComputedStyle(node); return style.display === 'none' || Number(style.opacity) === 0 || style.contentVisibility === 'hidden'; });
      const suppressedAncestors = new Map<Element, boolean>(), fixedRoots = new Map<Element, number>(), anchors = new Map<Element, { index: number; position: 'fixed' | 'sticky' }>();
      const indices = new Map(nodes.map((node, index) => [node, index])); let headerEffectivelyVisible = false;
      const concern = (index: number, reason: string) => { if (paintConcerns.length < 80) paintConcerns.push({ node: `document-descendant-${index}`, reason }); else inventoryTruncated = true; };
      for (let index = 0; index < Math.min(nodes.length, 12_000); index++) {
        const node = nodes[index], style = getComputedStyle(node), r = node.getBoundingClientRect();
        const suppressed = (suppressedAncestors.get(node.parentElement!) ?? rootSuppressed) || style.display === 'none' || Number(style.opacity) === 0 || style.contentVisibility === 'hidden';
        suppressedAncestors.set(node, suppressed);
        const visible = r.width > 0 && r.height > 0 && !suppressed && !['hidden', 'collapse'].includes(style.visibility);
        if (node === header) headerEffectivelyVisible = visible;
        const inHeader = !!header && (node === header || header.contains(node));
        const fixedRootIndex = fixedRoots.get(node.parentElement!) ?? (style.position === 'fixed' ? index : null);
        if (fixedRootIndex !== null) fixedRoots.set(node, fixedRootIndex);
        const inheritedAnchor = anchors.get(node.parentElement!);
        const ownAnchor = ['fixed', 'sticky'].includes(style.position) ? { index, position: style.position as 'fixed' | 'sticky' } : undefined;
        const anchored = inheritedAnchor ?? ownAnchor; if (anchored) anchors.set(node, anchored);
        const frame = inHeader ? 'owned-header-relative' : fixedRootIndex !== null ? 'viewport-fixed-subtree' : 'document';
        const normalizedBox = { x: r.x - (inHeader ? box.x : 0), y: r.y + (inHeader ? -box.y : fixedRootIndex !== null ? 0 : scrollY), width: r.width, height: r.height };
        // Read all bounded normal-flow geometry, not only the requested owner
        // rectangles. Header descendants use header-relative positions because
        // their legitimate pinning changes their viewport/document coordinates.
        // A real fixed subtree (including its static descendants) is measured
        // in viewport coordinates, never assigned an invented flow position by
        // adding scrollY. Its raw rows and actual visibility remain retained.
        normalLayout.push([node.tagName, node.childElementCount, inHeader ? 'owned-header' : style.position,
          frame, inHeader ? null : fixedRootIndex, r.width > 0 && r.height > 0 ? round(normalizedBox.x) : null,
          r.width > 0 && r.height > 0 ? round(normalizedBox.y) : null, round(r.width), round(r.height)]);
        layoutCoordinateRows.push({ index, parentIndex: indices.get(node.parentElement!) ?? null, tag: node.tagName.toLowerCase(), id: node.id, className: node.getAttribute('class') ?? '', frame, fixedRootIndex,
          rawViewportBox: { x: r.x, y: r.y, width: r.width, height: r.height }, normalizedBox, position: style.position, display: style.display, visibility: style.visibility, opacity: style.opacity, suppressed });
        // Hash actual presentation without exporting text, URLs or form values.
        // Legitimate owned header pinning changes position/top, not these fields.
        presentation.push([style.display, style.visibility, style.opacity, style.contentVisibility, style.transform, style.filter, style.clipPath, style.maskImage,
          style.color, style.backgroundColor, style.backgroundImage, style.fontFamily, style.fontSize, style.fontWeight, style.lineHeight]);
        for (const child of Array.from(node.childNodes)) if (child.nodeType === Node.TEXT_NODE) {
          const text = child.textContent ?? ''; contentLength += text.length;
          if (contentLength <= 500_000) content.push(text); else inventoryTruncated = true;
        }
        if (visible && inHeader) {
          if (r.x < box.x - .02 || r.y < box.y - .02 || r.right > box.x + box.width + .02 || r.bottom > box.y + box.height + .02) { contentOverflows = true; concern(index, 'Actual descendant BCR exceeds the owned header BCR'); }
          if (style.boxShadow !== 'none' || style.filter !== 'none' || style.transform !== 'none' || style.getPropertyValue('backdrop-filter') !== 'none' && style.getPropertyValue('backdrop-filter') !== '') { unboundedPaint = true; concern(index, 'Actual transform/filter/shadow has no verified BCR paint bound'); }
        }
        if (visible && header && !inHeader && !node.contains(header) && r.x < box.x + box.width && r.right > box.x && r.y < box.y + box.height - .02 && r.bottom > box.y + .02) bodyOverlapsTopFootprint = true;
        if (visible && (ownAnchor && node !== header || !inHeader && anchored) && r.x < innerWidth && r.right > 0 && r.y < innerHeight && r.bottom > 0) {
          const actualAnchor = ownAnchor && node !== header ? ownAnchor : anchored!;
          overlays.push({ node: `${node.tagName.toLowerCase()}:document-descendant-${index}`, position: actualAnchor.position, box: { x: r.x, y: r.y, width: r.width, height: r.height }, top: style.top, bottom: style.bottom, left: style.left, right: style.right,
            ...(actualAnchor.index !== index ? { ownPosition: style.position, anchoredAncestorIndex: actualAnchor.index } : {}) });
        }
        if (visible) for (const pseudo of ['::before', '::after']) {
          const p = getComputedStyle(node, pseudo);
          if (!['none', 'normal', '""'].includes(p.content) && p.display !== 'none' && p.visibility !== 'hidden' && Number(p.opacity) !== 0 && ['fixed', 'sticky'].includes(p.position)) {
            overlays.push({ node: `${node.tagName.toLowerCase()}:document-descendant-${index}${pseudo}:unmeasured`, position: p.position as 'fixed' | 'sticky', box: { x: r.x, y: r.y, width: r.width, height: r.height }, top: p.top, bottom: p.bottom, left: p.left, right: p.right });
          }
          if (inHeader && !['none', 'normal', '""'].includes(p.content) && ['absolute', 'fixed', 'sticky'].includes(p.position)) { unboundedPaint = true; concern(index, `Actual ${pseudo} positioned paint has no measurable DOM BCR`); }
        }
      }
      const tracked = selectors.flatMap(selector => Array.from(document.querySelectorAll(selector)).slice(0, 20).map(node => {
        const r = node.getBoundingClientRect(); return { selector, position: getComputedStyle(node).position, box: { x: r.x, y: r.y, width: r.width, height: r.height }, documentY: r.y + scrollY };
      }));
      return { innerWidth, innerHeight, clientWidth: document.documentElement.clientWidth, clientHeight: document.documentElement.clientHeight,
        scrollWidth: document.documentElement.scrollWidth, scrollHeight: document.documentElement.scrollHeight, devicePixelRatio, scrollX, scrollY,
        tracked, overlays, runningAnimations: document.getAnimations().filter(animation => animation.playState === 'running' || animation.pending).length,
        elementCount: nodes.length, inventoryTruncated, layoutCoordinateRows,
        header: { ownerMatches: owners.length, headerMatches: headers.length, sameOwner: !!ownerHandle && owner === ownerHandle,
          sameHeader: !!headerHandle && header === headerHandle, owned: !!owner && !!header && owner.contains(header), box, position: css?.position ?? '',
          top: css?.top ?? '', overflowX: css?.overflowX ?? '', overflowY: css?.overflowY ?? '',
          visible: headerEffectivelyVisible,
          contentOverflows: contentOverflows || !!header && ((header as HTMLElement).scrollWidth > (header as HTMLElement).clientWidth + 1 || (header as HTMLElement).scrollHeight > (header as HTMLElement).clientHeight + 1), unboundedPaint, paintConcerns, bodyOverlapsTopFootprint },
        observedContent: JSON.stringify(content), observedLayout: JSON.stringify(normalLayout), observedPresentation: JSON.stringify(presentation) };
    }), { selectors, policy, ownerHandle, headerHandle });
    const { observedContent, observedLayout, observedPresentation, ...facts } = raw;
    return { ...facts, observedContentHash: hash(observedContent), observedLayoutHash: hash(observedLayout), observedPresentationHash: hash(observedPresentation) };
  };
  const initial = await sample(), started = Date.now(), gaps: LayoutScreenshotGap[] = [], tiles: LayoutStableScreenshotReceipt['tiles'] = [];
  const gap = (code: string, message: string, tile?: number) => { if (!gaps.some(item => item.code === code && item.tile === tile)) gaps.push({ code, message, ...(tile === undefined ? {} : { tile }) }); };
  const signature = (facts: HeaderLayoutFacts) => JSON.stringify([facts.innerWidth, facts.innerHeight, facts.clientWidth, facts.clientHeight, facts.scrollWidth, facts.scrollHeight,
    facts.devicePixelRatio, facts.elementCount, facts.observedContentHash, facts.observedLayoutHash, facts.observedPresentationHash]);
  const frameSignature = (facts: HeaderLayoutFacts) => JSON.stringify([signature(facts), facts.scrollX, facts.scrollY, facts.header, facts.overlays]);
  if (initial.innerWidth < 100 || initial.innerHeight < 100 || initial.clientWidth < 1 || initial.scrollHeight < 1 || initial.devicePixelRatio < 1 || initial.devicePixelRatio > 3) throw Error('Unsupported actual browser geometry for owned-header screenshot');
  const captureHeight = Math.min(initial.scrollHeight, Math.floor(maxPageHeight));
  if (initial.clientWidth * captureHeight * initial.devicePixelRatio ** 2 > 120_000_000) throw Error('Actual document exceeds bounded layout screenshot raster budget');
  if (captureHeight < initial.scrollHeight) gap('screenshot-page-height-limit', 'Only a bounded actual document prefix can be captured.');
  if (uniqueSelectors.length > selectors.length) gap('screenshot-tracked-selector-bound', 'Requested selector bindings exceed the retained bound.');
  if (initial.scrollWidth > initial.clientWidth) gap('screenshot-horizontal-overflow', 'Actual horizontal document overflow cannot be represented by this vertical raster.');
  if (initial.scrollX !== 0) gap('screenshot-horizontal-scroll-origin', 'Owned-header composition requires the actual horizontal document origin.');
  const baselineHeight = initial.header.box.height;
  let before = initial, after = initial, restored = initial, layoutPreserved = true, unexpected: unknown;
  let scale = initial.devicePixelRatio, rasterWidth = Math.round(initial.clientWidth * scale), rasterHeight = Math.round(captureHeight * scale);
  let cursorPx = 0, overlapPixels = Math.ceil(baselineHeight * scale) + 1, integralScrollOrigins = true;
  const pieces: Array<{ input: Buffer; left: number; top: number }> = [];
  const rawDirectory = `${options.path}.tiles`, receiptPath = `${options.path}.layout.json`;
  await mkdir(path.dirname(options.path), { recursive: true });
  await mkdir(rawDirectory); // Never overwrite a previous observation's tiles.
  const session = await page.context().newCDPSession(page);
  const check = (facts: HeaderLayoutFacts, index: number, first: boolean) => {
    const h = facts.header;
    if (h.ownerMatches !== 1 || h.headerMatches !== 1 || !h.sameOwner || !h.sameHeader || !h.owned) gap('screenshot-owned-header-identity', 'The exact unique owned header/owner no longer matches the original observed nodes.', index);
    if (!h.visible || Math.abs(h.box.x) > .02 || Math.abs(h.box.width - initial.clientWidth) > .02 || baselineHeight <= 0 || baselineHeight >= initial.innerHeight - 2 || Math.abs(h.box.height - baselineHeight) > .02) gap('screenshot-owned-header-geometry', 'The owned top header must retain its actual full content-viewport width, x origin and positive stable bounded height.', index);
    if (h.overflowX !== 'visible' || h.overflowY !== 'visible' || h.contentOverflows || h.unboundedPaint) gap('screenshot-owned-header-overflow', 'Header content overflow, transform, filter, shadow or unmeasured positioned pseudo-paint prevents a proven BCR occlusion bound.', index);
    if (first && (Math.abs(facts.scrollY) > .02 || Math.abs(h.box.y) > .02 || !['static', 'relative', 'sticky'].includes(h.position) || h.bodyOverlapsTopFootprint)) gap('screenshot-owned-header-top-footprint', 'The first real document-top frame must show a normal-flow top header with no overlapping body boxes; an initially fixed overlay has no verified body footprint.', index);
    if (!first && ['fixed', 'sticky'].includes(h.position) && (Math.abs(h.box.y) > .02 || Math.abs(parseFloat(h.top)) > .02 || !Number.isFinite(parseFloat(h.top)))) gap('screenshot-owned-header-offset', 'The pinned header must occupy exactly the actual top edge without a changing offset.', index);
    if (!first && !['static', 'relative', 'fixed', 'sticky'].includes(h.position)) gap('screenshot-owned-header-position', 'Unsupported owned-header positioning cannot qualify as a top occluder.', index);
    if (facts.overlays.length) gap('screenshot-fixed-sticky-overlay', 'Additional actual fixed/sticky or unmeasurable pseudo overlays remain untouched and block seamless certification.', index);
    if (facts.inventoryTruncated) gap('screenshot-overlay-inventory-bounded', 'Actual content/layout/overlay inventory exceeded its bound.', index);
    if (facts.runningAnimations) gap('screenshot-active-animation', 'Actual running animations prevent sequential-frame stability.', index);
    if (signature(facts) !== signature(before)) { layoutPreserved = false; gap('screenshot-layout-changed', 'Actual document content or normal layout changed; no expected geometry or earlier pixels were substituted.', index); }
  };
  try {
    while (cursorPx < rasterHeight && tiles.length < maxTiles && Date.now() - started < timeoutMs) {
      const index = tiles.length, requestedScrollY = index ? Math.min((cursorPx - overlapPixels) / scale, Math.max(0, initial.scrollHeight - initial.innerHeight)) : 0;
      metrics.scrollCommands++;
      await page.evaluate(y => scrollTo({ left: 0, top: y, behavior: 'instant' }), Math.max(0, requestedScrollY));
      if (options.prepareFrame) { const start = Date.now(); metrics.preparationCalls++; await options.prepareFrame(); metrics.preparationMs += Date.now() - start; }
      let state = await sample(), previous = frameSignature(state), stable = 0;
      const settling = Date.now();
      while (Date.now() - settling < settleTimeoutMs && Date.now() - started < timeoutMs) {
        await page.waitForTimeout(50); const next = await sample(), current = frameSignature(next);
        stable = current === previous && !next.runningAnimations ? stable + 1 : 0; previous = current; state = next; if (stable >= 2) break;
      }
      const settled = stable >= 2;
      if (!settled) gap('screenshot-scroll-or-animation-unsettled', 'The real scroll/header/layout did not stabilize within its observation bound.', index);
      // Track a fixed header's normal-flow footprint through its ancestor, not
      // by substituting its expected original documentY. The complete measured
      // non-header layout/content fingerprints must remain equal.
      if (!index) before = initial;
      check(state, index, !index);
      if (gaps.some(item => item.tile === index && /^screenshot-owned-header-/.test(item.code))) break;
      metrics.screenshots++;
      const response = await session.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
      const pixels = Buffer.from(response.data, 'base64'), metadata = await sharp(pixels).metadata();
      if (!index && metadata.width && metadata.height) {
        const actualScale = metadata.width / state.innerWidth;
        if (actualScale > 0 && actualScale <= 3 && Math.abs(actualScale - metadata.height / state.innerHeight) < .001) {
          scale = actualScale; rasterWidth = Math.round(initial.clientWidth * scale); rasterHeight = Math.round(captureHeight * scale); overlapPixels = Math.ceil(baselineHeight * scale) + 1;
        }
      }
      const originX = state.scrollX * scale, originY = state.scrollY * scale;
      const integral = Math.abs(originX - Math.round(originX)) < .001 && Math.abs(originY - Math.round(originY)) < .001;
      integralScrollOrigins &&= integral;
      const cropTopPx = cursorPx - Math.round(originY), heightPx = Math.min(rasterHeight - cursorPx, (metadata.height ?? 0) - cropTopPx);
      const headerBottom = Math.ceil((state.header.box.y + state.header.box.height) * scale);
      const pinned = ['fixed', 'sticky'].includes(state.header.position) && state.header.box.y >= -.02;
      const adoptedPixelsUnoccluded = !state.overlays.length && (!index || !pinned || cropTopPx >= headerBottom);
      if (!integral) gap('screenshot-scroll-pixel-origin', 'Actual scroll origin is not integral in the observed compositor raster; row correspondence cannot be certified.', index);
      if (!metadata.width || !metadata.height || Math.abs(metadata.width - state.innerWidth * scale) > .001 || Math.abs(metadata.height - state.innerHeight * scale) > .001 ||
        Math.abs(initial.clientWidth * scale - rasterWidth) > .001 || Math.abs(captureHeight * scale - rasterHeight) > .001 || cropTopPx < 0 || heightPx <= 0 || rasterWidth > metadata.width) {
        gap('screenshot-raster-geometry-mismatch', 'Actual viewport raster does not support an exact integral document crop.', index); break;
      }
      if (!adoptedPixelsUnoccluded) gap('screenshot-header-occlusion-coverage', 'The proposed actual body crop includes header or unknown-overlay pixels.', index);
      const rawPath = path.join(rawDirectory, `tile-${String(index).padStart(3, '0')}.png`);
      await writeFile(rawPath, pixels, { flag: 'wx' });
      after = await sample(); check(after, index, !index);
      if (frameSignature(state) !== frameSignature(after)) gap('screenshot-frame-changed-during-capture', 'Actual scroll/header/content/layout changed during the real viewport screenshot.', index);
      const ownedHeaderFrame: OwnedHeaderFrame = {
        rawScreenshot: { path: rawPath, sha256: hash(pixels), width: metadata.width, height: metadata.height }, receiptPath: `${rawPath}.json`,
        crop: { left: 0, top: cropTopPx, width: rasterWidth, height: heightPx }, destination: { left: 0, top: cursorPx, bottomExclusive: cursorPx + heightPx },
        scrollOriginPixels: { x: originX, y: originY }, headerBottomViewportPixels: headerBottom,
        firstDocumentFrame: !index, retainedHeaderOccurrence: !index, adoptedPixelsUnoccluded };
      const tile = { index, requestedScrollY, actualScrollY: state.scrollY, documentTop: cursorPx / scale, documentHeight: heightPx / scale,
        cropTopPx, rasterWidth: metadata.width, rasterHeight: metadata.height, before: state, after, settled, ownedHeaderFrame };
      await writeFile(ownedHeaderFrame.receiptPath, JSON.stringify(tile, null, 2), { flag: 'wx' });
      pieces.push({ input: await sharp(pixels).extract(ownedHeaderFrame.crop).png().toBuffer(), left: 0, top: cursorPx }); tiles.push(tile); cursorPx += heightPx;
      if (!integral || !layoutPreserved || frameSignature(state) !== frameSignature(after)) break;
    }
    if (cursorPx < Math.round(initial.scrollHeight * scale)) gap('screenshot-incomplete-coverage', 'Capture bounds or actual instability stopped observation before all document rows were exposed.');
  } catch (error) { unexpected = error; gap('screenshot-capture-failed', 'Actual screenshot, observation or immutable evidence write failed; raw errors are omitted.'); }
  finally {
    await session.detach().catch(() => undefined);
    try { metrics.scrollCommands++; await page.evaluate(({ x, y }) => scrollTo({ left: x, top: y, behavior: 'instant' }), { x: initial.scrollX, y: initial.scrollY }); await page.waitForTimeout(50); restored = await sample(); }
    catch { gap('screenshot-scroll-restore-failed', 'The original real scroll position could not be observed after restoration.'); }
    await Promise.all([ownerHandle?.dispose(), headerHandle?.dispose()]);
  }
  const originalScrollRestored = Math.abs(restored.scrollX - initial.scrollX) < .5 && Math.abs(restored.scrollY - initial.scrollY) < .5;
  if (!originalScrollRestored) gap('screenshot-scroll-restore-failed', 'The original actual scroll position was not restored.');
  if (signature(restored) !== signature(initial)) { layoutPreserved = false; gap('screenshot-layout-changed-after-restore', 'Actual content/layout did not return to its measured baseline.'); }
  let expectedTop = 0;
  const nonOverlapping = tiles.every(tile => { const crop = tile.ownedHeaderFrame!; const matches = crop.destination.top === expectedTop && crop.scrollOriginPixels.y + crop.crop.top === crop.destination.top; expectedTop = crop.destination.bottomExclusive; return matches; });
  const gapFree = nonOverlapping && expectedTop === rasterHeight;
  const unoccluded = tiles.every(tile => tile.ownedHeaderFrame!.adoptedPixelsUnoccluded) && !gaps.some(item => /overlay|owned-header|occlusion|frame-changed|layout-changed/.test(item.code));
  if (!gapFree) gap('screenshot-pixel-coverage-gap', 'Observed source crop intervals do not form an exact contiguous nonoverlapping raster partition.');
  const complete = cursorPx >= Math.round(initial.scrollHeight * scale) && !unexpected, seamless = complete && gapFree && unoccluded && integralScrollOrigins && gaps.length === 0;
  await sharp({ create: { width: rasterWidth, height: rasterHeight, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite(pieces).png().toFile(options.path);
  metrics.durationMs = Date.now() - started;
  const receipt: LayoutStableScreenshotReceipt = {
    version: 1, method: 'scroll-viewport-cdp-no-beyond', pngPath: options.path, receiptPath, documentLayoutPreserved: layoutPreserved, complete, seamless,
    passed: layoutPreserved && originalScrollRestored && seamless, before, after, restored, originalScrollRestored,
    contentRaster: { width: rasterWidth, height: rasterHeight, scale, scaleBasis: 'actual-png-viewport-ratio', measuredDevicePixelRatio: initial.devicePixelRatio }, selectorCoverage, tiles, gaps, metrics,
    ...(options.prepareFrame ? { preparation: { initial, layoutRefreshes: 0, discardedFrames: 0, maximumRefreshes: 0 } } : {}),
    ownedHeaderComposition: { kind: 'single-owned-top-header-overlap-v1', ...policy, headerPresentation: 'real-document-top-once', rawFramesRetained: true, headerHeightCSS: baselineHeight, overlapPixels, layoutCoordinateFrames: 'header-relative-fixed-subtree-viewport-normal-document-v1',
      coverage: { expectedRows: rasterHeight, observedRows: cursorPx, gapFree, nonOverlapping, unoccluded, integralScrollOrigins } },
    constraints: { domOrCSSMutations: 0, viewportOverrides: 0, captureBeyondViewport: false, fromSurface: true, omittedScrollbarPixels: Math.round((initial.innerWidth - initial.clientWidth) * scale), timeModel: 'Sequential real viewport frames, not one simultaneous frame' },
    limitations: ['The explicitly owned real top header is displayed once at document top. It remains visible in subsequent raw viewport frames; only real body pixels below its measured occlusion are adopted.',
      'This is a document composition, not a claim that every real scrolled viewport lacks the header. Raw frames, measured scroll origins and exact crop intervals are retained.',
      'All bounded DOM geometry rows are retained. Owned header coordinates are header-relative, real fixed subtrees use viewport coordinates, and normal body layout uses document coordinates; hidden/offscreen fixed rows are not discarded.',
      'Additional fixed/sticky overlays, unbounded header paint, nonintegral raster origins, changing content/layout and animations block certification.',
      'Only the actual visible horizontal content is retained; browser scrollbar chrome is omitted using clientWidth. No DOM, CSS, animation or viewport overrides are performed.',
      'Frame preparation may wait for readiness; unlike the default path, this opt-in rejects document drift instead of refreshing its baseline. Hidden application state outside the measured evidence is not proven frozen.'] };
  await writeFile(receiptPath, JSON.stringify(receipt, null, 2)); return receipt;
}
