import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { verifySourceHoverReview } from '../src/replica-v2/hover-review.js';

test('source collector declares CSS hover owners and real pointer probe captures changed and restored states', async () => {
  const source = await readFile('D:/cloneWP/src/replica-v2/collect.browser.js', 'utf8');
  const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  const page = await browser.newPage();
  try {
    await page.setContent(`<style>
      nav a:hover { color: rgb(173, 7, 61); text-decoration: underline }
      .cta:hover svg { transform: translateX(20px) }
      .card:hover img { transform: scale(1.09) }
      .unrelated:hover { color: blue }
    </style><main id="observed"><nav><a href="/collections">Collections</a></nav><a class="cta" href="/shop">Shop Now <svg width="20" height="11"></svg></a><a class="card" href="/gold"><img width="100" height="100" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100'/%3E">Gold Bars</a></main><a class="unrelated" href="/else">Elsewhere</a>`);
    const transport = JSON.parse(await page.evaluate(`${source};collectObservationV2({snapshotId:'hover-source',rootSelectors:['#observed']})`));
    const packet = JSON.parse(transport.chunks[0].json);
    const hover = Object.values(packet.interactions).filter((row: any) => row.kind === 'hover') as any[];
    assert.deepEqual(hover.map(row => packet.nodes[row.nodeId].attributes.class || packet.nodes[row.nodeId].tag), ['a', 'cta', 'card']);
    assert.ok(hover.every(row => row.status === 'declared' && row.details.behaviorVerified === false));
    assert.equal(hover.some(row => row.details.selector.includes('unrelated')), false);
    const nav = hover.find(row => packet.nodes[row.nodeId].tag === 'a' && !packet.nodes[row.nodeId].attributes.class);
    const options = { sourceUrl: 'about:blank', triggerSelector: packet.nodes[nav.nodeId].selector, affectedSelectors: [], screenshotHash: 'a'.repeat(64) };
    const probe = async (stage: string) => page.evaluate(`${source};collectHoverStateV2(${JSON.stringify({ ...options, stage })})`) as Promise<any>;
    const before = await probe('default');
    await page.locator('nav a').hover();
    const during = await probe('hover');
    await page.mouse.move(0, 0);
    const restored = await probe('restored');
    assert.notEqual(before.affected[0].styles.element.color, 'rgb(173, 7, 61)');
    assert.equal(during.affected[0].styles.element.color, 'rgb(173, 7, 61)');
    assert.equal(restored.affected[0].styles.element.color, before.affected[0].styles.element.color);
    assert.equal(during.hovered, true);
    await assert.rejects(probe('hover'), /Real pointer state/);
    const facts = { sourceUrl: 'about:blank', snapshots: [{ id: 'hover-source', nodes: packet.nodes }], facts: {
      hover: { snapshotId: 'hover-source', nodeId: nav.nodeId, kind: 'interaction', value: { kind: 'hover', details: { source: 'css-hover-selector' } } },
    } } as any;
    const capture = (state: any) => ({ state, screenshot: { path: `${state.stage}.png`, sha256: state.screenshotHash } });
    const review = { version: 1, kind: 'source-hover-review', sourceUrl: 'about:blank', rows: [{ snapshotId: 'hover-source', triggerNodeId: nav.nodeId, captures: [capture(before), capture(during), capture(restored)] }] };
    assert.equal(verifySourceHoverReview(facts, review).rows.length, 1);
    const sameRule = { ...facts, facts: { ...facts.facts, another: { ...facts.facts.hover, nodeId: nav.nodeId + '-copy' } } } as any;
    sameRule.snapshots = [{ ...facts.snapshots[0], nodes: { ...packet.nodes, [nav.nodeId + '-copy']: packet.nodes[nav.nodeId] } }];
    assert.equal(verifySourceHoverReview(sameRule, review).rows.length, 1);
    const differentRule = { ...facts, facts: { ...facts.facts, cta: { ...facts.facts.hover, nodeId: hover.find(row => packet.nodes[row.nodeId].attributes.class === 'cta').nodeId, value: { kind: 'hover', details: { source: 'css-hover-selector', selector: '.cta:hover' } } } } } as any;
    assert.throws(() => verifySourceHoverReview(differentRule, review), /coverage_missing/);
    assert.throws(() => verifySourceHoverReview(facts, { ...review, rows: [] }), /coverage_missing/);
    assert.throws(() => verifySourceHoverReview(facts, { ...review, rows: [{ ...review.rows[0], captures: [capture(before), capture(restored), capture(during)] }] }), /pointer_cycle_invalid/);
  } finally { await browser.close(); }
});

test('covered CSS hover owner keeps a bound nine-point unreachable proof', async () => {
  const source = await readFile('D:/cloneWP/src/replica-v2/collect.browser.js', 'utf8');
  const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  const page = await browser.newPage();
  try {
    await page.setContent('<style>#observed{position:relative}.blocked{display:block;width:100px;height:40px}.blocked:hover{color:red}.cover{position:absolute;inset:0 auto auto 0;width:100px;height:40px;z-index:5}</style><main id="observed"><a class="blocked" href="/blocked">Blocked</a><a class="cover" href="/cover">Cover</a></main>');
    const transport = JSON.parse(await page.evaluate(`${source};collectObservationV2({snapshotId:'covered',rootSelectors:['#observed']})`));
    const packet = JSON.parse(transport.chunks[0].json);
    const trigger = Object.values(packet.interactions).find((item: any) => item.kind === 'hover') as any;
    const selector = packet.nodes[trigger.nodeId].selector;
    await page.mouse.move(200, 200);
    const probe = await page.evaluate(`${source};collectHoverReachabilityV2(${JSON.stringify({sourceUrl:'about:blank',triggerSelector:selector,screenshotHash:'a'.repeat(64)})})`) as any;
    assert.equal(probe.hits.length, 9);
    assert.ok(probe.hits.every((hit: any) => hit.targetOrDescendant === false && hit.hitSelector));
    const facts = { sourceUrl: 'about:blank', snapshots: [{ id: 'covered', nodes: packet.nodes }], facts: { hover: { snapshotId: 'covered', nodeId: trigger.nodeId, kind: 'interaction', value: { kind: 'hover', details: { source: 'css-hover-selector' } } } } } as any;
    const row = { snapshotId: 'covered', triggerNodeId: trigger.nodeId, unreachable: { probe, screenshot: { path: 'covered.png', sha256: probe.screenshotHash }, activation: { kind: 'other', label: 'Covered static card' } } };
    const review = { version: 1, kind: 'source-hover-review', sourceUrl: 'about:blank', rows: [row] };
    assert.equal(verifySourceHoverReview(facts, review).rows.length, 1);
    assert.throws(() => verifySourceHoverReview(facts, { ...review, rows: [{ ...row, unreachable: { ...row.unreachable, probe: { ...probe, hits: [{ ...probe.hits[0], targetOrDescendant: true }, ...probe.hits.slice(1)] } } }] }), /unreachable_proof_invalid/);
  } finally { await browser.close(); }
});
