// Evaluate with collect.browser.js in the same read-only DOM scope.
function measureObservationGeometryV2(regions) {
  const round = value => Math.round(value * 1000) / 1000;
  const rows = [], styleCache = new Map(), animatedCache = new Map();
  for (const region of regions) {
    const matches = document.querySelectorAll(region.selector);
    if (matches.length !== 1) throw new Error('Observation region is no longer unique: ' + region.id);
    const root = matches[0], elements = [root, ...root.querySelectorAll('*')].filter(element => !['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'META', 'LINK'].includes(element.tagName) && !element.closest('svg *'));
    for (const [index, element] of elements.entries()) {
      const css = getComputedStyle(element), r = element.getBoundingClientRect(), padding = ['Top', 'Right', 'Bottom', 'Left'].map(side => Number.parseFloat(css['padding' + side]) || 0);
      const animated = captureAnimationLayoutV2(element, styleCache, animatedCache);
      const rect = animated?.rect ?? {x: round(r.x + scrollX), y: round(r.y + scrollY), width: round(r.width), height: round(r.height)};
      const content = animated?.contentRect ?? {x: round(rect.x + padding[3]), y: round(rect.y + padding[0]), width: round(Math.max(0, rect.width - padding[1] - padding[3])), height: round(Math.max(0, rect.height - padding[0] - padding[2]))};
      rows.push([region.id + '-n' + (index + 1), rect.x, rect.y, rect.width, rect.height, content.x, content.y, content.width, content.height, css.display, css.position]);
    }
  }
  const json = JSON.stringify({url: location.href, scrollX, scrollY, pageHeight: Math.max(document.body.scrollHeight, document.documentElement.scrollHeight), viewport: {width: innerWidth, height: innerHeight, clientWidth: document.documentElement.clientWidth, scrollbarWidth: innerWidth - document.documentElement.clientWidth, devicePixelRatio}, rows});
  const parts = [];
  for (let offset = 0; offset < json.length; offset += 80000) parts.push(json.slice(offset, offset + 80000));
  return parts;
}
