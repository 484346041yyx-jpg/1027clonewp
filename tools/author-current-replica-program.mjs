import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const job = path.resolve(process.argv[2] ?? '');
if (!job.toLowerCase().startsWith('d:\\clonewp\\references\\')) throw new Error('Current replica job required');
const read = async name => JSON.parse(await readFile(path.join(job, name), 'utf8'));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const contract = await read('block-contract.json'), manifest = await read('asset-manifest.json');
const packets = Object.fromEntries(await Promise.all(['desktop', 'tablet', 'mobile'].map(async name => [name, await read(`reference/${name}.json`)])));
const assetsByUrl = new Map(manifest.assets.map(asset => [asset.sourceUrl, asset]));
const px = size => ({ unit: 'px', size: Math.max(0, Math.round(size * 100) / 100), sizes: [] });
const percent = size => ({ unit: '%', size, sizes: [] });
const edges = value => ({ unit: 'px', top: String(value), right: String(value), bottom: String(value), left: String(value), isLinked: true });
const gap = value => ({ unit: 'px', column: String(value), row: String(value), isLinked: true });
const box = (key, children = [], settings = {}) => ({ key, type: 'container', settings: { container_type: 'flex', content_width: 'full', width: percent(100), flex_direction: 'column', flex_justify_content: 'flex-start', flex_align_items: 'stretch', flex_gap: gap(0), padding: edges(0), margin: edges(0), ...settings }, children });
const hashFile = async name => sha(await readFile(path.join(job, name)));
const staticUsage = (id, url) => new Set(Object.entries(packets).filter(([, packet]) => packet.blocks.find(block => block.id === id)?.images?.some(image => image.url === url)).map(([name]) => name));
const visibleCSS = usage => {
  const desktop = usage.has('desktop'), tablet = usage.has('tablet'), mobile = usage.has('mobile');
  if (desktop && tablet && mobile) return undefined;
  return `selector{display:${desktop ? 'block' : 'none'};}@media(max-width:1024px){selector{display:${tablet ? 'block' : 'none'};}}@media(max-width:767px){selector{display:${mobile ? 'block' : 'none'};}}`;
};
const observedAtoms = id => {
  const map = new Map();
  for (const packet of Object.values(packets)) for (const atom of packet.blocks.find(block => block.id === id)?.textAtoms ?? []) {
    if (atom.text?.trim() && !map.has(`${atom.selector}\u0000${atom.text}`)) map.set(`${atom.selector}\u0000${atom.text}`, atom);
  }
  return [...map.values()];
};
const sourceImage = (id, url) => Object.values(packets).flatMap(packet => packet.blocks.find(block => block.id === id)?.images ?? []).find(image => image.url === url);
const sourceLink = (id, image) => {
  const links = Object.values(packets).flatMap(packet => packet.blocks.find(block => block.id === id)?.links ?? []);
  return links.filter(link => image?.ancestorSelectors?.includes(link.selector) && link.href?.startsWith('http')).sort((a, b) => b.selector.length - a.selector.length)[0]?.href;
};
const imageNode = (id, asset, suffix) => {
  const image = sourceImage(id, asset.sourceUrl), usage = staticUsage(id, asset.sourceUrl), link = sourceLink(id, image);
  const settings = { image: { $asset: asset.key }, image_size: 'full', width: percent(100), align: 'center', ...(image?.rect?.height > 0 ? { height: px(Math.min(image.rect.height, 350)), 'object-fit': image.style?.['object-fit'] === 'cover' ? 'cover' : 'contain' } : {}) };
  const css = visibleCSS(usage); if (css) settings.custom_css = css;
  if (link) { settings.link_to = 'custom'; settings.link = { url: link, is_external: 'on' }; }
  return { key: `${id}-image-${suffix}`, type: 'image', settings };
};
const textNode = (id, entry, atom) => {
  const css = atom?.style ?? {}, size = Number.parseFloat(css['font-size'] ?? '') || 16, line = Number.parseFloat(css['line-height'] ?? '') || Math.round(size * 1.3);
  const sourceWeight = Number.parseFloat(css['font-weight'] ?? '400');
  const nativeWeight = Number.isFinite(sourceWeight) ? String(Math.max(100, Math.min(900, Math.round(sourceWeight / 100) * 100))) : '400';
  const settings = { title: entry.text, header_size: /^h[1-6]$/i.test(atom?.tag ?? '') ? atom.tag.toLowerCase() : 'p', title_color: css.color ?? '#3D3935', typography_typography: 'custom', typography_font_family: css['font-family']?.split(',')[0]?.replaceAll('"', '')?.trim() || 'Arial', typography_font_size: px(Math.min(80, size)), typography_font_weight: nativeWeight, typography_line_height: px(Math.min(100, line)), align: ['left', 'right', 'center', 'justify'].includes(css['text-align']) ? css['text-align'] : 'left', _margin: edges(0), _padding: edges(0) };
  if (atom?.href?.startsWith('http')) settings.link = { url: atom.href, is_external: 'on' };
  if (atom && atom.visible === false && Object.values(packets).every(packet => {
    const match = packet.blocks.find(block => block.id === id)?.textAtoms?.find(value => value.selector === atom.selector && value.text === atom.text);
    return !match || match.rect?.height === 0;
  })) settings.custom_css = 'selector{display:none;}';
  return { key: entry.id, type: 'heading', settings };
};
const slideCount = id => ({ header: 1, hero: 1, 'featured-brands': 6, 'dog-deals': 6, 'cat-deals': 6, 'other-deals': 6 })[id] ?? 1;
const nativeElements = [], programBlocks = [], deviations = [];
for (const source of contract.blocks) {
  const id = source.id, d = packets.desktop.blocks.find(block => block.id === id), atoms = observedAtoms(id);
  const entryByIdentity = new Map(atoms.map((atom, index) => [`${atom.selector}\u0000${atom.text}`, source.texts[index]]));
  const nodeByTextId = new Map(source.texts.map((entry, index) => [entry.id, textNode(id, entry, atoms[index])]));
  const dynamicText = new Set(source.dynamicData?.replaceableTextIds ?? []), dynamicAssets = new Set(source.dynamicData?.replaceableAssetKeys ?? []);
  const mountedText = new Set(), mountedAssets = new Set();
  const addText = (parent, atom) => { const entry = entryByIdentity.get(`${atom.selector}\u0000${atom.text}`); if (!entry || dynamicText.has(entry.id) || mountedText.has(entry.id)) return; parent.children.push(nodeByTextId.get(entry.id)); mountedText.add(entry.id); };
  const addImage = (parent, url) => { const asset = assetsByUrl.get(url); if (!asset || !source.assets.includes(asset.key) || dynamicAssets.has(asset.key) || mountedAssets.has(asset.key)) return; parent.children.push(imageNode(id, asset, mountedAssets.size + 1)); mountedAssets.add(asset.key); };
  const root = box(`${id}-root`, [], { background_background: 'classic', background_color: source.colors.background && !/^rgba\(0, 0, 0, 0\)/.test(source.colors.background) ? source.colors.background : '#FFFFFF', width: percent(100), flex_gap: gap(0) });
  const measured = source.contentBounds.desktop, content = box(`${id}-content`, [], { width: px(Math.min(measured.width, 1440)), width_tablet: percent(100), width_mobile: percent(100), custom_css: 'selector{margin-left:auto;margin-right:auto;max-width:100%;}' });
  root.children.push(content);
  if (source.presentation === 'carousel' && !source.dynamicData) {
    const carousel = { key: `${id}-carousel`, type: 'nested-carousel', settings: { slides_to_show: String(slideCount(id)), slides_to_show_tablet: String(Math.min(slideCount(id), id === 'hero' || id === 'header' ? 1 : 3)), slides_to_show_mobile: String(id === 'hero' || id === 'header' ? 1 : 2), slides_to_scroll: '1', arrows: 'yes', pagination: id === 'hero' ? 'bullets' : 'fraction', autoplay: id === 'hero' || id === 'header' ? 'yes' : 'no', ...(id === 'hero' || id === 'header' ? { autoplay_speed: 5000, pause_on_hover: 'yes' } : {}), infinite: 'yes' }, children: [] };
    const slides = d.carousels?.[0]?.slides ?? [];
    for (let index = 0; index < slides.length; index++) {
      const slide = box(`${id}-slide-${index + 1}`, [], { flex_direction: id === 'hero' ? 'row' : 'column', flex_direction_mobile: 'column', flex_justify_content: id === 'hero' ? 'center' : 'flex-start', flex_align_items: 'center', flex_gap: gap(id === 'hero' ? 6 : 4), min_height: px(id === 'hero' ? 225 : id === 'header' ? 28 : 220) });
      const imageUrls = [...new Set(Object.values(packets).flatMap(packet => packet.blocks.find(block => block.id === id)?.carousels?.[0]?.slides?.[index]?.images?.map(image => image.url) ?? []))];
      const media = box(`${id}-slide-${index + 1}-media`, [], { width: percent(id === 'hero' ? 50 : 100), width_mobile: percent(100) });
      for (const url of imageUrls) addImage(media, url);
      if (media.children.length) slide.children.push(media);
      const copy = box(`${id}-slide-${index + 1}-copy`, [], { width: percent(id === 'hero' ? 50 : 100), width_mobile: percent(100), flex_align_items: 'center', flex_gap: gap(5) });
      for (const packet of Object.values(packets)) for (const atom of packet.blocks.find(block => block.id === id)?.carousels?.[0]?.slides?.[index]?.atoms ?? []) addText(copy, atom);
      slide.children.push(copy);
      carousel.children.push(slide);
    }
    carousel.settings.carousel_items = carousel.children.map((_, index) => ({ _id: sha(`${id}:${index}`).slice(0, 7), slide_title: `Source item ${index + 1}` }));
    for (const entry of source.texts) if (!mountedText.has(entry.id) && !dynamicText.has(entry.id)) { content.children.push(nodeByTextId.get(entry.id)); mountedText.add(entry.id); }
    content.children.push(carousel);
    for (const assetKey of source.assets) if (!mountedAssets.has(assetKey)) { const asset = manifest.assets.find(row => row.key === assetKey); if (asset) addImage(content, asset.sourceUrl); }
  } else if (source.dynamicData) {
    for (const assetKey of source.assets) if (!dynamicAssets.has(assetKey)) { const asset = manifest.assets.find(row => row.key === assetKey); if (asset) addImage(content, asset.sourceUrl); }
    for (const entry of source.texts) if (!dynamicText.has(entry.id)) { content.children.push(nodeByTextId.get(entry.id)); mountedText.add(entry.id); }
    const count = source.dynamicData.items.length;
    const widget = { key: `${id}-carousel`, type: 'wd_products', settings: { layout: 'carousel', post_type: 'product', orderby: 'date', order: 'DESC', offset: '0', items_per_page: count, slides_per_view: px(5), slides_per_view_tablet: px(3), slides_per_view_mobile: px(1), spacing: '10', spacing_tablet: '10', spacing_mobile: '10', scroll_per_page: 'no', wrap: 'yes', autoplay: 'no', hide_prev_next_buttons: 'no', hide_pagination_control: 'no', product_hover: 'icons' } };
    content.children.push(widget);
  } else {
    const headings = source.texts.filter(entry => entry.kind === 'heading');
    for (const entry of headings) { content.children.push(nodeByTextId.get(entry.id)); mountedText.add(entry.id); }
    const staticAssets = source.assets.filter(key => !dynamicAssets.has(key));
    const otherTexts = source.texts.filter(entry => !mountedText.has(entry.id) && !dynamicText.has(entry.id));
    if (['deals-by-pet', 'shop-way', 'services', 'bogo'].includes(id)) {
      const columns = id === 'deals-by-pet' ? 6 : 4;
      const row = box(`${id}-cards`, [], { flex_direction: 'row', flex_wrap: 'wrap', flex_gap: gap(8), flex_justify_content: 'center' });
      for (let index = 0; index < staticAssets.length; index++) {
        const card = box(`${id}-card-${index + 1}`, [], { width: percent(100 / columns - 1), width_mobile: percent(id === 'deals-by-pet' ? 31 : 47), flex_align_items: 'center', flex_gap: gap(6) });
        const asset = manifest.assets.find(row => row.key === staticAssets[index]); if (asset) addImage(card, asset.sourceUrl);
        if (otherTexts[index]) { card.children.push(nodeByTextId.get(otherTexts[index].id)); mountedText.add(otherTexts[index].id); }
        row.children.push(card);
      }
      content.children.push(row);
    } else if (id === 'promo') {
      const row = box(`${id}-row`, [], { flex_direction: 'row', flex_direction_mobile: 'column', flex_align_items: 'center', background_background: 'classic', background_color: '#3F748D' });
      const media = box(`${id}-media`, [], { width: percent(50), width_mobile: percent(100) });
      for (const assetKey of staticAssets) { const asset = manifest.assets.find(row => row.key === assetKey); if (asset) addImage(media, asset.sourceUrl); }
      const copy = box(`${id}-copy`, [], { width: percent(50), width_mobile: percent(100), flex_align_items: 'center' });
      for (const entry of otherTexts) { copy.children.push(nodeByTextId.get(entry.id)); mountedText.add(entry.id); }
      row.children.push(media, copy); content.children.push(row);
    } else {
      const row = box(`${id}-media-grid`, [], { flex_direction: 'row', flex_wrap: 'wrap', flex_gap: gap(8) });
      for (const assetKey of staticAssets) { const asset = manifest.assets.find(row => row.key === assetKey); if (asset) { const cell = box(`${id}-media-cell-${row.children.length + 1}`, [], { width: percent(id === 'footer' ? 18 : id === 'header' ? 24 : 25), width_mobile: percent(id === 'footer' ? 30 : 50) }); addImage(cell, asset.sourceUrl); row.children.push(cell); } }
      if (id === 'header') content.children.push(row);
      const copy = box(`${id}-copy`, [], { flex_direction: id === 'footer' ? 'row' : 'column', flex_wrap: 'wrap', flex_gap: gap(id === 'footer' ? 10 : 3) });
      for (const entry of otherTexts) { const widget = nodeByTextId.get(entry.id); if (id === 'footer') widget.settings._element_width = 'initial'; copy.children.push(widget); mountedText.add(entry.id); }
      content.children.push(copy);
      if (id !== 'header') content.children.push(row);
    }
    for (const entry of source.texts) if (!mountedText.has(entry.id) && !dynamicText.has(entry.id)) { content.children.push(nodeByTextId.get(entry.id)); mountedText.add(entry.id); }
    for (const assetKey of source.assets) if (!mountedAssets.has(assetKey)) { const asset = manifest.assets.find(row => row.key === assetKey); if (asset) addImage(content, asset.sourceUrl); }
  }
  const bindings = source.texts.filter(entry => !dynamicText.has(entry.id)).map(entry => ({ sourceTextId: entry.id, elementKey: entry.id, settingPath: 'title' }));
  const programBlock = { sourceBlockId: id, rootKey: root.key, presentation: source.presentation, contentBindings: Object.fromEntries(Object.keys(source.contentBounds ?? {}).map(viewport => [viewport, content.key])), bindings, states: source.states };
  if (source.dynamicData) programBlock.productQuery = { provider: 'target-woocommerce', widgetKey: `${id}-carousel`, widgetType: 'wd_products', sourceTextIds: source.dynamicData.replaceableTextIds, sourceAssetKeys: source.dynamicData.replaceableAssetKeys, queryControlKeys: ['post_type', 'orderby', 'order', 'offset', 'items_per_page'], styleBindings: { nameSourceTextIds: source.texts.filter(entry => dynamicText.has(entry.id) && entry.kind === 'product-name').map(entry => entry.id), priceSourceTextIds: source.texts.filter(entry => dynamicText.has(entry.id) && entry.kind === 'price').map(entry => entry.id) }, carouselMode: { control: 'layout', value: 'carousel' }, evidence: ['desktop-json'] };
  nativeElements.push(root); programBlocks.push(programBlock);
}
deviations.push({ blockId: 'hero', category: 'behavior', reason: 'Source autoplay toggle changed its live state, while registered native carousel pause control still requires actual target verification.', evidence: ['hero-interaction'] });
const program = { version: 1, workflow: 'block-replication', title: 'Pet Supermarket homepage replica', sourceUrl: contract.sourceUrl, sourceContract: { path: path.join(job, 'block-contract.json'), sha256: await hashFile('block-contract.json') }, assetsManifest: { path: path.join(job, 'asset-manifest.json'), sha256: await hashFile('asset-manifest.json') }, elements: nativeElements, blocks: programBlocks, deviations };
await writeFile(path.join(job, 'program.json'), JSON.stringify(program, null, 2));
console.log(JSON.stringify({ job, blocks: nativeElements.length, nodes: JSON.stringify(program).match(/"type"/g)?.length, media: nativeElements.flatMap(root => JSON.stringify(root).match(/\$asset/g) ?? []).length, boundTexts: programBlocks.reduce((n, block) => n + block.bindings.length, 0) }));
