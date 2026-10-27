/** Evaluate this function in the connected public tab. It returns a JSON STRING,
 * or an array of <=80000-character JSON string parts with bridgeParts:true.
 * Cua limits individual returned strings to 200000 characters, so connected
 * browser capture MUST use bridgeParts:true and join before parsing on host.
 * Do not return the object through a depth-limited browser bridge.
 * Screenshot metadata is supplied by the host after the actual capture. */
async function collectObservationV2(options = {}) {
  const now = options.capturedAt || new Date().toISOString();
  const snapshotId = options.snapshotId || `snapshot-${now.replace(/[:.]/g, '-')}`;
  const viewportName = options.viewportName || 'desktop';
  if (options.inventoryOnly) return collectSceneInventoryV2({ ...options, regions: options.inventoryRegions || options.regions || [] });
  const idPrefix = options.idPrefix ? `${String(options.idPrefix).replace(/[^a-zA-Z0-9_-]/g, '-')}-` : '';
  const round = value => Math.round(value * 1000) / 1000;
  const bounds = element => { const r = element.getBoundingClientRect(); return { x: round(r.x + scrollX), y: round(r.y + scrollY), width: round(r.width), height: round(r.height) }; };
  const cssNumber = value => Number.isFinite(Number.parseFloat(value)) ? Number.parseFloat(value) : 0;
  const selector = element => { const parts = []; let node = element; while (node && node !== document.documentElement) { const parent = node.parentElement, peers = parent ? [...parent.children].filter(child => child.tagName === node.tagName) : []; parts.unshift(`${node.tagName.toLowerCase()}:nth-of-type(${Math.max(1, peers.indexOf(node) + 1)})`); node = parent; } return parts.length ? `html > ${parts.join(' > ')}` : 'html'; };
  const displayable = (element, style) => style.display !== 'none' && style.visibility !== 'hidden' && style.visibility !== 'collapse' && Number(style.opacity) !== 0 && element.getBoundingClientRect().width > 0 && element.getBoundingClientRect().height > 0;
  const role = element => element.tagName === 'HEADER' || element.getAttribute('role') === 'banner' ? 'header' : element.tagName === 'FOOTER' || element.getAttribute('role') === 'contentinfo' ? 'footer' : 'region';
  const requested = options.regions || (options.rootSelectors || []).map(value => ({ selector: value }));
  let roots = requested.map((spec, index) => { const element = document.querySelector(spec.selector); if (!element) throw new Error(`Missing observation root ${spec.selector}`); return { element, id: spec.id || `r${index + 1}`, role: spec.role || role(element), order: spec.order === undefined ? index : spec.order, previousSelector: spec.previousSelector }; });
  if (!roots.length) {
    const candidates = [...document.querySelectorAll('header, main > *, [role="main"] > *, footer, body > section')].filter(element => element.getBoundingClientRect().height > 40);
    roots = candidates.filter(element => !candidates.some(other => other !== element && other.contains(element))).map((element, index) => ({ element, id: `r${index + 1}`, role: role(element), order: index }));
    if (!roots.length) roots = [{ element: document.body, id: 'r1', role: 'page', order: 0 }];
  }
  for (let i = 0; i < roots.length; i++) for (let j = i + 1; j < roots.length; j++) if (roots[i].element.contains(roots[j].element) || roots[j].element.contains(roots[i].element)) throw new Error('Observation region roots must not overlap');
  const nodes = {}, texts = {}, styles = {}, layouts = {}, resources = {}, usages = {}, interactions = {}, regions = [], gaps = [];
  const nodeIds = new Map(), resourceIds = new Map(); let nodeCounter = 0, textCounter = 0, usageCounter = 0, interactionCounter = 0;
  const addResource = (url, kind, inline) => { const key = inline || url; if (resourceIds.has(key)) return resourceIds.get(key); const id = `${idPrefix}res${resourceIds.size + 1}`; resourceIds.set(key, id); resources[id] = { id, url, kind, ...(inline ? { inline, mime: 'image/svg+xml' } : {}) }; return id; };
  const addUsage = (nodeId, regionId, url, kind, attribute, media, inline) => { if (!url && !inline) return; const resourceId = addResource(url || `inline-svg:${snapshotId}:${nodeId}`, kind === 'img' || kind === 'picture' ? 'image' : kind, inline); const id = `${idPrefix}u${++usageCounter}`; usages[id] = { id, nodeId, regionId, resourceId, kind, ...(attribute ? { attribute } : {}), ...(media ? { media } : {}), visible: nodes[nodeId].visible }; };
  const properties = ['display', 'position', 'width', 'height', 'min-width', 'max-width', 'min-height', 'max-height', 'box-sizing', 'background-color', 'background-image', 'background-position', 'background-size', 'background-repeat', 'color', 'font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing', 'text-align', 'text-decoration', 'white-space', 'border-radius', 'border-width', 'border-color', 'border-style', 'box-shadow', 'opacity', 'overflow', 'object-fit', 'object-position', 'justify-content', 'align-items', 'flex-direction', 'flex-wrap', 'grid-template-columns', 'grid-template-rows', 'row-gap', 'column-gap', 'z-index', 'transform', 'visibility', 'animation-name', 'animation-duration', 'animation-timing-function', 'animation-iteration-count'];
  properties.push('text-shadow','filter','backdrop-filter','-webkit-box-reflect','mix-blend-mode','outline-style','outline-width','border-image-outset');
  properties.push('word-spacing','text-transform','text-indent','word-break','overflow-wrap','hyphens','text-overflow','overflow-x','overflow-y','vertical-align','align-content','flex-grow','flex-shrink','flex-basis','aspect-ratio','background-clip','background-origin','transition-property','transition-duration','transition-timing-function','outline-color','outline-offset');
  properties.push('top','right','bottom','left','order','align-self','justify-self','grid-auto-flow');
  properties.push(...['top', 'right', 'bottom', 'left'].flatMap(side => [`border-${side}-width`, `border-${side}-style`, `border-${side}-color`]));
  const captureStyleCache = new Map(), captureAnimatedCache = new Map();
  let textLineCharactersRemaining = Math.max(0, Math.min(262144, Number.isInteger(options.maxTextLineCharactersTotal) ? options.maxTextLineCharactersTotal : 65536));
  let previousBottom = 0;
  for (const [order, root] of roots.entries()) {
    const elements = [root.element, ...root.element.querySelectorAll('*')].filter(element => !['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'META', 'LINK'].includes(element.tagName) && !element.closest('svg *'));
    if (elements.length > (options.maxNodesPerRegion || 20000)) throw new Error(`Observation region ${root.id} exceeds explicit node limit`);
    for (const element of elements) nodeIds.set(element, `${idPrefix}n${++nodeCounter}`);
    for (const [flowIndex, element] of elements.entries()) {
      const id = nodeIds.get(element), computed = getComputedStyle(element), rect = bounds(element), padding = ['Top', 'Right', 'Bottom', 'Left'].map(side => cssNumber(computed[`padding${side}`])), margin = ['Top', 'Right', 'Bottom', 'Left'].map(side => cssNumber(computed[`margin${side}`]));
      const parentId = element === root.element ? null : nodeIds.get(element.parentElement) || null;
      const attributes = {}; for (const name of ['id', 'class', 'role', 'aria-label', 'aria-hidden', 'aria-controls', 'aria-expanded', 'aria-current', 'aria-selected', 'aria-disabled', 'aria-haspopup', 'aria-multiselectable', 'open', 'disabled', 'readonly', 'alt', 'title', 'type', 'name', 'placeholder', 'required', 'min', 'max', 'step', 'maxlength', 'multiple', 'href', 'data-content-asset-id', 'data-widget_type', 'data-slick-index', 'data-swiper-slide-index', 'data-target', 'data-bs-target', 'data-slide', 'data-bs-slide', 'data-slide-to', 'data-bs-slide-to', 'data-ride', 'data-bs-ride', 'data-interval', 'data-bs-interval', 'data-pid', 'data-product-id', 'data-product_id', 'data-sku', 'itemtype', 'itemprop', 'itemscope']) if (element.hasAttribute(name)) attributes[name] = element.getAttribute(name);
      if (element.tagName.toLowerCase() === 'option' && element.hasAttribute('value')) attributes.value = element.getAttribute('value');
      if (attributes.href) try { attributes.href = new URL(attributes.href, location.href).href; } catch {}
      if (element.matches('video,audio')) { if (element.currentSrc || element.src) attributes.src = element.currentSrc || element.src; if (element.poster) attributes.poster = element.poster; }
      // Forms expose only their public destination; never names, values or tokens.
      if (element.tagName === 'FORM' && element.hasAttribute('action')) try { const action = new URL(element.getAttribute('action'), location.href); attributes.action = action.origin + action.pathname; } catch {}
      nodes[id] = { id, parentId, regionId: root.id, tag: element.tagName.toLowerCase(), selector: selector(element), attributes, childIds: [...element.children].map(child => nodeIds.get(child)).filter(Boolean), styleId: `s${id}`, layoutId: `l${id}`, visible: displayable(element, computed) };
      styles[`s${id}`] = Object.fromEntries(properties.map(property => [property, computed.getPropertyValue(property)]));
      for (const pseudo of ['before', 'after']) {
        const pseudoStyle = getComputedStyle(element, `::${pseudo}`);
        styles[`s${id}`][`${pseudo}:content`] = pseudoStyle.content;
        for (const property of ['display','position','visibility','transform','width','height','margin-top','margin-right','margin-bottom','margin-left','padding-top','padding-right','padding-bottom','padding-left','border-width','border-style','background-color','background-image','box-shadow','text-shadow','filter','backdrop-filter','-webkit-box-reflect','mix-blend-mode','outline-style','outline-width','border-image-outset','overflow','font-size','line-height','color']) styles[`s${id}`][`${pseudo}:${property}`] = pseudoStyle.getPropertyValue(property);
        if (pseudoStyle.content && !['none', 'normal', '""', "''"].includes(pseudoStyle.content)) {
          for (const property of ['content', 'font-family', 'font-size', 'color', 'display', 'width', 'height', 'background-image']) styles[`s${id}`][`${pseudo}:${property}`] = pseudoStyle.getPropertyValue(property);
          if (/icon|awesome|glyph|symbol/i.test(pseudoStyle.fontFamily)) gaps.push({ code: 'font-icon-asset-unresolved', message: `Observed ::${pseudo} icon glyph ${pseudoStyle.content} in ${pseudoStyle.fontFamily}; actual font asset and rendering need explicit verification`, nodeId: id });
        }
        for (const match of pseudoStyle.backgroundImage.matchAll(/url\(["']?([^"')]+)["']?\)/g)) addUsage(id, root.id, new URL(match[1], location.href).href, 'icon', `${pseudo}:background-image`);
      }
      const border = ['Top', 'Right', 'Bottom', 'Left'].map(side => cssNumber(computed[`border${side}Width`]));
      layouts[`l${id}`] = { id: `l${id}`, rect, contentRect: { x: round(rect.x + padding[3] + border[3]), y: round(rect.y + padding[0] + border[0]), width: round(Math.max(0, rect.width - padding[1] - padding[3] - border[1] - border[3])), height: round(Math.max(0, rect.height - padding[0] - padding[2] - border[0] - border[2])) }, padding, margin, gap: { row: cssNumber(computed.rowGap), column: cssNumber(computed.columnGap) }, display: computed.display, position: computed.position, maxWidth: computed.maxWidth, direction: computed.flexDirection || computed.direction, flowIndex };
      const captureGeometry = captureAnimationLayoutV2(element, captureStyleCache, captureAnimatedCache);
      if (captureGeometry) layouts[`l${id}`].captureGeometry = captureGeometry;
      const textNodes = [...element.childNodes].filter(child => child.nodeType === 3 && child.textContent.trim());
      const text = textNodes.map(child => child.textContent).join(' ').replace(/\s+/g, ' ').trim();
      if (text) {
        const lineTops = new Set();
        for (const child of textNodes) {
          const range = document.createRange(); range.selectNodeContents(child);
          for (const line of range.getClientRects()) if (line.width > 0 && line.height > 0) lineTops.add(Math.round(line.top * 2) / 2);
        }
        const textId = `${idPrefix}t${++textCounter}`, heading = /^h([1-6])$/.exec(element.tagName.toLowerCase());
        const textLayout = collectTextLinesV2(element, textNodes, Math.min(options.maxTextLineCharacters ?? 4096, textLineCharactersRemaining));
        textLineCharactersRemaining = Math.max(0, textLineCharactersRemaining - textNodes.reduce((total, child) => total + child.textContent.length, 0));
        texts[textId] = { id: textId, nodeId: id, regionId: root.id, text, kind: heading ? 'heading' : element.matches('button,a,[role="button"]') ? 'control' : element.tagName === 'LABEL' ? 'label' : 'body', lineCount: lineTops.size, textLayout, ...(heading ? { level: Number(heading[1]) } : {}) };
      }
      if (element.tagName.toLowerCase() === 'img') {
        addUsage(id, root.id, element.currentSrc || element.src, element.closest('picture') ? 'picture' : 'img', 'src');
        const picture = element.closest('picture'); if (picture) for (const source of picture.querySelectorAll('source')) { const srcset = source.getAttribute('srcset') || ''; for (const candidate of srcset.split(',')) { const url = candidate.trim().split(/\s+/)[0]; if (url) addUsage(id, root.id, new URL(url, location.href).href, 'picture', 'srcset', source.media || 'all'); } }
      }
      for (const match of computed.backgroundImage.matchAll(/url\(["']?([^"')]+)["']?\)/g)) addUsage(id, root.id, new URL(match[1], location.href).href, 'background', 'background-image');
      if (element.tagName.toLowerCase() === 'svg') {
        addUsage(id, root.id, '', 'svg', 'outerHTML', undefined, element.outerHTML);
        for (const use of element.querySelectorAll('use')) { const href = use.getAttribute('href') || use.getAttribute('xlink:href'); if (href && !href.startsWith('#')) addUsage(id, root.id, new URL(href, location.href).href, 'icon', 'svg-use-href'); }
      }
      if (element.tagName === 'A' && attributes.href) { const interactionId = `${idPrefix}i${++interactionCounter}`; interactions[interactionId] = { id: interactionId, nodeId: id, regionId: root.id, kind: 'link', status: 'observed', href: attributes.href, details: { text: element.textContent.replace(/\s+/g, ' ').trim(), target: element.getAttribute('target') || '' } }; }
      const nativeControl = element.matches('button,input,[role="button"],select,textarea,[role="combobox"],[role="listbox"],[role="checkbox"],[role="radio"],[role="switch"],[role="slider"],[role="menuitem"]');
      const tabControl = element.matches('[role="tab"],[data-slide-to],[data-bs-slide-to],[data-toggle="tab"],[data-bs-toggle="tab"]');
      const disclosureControl = element.matches('summary,[data-toggle="collapse"],[data-bs-toggle="collapse"]');
      const counterControl = element.matches('.counter,.countup,[data-count],[data-counter]');
      if (nativeControl || tabControl || disclosureControl || counterControl) { const interactionId = `${idPrefix}i${++interactionCounter}`; interactions[interactionId] = { id: interactionId, nodeId: id, regionId: root.id, kind: 'control', status: nativeControl ? 'unobserved' : 'declared', details: { type: counterControl ? 'counter' : tabControl ? 'tab' : disclosureControl ? 'disclosure' : element.getAttribute('type') || element.getAttribute('role') || element.tagName.toLowerCase(), label: (element.getAttribute('aria-label') || element.textContent.replace(/\s+/g, ' ').trim()).slice(0, 500) } }; }
    }
    const rect = bounds(root.element), content = [...root.element.children].filter(child => displayable(child, getComputedStyle(child))).sort((left, right) => bounds(right).width - bounds(left).width)[0] || root.element;
    const previousElement = root.previousSelector ? document.querySelector(root.previousSelector) : null;
    const measuredPreviousBottom = previousElement ? bounds(previousElement).y + bounds(previousElement).height : previousBottom;
    regions.push({ id: root.id, nodeId: nodeIds.get(root.element), role: root.role, order: root.order, contentNodeId: nodeIds.get(content) || nodeIds.get(root.element), gapBefore: round(rect.y - measuredPreviousBottom) }); previousBottom = rect.y + rect.height;
  }
  for (const root of roots) for (const element of [root.element, ...root.element.querySelectorAll('*')]) {
    if (!nodeIds.has(element)) continue;
    const trackSelector = '.swiper-wrapper,.slick-track,.owl-stage,.carousel-inner,[data-carousel-track]';
    const track = element.matches(trackSelector) ? element : null;
    if (track) {
      const nativeOwner = track.closest('.swiper,.swiper-container,.slick-slider,.owl-carousel,.carousel,[data-carousel]') || track.parentElement;
      let owner = nativeOwner;
      // Controls can be siblings of the slider and can live in its header.
      // Widen within the observed region only while exactly this one track is owned.
      while (owner && owner !== root.element && owner.parentElement && root.element.contains(owner.parentElement)) {
        const candidate = owner.parentElement, tracks = [...candidate.querySelectorAll(trackSelector)].filter(item => nodeIds.has(item));
        if (tracks.length !== 1 || tracks[0] !== track) break;
        owner = candidate;
      }
      const items = [...track.children].filter(child => nodeIds.has(child));
      const controlSelector = '.slick-arrow,.slick-dots,.slick-dots button,.swiper-button-next,.swiper-button-prev,.swiper-pagination,.owl-prev,.owl-next,.owl-dot,.owl-dots,.carousel-control,.carousel-control-prev,.carousel-control-next,[data-carousel-next],[data-carousel-prev],[data-slide],[data-bs-slide],[data-slide-to],[data-bs-slide-to],[aria-controls],[aria-label]';
      const controls = owner ? [...root.element.querySelectorAll(controlSelector)].filter(child => {
        if (!nodeIds.has(child) || track.contains(child)) return false;
        const declaredTargets = [child.getAttribute('data-target'), child.getAttribute('data-bs-target'), ...(child.getAttribute('aria-controls') || '').split(/\s+/).map(value => value ? `#${value}` : '')];
        const href = child.getAttribute('href'); if (href && href.includes('#')) try { const destination = new URL(href, location.href); if (destination.origin === location.origin && destination.pathname === location.pathname && destination.search === location.search) declaredTargets.push(destination.hash); } catch {}
        const targetSelectors = declaredTargets.filter(Boolean);
        if (targetSelectors.length) return targetSelectors.some(value => { try { const targets = document.querySelectorAll(value); return targets.length === 1 && (targets[0] === track || targets[0].contains(track)); } catch { return false; } });
        if (!owner.contains(child)) return false;
        const nearestOwner = child.closest('.swiper,.swiper-container,.slick-slider,.owl-carousel,.carousel,[data-carousel]');
        if (nearestOwner && nearestOwner !== nativeOwner && !nearestOwner.contains(track)) return false;
        return child.matches('.slick-arrow,.slick-dots,.slick-dots button,.swiper-button-next,.swiper-button-prev,.swiper-pagination,.owl-prev,.owl-next,.owl-dot,.owl-dots,.carousel-control,.carousel-control-prev,.carousel-control-next,[data-carousel-next],[data-carousel-prev]') || /next|prev|autoplay|pause|play/i.test(child.getAttribute('aria-label') || '');
      }) : [];
      const currentState = collectCarouselDOMStateV2(track, nativeOwner);
      const interactionId = `${idPrefix}i${++interactionCounter}`;
      interactions[interactionId] = { id: interactionId, nodeId: nodeIds.get(owner) || nodeIds.get(track), regionId: root.id, kind: 'carousel', status: 'declared', trackNodeId: nodeIds.get(track), itemNodeIds: items.filter(child => !child.matches('.slick-cloned,.swiper-slide-duplicate,.owl-item.cloned')).map(child => nodeIds.get(child)), cloneNodeIds: items.filter(child => child.matches('.slick-cloned,.swiper-slide-duplicate,.owl-item.cloned')).map(child => nodeIds.get(child)), controlNodeIds: controls.map(child => nodeIds.get(child)), details: { ownership: 'Unique track within observed common ancestor; explicitly targeted controls remain bound to their track', behaviorVerified: false, engine: currentState.engine, logicalCount: currentState.logicalCount, logicalIndexStatus: currentState.status, currentLogicalIndex: currentState.logicalIndex, motionStatus: currentState.motionStatus, stateReason: currentState.reason } };
    }
  }
  // A static screenshot cannot establish a hover state. Discover CSS-owned
  // hover triggers as declared interactions so downstream requirements must
  // request a real default/hover/restored observation instead of silently
  // treating the ordinary link as navigation-only.
  const hoverOwners = new Map(); let unreadableHoverSheets = 0;
  const selectorGroups = value => { const result = []; let start = 0, depth = 0; for (let i = 0; i < value.length; i++) { if (value[i] === '(' || value[i] === '[') depth++; else if (value[i] === ')' || value[i] === ']') depth--; else if (value[i] === ',' && depth === 0) { result.push(value.slice(start, i).trim()); start = i + 1; } } result.push(value.slice(start).trim()); return result; };
  const inspectHoverRules = rules => {
    for (const rule of rules) {
      if (rule.cssRules) { if (rule.conditionText && rule.constructor?.name === 'CSSMediaRule' && !matchMedia(rule.conditionText).matches) continue; inspectHoverRules(rule.cssRules); }
      if (!rule.selectorText || !rule.selectorText.includes(':hover')) continue;
      for (const group of selectorGroups(rule.selectorText)) {
        const index = group.indexOf(':hover'); if (index < 0) continue;
        const ownerSelector = group.slice(0, index).trim(); if (!ownerSelector || /[>+~,(]$/.test(ownerSelector)) continue;
        let matches; try { matches = document.querySelectorAll(ownerSelector); } catch { continue; }
        for (const element of matches) {
          const nodeId = nodeIds.get(element); if (!nodeId || !nodes[nodeId].visible) continue;
          const owned = hoverOwners.get(nodeId) || { element, rules: new Set() }; owned.rules.add(group.slice(0, 800)); hoverOwners.set(nodeId, owned);
        }
      }
    }
  };
  for (const sheet of document.styleSheets) try { inspectHoverRules(sheet.cssRules); } catch { unreadableHoverSheets++; }
  if (unreadableHoverSheets) gaps.push({ code: 'hover-stylesheet-unreadable', message: `${unreadableHoverSheets} stylesheet(s) could not be inspected for hover selectors; live interaction review remains required` });
  if (hoverOwners.size > 1500) throw new Error('Observed hover trigger inventory exceeds explicit node limit');
  for (const [nodeId, owner] of hoverOwners) {
    const interactionId = `${idPrefix}i${++interactionCounter}`;
    interactions[interactionId] = { id: interactionId, nodeId, regionId: nodes[nodeId].regionId, kind: 'hover', status: 'declared', details: { source: 'css-hover-selector', selector: [...owner.rules].join(' | ').slice(0, 2000), behaviorVerified: false } };
  }
  // Retain typed Product URL relationships, not arbitrary JSON-LD or its copy.
  const productUrls = new Set(), addProductUrl = value => { if (typeof value !== 'string') return; try { const url = new URL(value, location.href); if (/^https?:$/.test(url.protocol)) { url.hash = ''; productUrls.add(url.href); } } catch {} };
  const scanStructured = value => { if (!value || typeof value !== 'object') return; if (Array.isArray(value)) { value.forEach(scanStructured); return; } const types = [].concat(value['@type'] || []); if (types.some(type => typeof type === 'string' && /(?:^|[/#])Product$/.test(type))) { addProductUrl(value.url); addProductUrl(value['@id']); for (const offer of [].concat(value.offers || [])) if (offer && typeof offer === 'object') addProductUrl(offer.url); } Object.values(value).filter(child => child && typeof child === 'object').forEach(scanStructured); };
  for (const script of document.querySelectorAll('script[type="application/ld+json"]')) try { scanStructured(JSON.parse(script.textContent)); } catch {}
  const commerceEvidence = { version: 1, productUrls: [...productUrls].sort() };
  const viewport = { name: viewportName, width: innerWidth, height: innerHeight, clientWidth: document.documentElement.clientWidth, scrollbarWidth: innerWidth - document.documentElement.clientWidth, devicePixelRatio };
  const packet = { version: 2, kind: 'observation-packet', presentationVersion: 1, snapshot: { id: snapshotId, url: location.href, title: document.title, capturedAt: now, viewport, pageHeight: Math.max(document.body.scrollHeight, document.documentElement.scrollHeight), screenshot: options.screenshot || { path: `${viewportName}.png`, sha256: '0'.repeat(64), width: innerWidth, height: Math.max(document.body.scrollHeight, document.documentElement.scrollHeight) } }, nodes, regions, texts, styles, layouts, resources, usages, interactions, gaps, commerceEvidence };
  const chunks = [];
  for (const region of regions) {
    const regionNodes = Object.fromEntries(Object.entries(nodes).filter(([, node]) => node.regionId === region.id));
    const filter = table => Object.fromEntries(Object.entries(table).filter(([, entity]) => entity.regionId === region.id));
    const regionUsages = filter(usages), resourceSet = new Set(Object.values(regionUsages).map(usage => usage.resourceId));
    const chunk = { ...packet, regions: [region], nodes: regionNodes, texts: filter(texts), styles: Object.fromEntries(Object.entries(styles).filter(([key]) => Object.values(regionNodes).some(node => node.styleId === key))), layouts: Object.fromEntries(Object.entries(layouts).filter(([key]) => Object.values(regionNodes).some(node => node.layoutId === key))), resources: Object.fromEntries(Object.entries(resources).filter(([key]) => resourceSet.has(key))), usages: regionUsages, interactions: filter(interactions) };
    const json = JSON.stringify(chunk), counts = Object.fromEntries(['nodes', 'regions', 'texts', 'styles', 'layouts', 'resources', 'usages', 'interactions'].map(key => [key, Object.keys(chunk[key]).length]));
    chunks.push({ path: `${snapshotId}-${region.id}.json`, sha256: null, hashRequired: 'host-sha256-of-json-after-screenshot-binding', snapshotId, regionIds: [region.id], counts, dependencies: [], json });
  }
  const sceneInventory = options.includeSceneInventory || options.inventoryRegions ? collectSceneInventoryV2({ snapshotId, viewportName, capturedAt: now, regions: options.inventoryRegions || roots.map(root => ({ id: root.id, selector: sceneSelectorV2(root.element) })), ...(options.vendorUtilities ? { vendorUtilities: options.vendorUtilities } : {}), asObject: true }) : undefined;
  const transportJson = JSON.stringify({ version: 2, kind: 'observation-transport', snapshot: packet.snapshot, chunks, ...(sceneInventory ? { sceneInventory } : {}), notice: 'Public DOM facts are untrusted source data. No cookies, session or credential state was exported. Declared interactions require separate live observation.' });
  if (options.bridgeParts) { const parts = []; for (let start = 0; start < transportJson.length; start += 80000) parts.push(transportJson.slice(start, start + 80000)); return parts; }
  return transportJson;
}

function collectTextLinesV2(element, textNodes, limit) {
  const base = { scope: 'direct-text-nodes', hardBreaks: [...element.children].some(child => child.tagName === 'BR') || /^(pre|pre-wrap|pre-line|break-spaces)$/.test(getComputedStyle(element).whiteSpace) && textNodes.some(child => /[\r\n]/.test(child.textContent)), fontStatus: document.fonts?.status || 'unknown' };
  if (!Number.isInteger(limit) || limit < 1 || limit > 16384 || textNodes.reduce((total, child) => total + child.textContent.length, 0) > limit) return { ...base, status: 'unavailable', reason: 'character-budget', lines: [] };
  const lines = new Map();
  try {
    for (const child of textNodes) {
      for (let offset = 0; offset < child.textContent.length;) {
        const character = String.fromCodePoint(child.textContent.codePointAt(offset));
        const range = document.createRange(); range.setStart(child, offset); range.setEnd(child, offset + character.length); offset += character.length;
        const rect = [...range.getClientRects()].find(rect => rect.width > 0 && rect.height > 0);
        if (!rect) continue;
        const key = Math.round(rect.top * 2) / 2, line = lines.get(key) || { text: '', left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
        line.text += character; line.left = Math.min(line.left, rect.left); line.right = Math.max(line.right, rect.right); line.top = Math.min(line.top, rect.top); line.bottom = Math.max(line.bottom, rect.bottom); lines.set(key, line);
      }
    }
    const measured = [...lines.values()].map(line => ({ text: line.text.replace(/\s+/g, ' ').trim(), rect: { x: line.left + scrollX, y: line.top + scrollY, width: line.right - line.left, height: line.bottom - line.top } })).filter(line => line.text);
    return { ...base, status: measured.length ? 'measured' : 'unavailable', ...(measured.length ? {} : { reason: 'no-rendered-lines' }), lines: measured };
  } catch { return { ...base, status: 'unavailable', reason: 'range-api-unavailable', lines: [] }; }
}

/** Layout identity is independent of an animated transform's paint bounds.
 * Keep the original getBoundingClientRect above as the visible source fact.
 * offsetLeft/Top and computed box dimensions still change if the animation
 * changes real layout, so such drift remains a capture failure. */
function captureAnimationLayoutV2(element, styleCache = new Map(), animatedCache = new Map()) {
  const style = node => { if (!styleCache.has(node)) styleCache.set(node, getComputedStyle(node)); return styleCache.get(node); };
  const animated = node => {
    if (!node) return false;
    if (animatedCache.has(node)) return animatedCache.get(node);
    const css = style(node), own = css.animationName && css.animationName !== 'none' && css.animationDuration.split(',').some(value => Number.parseFloat(value) > 0);
    const result = Boolean(own || animated(node.parentElement)); animatedCache.set(node, result); return result;
  };
  if (!animated(element)) return undefined;
  const round = value => Math.round(value * 1000) / 1000;
  const number = value => Number.parseFloat(value) || 0;
  const box = node => {
    const css = style(node), parent = node.offsetParent;
    let x, y;
    if (!Number.isFinite(node.offsetLeft) || !Number.isFinite(node.offsetTop)) {
      // SVG descendants have no offsetLeft/Top. Their painted displacement
      // relative to the parent cancels an animated ancestor's transform.
      const ancestor = node.parentElement;
      const painted = node.getBoundingClientRect();
      if (!ancestor) { x = painted.x + scrollX; y = painted.y + scrollY; }
      else {
        const parentPainted = ancestor.getBoundingClientRect();
        const stableParent = animated(ancestor) ? box(ancestor) : {x: parentPainted.x + scrollX, y: parentPainted.y + scrollY};
        x = stableParent.x + painted.x - parentPainted.x;
        y = stableParent.y + painted.y - parentPainted.y;
      }
    } else if (parent) {
      const bounds = animated(parent) ? box(parent) : parent.getBoundingClientRect();
      x = bounds.x + (animated(parent) ? 0 : scrollX) + parent.clientLeft + node.offsetLeft - parent.scrollLeft;
      y = bounds.y + (animated(parent) ? 0 : scrollY) + parent.clientTop + node.offsetTop - parent.scrollTop;
    } else { x = node.offsetLeft; y = node.offsetTop; }
    const extraX = css.boxSizing === 'border-box' ? 0 : number(css.paddingLeft) + number(css.paddingRight) + number(css.borderLeftWidth) + number(css.borderRightWidth);
    const extraY = css.boxSizing === 'border-box' ? 0 : number(css.paddingTop) + number(css.paddingBottom) + number(css.borderTopWidth) + number(css.borderBottomWidth);
    return {x: round(x), y: round(y), width: round(number(css.width) + extraX), height: round(number(css.height) + extraY)};
  };
  const rect = box(element), css = style(element), padding = ['Top', 'Right', 'Bottom', 'Left'].map(side => number(css['padding' + side]));
  return {method: 'css-animation-offset-layout', rect, contentRect: {x: round(rect.x + padding[3]), y: round(rect.y + padding[0]), width: round(Math.max(0, rect.width - padding[1] - padding[3])), height: round(Math.max(0, rect.height - padding[0] - padding[2]))}};
}

function sceneSelectorV2(element) {
  const parts = []; let node = element;
  while (node && node !== document.documentElement) { const parent = node.parentElement, peers = parent ? [...parent.children].filter(child => child.tagName === node.tagName) : []; parts.unshift(`${node.tagName.toLowerCase()}:nth-of-type(${Math.max(1, peers.indexOf(node) + 1)})`); node = parent; }
  return parts.length ? `html > ${parts.join(' > ')}` : 'html';
}

function collectCarouselDOMStateV2(track, owner) {
  const trackSelectors = '.swiper-wrapper,.slick-track,.owl-stage,.carousel-inner,[data-carousel-track]';
  const ownerSelectors = '.swiper,.swiper-container,.slick-slider,.owl-carousel,.carousel,[data-carousel]';
  const engine = track?.matches('.owl-stage') ? 'owl' : track?.matches('.carousel-inner') ? 'bootstrap' : track?.matches('.slick-track') ? 'slick' : track?.matches('.swiper-wrapper') ? 'swiper' : 'unknown';
  owner = owner || track?.closest(ownerSelectors) || track?.parentElement;
  const result = { engine, status: 'unknown', logicalIndex: null, logicalCount: 0, reason: 'carousel-track-unresolved', ownerSelector: owner ? sceneSelectorV2(owner) : null, trackSelector: track ? sceneSelectorV2(track) : null, motionStatus: 'unknown', autoplayStatus: 'unknown', identityNormalizations: [], items: [] };
  if (!track || !owner || !owner.contains(track) || !track.matches(trackSelectors)) return result;
  const cloneSelector = '.slick-cloned,.swiper-slide-duplicate,.owl-item.cloned';
  const items = [...track.children].filter(item => engine !== 'owl' || item.matches('.owl-item')).filter(item => engine !== 'bootstrap' || item.matches('.item,.carousel-item'));
  const originals = items.filter(item => !item.matches(cloneSelector));
  result.logicalCount = originals.length;
  if (!items.length || !originals.length) { result.reason = 'carousel-items-unresolved'; return result; }
  const mediaElements = item => [item, ...item.querySelectorAll('img,source')].filter(element => element.matches('img,source'));
  const normalizeMediaValue = (attribute, value) => { if (!value) return ''; if (attribute === 'src') try { return new URL(value, location.href).href; } catch {} return value.trim().replace(/\s+/g, ' '); };
  const placeholderValues = new Map();
  for (const [attribute, deferredAttribute] of [['src', 'data-src'], ['srcset', 'data-srcset']]) {
    const values = element => ({ current: normalizeMediaValue(attribute, element.getAttribute(attribute)), deferred: normalizeMediaValue(attribute, element.getAttribute(deferredAttribute)) });
    const originalValues = originals.flatMap(mediaElements).map(values);
    const actualOriginalValues = new Set(originalValues.filter(value => !value.deferred || value.current === value.deferred).map(value => value.current).filter(Boolean));
    const declaredOriginalValues = new Set(originalValues.map(value => value.deferred || value.current).filter(Boolean));
    const actualValues = new Set(items.flatMap(mediaElements).map(values).filter(value => !value.deferred || value.current === value.deferred).map(value => value.current).filter(Boolean));
    const deferredByCurrent = new Map();
    for (const element of items.flatMap(mediaElements)) {
      const current = normalizeMediaValue(attribute, element.getAttribute(attribute)), deferred = normalizeMediaValue(attribute, element.getAttribute(deferredAttribute));
      if (!current || !deferred || current === deferred) continue;
      if (!deferredByCurrent.has(current)) deferredByCurrent.set(current, new Set());
      deferredByCurrent.get(current).add(deferred);
    }
    const proven = new Set();
    for (const [current, targets] of deferredByCurrent) if (targets.size >= 2 && !actualOriginalValues.has(current) && [...targets].every(target => declaredOriginalValues.has(target)) && [...declaredOriginalValues].every(target => target !== current && actualValues.has(target))) {
      proven.add(current); result.identityNormalizations.push({ attribute, placeholder: current, targets: [...targets].sort(), proof: 'shared-deferred-placeholder-with-distinct-observed-original-sources' });
    }
    placeholderValues.set(attribute, proven);
  }
  const signature = item => JSON.stringify([item, ...item.querySelectorAll('*')].filter(element => !element.matches('script,style,noscript,input,textarea,select,option')).map(element => {
    const normalized = new Map();
    if (element.matches('img,source')) for (const [attribute, deferredAttribute] of [['src', 'data-src'], ['srcset', 'data-srcset']]) {
      const current = normalizeMediaValue(attribute, element.getAttribute(attribute)), deferred = normalizeMediaValue(attribute, element.getAttribute(deferredAttribute));
      if (deferred && (!current || current === deferred || placeholderValues.get(attribute).has(current))) { normalized.set(attribute, deferred); normalized.set(deferredAttribute, null); }
      else if (current) normalized.set(attribute, current);
    }
    const attributes = ['href', 'src', 'srcset', 'data-src', 'data-srcset', 'alt', 'title', 'data-product-id', 'data-product_id', 'data-pid', 'data-sku'].filter(name => normalized.has(name) ? normalized.get(name) !== null : element.hasAttribute(name)).map(name => [name, normalized.has(name) ? normalized.get(name) : element.getAttribute(name)]);
    const text = [...element.childNodes].filter(child => child.nodeType === 3).map(child => child.textContent).join(' ').replace(/\s+/g, ' ').trim();
    return text || attributes.length ? [element.tagName.toLowerCase(), text, attributes] : null;
  }).filter(Boolean));
  const originalSignatures = originals.map(signature), firstOriginal = items.indexOf(originals[0]);
  const contiguousOriginals = originals.every((item, index) => items[firstOriginal + index] === item);
  const logical = new Map(originals.map((item, index) => [item, index]));
  let cloneMappingVerified = !items.flatMap(mediaElements).some(element => [['src', 'data-src'], ['srcset', 'data-srcset']].some(([attribute, deferredAttribute]) => {
    const current = normalizeMediaValue(attribute, element.getAttribute(attribute)), deferred = normalizeMediaValue(attribute, element.getAttribute(deferredAttribute));
    return current && deferred && current !== deferred && !placeholderValues.get(attribute).has(current);
  }));
  for (const [index, item] of items.entries()) {
    if (!item.matches(cloneSelector)) continue;
    const declaredIndex = item.getAttribute(engine === 'slick' ? 'data-slick-index' : 'data-swiper-slide-index');
    const relativeIndex = ((index - firstOriginal) % originals.length + originals.length) % originals.length;
    const candidate = engine === 'owl' ? contiguousOriginals ? relativeIndex : null : declaredIndex !== null && /^-?\d+$/.test(declaredIndex) ? ((Number(declaredIndex) % originals.length) + originals.length) % originals.length : null;
    if (candidate !== null && originalSignatures[candidate] !== '[]' && signature(item) === originalSignatures[candidate]) logical.set(item, candidate);
    else cloneMappingVerified = false;
  }
  const activeSelector = engine === 'owl' ? '.active' : engine === 'bootstrap' ? '.active' : engine === 'slick' ? '.slick-current' : engine === 'swiper' ? '.swiper-slide-active' : '[aria-current="true"]';
  const activeItems = items.filter(item => item.matches(activeSelector));
  const visible = element => {
    const rect = element.getBoundingClientRect(); let left = rect.left, right = rect.right, top = rect.top, bottom = rect.bottom;
    if (!(rect.width > 0 && rect.height > 0)) return false;
    for (let current = element; current; current = current.parentElement) {
      const css = getComputedStyle(current); if (css.display === 'none' || /^(hidden|collapse)$/.test(css.visibility) || Number(css.opacity) === 0) return false;
      if (current !== element) { const clip = current.getBoundingClientRect(); if (/^(hidden|clip|auto|scroll)$/.test(css.overflowX)) { left = Math.max(left, clip.left); right = Math.min(right, clip.right); } if (/^(hidden|clip|auto|scroll)$/.test(css.overflowY)) { top = Math.max(top, clip.top); bottom = Math.min(bottom, clip.bottom); } }
    }
    return right - left > .5 && bottom - top > .5;
  };
  result.items = items.map(item => { const rect = item.getBoundingClientRect(); return { selector: sceneSelectorV2(item), originalSelector: logical.has(item) ? sceneSelectorV2(originals[logical.get(item)]) : null, logicalIndex: logical.get(item) ?? null, clone: item.matches(cloneSelector), active: activeItems.includes(item), visible: visible(item), rect: { x: rect.x + scrollX, y: rect.y + scrollY, width: rect.width, height: rect.height } }; });
  const transitionClasses = engine === 'bootstrap' && items.some(item => item.matches('.next,.prev,.left,.right,.carousel-item-next,.carousel-item-prev,.carousel-item-start,.carousel-item-end'));
  if (transitionClasses || owner.matches('.owl-dragging') || track.matches('.owl-grab')) result.motionStatus = 'moving';
  else try {
    const animations = typeof track.getAnimations === 'function' ? track.getAnimations({ subtree: true }) : typeof document.getAnimations === 'function' ? document.getAnimations().filter(animation => { const target = animation.effect?.target; return target && (target === track || track.contains(target)); }) : null;
    if (animations) result.motionStatus = animations.some(animation => animation.pending === true || animation.playState === 'running') ? 'moving' : 'settled';
  } catch {}
  if (!activeItems.length) { result.reason = 'carousel-active-item-unresolved'; return result; }
  if (engine !== 'owl' && activeItems.length !== 1) { result.reason = 'carousel-active-item-ambiguous'; return result; }
  if (engine === 'owl' && (!contiguousOriginals || !cloneMappingVerified)) { result.reason = 'carousel-clone-mapping-unverified'; return result; }
  if (engine === 'owl' && activeItems.some((item, index) => items.indexOf(item) !== items.indexOf(activeItems[0]) + index)) { result.reason = 'carousel-active-window-ambiguous'; return result; }
  let index = logical.get(activeItems[0]);
  if (engine === 'slick' || engine === 'swiper') {
    const attribute = engine === 'slick' ? 'data-slick-index' : 'data-swiper-slide-index';
    const declared = activeItems[0].getAttribute(attribute);
    if (declared !== null && /^\d+$/.test(declared) && Number(declared) < originals.length) index = Number(declared);
  }
  if (index === undefined) { result.reason = 'carousel-active-clone-unmapped'; return result; }
  result.status = 'observed'; result.logicalIndex = index; result.reason = engine === 'owl' ? 'contiguous-originals-and-content-verified-clone-order' : 'unique-dom-active-item';
  return result;
}

/** Supplementary source render facts. Evaluate alongside collectObservationV2
 * in the exact connected source tab. Pass node selectors and usage resourceUrl
 * from that observation; this never loads inactive srcset candidates. Returns
 * JSON text (or bridgeParts) so a depth-limited transport cannot trim proofs.
 * The host binds screenshotHash to the actual PNG, just as for the main packet. */
async function collectSourceRenderEvidenceV2(options = {}) {
  if (!options.taskId || !options.snapshotId || !/^[a-f0-9]{64}$/.test(options.screenshotHash || '')) throw new Error('Source rendering requires task/snapshot and an actual screenshot hash');
  if (options.sourceUrl && options.sourceUrl !== location.href) throw new Error('Source rendering is outside the bound normal source page');
  const readonlyDOM = options.readonlyDOM === true;
  if (document.fonts?.status !== 'loaded' && document.fonts?.ready) await document.fonts.ready;
  const media = [], states = [], gaps = [], cache = new Map(), nodeSpecs = options.nodes || [], usageSpecs = options.usages || [], interactionSpecs = options.interactions || [];
  const nodeMap = new Map(nodeSpecs.map(node => [node.id || node.nodeId, node]));
  const nodes = new Map();
  for (const spec of nodeSpecs) { const id = spec.id || spec.nodeId, matches = document.querySelectorAll(spec.selector); if (matches.length !== 1) { gaps.push({ nodeId: id, code: 'source-render-selector-not-unique', count: matches.length }); continue; } nodes.set(id, matches[0]); }
  const paintable = element => { const box = element.getBoundingClientRect(); if (!(box.width > 0 && box.height > 0)) return false; let left = box.left, right = box.right, top = box.top, bottom = box.bottom; for (let owner = element; owner; owner = owner.parentElement) { const css = getComputedStyle(owner); if (css.display === 'none' || css.visibility === 'hidden' || css.visibility === 'collapse' || Number(css.opacity) === 0) return false; if (owner !== element) { const clip = owner.getBoundingClientRect(); if (/^(hidden|clip|auto|scroll)$/.test(css.overflowX)) { left = Math.max(left, clip.left); right = Math.min(right, clip.right); } if (/^(hidden|clip|auto|scroll)$/.test(css.overflowY)) { top = Math.max(top, clip.top); bottom = Math.min(bottom, clip.bottom); } } } return right - left > 0 && bottom - top > 0; };
  const decode = async url => { if (!cache.has(url)) cache.set(url, (async () => { const image = new Image(); image.src = url; let timer; try { await Promise.race([image.decode(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('source image decode timeout')), 5000); })]); const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1; const context = canvas.getContext('2d'); if (!context) throw new Error('drawable canvas unavailable'); context.drawImage(image, 0, 0, 1, 1); return { decoded: image.naturalWidth > 0 && image.naturalHeight > 0, drawable: true, naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight }; } catch { return { decoded: false, drawable: false, naturalWidth: image.naturalWidth || 0, naturalHeight: image.naturalHeight || 0 }; } finally { if (timer) clearTimeout(timer); } })()); return cache.get(url); };
  for (const [nodeId, element] of nodes) {
    const usages = usageSpecs.filter(usage => usage.nodeId === nodeId);
    if (String(element.tagName).toLowerCase() === 'img') {
      const currentSrc = element.currentSrc || element.src;
      let decoded = element.complete === true && element.naturalWidth > 0 && element.naturalHeight > 0, timer;
      if (!readonlyDOM) try { await Promise.race([element.decode(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('actual source image decode timeout')), 5000); })]); decoded = element.naturalWidth > 0 && element.naturalHeight > 0; } catch { decoded = false; } finally { if (timer) clearTimeout(timer); }
      let drawable = readonlyDOM ? decoded : false; if (!readonlyDOM && decoded) try { const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1; const context = canvas.getContext('2d'); if (context) { context.drawImage(element, 0, 0, 1, 1); drawable = true; } } catch {}
      media.push({ nodeId, url: currentSrc, currentSrc, kind: 'image', decoded: decoded && currentSrc === (element.currentSrc || element.src), drawable, complete: element.complete === true, naturalWidth: element.naturalWidth, naturalHeight: element.naturalHeight, painted: paintable(element), proof: readonlyDOM ? 'browser-complete-currentSrc-natural-dimensions' : 'browser-decode-canvas' });
    }
    const pseudos = new Set(['', ...usages.filter(usage => /^(before|after):background-image$/.test(usage.attribute || '')).map(usage => `::${usage.attribute.split(':')[0]}`)]);
    for (const pseudo of pseudos) {
      const background = getComputedStyle(element, pseudo || null).backgroundImage;
      const actualURLs = [...background.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/g)].map(match => new URL((match[1] ?? match[2] ?? match[3]).trim(), location.href).href);
      for (const url of actualURLs) { const pixels = readonlyDOM ? { decoded: null, drawable: null, naturalWidth: 0, naturalHeight: 0 } : await decode(url), sameStyle = getComputedStyle(element, pseudo || null).backgroundImage === background; media.push({ nodeId, url, kind: pseudo ? 'icon' : 'background', ...pixels, drawable: pixels.drawable === null ? null : pixels.drawable && sameStyle, painted: paintable(element) && sameStyle, proof: readonlyDOM ? 'browser-computed-background-paintability-only' : 'browser-decode-canvas', ...(pseudo ? { pseudo } : {}) }); }
    }
    if (String(element.tagName).toLowerCase() === 'svg') {
      const usage = usages.find(item => item.kind === 'svg'), rect = element.getBoundingClientRect(); let box = null; if (typeof element.getBBox === 'function') try { box = element.getBBox(); } catch {}
      const geometry = rect.width > 0 && rect.height > 0 && (box === null || box.width > 0 && box.height > 0);
      if (usage?.resourceUrl) media.push({ nodeId, url: usage.resourceUrl, kind: 'svg', decoded: readonlyDOM ? null : geometry, drawable: geometry, naturalWidth: box?.width ?? rect.width, naturalHeight: box?.height ?? rect.height, painted: paintable(element), proof: box ? 'browser-svg-graphics-bbox+bound-screenshot' : 'browser-svg-client-rect+bound-screenshot' });
    }
  }
  for (const spec of interactionSpecs) {
    const nodeId = spec.nodeId, owner = nodes.get(nodeId) || (nodeMap.get(nodeId)?.selector ? document.querySelector(nodeMap.get(nodeId).selector) : null), tracks = spec.trackSelector ? document.querySelectorAll(spec.trackSelector) : owner?.querySelectorAll('.swiper-wrapper,.slick-track,.owl-stage,.carousel-inner,[data-carousel-track]'), track = tracks?.length === 1 ? tracks[0] : null;
    if (!owner || !track || owner !== track && !owner.contains(track)) { gaps.push({ nodeId, code: 'source-carousel-track-unresolved' }); continue; }
    const observed = collectCarouselDOMStateV2(track);
    if (observed.status === 'observed') {
      states.push({ nodeId, carouselIndex: observed.logicalIndex, engine: observed.engine === 'slick' ? 'observed-slick-current-data-index' : `observed-${observed.engine}-dom-active-index`, domState: observed });
      if (observed.motionStatus !== 'settled') gaps.push({ nodeId, code: 'source-carousel-motion-unverified', status: observed.motionStatus });
      continue;
    }
    if (!['swiper', 'slick'].includes(observed.engine)) { states.push({ nodeId, domState: observed }); gaps.push({ nodeId, code: 'source-carousel-logical-index-unverified', reason: observed.reason }); continue; }
    const engines = [owner, ...owner.querySelectorAll('*')].map(element => element.swiper).filter(runtime => runtime?.initialized === true && runtime.destroyed !== true && runtime.wrapperEl === track);
    const unique = [...new Set(engines)];
    if (unique.length === 1 && Number.isInteger(unique[0].realIndex) && unique[0].animating !== true) { states.push({ nodeId, carouselIndex: unique[0].realIndex, engine: 'observed-swiper-real-index' }); continue; }
    const originals = [...track.children].filter(item => !item.matches('.slick-cloned,.swiper-slide-duplicate')), known = new Set(originals.map(item => item.getAttribute('data-slick-index')).filter(value => value !== null));
    const current = [...track.children].filter(item => item.matches('.slick-current') && !item.matches('.slick-cloned')), index = current.length === 1 ? current[0].getAttribute('data-slick-index') : null;
    if (index !== null && known.has(index) && Number.isInteger(Number(index)) && Number(index) >= 0) states.push({ nodeId, carouselIndex: Number(index), engine: 'observed-slick-current-data-index' });
    else { states.push({ nodeId, domState: observed }); gaps.push({ nodeId, code: 'source-carousel-logical-index-unverified', reason: observed.reason }); }
  }
  const result = { version: 1, taskId: options.taskId, snapshotId: options.snapshotId, sourceUrl: location.href, capturedAt: new Date().toISOString(), screenshotHash: options.screenshotHash, viewport: { width: innerWidth, height: innerHeight, clientWidth: document.documentElement.clientWidth, devicePixelRatio }, fontsReady: document.fonts?.status === 'loaded', observationMode: readonlyDOM ? 'readonlyDOM' : 'browser-decode', media, states, gaps };
  const json = JSON.stringify(result); if (!options.bridgeParts) return json;
  const parts = []; for (let index = 0; index < json.length; index += 80000) parts.push(json.slice(index, index + 80000)); return parts;
}

/** Read-only state probe. The caller must move a real pointer with a supported
 * browser adapter before requesting `hover`, then move it away for `restored`.
 * This function never synthesizes an event or claims the pointer moved. */
function collectHoverStateV2(options = {}) {
  const { sourceUrl, triggerSelector, affectedSelectors = [], stage, screenshotHash } = options;
  if (sourceUrl !== location.href || !['default', 'hover', 'restored'].includes(stage) || !/^[a-f0-9]{64}$/.test(screenshotHash || '') || typeof triggerSelector !== 'string' || !triggerSelector || !Array.isArray(affectedSelectors) || affectedSelectors.length > 30) throw new Error('Invalid hover state probe');
  const triggerMatches = document.querySelectorAll(triggerSelector);
  if (triggerMatches.length !== 1) throw new Error('Hover trigger selector is not unique');
  const trigger = triggerMatches[0], hovered = trigger.matches(':hover');
  if (hovered !== (stage === 'hover')) throw new Error('Real pointer state does not match requested hover stage');
  const properties = ['color', 'background-color', 'border-color', 'text-decoration-line', 'transform', 'opacity', 'filter', 'box-shadow', 'visibility', 'display', 'width', 'height', 'transition-duration'];
  const style = element => { const result = {}; for (const pseudo of ['', '::before', '::after']) { const computed = getComputedStyle(element, pseudo || null); result[pseudo || 'element'] = Object.fromEntries([...properties, 'content'].map(property => [property, computed.getPropertyValue(property)])); } return result; };
  const observe = selector => { const matches = document.querySelectorAll(selector); if (matches.length !== 1) throw new Error(`Hover affected selector is not unique: ${selector}`); const element = matches[0], rect = element.getBoundingClientRect(); return { selector, tag: element.tagName.toLowerCase(), text: element.textContent.replace(/\s+/g, ' ').trim().slice(0, 200), rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, currentSrc: element.tagName === 'IMG' ? element.currentSrc : null, styles: style(element) }; };
  return { version: 1, kind: 'source-hover-state', sourceUrl, stage, observedAt: new Date().toISOString(), screenshotHash, triggerSelector, hovered, affected: [triggerSelector, ...affectedSelectors.filter(selector => selector !== triggerSelector)].map(observe) };
}

/** Record CSS hover declarations whose painted trigger is covered by another
 * element even after its own carousel state has been activated. This is a
 * read-only hit test; the caller supplies the real activation and screenshot. */
function collectHoverReachabilityV2(options = {}) {
  const { sourceUrl, triggerSelector, screenshotHash } = options;
  if (sourceUrl !== location.href || typeof triggerSelector !== 'string' || !triggerSelector || !/^[a-f0-9]{64}$/.test(screenshotHash || '')) throw new Error('Invalid hover reachability probe');
  const matches = document.querySelectorAll(triggerSelector);
  if (matches.length !== 1) throw new Error('Hover reachability selector is not unique');
  const trigger = matches[0], rect = trigger.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0 || rect.left < 0 || rect.top < 0 || rect.right > document.documentElement.clientWidth || rect.bottom > innerHeight) throw new Error('Hover reachability trigger is not fully in viewport');
  if (trigger.matches(':hover')) throw new Error('Hover reachability requires pointer away from trigger');
  const hits = [];
  for (const fy of [0.2, 0.5, 0.8]) for (const fx of [0.2, 0.5, 0.8]) {
    const x = rect.left + rect.width * fx, y = rect.top + rect.height * fy;
    const hit = document.elementFromPoint(x, y);
    hits.push({ x, y, hitSelector: hit ? sceneSelectorV2(hit) : null, targetOrDescendant: hit === trigger || !!hit && trigger.contains(hit) });
  }
  return { version: 1, kind: 'source-hover-unreachable', sourceUrl, observedAt: new Date().toISOString(), screenshotHash, triggerSelector, triggerRect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, pointerEvents: getComputedStyle(trigger).pointerEvents, hits };
}

/** Independent whole-body denominator, evaluated once with ALL region selectors.
 * It never reads form values, cookies, storage or document instructions. */
function collectSceneInventoryV2(options = {}) {
  const regionSpecs = options.regions || options.inventoryRegions || [];
  const regions = regionSpecs.map(spec => { const element = document.querySelector(spec.selector); if (!element) throw new Error(`Scene inventory root missing: ${spec.selector}`); return { ...spec, element }; });
  const vendorSpecs = options.vendorUtilities || [{ selector: '#QSIFeedbackButton-btn', marker: 'feedback' }, { selector: '.QSIFeedbackButton', marker: 'feedback' }, { selector: '#web-messenger-container', marker: 'messenger-chat' }, { selector: '#chat-widget-container', marker: 'chat' }, { selector: '#launcher', marker: 'chat-launcher' }, { selector: '[data-testid="messenger-wrapper"]', marker: 'messenger-chat' }];
  const vendors = vendorSpecs.map(spec => ({ ...spec, elements: [...document.querySelectorAll(spec.selector)] }));
  const entries = {}, round = value => Math.round(value * 1000) / 1000;
  const stableId = (selector, kind) => { let a = 2166136261, b = 2246822519; const value = `${kind}:${selector}`; for (let index = 0; index < value.length; index++) { a = Math.imul(a ^ value.charCodeAt(index), 16777619); b = Math.imul(b ^ value.charCodeAt(index), 3266489917); } return `scene-${(a >>> 0).toString(16)}-${(b >>> 0).toString(16)}`; };
  const visible = element => {
    const style = getComputedStyle(element), box = element.getBoundingClientRect();
    if (style.display === 'none' || style.visibility !== 'visible' || Number(style.opacity) === 0 || box.width <= 0 || box.height <= 0 || box.right <= 0 || box.left >= document.documentElement.clientWidth) return false;
    for (let parent = element.parentElement; parent && parent !== document.documentElement; parent = parent.parentElement) {
      const css = getComputedStyle(parent); if (css.display === 'none' || css.visibility === 'hidden' || Number(css.opacity) === 0) return false;
      const outer = parent.getBoundingClientRect();
      if (['hidden', 'clip', 'scroll', 'auto'].includes(css.overflowX) && (box.right <= outer.left || box.left >= outer.right)) return false;
      if (['hidden', 'clip', 'scroll', 'auto'].includes(css.overflowY) && (box.bottom <= outer.top || box.top >= outer.bottom)) return false;
    }
    return true;
  };
  const add = (element, kind, label) => {
    const selector = sceneSelectorV2(element), id = stableId(selector, kind), owners = regions.filter(region => region.element === element || region.element.contains(element));
    if (owners.length > 1) throw new Error(`Independent scene node has ambiguous ownership: ${selector}`);
    const vendor = !owners.length ? vendors.find(spec => spec.elements.some(parent => parent === element || parent.contains(element))) : undefined;
    const box = element.getBoundingClientRect();
    entries[id] = { id, selector, ownerRegionId: owners[0]?.id || null, kind, ...(label ? { label } : {}), ...(vendor ? { utility: { kind: 'source-vendor', marker: vendor.marker || vendor.selector } } : {}), rect: { x: round(box.x + scrollX), y: round(box.y + scrollY), width: round(box.width), height: round(box.height) } };
  };
  for (const element of document.querySelectorAll('body,body *')) {
    if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'META', 'LINK'].includes(element.tagName) || element.closest('svg *') || !visible(element)) continue;
    const text = [...element.childNodes].filter(child => child.nodeType === 3).map(child => child.textContent).join(' ').replace(/\s+/g, ' ').trim();
    if (text) add(element, 'text', text);
    const css = getComputedStyle(element);
    if (element.matches('img,svg,video,canvas') || css.backgroundImage !== 'none') add(element, 'media', element.getAttribute('alt') || element.getAttribute('aria-label') || element.tagName.toLowerCase());
    if (element.matches('a[href],button,input,select,textarea,iframe,[role="button"],[role="tab"],[aria-controls]')) add(element, 'control', element.getAttribute('aria-label') || element.getAttribute('title') || element.getAttribute('placeholder') || text || element.getAttribute('role') || element.tagName.toLowerCase());
  }
  const content = { entries: [], gaps: [] };
  for (const element of document.querySelectorAll('body,body *')) {
    if (element.closest('script,style,noscript,template') || ['META', 'LINK'].includes(element.tagName) || element.closest('svg *')) continue;
    const selector = sceneSelectorV2(element), owners = regions.filter(region => region.element === element || region.element.contains(element));
    const common = { selector, ownerRegionId: owners.length === 1 ? owners[0].id : null, visible: visible(element) };
    const text = element.closest('textarea') ? '' : [...element.childNodes].filter(child => child.nodeType === 3).map(child => child.textContent).join(' ').replace(/\s+/g, ' ').trim();
    if (text) content.entries.push({ ...common, kind: 'text', text });
    if (element.matches('a[href]')) content.entries.push({ ...common, kind: 'link', text: element.textContent.replace(/\s+/g, ' ').trim(), href: element.href });
    const css = getComputedStyle(element);
    if (element.matches('img,svg,video,audio,canvas') || /url\(["']?[^"')]+["']?\)/.test(css.backgroundImage)) content.entries.push({ ...common, kind: 'media', resource: element.tagName.toLowerCase() === 'svg' ? 'inline-svg' : element.currentSrc || element.src || css.backgroundImage });
    const decorationPaint = Object.fromEntries(['top', 'right', 'bottom', 'left'].flatMap(side => ['width', 'style', 'color'].map(property => { const key = `border-${side}-${property}`; return [key, css.getPropertyValue(key)]; })));
    let pseudoDecoration = false;
    for (const pseudo of ['before', 'after']) {
      const style = getComputedStyle(element, `::${pseudo}`);
      if (!style.content || ['none', 'normal'].includes(style.content) || style.display === 'none') continue;
      pseudoDecoration = true;
      for (const key of ['content', 'background-color', 'background-image', 'color', 'width', 'height', 'display']) decorationPaint[`${pseudo}:${key}`] = style.getPropertyValue(key);
    }
    if (pseudoDecoration || ['Top', 'Right', 'Bottom', 'Left'].some(side => Number.parseFloat(css[`border${side}Width`]) > 0)) content.entries.push({ ...common, kind: 'decoration', paint: decorationPaint });
    if (element.matches('button,input:not([type="hidden"]),select,textarea,summary,[role="tab"],[aria-controls]')) content.entries.push({ ...common, kind: 'control' });
    if (element.matches('iframe,canvas') || element.shadowRoot) content.gaps.push({ selector, code: 'nested-content-needs-observation', message: 'Frame, canvas or shadow content needs separate observation; outer DOM does not prove its content was captured.' });
  }
  const values = Object.values(entries), inventory = { version: 2, kind: 'scene-inventory', snapshotId: options.snapshotId || 'desktop-initial', sourceUrl: location.href, capturedAt: options.capturedAt || new Date().toISOString(), viewport: { name: options.viewportName || 'desktop', width: innerWidth, height: innerHeight }, regions: regions.map(region => ({ id: region.id, selector: region.selector })), entries, content, counts: { total: values.length, text: values.filter(entry => entry.kind === 'text').length, media: values.filter(entry => entry.kind === 'media').length, control: values.filter(entry => entry.kind === 'control').length, assigned: values.filter(entry => entry.ownerRegionId !== null).length, unassigned: values.filter(entry => entry.ownerRegionId === null && !entry.utility).length, vendorUtilities: values.filter(entry => entry.utility).length } };
  if (options.asObject) return inventory;
  const json = JSON.stringify(inventory);
  if (options.bridgeParts) { const parts = []; for (let start = 0; start < json.length; start += 80000) parts.push(json.slice(start, start + 80000)); return parts; }
  return json;
}
