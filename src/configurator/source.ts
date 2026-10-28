import { createHash } from 'node:crypto';
import { copyFile, lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'parse5';
import sharp from 'sharp';
import type { Catalog } from './contract.js';
import type { Native44Asset } from '../native44/media.js';

type AssetRef = { $asset: string };
type Unbound<T> = T extends { id: number; url: string } ? AssetRef : T extends Array<infer U> ? Unbound<U>[] : T extends object ? { [P in keyof T]: Unbound<T[P]> } : T;
export type ConfiguratorSourceCatalog = Omit<Unbound<Catalog>, 'form'> & { form: { $nativeFormBinding: true } };
interface DomNode { nodeName: string; tagName?: string; value?: string; attrs?: Array<{ name: string; value: string }>; childNodes?: DomNode[]; parentNode?: DomNode }
interface SourceItem { id: string; label: string; image: string; thumbnail: string; attributes: Record<string, string> | []; ancestors: string[] }
interface SourceMetadata { url: string; observedAt: string; body: string; fonts: Array<{ label: string; value: string }>; items: SourceItem[] }
interface BundledAsset { id: string; kind: string; name: string; path: string; url: string; contentType: string | null }
interface Rect { x: number; y: number; width: number; height: number }
interface Packet { snapshot: { id: string; viewport: unknown }; nodes: Record<string, { id: string; attributes: Record<string, string>; layoutId: string; styleId: string }>; layouts: Record<string, { rect: Rect }>; styles: Record<string, Record<string, string>> }
export interface ConfiguratorSourceOptions { projectRoot: string; metadataPath: string; observationPath: string; assetDirectory: string }
const sha256 = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
const attr = (node: DomNode, key: string) => node.attrs?.find(a => a.name === key)?.value ?? '';
const classes = (node: DomNode) => attr(node, 'class').split(/\s+/).filter(Boolean);
const hasClass = (node: DomNode, name: string) => classes(node).includes(name);
const all = (node: DomNode): DomNode[] => [node, ...(node.childNodes ?? []).flatMap(all)];
const text = (node: DomNode): string => node.nodeName === '#text' ? node.value ?? '' : (node.childNodes ?? []).map(text).join('');
const normalizedText = (node: DomNode) => text(node).replace(/\s+/g, ' ').trim();
function owner(node: DomNode, className: string) { let current: DomNode | undefined = node; while (current && !hasClass(current, className)) current = current.parentNode; return current; }
function sourceUrl(value: string, base: string) {
  // The source's `img` data attribute uses //u_file as a site-relative value; the actual observed image src confirms /u_file.
  const url = new URL(value.startsWith('//u_file/') ? value.slice(1) : value, base);
  if (url.protocol !== 'https:' || url.username || url.password || /(?:token|nonce|secret|password|signature)=/i.test(url.search)) throw Error('configurator_source_public_asset_required');
  return url.href;
}
async function boundedFile(root: string, filename: string) {
  const absolute = await realpath(filename), relative = path.relative(root, absolute);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw Error('configurator_source_path');
  return { path: absolute, bytes: await readFile(absolute) };
}
function rectFor(packet: Packet, className: string): Rect {
  const nodes = Object.values(packet.nodes).filter(n => (n.attributes.class ?? '').split(/\s+/).includes(className));
  if (nodes.length !== 1 || !packet.layouts[nodes[0].layoutId]?.rect.width) throw Error(`configurator_source_geometry_${className}`);
  return packet.layouts[nodes[0].layoutId].rect;
}

/** Literal font URLs found in the saved source stylesheets; a declaration is not proof of downloaded font bytes. */
export async function readDeclaredConfiguratorFontSources(options: ConfiguratorSourceOptions) {
  const root = await realpath(options.projectRoot), metadataFile = await boundedFile(root, options.metadataPath);
  const metadata = JSON.parse(metadataFile.bytes.toString('utf8')) as SourceMetadata;
  const manifest = JSON.parse((await boundedFile(root, path.join(options.assetDirectory, 'manifest.json'))).bytes.toString('utf8')) as { assets: BundledAsset[] };
  const families = new Set(metadata.fonts.filter(font => font.value).map(font => font.value));
  const declarations: Array<{ family: string; url: string; format: string; cssEvidence: { path: string; sha256: string; sourceUrl: string } }> = [];
  for (const stylesheet of manifest.assets.filter(asset => asset.kind === 'stylesheet')) {
    const file = await boundedFile(root, path.join(options.assetDirectory, path.win32.basename(stylesheet.path.replace(/\//g, '\\'))));
    const css = file.bytes.toString('utf8');
    for (const match of css.matchAll(/@font-face\s*\{([^}]+)\}/gi)) {
      const family = match[1].match(/font-family\s*:\s*['"]?([^;'"\n]+)['"]?\s*;/i)?.[1].trim(); if (!family || !families.has(family)) continue;
      for (const resource of match[1].matchAll(/url\(\s*['"]?([^)'"\s]+)['"]?\s*\)\s*format\(\s*['"]?([^)'"\s]+)['"]?\s*\)/gi)) {
        const url = sourceUrl(resource[1], stylesheet.url), format = resource[2].toLowerCase();
        if (!declarations.some(row => row.family === family && row.url === url)) declarations.push({ family, url, format, cssEvidence: { path: file.path, sha256: sha256(file.bytes), sourceUrl: stylesheet.url } });
      }
    }
  }
  return { version: 1, kind: 'clonewp-configurator-declared-font-sources', sourceUrl: metadata.url, status: 'declared-not-downloaded', declarations,
    preferredTrueType: declarations.filter(row => row.format === 'truetype'),
    missingDeclarations: [...families].filter(family => family !== 'Arial' && !declarations.some(row => row.family === family)) };
}

/** Preserve source facts and produce media-key references. No target IDs or remote writes are created here. */
export async function buildConfiguratorSourceMaterials(options: ConfiguratorSourceOptions) {
  const root = await realpath(options.projectRoot), metadataFile = await boundedFile(root, options.metadataPath), packetFile = await boundedFile(root, options.observationPath);
  const manifestFile = await boundedFile(root, path.join(options.assetDirectory, 'manifest.json'));
  const metadata = JSON.parse(metadataFile.bytes.toString('utf8')) as SourceMetadata;
  const packet = JSON.parse(packetFile.bytes.toString('utf8')) as Packet;
  const bundle = JSON.parse(manifestFile.bytes.toString('utf8')) as { assets: BundledAsset[] };
  const pageUrl = sourceUrl(metadata.url, metadata.url), document = parse(metadata.body) as unknown as DomNode, nodes = all(document);
  const itemNodes = nodes.filter(n => hasClass(n, 'custom_result_item'));
  if (itemNodes.length !== metadata.items.length || new Set(metadata.items.map(i => i.id)).size !== metadata.items.length) throw Error('configurator_source_item_identity');
  const evidence = { metadata: { path: metadataFile.path, sha256: sha256(metadataFile.bytes) }, observation: { path: packetFile.path, sha256: sha256(packetFile.bytes) }, sourceAssets: { path: manifestFile.path, sha256: sha256(manifestFile.bytes) } };
  const bundleByUrl = new Map<string, BundledAsset[]>();
  for (const entry of bundle.assets) { if (entry.url.startsWith('inline-svg:')) continue; const url = sourceUrl(entry.url, pageUrl); bundleByUrl.set(url, [...bundleByUrl.get(url) ?? [], entry]); }
  const materialAssets: Array<Native44Asset & { absoluteSourcePath: string; bytes: number; width?: number; height?: number; role: 'image' | 'font'; sourceBundleId: string }> = [];
  const gaps: Array<{ code: string; message: string; itemIds?: string[] }> = [];
  const addAsset = async (key: string, url: string, alt: string, role: 'image' | 'font' = 'image'): Promise<AssetRef> => {
    const normalized = sourceUrl(url, pageUrl), entries = bundleByUrl.get(normalized);
    if (!entries?.length) throw Error(`configurator_source_asset_missing:${normalized}`);
    const entry = entries[0], basename = path.win32.basename(entry.path.replace(/\//g, '\\'));
    if (!/^[a-f0-9]{16}\.[a-z0-9]+$/i.test(basename)) throw Error('configurator_source_asset_filename');
    const local = await boundedFile(root, path.join(options.assetDirectory, basename));
    let mediaType = entry.contentType ?? '', width: number | undefined, height: number | undefined;
    if (role === 'image') { const details = await sharp(local.bytes).metadata(); width = details.width; height = details.height; const formats: Record<string, string> = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif', svg: 'image/svg+xml' }; mediaType = formats[details.format ?? ''] ?? ''; if (!mediaType || !width || !height) throw Error('configurator_source_image_bytes'); }
    else if (local.bytes.subarray(0, 4).toString() === 'wOF2') mediaType = 'font/woff2';
    else throw Error('configurator_source_font_bytes');
    const row = { key, localPath: `assets/${basename}`, sourceUrl: normalized, sha256: sha256(local.bytes), mediaType, alt, absoluteSourcePath: local.path, bytes: local.bytes.length, ...(width ? { width, height } : {}), role, sourceBundleId: entry.id };
    const prior = materialAssets.find(a => a.key === key); if (prior && prior.sha256 !== row.sha256) throw Error('configurator_source_asset_key'); if (!prior) materialAssets.push(row);
    return { $asset: key };
  };
  const prepared: Array<{ item: SourceItem; node: DomNode; part: 'bottles' | 'pumps' | 'caps' | 'decorations'; image: AssetRef; width: number; height: number; category?: string }> = [];
  for (const item of metadata.items) {
    const matches = itemNodes.filter(n => attr(n, 'proid') === item.id); if (matches.length !== 1) throw Error('configurator_source_dom_item');
    const node = matches[0], step = owner(node, 'custom_step_item'), stepNumber = step && attr(step, 'data');
    const part = ({ '1': 'bottles', '2': 'pumps', '3': 'caps', '5': 'decorations' } as const)[stepNumber as '1' | '2' | '3' | '5']; if (!part) throw Error('configurator_source_step');
    const image = await addAsset(`reference-${part}-${item.id}`, item.thumbnail, item.label), material = materialAssets.find(a => a.key === image.$asset)!;
    const group = owner(node, 'custom_step_group'), category = group && all(group).find(n => hasClass(n, 'custom_filter_key'));
    prepared.push({ item, node, part, image, width: material.width!, height: material.height!, ...(category ? { category: normalizedText(category) } : {}) });
  }
  const counts = Object.fromEntries((['bottles', 'pumps', 'caps', 'decorations'] as const).map(part => [part, prepared.filter(p => p.part === part).length]));
  const canvas = rectFor(packet, 'custom_rendering_canvas');
  const layer = (name: string) => { const found = Object.values(packet.nodes).find(n => (n.attributes.class ?? '') === `img ${name}`); if (!found) throw Error(`configurator_source_layer_${name}`); return { nodeId: found.id, rect: packet.layouts[found.layoutId].rect, style: packet.styles[found.styleId] }; };
  const originalLayers = { bottles: layer('bottle'), pumps: layer('pump_collar'), caps: layer('cap') };
  const referenceWidth = canvas.width, maximumBottleHeight = Math.max(...prepared.filter(p => p.part === 'bottles').map(p => p.height * referenceWidth / p.width));
  const capHeight = originalLayers.caps.rect.height, pumpHeight = originalLayers.pumps.rect.height;
  const bottleOffsetY = originalLayers.bottles.rect.y - canvas.y;
  const fallbackHeight = Math.max(capHeight, pumpHeight) + Math.max(maximumBottleHeight + bottleOffsetY, canvas.height);
  const percent = (number: number) => Number(number.toFixed(6));
  const position = (part: 'bottles' | 'pumps' | 'caps', width: number, height: number) => ({ x: 0, y: percent((capHeight + (part === 'bottles' ? bottleOffsetY : -height * referenceWidth / width)) / fallbackHeight * 100), width: 100, height: percent(height * referenceWidth / width / fallbackHeight * 100) });
  const catalog: ConfiguratorSourceCatalog = { version: 1, title: normalizedText(nodes.find(n => hasClass(n, 'custom_title')) ?? document), bottles: [], pumps: [], caps: [], decorations: [], fonts: [],
    logoArea: { x: 0, y: percent(capHeight / fallbackHeight * 100), width: 100, height: percent((fallbackHeight - capHeight) / fallbackHeight * 100) },
    previewLayout: { mode: 'natural-stack', width: 400, minHeight: 364, outerPaddingTop: 220, bottleOffsetY: -32, capAndPumpAnchor: 'bottom:100%', mobile: { breakpoint: 991, minHeight: 237, outerPaddingTop: 135, bottleOffsetY: -20, previewLabel: 'View Renderings' } },
    form: { $nativeFormBinding: true } };
  const sourceOptions: Array<Record<string, unknown>> = [];
  for (const row of prepared) {
    const { item, part } = row;
    if (part === 'decorations') {
      const category = row.category; if (!category) throw Error('configurator_source_decoration_category');
      const values = Object.values(item.attributes), finish = values[0] || category;
      catalog.decorations.push({ id: `source-${item.id}`, label: item.label, image: row.image, category, finish, overlays: [] });
    } else catalog[part].push({ id: `source-${item.id}`, label: item.label, image: row.image, preview: row.image, position: position(part, row.width, row.height), attributes: Array.isArray(item.attributes) ? {} : { ...item.attributes }, fit: ['visual-only'] });
    sourceOptions.push({ id: `source-${item.id}`, sourceProductId: item.id, part, label: item.label, thumbnailUrl: sourceUrl(item.thumbnail, pageUrl), previewSourceUrl: sourceUrl(item.image, pageUrl), selectedAsset: row.image, naturalWidth: row.width, naturalHeight: row.height, attributes: item.attributes, ...(row.category ? { decorationCategory: row.category } : {}), classificationEvidence: { step: attr(owner(row.node, 'custom_step_item')!, 'data'), ...(row.category ? { groupFilterLabel: row.category } : {}) } });
  }
  const placeholders = {} as NonNullable<ConfiguratorSourceCatalog['placeholders']>;
  for (const [part, sourceClass] of [['bottles', 'bottle'], ['pumps', 'pump_collar'], ['caps', 'cap']] as const) {
    const mediaNode = nodes.find(n => hasClass(n, 'img') && hasClass(n, sourceClass)); const imageNode = mediaNode && all(mediaNode).find(n => n.tagName === 'img');
    const original = imageNode && attr(imageNode, 'original'); if (!original) throw Error(`configurator_source_placeholder_${part}`);
    const image = await addAsset(`reference-placeholder-${part}`, original, `Unselected ${part}`), asset = materialAssets.find(a => a.key === image.$asset)!;
    placeholders[part] = { image, position: position(part, asset.width!, asset.height!) };
  }
  catalog.placeholders = placeholders;
  const sourceColors = nodes.filter(n => hasClass(n, 'custom_color_item')).map(n => attr(n, 'data')).filter(Boolean);
  const expandColor = (value: string) => /^#[a-fA-F0-9]{3}$/.test(value) ? `#${[...value.slice(1)].map(char => char + char).join('')}` : value;
  if (sourceColors.length) catalog.logoColors = [...new Set(sourceColors.map(expandColor))].map(value => ({ label: value.toUpperCase(), value }));
  const fontMaterials: Array<{ id: string; label: string; family: string; available: boolean; asset?: AssetRef }> = [];
  for (const font of metadata.fonts.filter(f => f.value)) {
    const id = font.value.toLowerCase().replace(/[^a-z0-9_-]/g, '-'), asset = bundle.assets.find(a => a.kind === 'font' && a.url.includes(`/fonts/${encodeURIComponent(font.value)}/`));
    catalog.fonts.push({ id, label: font.label, family: font.value });
    fontMaterials.push({ id, label: font.label, family: font.value, available: font.value === 'Arial' || !!asset, ...(asset ? { asset: await addAsset(`reference-font-${id}`, asset.url, font.label, 'font') } : {}) });
  }
  const filters = nodes.filter(n => hasClass(n, 'custom_filter_item')).map(n => { const key = all(n).find(k => hasClass(k, 'custom_filter_key')); return { step: attr(owner(n, 'custom_step_item')!, 'data'), label: key ? normalizedText(key) : '', options: all(n).filter(o => hasClass(o, 'custom_filter_opt')).map(o => ({ label: normalizedText(o), data: attr(o, 'data'), selected: hasClass(o, 'selected') })) }; });
  const quoteForm = nodes.find(n => hasClass(n, 'custom_pop_form'));
  const quoteFields = quoteForm ? all(quoteForm).filter(n => ['input', 'textarea', 'select'].includes(n.tagName ?? '')).map(n => ({ tag: n.tagName, name: attr(n, 'name'), type: attr(n, 'type') || (n.tagName === 'textarea' ? 'textarea' : ''), placeholder: attr(n, 'placeholder'), required: !!n.attrs?.some(a => a.name === 'notnull' || a.name === 'required'), ...(attr(n, 'type') === 'submit' ? { label: attr(n, 'value') } : {}) })) : [];
  const missingFonts = fontMaterials.filter(f => !f.available).map(f => f.family);
  gaps.push({ code: 'physical-fit-unverified', message: 'All source choices use an explicit visual-only fit group for non-contractual preview; no physical compatibility, dimensions or manufacturing guarantees are inferred.' });
  gaps.push({ code: 'natural-layout-required', message: 'Percent rectangles are measured editable fallback coordinates in a shared max-image frame. Source-faithful combinations require natural-layer layout: width400; canvas min-height364; bottle translateY(-32); cap/pump bottom100%; outer top padding220. A fixed 4:5 stage is not equivalent.' });
  gaps.push({ code: 'decoration-samples-only', message: 'All33 decoration assets are112×112 sample images. No bottle-specific coating overlay was observed or fabricated.' });
  gaps.push({ code: 'source-preview-derivative', message: 'Preview media currently uses the already-observed CDN format-WebP derivative of each source product image. The original preview URL and natural image dimensions are retained for every option.' });
  if (missingFonts.length) gaps.push({ code: 'font-bytes-missing', message: `Source font options without downloaded bytes: ${missingFonts.join(', ')}.` });
  if (fontMaterials.some(f => f.asset)) gaps.push({ code: 'font-conversion-required', message: 'Three downloaded source fonts are verified WOFF2 files. The existing source-font importer requires explicit verified TTF conversion; no conversion was performed here.' });
  gaps.push({ code: 'mobile-and-interaction-unverified', message: 'This output is based on the preserved desktop snapshot and earlier metadata. Remaining desktop/phone views and source interactions still require central current-browser evidence.' });
  return { version: 1 as const, kind: 'clonewp-configurator-source-materials' as const, sourceUrl: pageUrl, sourceObservedAt: metadata.observedAt, snapshotId: packet.snapshot.id, evidence, counts, catalogTemplate: catalog,
    requiredImageKeys: materialAssets.filter(a => a.role === 'image').map(a => a.key),
    assets: materialAssets,
    nativeImageManifest: materialAssets.filter(a => a.role === 'image').map(({ key, localPath, sourceUrl, sha256, mediaType, alt }) => ({ key, localPath, sourceUrl, sha256, mediaType, alt })),
    fonts: fontMaterials, sourceOptions, filters, quoteFields,
    sourceGeometry: { sourceViewport: packet.snapshot.viewport, referenceWidth, canvas, originalLayers, naturalLayerRules: { minCanvasHeight: 364, bottleOffsetY, capAndPumpAnchor: 'bottom:100%', outerPaddingTop: 220, sourceCss: 'custom.css:90-101' }, fallbackFrame: { width: referenceWidth, height: fallbackHeight, explanation: 'measured maximum bottle extent; does not replace natural source layout' } },
    gaps, status: 'source-preparation-not-qualified' as const };
}

/** Writes only a caller-selected task material directory inside the workspace; existing differing outputs fail. */
export async function writeConfiguratorSourceMaterials(options: ConfiguratorSourceOptions & { outputDirectory: string }) {
  const result = await buildConfiguratorSourceMaterials(options), root = await realpath(options.projectRoot), output = path.resolve(options.outputDirectory), relative = path.relative(root, output);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw Error('configurator_material_output_path');
  let ancestor = output;
  while (ancestor !== path.dirname(ancestor)) {
    try { if ((await lstat(ancestor)).isSymbolicLink()) throw Error('configurator_material_output_reparse'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    if (ancestor === root) break;
    ancestor = path.dirname(ancestor);
  }
  await mkdir(path.join(output, 'assets'), { recursive: true });
  for (const asset of result.assets) {
    const destination = path.join(output, asset.localPath);
    try { const prior = await readFile(destination); if (sha256(prior) !== asset.sha256) throw Error('configurator_material_existing_asset_changed'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; await copyFile(asset.absoluteSourcePath, destination); }
  }
  const declaredFonts = await readDeclaredConfiguratorFontSources(options);
  const outputs: Record<string, unknown> = { 'source-materials.json': result, 'catalog-unbound.json': result.catalogTemplate, 'native-images.json': result.nativeImageManifest, 'font-sources.json': declaredFonts };
  for (const [name, value] of Object.entries(outputs)) {
    const bytes = JSON.stringify(value, null, 2) + '\n', filename = path.join(output, name);
    try { if ((await readFile(filename, 'utf8')) !== bytes) throw Error('configurator_material_existing_output_changed'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; await writeFile(filename, bytes, { flag: 'wx' }); }
  }
  const report = `# Source material preparation\n\nSource: ${result.sourceUrl}\nSnapshot: ${result.snapshotId}\n\nCounts: ${JSON.stringify(result.counts)}\n\nCatalog media use {$asset:key}; no target attachment IDs are assigned. Native image manifest paths are relative to this material directory. Native Form binding remains unresolved.\n\n## Observed gaps\n\n${result.gaps.map(g => `- **${g.code}**: ${g.message}`).join('\n')}\n\n## Declared font alternatives\n\nfont-sources.json preserves ${declaredFonts.declarations.length} actual saved CSS declarations with stylesheet SHA256 evidence. Six custom font families have explicit TTF URLs, which may be downloaded and byte-validated by the coordinator before existing source-font import. PlayfairDisplay-Regular has no saved TTF declaration and still requires verified conversion from the downloaded WOFF2 or new source proof. A declaration is not proof of available bytes.\n`;
  await writeFile(path.join(output, 'REPORT.md'), report);
  return result;
}
