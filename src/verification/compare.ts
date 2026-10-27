import type { ComparisonOptions, SourceElementEvidence, SourceEvidence, TargetElementEvidence, TargetViewportEvidence, VerificationIssue } from './types.js';

export function normalizeText(value: string): string {
  return value.normalize('NFKC').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function primaryFont(value: string): string { const first=value.split(',')[0].trim();const quoted=/^["']/.test(first);const name=first.replace(/^["']|["']$/g,'').toLowerCase();const generic=['serif','sans-serif','monospace','cursive','fantasy','system-ui','ui-serif','ui-sans-serif','ui-monospace','ui-rounded','emoji','math','fangsong'].includes(name)&&!quoted;return `${generic?'generic':'named'}:${name}`; }
function fontUsage(fonts:NonNullable<SourceElementEvidence['renderedFonts']>):string{return JSON.stringify(fonts.map(font=>({familyName:font.familyName,postScriptName:font.postScriptName,isCustomFont:font.isCustomFont,glyphCount:font.glyphCount})).sort((a,b)=>`${a.familyName}/${a.postScriptName}`.localeCompare(`${b.familyName}/${b.postScriptName}`)));}
function numericStyle(value: string | undefined): number | undefined {
  if (!value || !/^-?[\d.]+px$/.test(value)) return undefined;
  const number = Number.parseFloat(value);
  return Number.isFinite(number) ? number : undefined;
}

export function resolveEvidenceURL(value: string, base?: string): string | undefined {
  try { return new URL(value, base).href; } catch { return undefined; }
}

function opacity(value: string | undefined): number { const number=value===undefined?1:Number(value);return Number.isFinite(number)&&number>=0&&number<=1?number:1; }
function rgba(value: string): {r:number;g:number;b:number;alpha:number}|undefined {
  if(value==='transparent') return {r:0,g:0,b:0,alpha:0};
  const match=value.trim().match(/^rgba?\(([^)]+)\)$/i);
  if(!match) return undefined;
  const pieces=match[1].replace(/\//g,' ').split(/[\s,]+/).filter(Boolean);
  if(pieces.length<3||pieces.length>4) return undefined;
  const channels=pieces.slice(0,3).map(part=>part.endsWith('%')?Number.parseFloat(part)*2.55:Number(part));
  const alpha=pieces[3]===undefined?1:pieces[3].endsWith('%')?Number.parseFloat(pieces[3])/100:Number(pieces[3]);
  if(channels.some(number=>!Number.isFinite(number))||!Number.isFinite(alpha)) return undefined;
  return {r:channels[0],g:channels[1],b:channels[2],alpha};
}
export function effectiveColor(color:string,effectiveOpacity=1):{r:number;g:number;b:number;alpha:number}|undefined {
  const parsed=rgba(color);return parsed?{...parsed,alpha:parsed.alpha*effectiveOpacity}:undefined;
}
export function physicalTextAlign(align:string,direction='ltr'):string {
  return align==='start'?(direction==='rtl'?'right':'left'):align==='end'?(direction==='rtl'?'left':'right'):align;
}
function sourcePaintOpacity(source:SourceElementEvidence,byId:Map<string,SourceElementEvidence>):{value:number;proven:boolean} {
  if(source.effectiveOpacity!==undefined) return {value:source.effectiveOpacity,proven:true};
  let current:SourceElementEvidence|undefined=source,value=1;
  const seen=new Set<string>();
  while(current){
    if(seen.has(current.id)) return {value,proven:false};seen.add(current.id);
    value*=opacity(current.style.opacity);
    if(current.parentId===null||current.parentId===undefined) return {value,proven:true};
    current=byId.get(current.parentId);
  }
  return {value,proven:false};
}

export function compareElement(source: SourceElementEvidence, target: TargetElementEvidence, viewport: string, options: ComparisonOptions & { sourceBaseUrl?: string; targetBaseUrl?: string; sourceEffectiveOpacity?:number; sourceOpacityProven?:boolean; containerPaddingEquivalent?:boolean } = {}): VerificationIssue[] {
  const issues: VerificationIssue[] = [];
  const issue = (code: string, message: string, expected?: unknown, actual?: unknown, severity: 'error' | 'warning' = 'error') => {
    issues.push({ code, status: 'mismatch', severity, viewport, sourceId: source.id, targetId: target.targetId, message, expected, actual });
  };
  if (!target.found) { issue('missing-element', 'A mapped source element is absent from the saved frontend.'); return issues; }
  if (target.count > 1) issue('ambiguous-target', 'The target selector matches multiple DOM elements.', 1, target.count);
  if (!target.visible && source.rect.width > 0 && source.rect.height > 0) { issue('hidden-element', 'A visible source element is hidden in the target.'); return issues; }
  if (!target.nativeElement) issues.push({ code: 'native-element-unproven', status: 'unverified', severity: 'error', viewport, sourceId: source.id, targetId: target.targetId, message: 'The mapped DOM element is not identifiable as an Elementor-native element.' });
  if (target.widgetType?.split('.')[0] === 'html') issue('html-widget-substitution', 'The source atom was placed inside an HTML widget instead of its own editable native element.');
  const sourceText = normalizeText(source.directText || (source.kind==='container'?'':source.text) || '');
  const sourceOpacity=options.sourceEffectiveOpacity??source.effectiveOpacity??opacity(source.style.opacity);
  const targetOpacity=target.effectiveOpacity??opacity(target.style.opacity);
  if(options.sourceOpacityProven===false) issues.push({code:'source-ancestor-opacity-unverified',status:'unverified',severity:'error',viewport,sourceId:source.id,targetId:target.targetId,message:'A source ancestor is missing from the captured opacity chain; painted color and media opacity cannot be certified.'});
  const targetText = normalizeText(target.text);
  if (sourceText && !targetText.includes(sourceText)) issue('content-missing', 'Visible source text is missing or changed.', sourceText.slice(0, 240), targetText.slice(0, 240));
  if (source.link) {
    const expected = resolveEvidenceURL(source.link.href, options.sourceBaseUrl);
    const actual = target.href ? resolveEvidenceURL(target.href, options.targetBaseUrl) : undefined;
    if (!expected) issues.push({ code: 'source-link-unresolved', status: 'unverified', severity: 'error', viewport, sourceId: source.id, targetId: target.targetId, message: 'The source link cannot be resolved against the source URL.' });
    else if (actual !== expected) issue('link-destination', 'The native link destination differs from the source, including its fragment.', expected, actual ?? '(no native link)');
  }
  const measured = source.kind === 'container' ? target.rect : target.contentRect ?? target.rect;
  for (const property of ['x', 'y', 'width', 'height'] as const) {
    const expected = source.rect[property], actual = measured[property];
    const tolerance = property === 'x' || property === 'y' ? Math.max(16, source.rect.width * 0.04) : Math.max(8, expected * 0.08);
    if (Math.abs(expected - actual) > tolerance) issue(`geometry-${property}`, `The ${property} differs from the source beyond the current measurement tolerance.`, Math.round(expected * 100) / 100, Math.round(actual * 100) / 100);
  }
  if (sourceText) {
    for (const property of ['font-size','line-height','letter-spacing'] as const) {
      const expected = numericStyle(source.style[property]), actual = numericStyle(target.style[property]);
      if (expected !== undefined && actual !== undefined && Math.abs(expected - actual) > Math.max(property === 'letter-spacing' ? 0.5 : 2, expected * 0.08)) issue(`typography-${property}`, `The ${property} differs from the source.`, source.style[property], target.style[property]);
    }
    for (const property of ['font-weight','font-style','direction','text-transform'] as const) {
      if (source.style[property] && target.style[property] && source.style[property] !== target.style[property]) issue(`typography-${property}`, `The ${property} differs from the source.`, source.style[property], target.style[property], property === 'text-transform' ? 'warning' : 'error');
    }
    if(source.style['text-align']&&target.style['text-align']&&physicalTextAlign(source.style['text-align'],source.style.direction)!==physicalTextAlign(target.style['text-align'],target.style.direction)) issue('typography-text-align','The physical text alignment differs after resolving start/end using writing direction.',{align:source.style['text-align'],direction:source.style.direction??'ltr'}, {align:target.style['text-align'],direction:target.style.direction??'ltr'});
    if(source.style.color&&target.style.color){
      const expected=effectiveColor(source.style.color,sourceOpacity),actual=effectiveColor(target.style.color,targetOpacity);
      if(expected&&actual){if(Math.abs(expected.r-actual.r)>.5||Math.abs(expected.g-actual.g)>.5||Math.abs(expected.b-actual.b)>.5||Math.abs(expected.alpha-actual.alpha)>.005) issue('typography-color','The painted text color differs after accounting for color alpha and measured element/ancestor opacity.',expected,actual);}
      else if(source.style.color!==target.style.color||Math.abs(sourceOpacity-targetOpacity)>.005) issues.push({code:'painted-color-unverified',status:'unverified',severity:'error',viewport,sourceId:source.id,targetId:target.targetId,expected:{color:source.style.color,opacity:sourceOpacity},actual:{color:target.style.color,opacity:targetOpacity},message:'The computed color format cannot yet be normalized into comparable effective RGBA evidence.'});
    }
    const sameFontText=normalizeText(source.text||source.directText||'')===normalizeText(target.fontText??target.text);
    const fontProof=!!source.renderedFonts?.length&&!!target.renderedFonts?.length&&sameFontText;
    const equivalent=fontProof&&fontUsage(source.renderedFonts!)===fontUsage(target.renderedFonts!);
    if(fontProof&&!equivalent) issue('rendered-font-mismatch','The actual glyph fonts differ (family, PostScript name, custom status or glyph counts).',source.renderedFonts,target.renderedFonts);
    if(source.renderedFonts?.length&&sameFontText&&!target.renderedFonts?.length) issues.push({code:'rendered-font-unverified',status:'unverified',severity:'error',viewport,sourceId:source.id,targetId:target.targetId,message:'Source glyph-font proof exists but target glyph-font proof is unavailable.'});
    if (source.style['font-family'] && target.style['font-family'] && primaryFont(source.style['font-family']) !== primaryFont(target.style['font-family'])&&!equivalent) issue('typography-font-family', 'The CSS font family semantics differ; a quoted generic keyword names a font rather than selecting the generic family. No equal rendered-glyph proof overrides this difference.', source.style['font-family'], target.style['font-family']);
  }
  const layers=target.paintLayers??[{rect:target.contentRect??target.rect,style:target.style,role:'content' as const,effectiveOpacity:targetOpacity}];
  const score=(layer:typeof layers[number])=>Math.abs(layer.rect.width-source.rect.width)+Math.abs(layer.rect.height-source.rect.height)+Math.abs(layer.rect.x-source.rect.x)+Math.abs(layer.rect.y-source.rect.y)+(layer.role==='content'?0:0.01);
  const primary=[...layers].sort((a,b)=>score(a)-score(b))[0];
  const painted=(layer:typeof layers[number])=>{const color=rgba(layer.style['background-color']??'transparent');return !!color?.alpha||(layer.style['background-image']&&layer.style['background-image']!=='none')||(layer.style['box-shadow']&&layer.style['box-shadow']!=='none')||['top','right','bottom','left'].some(side=>(numericStyle(layer.style[`border-${side}-width`])??0)>0&&layer.style[`border-${side}-style`]!=='none');};
  const active=layers.filter(painted);
  const box=active.length===1?active[0]:primary;
  if(active.length>1&&active.some(layer=>layer!==primary)) issues.push({code:'paint-layer-stack-unverified',status:'unverified',severity:'error',viewport,sourceId:source.id,targetId:target.targetId,message:'Multiple native wrapper/content layers paint this source box; their overlap requires explicit source layer equivalence.',actual:active});
  if(source.style['background-color']){
    const expected=effectiveColor(source.style['background-color'],sourceOpacity);
    const actual=effectiveColor(box.style['background-color']??'transparent',box.effectiveOpacity);
    if(expected&&actual&&((expected.alpha>0||actual.alpha>0)&&(Math.abs(expected.r-actual.r)>.5||Math.abs(expected.g-actual.g)>.5||Math.abs(expected.b-actual.b)>.5||Math.abs(expected.alpha-actual.alpha)>.005))) issue('paint-background-color','The painted background color differs.',expected,actual);
  }
  if(source.style['background-image']&&box.style['background-image']){
    const removeURLs=(value:string)=>value.replace(/url\(\s*(?:"[^"]*"|'[^']*'|[^)]*)\s*\)/g,'<asset>');
    if(removeURLs(source.style['background-image'])!==removeURLs(box.style['background-image'])) issue('paint-background-image','The background image/gradient layer structure differs.',source.style['background-image'],box.style['background-image']);
  }
  for(const property of ['border-radius','box-shadow'] as const) if(source.style[property]&&box.style[property]&&source.style[property]!==box.style[property]) issue(`paint-${property}`,`The painted ${property} differs.`,source.style[property],box.style[property]);
  for(const side of ['top','right','bottom','left']){
    const property=`border-${side}-width`,expected=numericStyle(source.style[property]),actual=numericStyle(box.style[property]);
    if(expected!==undefined&&actual!==undefined&&Math.abs(expected-actual)>.5) issue(`paint-${property}`,`The ${side} border width differs.`,expected,actual);
    if((expected??0)>0||(actual??0)>0) for(const detail of ['style','color']){const key=`border-${side}-${detail}`;if(source.style[key]&&box.style[key]&&source.style[key]!==box.style[key]) issue(`paint-${key}`,`The painted ${side} border ${detail} differs.`,source.style[key],box.style[key]);}
  }
  if((source.kind==='container'&&!options.containerPaddingEquivalent)||['button','link','input'].includes(source.kind)){
    for(const side of ['top','right','bottom','left']){const key=`padding-${side}`,expected=numericStyle(source.style[key]),actual=numericStyle(box.style[key]);if(expected!==undefined&&actual!==undefined&&Math.abs(expected-actual)>1) issue(`paint-${key}`,`The ${side} padding differs.`,expected,actual);}
  }
  if(source.style['background-image']&&source.style['background-image']!=='none') for(const property of ['background-size','background-position','background-repeat']) if(source.style[property]&&box.style[property]&&source.style[property]!==box.style[property]) issue(`paint-${property}`,`The background ${property} differs.`,source.style[property],box.style[property]);
  if(!sourceText || source.kind==='image'||source.kind==='icon'||source.kind==='container'){
    const expectedURLs=options.expectedMediaURLs?.[source.id]??[];
    const asset=source.image?options.assetMap?.find(item=>resolveEvidenceURL(item.sourceUrl,options.sourceBaseUrl)===resolveEvidenceURL(source.image!.url,options.sourceBaseUrl)):options.assetMap?.find(item=>[item.url,...(item.variants??[])].some(url=>expectedURLs.includes(url)));
    const baked=asset?.bakedOpacity??1;
    const expectedOpacity=baked>0?sourceOpacity/baked:sourceOpacity;
    if(expectedOpacity>1.005) issues.push({code:'baked-opacity-evidence-inconsistent',status:'unverified',severity:'error',viewport,sourceId:source.id,message:'The declared baked opacity exceeds the captured source opacity contract.',expected:{sourceOpacity,bakedOpacity:baked}});
    else if(Math.abs(expectedOpacity-targetOpacity)>.005) issue(baked!==1?'image-opacity-double-baked':'element-opacity',baked!==1?'The frozen asset already contains a source opacity effect; native image opacity applies it a second time or otherwise changes the painted result.':'The measured element and ancestor opacity differs from the source.',{effectiveSourceOpacity:sourceOpacity,bakedOpacity:baked,expectedNativeOpacity:expectedOpacity},targetOpacity);
  }
  if (source.image) {
    const image = target.images[0];
    if (!image) issue('image-missing', 'The mapped source image has no target image element.');
    else {
      if (!image.complete || image.naturalWidth === 0) issue('image-unloaded', 'The target image did not decode successfully.', 'decoded image', image.url);
      const sourceUrl = resolveEvidenceURL(source.image.url, options.sourceBaseUrl);
      const asset = options.assetMap?.find(item => resolveEvidenceURL(item.sourceUrl, options.sourceBaseUrl) === sourceUrl);
      const explicit = options.expectedMediaURLs?.[source.id] ?? options.expectedMediaURLs?.[source.image.url] ?? (sourceUrl ? options.expectedMediaURLs?.[sourceUrl] : undefined);
      const expectedUrls = [...new Set([...(asset ? [asset.url, ...(asset.variants ?? [])] : []), ...(explicit ?? [])].map(url => resolveEvidenceURL(url, options.targetBaseUrl)).filter((url): url is string => !!url))];
      if (!expectedUrls.length) issues.push({ code: 'image-resource-unverified', status: 'unverified', severity: 'error', viewport, sourceId: source.id, targetId: target.targetId, message: 'No imported attachment or explicit resource URL evidence was supplied for this source image.' });
      else if (!expectedUrls.includes(resolveEvidenceURL(image.url, options.targetBaseUrl) ?? '')) issue('image-resource-mismatch', 'The displayed image resource differs from the source-to-attachment mapping. Only explicitly registered thumbnail variants are accepted.', expectedUrls, image.url);
      if (source.image.alt && source.image.alt !== image.alt) issue('image-alt', 'The image alternative text differs.', source.image.alt, image.alt, 'warning');
      if (source.image.objectFit && source.image.objectFit !== image.objectFit) issue('image-fit', 'The image cropping mode differs.', source.image.objectFit, image.objectFit);
      if (source.image.objectPosition && source.image.objectPosition !== image.objectPosition) issue('image-position', 'The image crop position differs.', source.image.objectPosition, image.objectPosition);
      const sourceAspect = source.rect.height > 0 ? source.rect.width / source.rect.height : 0;
      const targetAspect = image.rect.height > 0 ? image.rect.width / image.rect.height : 0;
      if (sourceAspect && Math.abs(sourceAspect - targetAspect) / sourceAspect > 0.08) issue('image-aspect', 'The displayed image aspect ratio differs.', sourceAspect, targetAspect);
    }
  }
  if (!source.image && options.expectedMediaURLs?.[source.id]?.length) {
    const expected=options.expectedMediaURLs[source.id].map(url=>resolveEvidenceURL(url,options.targetBaseUrl)).filter((url):url is string=>!!url);
    const backgroundRequired=/url\(/i.test(source.style['background-image'] ?? '');
    const observed=(target.media ?? target.images.map(image=>({url:image.url,origin:'image' as const}))).filter(item=>!backgroundRequired || ['background','pseudo'].includes(item.origin));
    if (!observed.length) issue('mapped-media-missing',backgroundRequired ? 'The source background asset has no measured target background, pseudo-element or native background layer resource.' : 'The source media asset has no measured target image/SVG resource; an icon or geometric placeholder cannot prove the imported visual.',expected,[]);
    else if (!observed.some(item=>expected.includes(resolveEvidenceURL(item.url,options.targetBaseUrl) ?? ''))) issue('mapped-media-resource-mismatch','The source media asset differs from the actual target resource. Only known attachment URLs and registered variants are accepted.',expected,observed);
  }
  return issues;
}

export function compareEvidence(source: SourceEvidence, targets: TargetViewportEvidence[], expectedSourceIds?: string[], options: ComparisonOptions = {}): {
  issues: VerificationIssue[];
  coverage: Array<{ viewport: string; expected: number; matched: number }>;
} {
  const issues: VerificationIssue[] = [], coverage: Array<{ viewport: string; expected: number; matched: number }> = [];
  if (source.complete === false) issues.push({ code: 'source-incomplete', status: 'unverified', severity: 'error', message: 'Source capture is marked incomplete; a faithful comparison cannot be certified.' });
  if (!targets.length) issues.push({ code: 'no-target-viewports', status: 'unverified', severity: 'error', message: 'No target viewport was captured.' });
  for (const target of targets) {
    const viewportSource = source.viewports.find(viewport => viewport.name === target.name && viewport.width === target.width);
    if (!viewportSource) { issues.push({ code: 'source-viewport-missing', status: 'unverified', severity: 'error', viewport: target.name, message: 'No source capture at the same viewport width is available.' }); continue; }
    const byId = new Map(viewportSource.elements.map(element => [element.id, element]));
    const expectedIds = expectedSourceIds ?? target.elements.map(element => element.sourceId);
    const targetById = new Map(target.elements.map(element => [element.sourceId, element]));
    const equivalentContainerPadding=(container:SourceElementEvidence)=>{
      if(container.kind!=='container') return false;
      const own=targetById.get(container.id);if(!own?.found)return false;
      const sameRect=(a:SourceElementEvidence['rect'],b:SourceElementEvidence['rect'])=>['x','y','width','height'].every(key=>Math.abs(a[key as keyof typeof a]-b[key as keyof typeof b])<=2);
      if(!sameRect(container.rect,own.rect)) return false;
      const children=viewportSource.elements.filter(element=>element.kind!=='container'&&expectedIds.includes(element.id)&&(()=>{let node=element;const seen=new Set<string>();while(node.parentId&&!seen.has(node.id)){seen.add(node.id);if(node.parentId===container.id)return true;const parent=byId.get(node.parentId);if(!parent)return false;node=parent;}return false;})());
      return children.length>0&&children.every(element=>{const mapped=targetById.get(element.id);return mapped?.found&&sameRect(element.rect,mapped.contentRect??mapped.rect);});
    };
    let matched = 0;
    for (const sourceId of expectedIds) {
      const original = byId.get(sourceId);
      // Source IDs can legitimately disappear at a responsive breakpoint.
      if (!original) continue;
      const rendered = targetById.get(sourceId);
      if (!rendered) issues.push({ code: 'unmapped-element', status: 'unverified', severity: 'error', viewport: target.name, sourceId, message: 'An expected source element has no saved target mapping.' });
      else { if (rendered.found) matched++; const paintOpacity=sourcePaintOpacity(original,byId);issues.push(...compareElement(original, rendered, target.name, { ...options, sourceBaseUrl: source.url, targetBaseUrl: target.url,sourceEffectiveOpacity:paintOpacity.value,sourceOpacityProven:paintOpacity.proven,containerPaddingEquivalent:equivalentContainerPadding(original) })); }
    }
    const expectedCount = expectedIds.filter(id => byId.has(id)).length;
    coverage.push({ viewport: target.name, expected: expectedCount, matched });
    if (!expectedCount) issues.push({ code: 'empty-comparison', status: 'unverified', severity: 'error', viewport: target.name, message: 'No source elements were compared at this viewport.' });
    if (!expectedSourceIds) issues.push({ code: 'coverage-unproven', status: 'unverified', severity: 'warning', viewport: target.name, message: 'Only supplied mappings were compared; full-page atom coverage requires an explicit expected source ID list.' });
    for (const interaction of viewportSource.interactions ?? []) {
      const mapped = targetById.get(interaction.sourceNodeId);
      const isNavigationLink = !!interaction.href && interaction.expanded === undefined && interaction.controls === undefined && interaction.role !== 'button';
      if (isNavigationLink) {
        const expected = resolveEvidenceURL(interaction.href!, source.url), actual = mapped?.href ? resolveEvidenceURL(mapped.href, target.url) : undefined;
        if (!expected || !mapped?.found) issues.push({ code: 'interaction-link-unverified', status: 'unverified', severity: 'error', viewport: target.name, sourceId: interaction.sourceNodeId, message: 'A source navigation link has no resolved native target-link evidence.' });
        else if (actual !== expected && !issues.some(issue => issue.viewport === target.name && issue.sourceId === interaction.sourceNodeId && issue.code === 'link-destination')) issues.push({ code: 'link-destination', status: 'mismatch', severity: 'error', viewport: target.name, sourceId: interaction.sourceNodeId, targetId: mapped.targetId, expected, actual, message: 'The target navigation destination differs from the captured source URL, including its fragment.' });
      } else if (interaction.disabled && mapped?.disabled === true) {
        // A source-disabled control has no enabled interaction to reproduce.
      } else {
        const behavior = target.interactions?.find(item => item.sourceNodeId === interaction.sourceNodeId);
        if (behavior?.status === 'verified' && behavior.clicked && behavior.restored) {
          const actualExpanded = behavior.before?.expanded ?? (behavior.before?.detailsOpen !== null && behavior.before?.detailsOpen !== undefined ? String(behavior.before.detailsOpen) : undefined);
          if (interaction.expanded !== undefined && actualExpanded !== interaction.expanded) issues.push({ code:'interaction-initial-state',status:'mismatch',severity:'error',viewport:target.name,sourceId:interaction.sourceNodeId,targetId:mapped?.targetId,expected:interaction.expanded,actual:actualExpanded,message:'The functional native toggle starts in a different expanded state than the source.' });
          if(interaction.controlledContentText!==undefined&&!normalizeText(behavior.controlledContentText??'').includes(normalizeText(interaction.controlledContentText))) issues.push({code:'interaction-controlled-content',status:'mismatch',severity:'error',viewport:target.name,sourceId:interaction.sourceNodeId,targetId:mapped?.targetId,expected:normalizeText(interaction.controlledContentText),actual:normalizeText(behavior.controlledContentText??''),message:'The functional native toggle opens different or missing content than the loaded source answer.'});
        } else {
          issues.push({ code: behavior?.status === 'failed' ? 'interaction-behavior-failed' : 'interaction-unverified', status: behavior?.status === 'failed' ? 'mismatch' : 'unverified', severity: 'error', viewport: target.name, sourceId: interaction.sourceNodeId, targetId: mapped?.targetId, expected: { role: interaction.role, text: interaction.text, expanded: interaction.expanded, controls: interaction.controls }, actual: behavior, message: behavior?.error ?? 'A non-navigation source control requires an actual behavior test. DOM state and visual similarity cannot verify a menu, FAQ, carousel, form or other interactive control.' });
        }
      }
    }
    if (target.responseStatus !== null && target.responseStatus >= 400) issues.push({ code: 'preview-http-error', status: 'mismatch', severity: 'error', viewport: target.name, actual: target.responseStatus, message: 'The preview returned an HTTP error.' });
    if (/wp-login\.php|\/login(?:\/|\?|$)/.test(target.url)) issues.push({ code: 'preview-login-redirect', status: 'unverified', severity: 'error', viewport: target.name, message: 'The browser reached a login screen instead of the draft preview.' });
    for (const failure of target.imageFailures) issues.push({ code: 'page-image-unloaded', status: 'mismatch', severity: 'error', viewport: target.name, actual: failure.url, message: 'A visible frontend image failed to load.' });
    if (target.overflow.length) issues.push({ code: 'horizontal-overflow', status: 'mismatch', severity: 'error', viewport: target.name, actual: target.overflow, message: 'Native elements extend beyond the viewport. Inspect intentional clipping or off-canvas states before acceptance.' });
    if (target.clipping.length) issues.push({ code: 'content-clipping', status: 'unverified', severity: 'warning', viewport: target.name, actual: target.clipping, message: 'Hidden overflow clips content. Confirm that the corresponding source intentionally crops this content.' });
    for (const error of target.pageErrors) issues.push({ code: 'frontend-exception', status: 'mismatch', severity: 'error', viewport: target.name, actual: error, message: 'The frontend raised an uncaught JavaScript error.' });
    for (const error of target.consoleErrors) issues.push({ code: 'browser-console-error', status: 'unverified', severity: 'warning', viewport: target.name, actual: error, message: 'The browser logged an error; inspect whether it affects the cloned content.' });
  }
  for (const sourceViewport of source.viewports) if (!targets.some(target => target.name === sourceViewport.name && target.width === sourceViewport.width)) issues.push({ code: 'target-viewport-missing', status: 'unverified', severity: 'error', viewport: sourceViewport.name, message: 'A source viewport has no matching target verification.' });
  return { issues, coverage };
}

export function repairSummary(issues: VerificationIssue[], limit = 40): string {
  const ranked = [...issues].sort((a, b) => Number(b.severity === 'error') - Number(a.severity === 'error'));
  const lines = ranked.slice(0, limit).map(issue => `${issue.status}/${issue.severity} ${issue.code} ${issue.viewport ?? ''} ${issue.sourceId ?? ''}: ${issue.message}${issue.expected !== undefined ? ` Expected ${JSON.stringify(issue.expected)}; actual ${JSON.stringify(issue.actual)}.` : ''}`);
  if (ranked.length > limit) lines.push(`${ranked.length - limit} additional issues are in verification/report.json.`);
  return lines.join('\n') || 'The measured visual checks passed. Native editor editability is assessed separately.';
}
