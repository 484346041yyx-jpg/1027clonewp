import { readFile, writeFile, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const job = path.resolve(process.argv[2] ?? '');
if (!job.toLowerCase().startsWith('d:\\clonewp\\references\\')) throw new Error('Current replica job required');
const read = async name => JSON.parse(await readFile(path.join(job, name), 'utf8'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const fileHash = async filename => hash(await readFile(filename));
const packets = Object.fromEntries(await Promise.all(['desktop', 'tablet', 'mobile'].map(async name => [name, await read(`reference/${name}.json`)])));
const report = await read('reference/report.json');
const manifest = await read('asset-manifest.json');
const supplement = await read('supplemental-asset-evidence.json');
const imageByUrl = new Map(manifest.assets.map(asset => [asset.sourceUrl, asset]));
const unsupportedSvg = new Set(supplement.assets.map(asset => asset.sourceUrl));
for (const viewport of Object.values(packets)) for (const block of viewport.blocks) for (const image of block.images ?? []) {
  const asset = imageByUrl.get(image.url);
  if (asset && !asset.alt && image.alt) asset.alt = String(image.alt).slice(0, 2000);
}
await writeFile(path.join(job, 'asset-manifest.json'), JSON.stringify(manifest, null, 2));
const interactionFile = path.join(job, 'source-hero-interaction.json');
await copyFile('D:/cloneWP/references/reference-2026-10-15T01-17-25-891Z-www-petsupermarket-com-c40dfc59/browser-observation/desktop-raw.json', interactionFile);
const evidence = [];
for (const name of ['desktop', 'tablet', 'mobile']) for (const [ext, kind] of [['json', 'observation'], ['html', 'dom'], ['jpg', 'screenshot']]) {
  const filename = ext === 'jpg' ? path.basename(report.viewports.find(viewport => viewport.name === name).screenshotPath) : `${name}.${ext}`;
  const file = path.join(job, 'reference', filename);
  evidence.push({ id: `${name}-${ext}`, path: file, sha256: await fileHash(file), kind });
}
evidence.push({ id: 'hero-interaction', path: interactionFile, sha256: await fileHash(interactionFile), kind: 'interaction' });
const normal = status => ({ status, evidence: status === 'observed' ? ['desktop-json'] : [], ...(status === 'unobserved' ? { note: 'This source state was not observed in the connected browser.' } : {}) });
const dynamicBlocks = new Set(['halloween-products', 'fall-products']);
const presentation = block => dynamicBlocks.has(block.id) || block.carousels?.some(carousel => carousel.slides?.length > 1) ? 'carousel' : ['deals-by-pet', 'bogo', 'shop-way', 'services'].includes(block.id) ? 'grid' : 'static';
const blocks = [];
for (const source of packets.desktop.blocks) {
  const allAtoms = new Map();
  for (const viewport of Object.values(packets)) for (const atom of viewport.blocks.find(block => block.id === source.id)?.textAtoms ?? []) {
    if (!atom.text?.trim()) continue;
    const identity = `${atom.selector}\u0000${atom.text}`;
    if (!allAtoms.has(identity)) allAtoms.set(identity, atom);
  }
  const idsByIdentity = new Map();
  const texts = [...allAtoms].map(([identity, atom], index) => {
    const id = `${source.id}-t${index + 1}`; idsByIdentity.set(identity, id);
    let kind = /^h[1-6]$/i.test(atom.tag ?? '') ? 'heading' : atom.tag === 'a' ? 'navigation' : 'body';
    if (dynamicBlocks.has(source.id) && /^\$\s*\d/.test(atom.text)) kind = 'price';
    else if (dynamicBlocks.has(source.id) && atom.text.length > 20 && !/buy |get |off |free /i.test(atom.text)) kind = 'product-name';
    return { id, text: atom.text, kind };
  });
  const assetUrls = [...new Set(Object.values(packets).flatMap(viewport => viewport.blocks.find(block => block.id === source.id)?.images?.map(image => image.url) ?? []))].filter(url => !/\/images\/icons\/(?:carousel|product)\//.test(url));
  const assets = assetUrls.map(url => imageByUrl.get(url)?.key).filter(Boolean);
  const geometry = {}, contentBounds = {};
  for (const [name, viewport] of Object.entries(packets)) {
    const observed = viewport.blocks.find(block => block.id === source.id), box = observed.rect, width = viewport.observedPage.viewport.width;
    geometry[name] = { width: box.width, height: box.height };
    const candidate = observed.contentLayout?.contentFrames?.find(frame => observed.contentLayout.preferredFrameSelectors?.includes(frame.selector) && frame.contentRect && frame.contentRect.y >= box.y - 2 && frame.contentRect.y + frame.contentRect.height <= box.y + box.height + 2 && frame.contentRect.width <= box.width + 2);
    const inner = candidate?.contentRect ?? box;
    contentBounds[name] = { x: inner.x, width: inner.width, viewportWidth: width, sourceNodeId: candidate?.selector ?? observed.selectors?.[0] ?? source.id, evidence: [`${name}-json`] };
  }
  const colors = {};
  if (source.style?.['background-color']) colors.background = source.style['background-color'];
  if (source.textAtoms?.find(atom => atom.style?.color)?.style?.color) colors.text = source.textAtoms.find(atom => atom.style?.color).style.color;
  const states = { normal: normal('observed'), hover: normal('unobserved'), interaction: normal('unobserved') };
  if (source.id === 'hero') states.interaction = { status: 'observed', evidence: ['hero-interaction'], properties: { nextAdvances: true, autoplayToggle: true } };
  const role = dynamicBlocks.has(source.id) ? 'products' : source.role;
  const frozen = { id: source.id, role, presentation: presentation(source), texts, assets, evidence: ['desktop-json', 'tablet-json', 'mobile-json'], geometry, contentBounds, colors, states };
  if (dynamicBlocks.has(source.id)) {
    frozen.requiredWidgetTypes = ['wd_products'];
    const slides = source.carousels?.[0]?.slides ?? [];
    const items = slides.map(slide => {
      const textIds = (slide.atoms ?? []).map(atom => idsByIdentity.get(`${atom.selector}\u0000${atom.text}`)).filter(Boolean);
      const assetKeys = [...new Set((slide.images ?? []).map(image => imageByUrl.get(image.url)?.key).filter(Boolean))];
      return { sourceNodeId: slide.selector, textIds: [...new Set(textIds)], assetKeys, evidence: ['desktop-json'] };
    }).filter(item => item.sourceNodeId && item.textIds.length && item.assetKeys.length);
    frozen.dynamicData = { provider: 'target-woocommerce', kind: 'product-list', replaceableTextIds: items.flatMap(item => item.textIds), replaceableAssetKeys: [...new Set(items.flatMap(item => item.assetKeys))], items, evidence: ['desktop-json'] };
  } else if (frozen.presentation === 'carousel') frozen.requiredWidgetTypes = ['nested-carousel'];
  blocks.push(frozen);
}
const sourceSceneBindings = [];
for (const [viewportName, packet] of Object.entries(packets)) for (const item of packet.sceneInventory?.items ?? []) {
  const id = item.sourceBlockId;
  if (!id || !blocks.some(block => block.id === id)) continue;
  const block = blocks.find(block => block.id === id);
  const targetKey = item.kind === 'block' ? `${id}-root` : item.kind === 'content-frame' ? `${id}-content` : item.kind === 'control' || item.kind === 'control-group' ? `${id}-${block.presentation === 'carousel' ? 'carousel' : 'content'}` : `${id}-${block.presentation === 'carousel' ? 'carousel' : 'content'}`;
  sourceSceneBindings.push({ viewport: viewportName, sourceId: item.id, blockId: id, targetKey, requirement: item.kind, state: item.state });
}
const limitations = [
  'The connected browser provided resized viewports but no touch device emulation or touch interaction proof.',
  'Hover, most carousel switching, autoplay timing and responsive breakpoint transitions remain unobserved.',
  'The independent source scene inventory reports unresolved content/control ownership and global overlay controls; these are not counted as passed.',
  'Source carousel/product arrow SVGs are retained as byte evidence; native arrow controls need direct visual verification before their icon appearance can pass.',
  `${unsupportedSvg.size} public SVG originals are byte preserved separately; native media candidates are visibly derived PNG rasterizations with original SHA-256 provenance.`,
];
const contract = { version: 1, workflow: 'block-replication', sourceUrl: report.url, capturedAt: new Date().toISOString(), referenceReport: { path: path.join(job, 'reference', 'report.json'), sha256: await fileHash(path.join(job, 'reference', 'report.json')) }, evidence, tolerances: { geometryPx: 8, geometryRatio: 0.04, colorChannel: 8 }, sourceSceneBindings, blocks, limitations };
await writeFile(path.join(job, 'block-contract.json'), JSON.stringify(contract, null, 2));
console.log(JSON.stringify({ job, blocks: blocks.length, texts: blocks.reduce((n, block) => n + block.texts.length, 0), assets: manifest.assets.length, sceneBindings: sourceSceneBindings.length, dynamicItems: blocks.filter(block => block.dynamicData).map(block => [block.id, block.dynamicData.items.length]) }));
