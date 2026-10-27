/** Evaluated in the Claude-driven source page together with collect.browser.js
 * and measure-geometry.browser.js. Read-only probes except the explicit
 * freeze helper, which settles animations after the host paused page timers. */
const CLAUDE_CAPTURE_ENGINES_V2 = [
  { engine: 'splide', root: '.splide', track: '.splide__list', item: '.splide__slide:not(.splide__slide--clone)', ready: 'is-initialized' },
  { engine: 'swiper', root: '.swiper, .swiper-container', track: '.swiper-wrapper', item: '.swiper-slide:not(.swiper-slide-duplicate)', ready: 'swiper-initialized' },
  { engine: 'slick', root: '.slick-slider', track: '.slick-track', item: '.slick-slide:not(.slick-cloned)', ready: 'slick-initialized' },
  { engine: 'owl', root: '.owl-carousel', track: '.owl-stage', item: '.owl-item:not(.cloned)', ready: 'owl-loaded' },
  { engine: 'flickity', root: '.flickity-enabled', track: '.flickity-slider', item: '.flickity-slider > *', ready: 'flickity-enabled' },
  { engine: 'bootstrap', root: '.carousel', track: '.carousel-inner', item: '.carousel-item', ready: null },
];

function claudeCaptureDocumentV2() {
  if (!window.__claudeCapture) window.__claudeCapture = { id: crypto.randomUUID(), frozenTimers: false, autoplayObserved: {} };
  const sheets = [...document.styleSheets].map(sheet => { let rules = -1; try { rules = sheet.cssRules.length; } catch {} return [sheet.href || (sheet.ownerNode && sheet.ownerNode.id) || 'inline', rules, sheet.media ? sheet.media.mediaText : '']; });
  const adopted = (document.adoptedStyleSheets || []).map(sheet => { try { return sheet.cssRules.length; } catch { return -1; } });
  return { key: location.origin + location.pathname, revision: window.__claudeCapture.id, styleDescriptor: JSON.stringify([sheets, adopted]) };
}

function claudeCaptureCarouselOwnersV2() {
  const owners = [], seen = new Set();
  for (const spec of CLAUDE_CAPTURE_ENGINES_V2) for (const root of document.querySelectorAll(spec.root)) {
    if (seen.has(root) || !root.querySelector(spec.track)) continue;
    seen.add(root);
    const box = root.getBoundingClientRect();
    owners.push({ id: 'carousel-' + sceneSelectorV2(root).replace(/[^a-zA-Z0-9]+/g, '-').slice(-60) + '-' + owners.length, engine: spec.engine, selector: sceneSelectorV2(root), visible: box.width > 0 && box.height > 0 });
  }
  return owners;
}

function claudeCaptureCarouselStateV2(owner) {
  claudeCaptureDocumentV2();
  const spec = CLAUDE_CAPTURE_ENGINES_V2.find(item => item.engine === owner.engine), root = document.querySelector(owner.selector);
  if (!root) throw new Error('Carousel owner is no longer present: ' + owner.id);
  const track = root.querySelector(spec.track), items = [...root.querySelectorAll(spec.item)], rootBox = root.getBoundingClientRect();
  const visibleIndexes = [];
  items.forEach((item, index) => {
    const box = item.getBoundingClientRect(), overlap = Math.min(box.right, rootBox.right) - Math.max(box.left, rootBox.left);
    if (box.width > 0 && overlap >= box.width * 0.5 && item.getAttribute('aria-hidden') !== 'true') visibleIndexes.push(index);
  });
  const counterElement = root.querySelector('[class*="fraction"],[class*="counter"],.swiper-pagination-fraction,.splide__pagination__page.is-active');
  const frozen = window.__claudeCapture.frozenTimers === true, observed = window.__claudeCapture.autoplayObserved[owner.id] === true;
  return {
    owner: owner.id, initialized: spec.ready ? root.classList.contains(spec.ready) : items.length > 0,
    logicalIndex: visibleIndexes.length ? visibleIndexes[0] : 0, visibleIds: (visibleIndexes.length ? visibleIndexes : [0]).map(index => 'item-' + index),
    counter: counterElement ? counterElement.textContent.replace(/\s+/g, ' ').trim().slice(0, 240) : '',
    transform: track ? getComputedStyle(track).transform.slice(0, 1000) : 'none',
    animating: root.getAnimations({ subtree: true }).some(animation => animation.playState === 'running' && animation.effect && animation.effect.getComputedTiming().iterations !== Infinity),
    autoplayRunning: observed && !frozen, autoplayPaused: observed && frozen,
  };
}

/** Rows use exactly the layout formulas of collectObservationV2 so live geometry can be compared with packet geometry. */
function claudeCaptureGeometryV2(regions) {
  const round = value => Math.round(value * 1000) / 1000, number = value => Number.isFinite(Number.parseFloat(value)) ? Number.parseFloat(value) : 0;
  const rows = [], styleCache = new Map(), animatedCache = new Map();
  for (const region of regions) {
    const matches = document.querySelectorAll(region.selector);
    if (!matches.length) throw new Error('Observation region is missing: ' + region.id);
    const root = matches[0], elements = [root, ...root.querySelectorAll('*')].filter(element => !['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'META', 'LINK'].includes(element.tagName) && !element.closest('svg *'));
    for (const [index, element] of elements.entries()) {
      const css = getComputedStyle(element), box = element.getBoundingClientRect();
      const padding = ['Top', 'Right', 'Bottom', 'Left'].map(side => number(css['padding' + side])), border = ['Top', 'Right', 'Bottom', 'Left'].map(side => number(css['border' + side + 'Width']));
      const rect = { x: round(box.x + scrollX), y: round(box.y + scrollY), width: round(box.width), height: round(box.height) };
      const content = { x: round(rect.x + padding[3] + border[3]), y: round(rect.y + padding[0] + border[0]), width: round(Math.max(0, rect.width - padding[1] - padding[3] - border[1] - border[3])), height: round(Math.max(0, rect.height - padding[0] - padding[2] - border[0] - border[2])) };
      const animated = captureAnimationLayoutV2(element, styleCache, animatedCache), rectUsed = animated ? animated.rect : rect, contentUsed = animated ? animated.contentRect : content;
      rows.push([region.id + '-n' + (index + 1), rectUsed.x, rectUsed.y, rectUsed.width, rectUsed.height, contentUsed.x, contentUsed.y, contentUsed.width, contentUsed.height, css.display, css.position]);
    }
  }
  return { rows, pageHeight: Math.max(document.body.scrollHeight, document.documentElement.scrollHeight) };
}

async function claudeCaptureStateV2(options = {}) {
  const document0 = claudeCaptureDocumentV2(), regions = options.regions || [], owners = options.carouselOwners || [];
  const descriptor = new TextEncoder().encode(document0.styleDescriptor), digest = await crypto.subtle.digest('SHA-256', descriptor);
  const styleHash = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  const geometry = regions.length ? claudeCaptureGeometryV2(regions) : { rows: [], pageHeight: 0 };
  const visualViewport0 = window.visualViewport || { width: innerWidth, height: innerHeight, scale: 1 };
  const painted = element => { const css = getComputedStyle(element), box = element.getBoundingClientRect(); return css.display !== 'none' && css.visibility !== 'hidden' && Number(css.opacity) !== 0 && box.width > 0 && box.height > 0; };
  const images = [...document.images].filter(painted);
  const hovered = [...document.querySelectorAll(':hover')].slice(-1).map(sceneSelectorV2);
  const expanded = [...document.querySelectorAll('[aria-expanded="true"],details[open],dialog[open]')].map(sceneSelectorV2).sort();
  const overlays = [...document.querySelectorAll('body *')].filter(element => ['fixed', 'sticky'].includes(getComputedStyle(element).position) && painted(element)).map(element => { const box = element.getBoundingClientRect(), css = getComputedStyle(element); return [sceneSelectorV2(element), css.position, Math.round(box.x * 100) / 100, Math.round(box.y * 100) / 100, Math.round(box.width * 100) / 100, Math.round(box.height * 100) / 100, css.zIndex]; });
  const faces = document.fonts ? [...document.fonts] : [];
  return {
    observedAt: new Date().toISOString(),
    document: { key: document0.key, revision: document0.revision, styleHash },
    viewport: { width: innerWidth, height: innerHeight, clientWidth: document.documentElement.clientWidth, devicePixelRatio, visualWidth: visualViewport0.width, visualHeight: visualViewport0.height, visualScale: visualViewport0.scale },
    geometry: { rows: geometry.rows, pageHeight: geometry.pageHeight || Math.max(document.body.scrollHeight, document.documentElement.scrollHeight) },
    interaction: { active: document.activeElement && document.activeElement !== document.body ? sceneSelectorV2(document.activeElement) : null, hovered, expanded },
    overlays,
    fonts: { ready: !document.fonts || document.fonts.status === 'loaded', failed: faces.filter(face => face.status === 'error').length, rows: faces.map(face => [face.family, face.weight, face.style, face.status]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))) },
    media: { ready: images.every(image => image.complete), failed: images.filter(image => image.complete && image.naturalWidth === 0).length, rows: images.map(image => [image.currentSrc || image.src, image.naturalWidth, image.naturalHeight]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))) },
    carousels: owners.map(claudeCaptureCarouselStateV2),
    runningAnimations: document.getAnimations().filter(animation => animation.playState === 'running').length,
    scroll: { x: scrollX, y: scrollY },
  };
}

/** Called after the host froze page timers: finishes finite animations and pauses endless ones. */
function claudeCaptureFreezeAnimationsV2() {
  let finished = 0, pausedInfinite = 0;
  for (const animation of document.getAnimations()) {
    const timing = animation.effect && animation.effect.getComputedTiming();
    if (!timing || animation.playState !== 'running') continue;
    if (timing.iterations === Infinity) { animation.pause(); pausedInfinite++; } else { try { animation.finish(); finished++; } catch { animation.pause(); } }
  }
  return { finished, pausedInfinite };
}

/** Scroll the whole document once so lazy media and reveal-on-scroll content settle. */
async function claudeCaptureWarmupV2(options = {}) {
  const step = Math.max(200, Math.floor(innerHeight * 0.6)), pause = options.pauseMs || 160;
  let last = -1, guard = 0;
  while (guard++ < 400) {
    const height = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
    if (scrollY + innerHeight >= height - 1 || scrollY === last) break;
    last = scrollY; scrollTo(0, scrollY + step); await new Promise(resolve => setTimeout(resolve, pause));
  }
  await new Promise(resolve => setTimeout(resolve, 400));
  scrollTo(0, 0); await new Promise(resolve => setTimeout(resolve, 300));
  return { pageHeight: Math.max(document.body.scrollHeight, document.documentElement.scrollHeight) };
}
