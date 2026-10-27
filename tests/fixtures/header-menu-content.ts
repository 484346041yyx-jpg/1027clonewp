import path from 'node:path';
import { mkdir, rm, realpath, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { buildSourceFactsV2 } from '../../src/replica-v2/source.js';
import { validateObservationPacketV2 } from '../../src/replica-v2/observation.js';
import { native44KnowledgeIdentity } from '../../src/native44/knowledge.js';
import { native44ProfileViewports } from '../../src/native44/profile.js';
import { NATIVE44_SELECTION_RULES_HASH } from '../../src/native44/selection-rules.js';
import type { HeaderMenuContentClient, HeaderMenuContent } from '../../src/woodmart-header/generic/menu-content.js';
import type { LegacySchema, CapabilityReport } from '../../src/wordpress/types.js';
import type { Native44Program } from '../../src/native44/types.js';
const root = 'D:/cloneWP';
export const contentHash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
export const contentSchemas: Record<string, LegacySchema> = {
  container: { type: 'container', class: 'Container', controls: { css_classes: { type: 'text' } } },
  heading: { type: 'heading', class: 'Heading', controls: { _css_classes: { type: 'text' }, title: { type: 'textarea' } } },
  wd_products: { type: 'wd_products', class: 'Products', controls: { _css_classes: { type: 'text' }, post_type: { type: 'select', options: { ids: 'IDs' } }, include: { type: 'wd_autocomplete', multiple: true }, items_per_page: { type: 'number' }, orderby: { type: 'select', options: { date: 'Date' } } } },
  wd_image_or_svg: { type: 'wd_image_or_svg', class: 'Image', controls: { image: { type: 'media' }, _css_classes: { type: 'text' } } },
};
export function contentClient(origin: string): HeaderMenuContentClient {
  return {
    async discoverCapabilities() { return { mode: 'novamira', legacySchemas: contentSchemas } as unknown as CapabilityReport; },
    async readTargetCatalog() { return { version: 1, targetOrigin: origin, readAt: '2026-10-20T01:00:00.000Z', evidence: [], query: { status: 'publish', visibility: 'visible', orderby: 'date', order: 'DESC', limit: 200 }, products: [91, 90].map(id => ({ id, name: 'Fixture product ' + id, permalink: origin + '/product/' + id, imageUrl: origin + '/images/' + id + '.jpg', imageVariants: [], priceText: '$20' })) } as Awaited<ReturnType<HeaderMenuContentClient['readTargetCatalog']>>; },
  };
}
export async function contentFixture(runId = 'service-run') {
  const directory = path.join(root, '.cache', 'header-content-' + randomUUID()); await mkdir(directory, { recursive: true });
  const put = async (name: string, value: unknown) => { const bytes = JSON.stringify(value), filename = path.join(directory, name); await writeFile(filename, bytes); return { path: filename, sha256: contentHash(bytes) }; };
  const sourceUrl = 'https://header-source.example/';
  const packet = validateObservationPacketV2({
    version: 2, kind: 'observation-packet', snapshot: { id: 'wide', url: sourceUrl, title: 'Header test fixture', capturedAt: '2026-10-20T00:00:00.000Z', viewport: { name: 'desktop', width: 1920, height: 1080, clientWidth: 1920, scrollbarWidth: 0, devicePixelRatio: 1 }, pageHeight: 2000, screenshot: { path: 'fixture-placeholder.png', sha256: '0'.repeat(64), width: 1920, height: 2000 } },
    nodes: { h: { id: 'h', parentId: null, regionId: 'rh', tag: 'HEADER', childIds: [], selector: '#header', attributes: {}, styleId: 's', layoutId: 'l', visible: true } },
    regions: [{ id: 'rh', nodeId: 'h', contentNodeId: 'h', role: 'header', order: 0, gapBefore: 0 }],
    texts: {}, styles: { s: {} }, layouts: { l: { id: 'l', rect: { x: 0, y: 0, width: 1920, height: 100 }, contentRect: { x: 0, y: 0, width: 1920, height: 100 }, padding: [0, 0, 0, 0], margin: [0, 0, 0, 0], gap: { row: 0, column: 0 }, display: 'block', position: 'static', maxWidth: 'none', direction: 'ltr', flowIndex: 0 } },
    resources: {}, usages: {}, interactions: {}, gaps: [],
  });
  const packetRef = await put('packet.json', packet), observationRef = await put('observation.json', { testFixture: true });
  const facts = buildSourceFactsV2({ manifestPath: observationRef.path, manifestSha256: observationRef.sha256, manifest: { version: 2, kind: 'observation-manifest', sourceUrl, provenance: { method: 'user-opened-browser', observer: 'cua_repl', browser: 'chrome' }, packets: [], screenshots: [] }, packets: [packet], packetFiles: [{ ...packetRef, snapshotId: 'wide' }] });
  const factsRef = await put('facts.json', facts), planRef = await put('plan.json', {}), assetsRef = await put('assets.json', { assets: [] }), identity = await native44KnowledgeIdentity(root);
  const sourceFactIds = [Object.values(facts.facts).find(fact => fact.kind === 'region')!.id];
  const program: Native44Program = { version: 2, workflow: 'block-replication', executionStrategy: 'native44-css-handoff', replicationProfile: 'desktop-browser-v1', selectionRulesHash: NATIVE44_SELECTION_RULES_HASH, taskId: runId, title: 'Menu content fixture', sourceUrl, ...identity, sourceFacts: factsRef, componentPlan: planRef, assetsManifest: assetsRef, viewports: native44ProfileViewports('desktop-browser-v1'), blocks: [{ kind: 'composite', key: 'menu', children: [{ kind: 'native', key: 'label', widgetType: 'heading', widgetSettings: { title: 'Recommended products' }, sourceFactIds }, { kind: 'native-products', key: 'recommendations', widgetType: 'wd_products', widgetSettings: {}, query: { ids: [91, 90], evidence: [packetRef.path] }, sourceFactIds }] }] };
  const entry: HeaderMenuContent = { key: 'recommendations', name: 'Menu recommendations', menuKey: 'main', itemKey: 'catalog', program };
  return { directory, put, packet, facts, entry, cleanup: async () => { const actual = await realpath(directory), relative = path.relative(await realpath(root), actual); if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || actual.toLowerCase() !== directory.toLowerCase()) throw Error('Unsafe fixture cleanup'); await rm(actual, { recursive: true, force: true }); } };
}
