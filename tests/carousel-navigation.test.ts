import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { assertCarouselNavigationMapped, assertNativeCarouselArrowCSS } from '../src/replica-full/carousel-navigation.js';
import { native44ModuleClass } from '../src/native44/adapters.js';
import type { Native44Program } from '../src/native44/types.js';
import type { BodySourceUnits } from '../src/replica-full/body-prepare.js';
import type { ObservationPacketV2 } from '../src/replica-v2/observation.js';

const root = 'D:/cloneWP';
const read = async <T>(name: string): Promise<T> => JSON.parse(await readFile(name, 'utf8')) as T;

function sourceArrowFixture(previousClass: string, nextClass: string): Parameters<typeof assertCarouselNavigationMapped>[0] {
  const key = 'exhibition_carousel', reference = { path: 'fixture.json', sha256: '0'.repeat(64) };
  const program: Native44Program = {
    version: 2, workflow: 'block-replication', executionStrategy: 'native44-css-handoff', taskId: 'arrow-fixture', title: 'Arrow fixture', sourceUrl: 'https://example.com/',
    componentCatalog: reference, knowledge: { ...reference, fingerprint: reference.sha256 }, targetEnvironment: { woodmart: 'fixture', woodmartCore: 'fixture', elementor: 'fixture', elementorPro: 'fixture' },
    sourceFacts: reference, componentPlan: reference, assetsManifest: reference, viewports: [],
    blocks: [{ kind: 'native-carousel', key, widgetType: 'nested-carousel', widgetSettings: { arrows: 'yes' } }],
  };
  const packet: ObservationPacketV2 = {
    version: 2, kind: 'observation-packet', snapshot: { id: 'desktop', url: program.sourceUrl, title: program.title, capturedAt: '2026-01-01T00:00:00.000Z', viewport: { name: 'desktop', width: 1440, height: 1000, clientWidth: 1440, scrollbarWidth: 0, devicePixelRatio: 1 }, pageHeight: 1000, screenshot: { ...reference, width: 1440, height: 1000 } },
    nodes: {}, regions: [{ id: 'carousel', nodeId: 'owner', role: 'region', order: 0, contentNodeId: 'owner', gapBefore: 0 }], texts: {}, styles: {}, layouts: {}, resources: {}, usages: {}, interactions: {}, gaps: [],
  };
  for (const [id, className] of [['owner', 'source-carousel'], ['previous', previousClass], ['next', nextClass]]) {
    const rect = { x: 0, y: 0, width: 40, height: 40 };
    packet.nodes[id] = { id, parentId: id === 'owner' ? null : 'owner', regionId: 'carousel', tag: id === 'owner' ? 'div' : 'button', selector: `#${id}`, attributes: { class: className }, childIds: id === 'owner' ? ['previous', 'next'] : [], styleId: id, layoutId: id, visible: true };
    packet.styles[id] = { display: 'block', 'after:content': '"→"' };
    packet.layouts[id] = { id, rect, contentRect: rect, padding: [0,0,0,0], margin: [0,0,0,0], gap: { row: 0, column: 0 }, display: 'block', position: 'static', maxWidth: 'none', direction: 'ltr', flowIndex: 0 };
  }
  const sourceUnits: BodySourceUnits = { version: 1, kind: 'native44-body-source-units', taskId: program.taskId, sourceUrl: program.sourceUrl, units: [{ id: 'carousel', snapshotId: 'desktop', ownerNodeId: 'owner', nodeIds: Object.keys(packet.nodes), sourceFactIds: ['arrows'], componentKeys: [key] }] };
  const css = `:page .${native44ModuleClass(key)} .elementor-swiper-button::after{border-right:1px solid currentColor}`;
  return { program, sourceUnits, snapshots: new Map([['desktop',packet]]), css };
}

for (const prefix of ['swiper-button', 'swiper-btn']) {
  test(`carousel public gate maps exact ${prefix} arrows and preserves graphic and phone visibility requirements`, () => {
    const input = sourceArrowFixture(`control ${prefix}-prev`, `${prefix}-next control`);
    const rows = assertCarouselNavigationMapped(input);
    assert.deepEqual(rows[0], { componentKey: 'exhibition_carousel', snapshotId: 'desktop', sourceNodeIds: { previous: 'previous', next: 'next' }, visible: { previous: true, next: true }, graphic: { previous: 'pseudo', next: 'pseudo' } });
    assert.throws(() => assertCarouselNavigationMapped({ ...input, css: '' }), /carousel_navigation_graphic_unmapped:exhibition_carousel/);

    const phone = structuredClone(input.snapshots.get('desktop')!);
    phone.snapshot.id = 'phone';
    phone.nodes.previous.visible = false; phone.nodes.next.visible = false;
    input.phone = { packets: [phone], sections: [{ key: 'exhibition', evidence: [{ snapshotId: 'phone', nodeId: 'owner' }] }] };
    assert.throws(() => assertCarouselNavigationMapped(input), /carousel_navigation_hidden_state_unmapped:exhibition_carousel/);
    input.css += `@media(max-width:768px){:page .${native44ModuleClass('exhibition_carousel')} .elementor-swiper-button{display:none}}`;
    const withPhone = assertCarouselNavigationMapped(input);
    assert.deepEqual(withPhone[1].visible, { previous: false, next: false });
  });
}

test('carousel public gate rejects ambiguous standard and alias candidates in either direction', () => {
  for (const suffix of ['prev', 'next']) {
    const input = sourceArrowFixture(`swiper-button-${suffix}`, `swiper-btn-${suffix}`);
    assert.throws(() => assertCarouselNavigationMapped(input), /carousel_navigation_source_ambiguous:exhibition_carousel\/desktop/);
  }
  const input = sourceArrowFixture('custom-swiper-btn-prev', 'swiper-btn-nextish');
  assert.throws(() => assertCarouselNavigationMapped(input), /carousel_navigation_source_ambiguous:exhibition_carousel\/desktop/);
});

test('v3 carousel gate rejects a default glyph and accepts scoped graphic decisions', async () => {
  const base = `${root}/runs/sk-jewellery-20261020-r1-final-preparation/coordinator-merged-623f94ab-04f5-4bbe-ae1b-7b38a77888a1`;
  const program = await read<Native44Program>(`${base}/program.json`);
  const sourceUnits = await read<BodySourceUnits>(`${base}/source-units.json`);
  const snapshots = new Map<string, ObservationPacketV2>();
  for (const [id, prefix] of [['sk-desktop', 'desktop'], ['sk-narrow', 'narrow']] as const) {
    const packets = await Promise.all(['hero', 'collection', 'looks', 'reviews', 'socials'].map(name => read<ObservationPacketV2>(`${root}/references/sk-jewellery-20261020/${prefix}-${name}-packet.json`)));
    snapshots.set(id, { ...packets[0], nodes: Object.assign({}, ...packets.map(p => p.nodes)), styles: Object.assign({}, ...packets.map(p => p.styles)), layouts: Object.assign({}, ...packets.map(p => p.layouts)), usages: Object.assign({}, ...packets.map(p => p.usages)), resources: Object.assign({}, ...packets.map(p => p.resources)) });
  }
  assert.throws(() => assertCarouselNavigationMapped({ program, sourceUnits, snapshots, css: '' }), /carousel_navigation_graphic_unmapped/);
  const historicalCss = await readFile(`${base}/body.css`, 'utf8');
  assert.throws(() => assertNativeCarouselArrowCSS(historicalCss, native44ModuleClass('looks_carousel'), [native44ModuleClass('looks_carousel'), 'cwp-n44-95d09b6231e6']), /carousel_navigation_double_vertical_offset/);
  const css = ['hero_carousel', 'looks_carousel', 'reviews_carousel', 'socials_carousel'].map(key => `:page .${native44ModuleClass(key)} .elementor-swiper-button::after{border-right:1px solid currentColor}`).join('\n') +
    `:page .${native44ModuleClass('collection_products')} .wd-arrow-inner::after{border-right:1px solid currentColor}` +
    `@media(max-width:768px){:page .${native44ModuleClass('collection_products')} .wd-nav-arrows{display:none}}` +
    `:page .${native44ModuleClass('reviews_carousel')} .elementor-swiper-button{display:none}`;
  const observations = assertCarouselNavigationMapped({ program, sourceUnits, snapshots, css });
  assert.equal(observations.length, 10);
  assert.equal(observations.find(row => row.componentKey === 'hero_carousel')?.graphic.previous, 'svg');
  const singleArrowSnapshots = new Map([...snapshots].map(([id, packet]) => [id, structuredClone(packet)]));
  const singleArrowUnits = { ...sourceUnits, units: sourceUnits.units.map(unit => unit.componentKeys.includes('hero_carousel')
    ? { ...unit, nodeIds: unit.nodeIds.filter(id => !/splide__arrow--prev/.test(singleArrowSnapshots.get(unit.snapshotId)?.nodes[id]?.attributes.class ?? '')) }
    : unit) };
  for (const packet of singleArrowSnapshots.values()) packet.nodes['hero-n7'].attributes.class = 'aspire-button carousel-arrow chevron-square right unstyled';
  const singleArrowObservations = assertCarouselNavigationMapped({ program, sourceUnits: singleArrowUnits, snapshots: singleArrowSnapshots, css });
  assert.equal(singleArrowObservations.find(row => row.componentKey === 'hero_carousel')?.sourceNodeIds.previous, null);
  assert.equal(singleArrowObservations.find(row => row.componentKey === 'hero_carousel')?.sourceNodeIds.next, 'hero-n7');
  const phonePackets = await Promise.all([390, 430].flatMap(width => ['hero', 'collection', 'looks', 'reviews', 'socials'].map(name => read<ObservationPacketV2>(`${root}/references/sk-jewellery-20261020/phone${width}-${name}-packet.json`))));
  const sections = ['hero', 'collection', 'looks', 'reviews', 'socials'].map(key => ({ key, evidence: phonePackets.filter(packet => packet.nodes[`${key}-n1`]).map(packet => ({ snapshotId: packet.snapshot.id, nodeId: `${key}-n1` })) }));
  const withPhone = assertCarouselNavigationMapped({ program, sourceUnits, snapshots, css: css + `@media(max-width:768px){:page .${native44ModuleClass('hero_carousel')} .elementor-swiper-button{display:none}}`, phone: { packets: phonePackets, sections } });
  assert.equal(withPhone.length, 20);
  assert.equal(withPhone.find(row => row.componentKey === 'hero_carousel' && row.snapshotId === phonePackets[0].snapshot.id)?.visible.next, false);
  assert.equal(withPhone.find(row => row.componentKey === 'collection_products' && row.snapshotId === phonePackets[1].snapshot.id)?.visible.next, false);
  const noArrowUnits = { ...sourceUnits, units: sourceUnits.units.map(unit => unit.componentKeys.includes('collection_products')
    ? { ...unit, nodeIds: unit.nodeIds.filter(id => !/splide__arrow--(?:prev|next)|swiper-button-(?:prev|next)/.test(snapshots.get(unit.snapshotId)?.nodes[id]?.attributes.class ?? '')) }
    : unit) };
  assert.throws(() => assertCarouselNavigationMapped({ program, sourceUnits: noArrowUnits, snapshots, css }), /carousel_navigation_hidden_state_unmapped/);
  assert.doesNotThrow(() => assertCarouselNavigationMapped({ program, sourceUnits: noArrowUnits, snapshots, css: css + `:page .${native44ModuleClass('collection_products')} .wd-nav-arrows{display:none}` }));
});

test('native carousel arrow guard rejects a second vertical offset and a corner-anchored glyph', () => {
  const cls = native44ModuleClass('looks_carousel');
  assert.throws(() => assertNativeCarouselArrowCSS(`:page .${cls} .elementor-swiper-button{top:calc(28.5cqw - 25px);transform:none}`, cls), /carousel_navigation_double_vertical_offset/);
  assert.throws(() => assertNativeCarouselArrowCSS(`:page .${cls} .elementor-swiper-button::after{top:0;left:0;clip-path:polygon(0 0,100% 50%,0 100%)}`, cls), /carousel_navigation_glyph_top_left/);
  assert.doesNotThrow(() => assertNativeCarouselArrowCSS(`:page .${cls} .elementor-swiper-button{top:28.5cqw!important;transform:translateY(-50%)!important}:page .${cls} .elementor-swiper-button::after{top:50%;left:50%;transform:translate(-50%,-50%);clip-path:polygon(0 0,100% 50%,0 100%)}@media(max-width:768px){:page .${cls} .elementor-swiper-button{top:50cqw!important}}`, cls));
  assert.doesNotThrow(() => assertNativeCarouselArrowCSS(`:page .${cls} .elementor-swiper-button{top:calc(28.5cqw - 25px);transform:none!important}`, cls));
});
