import { createHash } from 'node:crypto';
import type { Page, Request, Response } from 'playwright';

export interface StylesheetGap { code: 'stylesheet-link-error' | 'stylesheet-http-error' | 'stylesheet-network-error' | 'stylesheet-timeout' | 'stylesheet-credential-url' | 'stylesheet-reload-failed' | 'stylesheet-document-scope-missing' | 'stylesheet-document-scope-unobserved'; resource?: string; resourceSha256?: string; status?: number; message: string }
interface LinkFact { node: string; href: string; media: string; applies: boolean; disabled: boolean; sheetAvailable: boolean; event?: 'load' | 'error' }
export interface DocumentStyleScopeProof {
  requiredSelector: string; status: 'observed' | 'missing' | 'unobserved'; scannedSheets: number; scannedRules: number; bounded: boolean;
  matches: Array<{ sheetIndex: number; rulePath: number[]; resource?: string; resourceSha256?: string; selectorSha256: string; ruleSha256: string }>;
  inaccessibleStylesheets: Array<{ sheetIndex: number; rulePath: number[]; resource?: string; resourceSha256?: string }>;
}
export interface StylesheetAttempt {
  attempt: number; startedAt: string; durationMs: number; document: string; documentUrlSha256: string;
  applicableLinkCount: number; inlineStyleCount: number; settled: boolean; ready: boolean;
  links: Array<Omit<LinkFact, 'href'> & { resource: string; resourceSha256: string; state: 'loaded' | 'failed' | 'pending' | 'ignored'; status?: number }>;
  resources: Array<{ resource: string; resourceSha256: string; status?: number; finished: boolean; failed: boolean }>;
  gaps: StylesheetGap[];
  documentStyleScope?: DocumentStyleScopeProof;
}
export interface StylesheetReadinessReport {
  version: 1; ready: boolean; status: 'ready' | 'not-applicable' | 'failed'; attempts: StylesheetAttempt[];
  reloads: 0 | 1; recovered: boolean; gaps: StylesheetGap[];
  scope: 'Current enabled matching-media stylesheet links and observed stylesheet requests; no expected CSS or box stability inference';
  visualFidelityProven: false;
}
interface Resource { url: string; status?: number; finished: boolean; failed: boolean }
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
// Resource query strings can contain authentication material. Use their actual
// hash for identity, but never persist credentials, query values or raw failures.
const publicURL = (value: string): string => { try { const url = new URL(value); return `${url.origin}${url.pathname}`; } catch { return '[invalid stylesheet URL]'; } };
const credentialURL = (value: string): boolean => { try { const url = new URL(value); return !!(url.username || url.password); } catch { return true; } };

/** Install before navigation so early load/error events and HTTP failures cannot
 * disappear before DOMContentLoaded. The observer makes no resource fetches and
 * delegates its single exact-document reload to the existing scoped Page route. */
export async function installStylesheetReadiness(page: Page, options: { expectedOrigin: string; timeoutMs?: number; quietMs?: number; requiredStyleScope?: string }) {
  const origin = new URL(options.expectedOrigin), timeoutMs = options.timeoutMs ?? 12_000, quietMs = options.quietMs ?? 250;
  if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password || !Number.isFinite(timeoutMs) || timeoutMs < 100 || timeoutMs > 30_000 || !Number.isFinite(quietMs) || quietMs < 50 || quietMs > 1000 || quietMs >= timeoutMs) throw Error('Invalid bounded stylesheet readiness options');
  if(options.requiredStyleScope!==undefined&&!/^\.[A-Za-z_][A-Za-z\d_-]{0,100}$/.test(options.requiredStyleScope))throw Error('Required native document style scope must be one bounded class selector');
  let resources = new Map<Request, Resource>(), stopped = false, used = false;
  const request = (item: Request) => { if (!stopped && item.resourceType() === 'stylesheet') resources.set(item, { url: item.url(), finished: false, failed: false }); };
  const response = (item: Response) => { const resource = resources.get(item.request()); if (resource) resource.status = item.status(); };
  const finished = (item: Request) => { const resource = resources.get(item); if (resource) resource.finished = true; };
  const failed = (item: Request) => { const resource = resources.get(item); if (resource) { resource.finished = true; resource.failed = true; } };
  page.on('request', request); page.on('response', response); page.on('requestfinished', finished); page.on('requestfailed', failed);
  await page.addInitScript(() => {
    const events = new WeakMap<HTMLLinkElement, { href: string; event: 'load' | 'error' }>();
    Object.defineProperty(window, '__clonewpStylesheetEvents', { value: events, configurable: true });
    for (const event of ['load', 'error'] as const) document.addEventListener(event, item => {
      if (item.target instanceof HTMLLinkElement && item.target.relList.contains('stylesheet')) events.set(item.target, { href: item.target.href, event });
    }, true);
  });
  const assertDocument = (expected?: string) => {
    const actual = new URL(page.url());
    if (actual.origin !== origin.origin || actual.username || actual.password || expected !== undefined && actual.href !== expected) throw Error('Stylesheet observation/reload left the exact scoped target document');
    return actual.href;
  };
  const attempt = async (number: number): Promise<StylesheetAttempt> => {
    const url = assertDocument(), startedAt = new Date().toISOString(), started = Date.now(); let signature = '', unchangedAt = started;
    let last!: StylesheetAttempt;
    do {
      assertDocument(url);
      const observed = await page.evaluate(requiredStyleScope => {
        const events = (window as unknown as { __clonewpStylesheetEvents?: WeakMap<HTMLLinkElement, { href: string; event: 'load' | 'error' }> }).__clonewpStylesheetEvents;
        const links = Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel~="stylesheet"]')).map((link, index) => {
          const event = events?.get(link), disabled = link.disabled || link.sheet?.disabled === true || link.relList.contains('alternate') && !!link.title && !link.sheet;
          return { node: `stylesheet-link-${index}`, href: link.href, media: link.media, disabled, applies: !disabled && (!link.media.trim() || matchMedia(link.media).matches), sheetAvailable: !!link.sheet, ...(event?.href === link.href ? { event: event.event } : {}) };
        });
        let documentStyleScope: {requiredSelector:string;status:'observed'|'missing'|'unobserved';scannedSheets:number;scannedRules:number;bounded:boolean;matches:Array<{sheetIndex:number;rulePath:number[];href?:string;selector:string;css:string}>;inaccessibleStylesheets:Array<{sheetIndex:number;rulePath:number[];href?:string}>}|undefined;
        if(requiredStyleScope){
          const proof:NonNullable<typeof documentStyleScope>={requiredSelector:requiredStyleScope,status:'missing',scannedSheets:0,scannedRules:0,bounded:false,matches:[],inaccessibleStylesheets:[]},requiredClass=requiredStyleScope.slice(1),visited=new WeakSet<CSSStyleSheet>();
          // Parse positive class tokens, not filenames, substrings, attribute
          // strings or negated selectors. CSS escapes are decoded as identifiers.
          const hasScope=(selector:string)=>{
            let bracket=0,quote='',functions:string[]=[];
            for(let index=0;index<selector.length;index++){
              const char=selector[index];
              if(quote){if(char==='\\'){index++;continue;}if(char===quote)quote='';continue;}
              if(char==='"'||char==="'"){quote=char;continue;}
              if(char==='/'&&selector[index+1]==='*'){const end=selector.indexOf('*/',index+2);if(end<0)break;index=end+1;continue;}
              if(char==='\\'){const hex=selector.slice(index+1).match(/^[a-f\d]{1,6}/i)?.[0];index+=hex?hex.length:1;if(hex&&/\s/.test(selector[index+1]??''))index++;continue;}
              if(char==='['){bracket++;continue;}if(char===']'){bracket=Math.max(0,bracket-1);continue;}if(bracket)continue;
              if(char==='('){functions.push(selector.slice(0,index).match(/:([a-z-]+)\s*$/i)?.[1].toLowerCase()??'');continue;}if(char===')'){functions.pop();continue;}
              if(char!=='.'||functions.includes('not')||functions.includes('has'))continue;
              let name='',cursor=index+1;
              while(cursor<selector.length){const next=selector[cursor];if(/[A-Za-z\d_-]/.test(next)||next.charCodeAt(0)>=128){name+=next;cursor++;continue;}if(next==='\\'&&cursor+1<selector.length){const hex=selector.slice(cursor+1).match(/^[a-f\d]{1,6}/i)?.[0];if(hex){const point=parseInt(hex,16);name+=String.fromCodePoint(point>0&&point<=0x10ffff?point:0xfffd);cursor+=hex.length+1;if(/\s/.test(selector[cursor]??''))cursor++;}else{name+=selector[cursor+1];cursor+=2;}continue;}break;}
              if(name===requiredClass)return true;index=Math.max(index,cursor-1);
            }return false;
          };
          const inspectRules=(rules:CSSRuleList,sheetIndex:number,href:string|undefined,parent:number[],depth:number)=>{
            if(depth>16){proof.bounded=true;return;}
            for(let index=0;index<rules.length;index++){
              if(++proof.scannedRules>60_000){proof.bounded=true;return;}
              const rule=rules[index] as CSSRule&{selectorText?:string;cssRules?:CSSRuleList;media?:MediaList;conditionText?:string;styleSheet?:CSSStyleSheet},rulePath=[...parent,index];
              if(rule.media?.mediaText&&!matchMedia(rule.media.mediaText).matches)continue;
              if(rule.constructor.name==='CSSSupportsRule'&&rule.conditionText&&!CSS.supports(rule.conditionText))continue;
              if(typeof rule.selectorText==='string'&&hasScope(rule.selectorText)){proof.matches.push({sheetIndex,rulePath,href,selector:rule.selectorText,css:rule.cssText});return;}
              if(rule.type===CSSRule.IMPORT_RULE&&rule.styleSheet)inspectSheet(rule.styleSheet,sheetIndex,rulePath,depth+1);
              else if(rule.cssRules)inspectRules(rule.cssRules,sheetIndex,href,rulePath,depth+1);
              if(proof.matches.length||proof.bounded)return;
            }
          };
          const inspectSheet=(sheet:CSSStyleSheet,sheetIndex:number,rulePath:number[],depth:number)=>{
            if(visited.has(sheet)||sheet.disabled||sheet.media.mediaText&&!matchMedia(sheet.media.mediaText).matches)return;visited.add(sheet);
            if(++proof.scannedSheets>256){proof.bounded=true;return;}
            try{inspectRules(sheet.cssRules,sheetIndex,sheet.href??undefined,rulePath,depth);}catch{proof.inaccessibleStylesheets.push({sheetIndex,rulePath,href:sheet.href??undefined});}
          };
          for(const[index,sheet]of Array.from(document.styleSheets).entries()){inspectSheet(sheet,index,[],0);if(proof.matches.length||proof.bounded)break;}
          proof.status=proof.matches.length?'observed':proof.bounded||proof.inaccessibleStylesheets.length?'unobserved':'missing';documentStyleScope=proof;
        }
        return { links, inlineStyleCount: document.querySelectorAll('style').length,documentStyleScope };
      },options.requiredStyleScope);
      const knownLinks = new Set(observed.links.map(link => link.href)), applicable = observed.links.filter(link => link.applies), relevant = [...resources.values()].filter(resource => applicable.some(link => link.href === resource.url) || !knownLinks.has(resource.url));
      const gaps: StylesheetGap[] = [];
      const add = (code: StylesheetGap['code'], message: string, href?: string, status?: number) => {
        const gap = { code, message, ...(href ? { resource: publicURL(href), resourceSha256: digest(href) } : {}), ...(status === undefined ? {} : { status }) };
        if (!gaps.some(item => item.code === gap.code && item.resourceSha256 === gap.resourceSha256)) gaps.push(gap);
      };
      const links: StylesheetAttempt['links'] = observed.links.map(link => {
        const rows = relevant.filter(resource => resource.url === link.href), http = rows.find(resource => (resource.status ?? 0) >= 400), network = rows.some(resource => resource.failed), invalid = credentialURL(link.href);
        const state = !link.applies ? 'ignored' : link.event === 'error' || http || network || invalid ? 'failed' : link.sheetAvailable || link.event === 'load' ? 'loaded' : 'pending';
        if (link.applies && invalid) add('stylesheet-credential-url', 'An enabled stylesheet has an invalid or credential-bearing URL.', link.href);
        if (link.applies && link.event === 'error') add('stylesheet-link-error', 'The enabled matching-media link emitted its actual error event.', link.href);
        const { href, ...fact } = link; return { ...fact, resource: publicURL(href), resourceSha256: digest(href), state, ...(http?.status === undefined ? {} : { status: http.status }) };
      });
      for (const resource of relevant) {
        if ((resource.status ?? 0) >= 400) add('stylesheet-http-error', 'An applicable stylesheet request returned an actual HTTP failure.', resource.url, resource.status);
        if (resource.failed) add('stylesheet-network-error', 'An applicable stylesheet request failed; raw browser/network diagnostics are omitted.', resource.url);
      }
      const rawScope=observed.documentStyleScope;
      const scopeResource=(href?:string)=>href?{resource:publicURL(href),resourceSha256:digest(href)}:{};
      const documentStyleScope:DocumentStyleScopeProof|undefined=rawScope?{...rawScope,matches:rawScope.matches.map(({href,selector,css,...match})=>({...match,...scopeResource(href),selectorSha256:digest(selector),ruleSha256:digest(css)})),inaccessibleStylesheets:rawScope.inaccessibleStylesheets.map(({href,...sheet})=>({...sheet,...scopeResource(href)}))}:undefined;
      if(documentStyleScope&&documentStyleScope.status!=='observed')add(documentStyleScope.status==='missing'?'stylesheet-document-scope-missing':'stylesheet-document-scope-unobserved','The required native document class scope was not proved by an actual enabled matching-media CSSOM selector. Loaded unrelated stylesheet links do not prove document styling.');
      const settled = !links.some(link => link.state === 'pending') && relevant.every(resource => resource.finished);
      const nextSignature = JSON.stringify([links, relevant.map(resource => [digest(resource.url), resource.status, resource.finished, resource.failed]), observed.inlineStyleCount,documentStyleScope]);
      if (nextSignature !== signature) { signature = nextSignature; unchangedAt = Date.now(); }
      const timedOut = Date.now() - started >= timeoutMs;
      if (timedOut && !settled) {
        for (const link of links.filter(link => link.state === 'pending')) gaps.push({ code: 'stylesheet-timeout', resource: link.resource, resourceSha256: link.resourceSha256, message: 'The matching-media stylesheet remained unresolved at the bounded readiness deadline.' });
        if (!gaps.some(gap => gap.code === 'stylesheet-timeout')) add('stylesheet-timeout', 'An observed stylesheet request remained unfinished at the bounded readiness deadline.');
      }
      last = { attempt: number, startedAt, durationMs: Date.now() - started, document: publicURL(url), documentUrlSha256: digest(url), applicableLinkCount: applicable.length, inlineStyleCount: observed.inlineStyleCount, settled, ready: settled && gaps.length === 0, links, resources: relevant.map(({ url: resourceURL, ...rest }) => ({ resource: publicURL(resourceURL), resourceSha256: digest(resourceURL), ...rest })), gaps,...(documentStyleScope?{documentStyleScope}:{}) };
      if (timedOut || settled && Date.now() - unchangedAt >= quietMs) return last;
      await page.waitForTimeout(50);
    } while (!stopped);
    throw Error('Stylesheet observer was disposed before readiness completed');
  };
  return {
    async wait(options: { allowReload?: boolean } = {}): Promise<StylesheetReadinessReport> {
      if (used || stopped) throw Error('Stylesheet readiness observer may finalize only once'); used = true;
      const exactURL = assertDocument(), attempts = [await attempt(0)]; let reloads: 0 | 1 = 0;
      const explicitFailure = attempts[0].gaps.some(gap => ['stylesheet-link-error', 'stylesheet-http-error', 'stylesheet-network-error','stylesheet-document-scope-missing','stylesheet-document-scope-unobserved'].includes(gap.code));
      if (!attempts[0].ready && explicitFailure && options.allowReload !== false) {
        assertDocument(exactURL); resources = new Map(); reloads = 1;
        try { await page.reload({ waitUntil: 'domcontentloaded', timeout: 45_000 }); assertDocument(exactURL); attempts.push(await attempt(1)); }
        catch {
          // Never print navigation error text, which may contain auth call logs.
          attempts.push({ attempt: 1, startedAt: new Date().toISOString(), durationMs: 0, document: publicURL(exactURL), documentUrlSha256: digest(exactURL), applicableLinkCount: 0, inlineStyleCount: 0, settled: false, ready: false, links: [], resources: [], gaps: [{ code: 'stylesheet-reload-failed', message: 'The one exact-document CSS recovery reload failed or left its scoped URL; no further reload was attempted.' }] });
        }
      }
      const final = attempts.at(-1)!;
      return { version: 1, ready: final.ready, status: !final.ready ? 'failed' : !final.applicableLinkCount && !final.resources.length && !final.documentStyleScope ? 'not-applicable' : 'ready', attempts, reloads, recovered: reloads === 1 && final.ready, gaps: final.gaps, scope: 'Current enabled matching-media stylesheet links and observed stylesheet requests; no expected CSS or box stability inference', visualFidelityProven: false };
    },
    dispose() { stopped = true; page.off('request', request); page.off('response', response); page.off('requestfinished', finished); page.off('requestfailed', failed); },
  };
}
