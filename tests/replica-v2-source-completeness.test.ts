import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { validateObservationPacketV2, type ValidatedObservationV2 } from '../src/replica-v2/observation.js';
import { validateSceneInventoryV2 } from '../src/replica-v2/scene-inventory.js';
import { assessSourceCompleteness } from '../src/replica-v2/source-completeness.js';

test('independent full-content capture retains every link, hidden content and decoration before components exist', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.route('https://source.test/**', route => route.fulfill({ contentType: 'text/html', body: `<main id="content"><h2>Full public source content</h2>${Array.from({ length: 13 }, (_, index) => `<a href="/category/${index}">Category ${index}</a>`).join('')}<div hidden><p>Hidden panel detail</p><img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E"></div><hr><button role="tab">Details</button><input name="email" required maxlength="100" value="PRIVATE_VALUE"><select name="country"><option value="different-value">Public option</option></select><video src="/factory.mp4"></video><textarea>PRIVATE_TEXTAREA</textarea></main><aside hidden>Unassigned hidden content</aside>` }));
    await page.goto('https://source.test/');
    await page.evaluate(() => { document.title = 'Source completeness fixture'; });
    const collector = await readFile('D:/cloneWP/src/replica-v2/collect.browser.js', 'utf8');
    const transport = JSON.parse(await page.evaluate(`${collector};collectObservationV2({snapshotId:'full',regions:[{id:'content',selector:'#content'}],includeSceneInventory:true})`) as string);
    const packets = transport.chunks.map((chunk: { json: string }) => validateObservationPacketV2(JSON.parse(chunk.json)));
    const inventory = validateSceneInventoryV2(transport.sceneInventory);
    assert.equal(inventory.content!.entries.filter(entry => entry.kind === 'link').length, 13);
    assert.ok(inventory.content!.entries.some(entry => entry.text === 'Hidden panel detail' && !entry.visible));
    assert.ok(inventory.content!.entries.some(entry => entry.kind === 'decoration'));
    assert.ok(!JSON.stringify(inventory.content).includes('PRIVATE_'));
    const observation = { manifest: { sourceUrl: 'https://source.test/' }, packets, sceneInventories: [{ inventory }] } as unknown as ValidatedObservationV2;
    const before = assessSourceCompleteness(observation);
    assert.equal(before.snapshots[0].items.filter(item => item.kind === 'link' && item.status === 'captured').length, 13);
    assert.ok(before.snapshots[0].items.some(item => item.text === 'Unassigned hidden content' && item.status === 'missing'));
    assert.ok(before.snapshots[0].gaps.some(gap => gap.code === 'source-state-needs-observation'));
    const packet = packets[0];
    const sourceNodes = Object.values(packet.nodes) as Array<{ tag: string; attributes?: Record<string, string> }>;
    const input = sourceNodes.find(node => node.tag === 'input')!;
    assert.equal(input.attributes?.name, 'email');
    assert.equal(input.attributes?.required, '');
    assert.equal(input.attributes?.maxlength, '100');
    assert.equal(input.attributes?.value, undefined);
    const option = sourceNodes.find(node => node.tag === 'option')!;
    assert.equal(option.attributes?.value, 'different-value');
    const video = sourceNodes.find(node => node.tag === 'video')!;
    assert.equal(video.attributes?.src, 'https://source.test/factory.mp4');
    for (const [id, interaction] of Object.entries(packet.interactions) as Array<[string, { kind: string; href?: string }]>) if (interaction.kind === 'link' && interaction.href?.endsWith('/category/12')) delete packet.interactions[id];
    const after = assessSourceCompleteness(observation);
    assert.ok(after.snapshots[0].items.some(item => item.kind === 'link' && item.href?.endsWith('/category/12') && item.status === 'missing'));
    assert.equal(after.status, 'open-items');
    const imageUsage = Object.values(packet.usages)[0] as { resourceId: string };
    packet.resources[imageUsage.resourceId].url = 'https://source.test/wrong-image.png';
    const textId = Object.keys(packet.texts).find(id => packet.texts[id].text === 'Hidden panel detail')!;
    packet.texts[textId].text = 'Truncated';
    const broken = assessSourceCompleteness(observation).snapshots[0];
    assert.ok(broken.items.some(item => item.kind === 'media' && item.status === 'missing'));
    assert.ok(broken.items.some(item => item.text === 'Hidden panel detail' && item.status === 'missing'));
  } finally { await browser.close(); }
});

test('historical observations without an independent full-content denominator are unassessed', () => {
  assert.equal(assessSourceCompleteness({ manifest: { sourceUrl: 'https://source.test/' }, packets: [] } as unknown as ValidatedObservationV2).status, 'unassessed');
});
