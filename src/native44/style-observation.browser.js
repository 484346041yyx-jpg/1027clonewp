globalThis.observeNative44Styles = function(requests) {
  if (!Array.isArray(requests) || requests.length > 2000) throw Error('style_observation_request_limit');
  const publicValue = value => /url\s*\(/i.test(value) ? '[resource-url-redacted]' : value;
  return {
    version: 1, kind: 'native44-current-style-observation',
    viewport: { width: window.innerWidth, height: window.innerHeight, clientWidth: document.documentElement.clientWidth, devicePixelRatio: window.devicePixelRatio },
    fontStatus: document.fonts ? document.fonts.status : 'unknown',
    targets: requests.map(request => {
      if (typeof request.selector !== 'string' || request.selector.length > 1000 || !Array.isArray(request.properties) || request.properties.length > 100 || request.properties.some(property => !/^[a-z][a-z-]*$/.test(property))) throw Error('style_observation_request_invalid');
      const elements = document.querySelectorAll(request.selector);
      if (elements.length !== 1) return { selector: request.selector, status: 'unresolved', reason: elements.length ? 'multiple-matches' : 'missing-target' };
      const element = elements[0], computed = getComputedStyle(element), rules = [], limitations = [];
      const visited = new Set(); let inspected = 0;
      function scan(sheet, path) {
        if (visited.has(sheet)) return;
        visited.add(sheet);
        let entries;
        try { entries = sheet.cssRules; } catch { limitations.push('stylesheet-rules-inaccessible'); return; }
        for (let index = 0; index < entries.length; index++) {
          if (++inspected > 20000 || rules.length >= 2000) { limitations.push('rule-budget'); return; }
          const rule = entries[index], location = path.concat(index);
          if (rule.type === CSSRule.IMPORT_RULE) { if (!rule.media.length || matchMedia(rule.media.mediaText).matches) scan(rule.styleSheet, location); continue; }
          if (rule.type === CSSRule.MEDIA_RULE && !matchMedia(rule.conditionText).matches) continue;
          if (rule.type === CSSRule.SUPPORTS_RULE && !CSS.supports(rule.conditionText)) continue;
          if (rule.selectorText && rule.style) {
            let matches = false;
            try { matches = element.matches(rule.selectorText); } catch { limitations.push('selector-not-matchable'); }
            if (matches) for (const property of request.properties) {
              const value = rule.style.getPropertyValue(property);
              if (value) rules.push({ path: location, selector: rule.selectorText, property, value: publicValue(value), important: rule.style.getPropertyPriority(property) === 'important' });
            }
          } else if (rule.cssRules) {
            if (![CSSRule.MEDIA_RULE, CSSRule.SUPPORTS_RULE].includes(rule.type)) limitations.push('layer-or-scope-cascade-not-resolved');
            scan(rule, location);
          }
        }
      }
      [...document.styleSheets, ...document.adoptedStyleSheets].forEach((sheet, index) => scan(sheet, [index]));
      const inline = Object.fromEntries(request.properties.filter(property => element.style.getPropertyValue(property)).map(property => [property, { value: publicValue(element.style.getPropertyValue(property)), important: element.style.getPropertyPriority(property) === 'important' }]));
      const rect = element.getBoundingClientRect();
      return {
        selector: request.selector, status: 'observed', computed: Object.fromEntries(request.properties.map(property => [property, publicValue(computed.getPropertyValue(property))])), inline, matchingRules: rules,
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        states: { hover: element.matches(':hover'), focus: element.matches(':focus'), active: element.matches(':active'), selected: element.getAttribute('aria-selected'), expanded: element.getAttribute('aria-expanded'), disabled: element.matches(':disabled') },
        limitations: [...new Set(limitations)], winningDeclarationVerified: false,
      };
    }),
    remoteWrites: 0,
  };
}
