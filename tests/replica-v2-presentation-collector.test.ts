import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { validateObservationPacketV2, type ObservationPacketV2 } from '../src/replica-v2/observation.js';
import { buildSourceFactsV2 } from '../src/replica-v2/source.js';

test('collector retains four actual widths, rendered words, compound fields and safe state attributes', async () => {
  const collector = await readFile('D:/cloneWP/src/replica-v2/collect.browser.js', 'utf8');
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const packets: ObservationPacketV2[] = [];
    await page.setContent('<title>Generic layout fixture</title><style>p{box-sizing:border-box;width:240px;padding:10px;border:3px solid;font:16px Arial;word-spacing:2px} @media(max-width:500px){p{width:180px;word-spacing:1px}}</style><main id="content"><p id="copy">Alpha beta gamma delta epsilon zeta eta theta.</p><div role="tab" aria-selected="true" aria-controls="panel">Overview</div><section id="panel">Full description</section><form><label>Phone</label><div role="combobox" aria-expanded="false" aria-haspopup="listbox">Code</div><input type="tel" value="PRIVATE-USER-VALUE" placeholder="Phone" required><select><option>+1</option><option>+86</option></select></form></main>');
    for (const width of [1920, 1440, 390, 430]) {
      await page.setViewportSize({ width, height: 900 });
      const transport = JSON.parse(await page.evaluate(`${collector};collectObservationV2({snapshotId:'view-${width}',viewportName:'${width < 768 ? 'mobile' : 'desktop'}',rootSelectors:['#content']})`));
      const packet = validateObservationPacketV2(JSON.parse(transport.chunks[0].json));
      assert.equal(packet.presentationVersion, 1);
      assert.equal(packet.snapshot.viewport.width, width);
      const text = Object.values(packet.texts).find(row => row.text.startsWith('Alpha'))!;
      assert.equal(text.textLayout?.status, 'measured');
      assert.equal(text.textLayout?.lines.length, text.lineCount);
      assert.equal(text.textLayout?.lines.map(line => line.text).join(' '), text.text);
      const layout = packet.layouts[packet.nodes[text.nodeId].layoutId];
      assert.equal(layout.contentRect.width, (width < 768 ? 180 : 240) - 26);
      assert.equal(layout.contentRect.x - layout.rect.x, 13);
      assert.equal(packet.styles[packet.nodes[text.nodeId].styleId]['word-spacing'], width < 768 ? '1px' : '2px');
      assert.ok(Object.values(packet.interactions).some(row => row.details.type === 'combobox' && row.status === 'unobserved'));
      assert.equal(JSON.stringify(packet).includes('PRIVATE-USER-VALUE'), false);
      packets.push(packet);
      const source = buildSourceFactsV2({ packets, packetFiles: packets.map(item => ({ path: `${item.snapshot.id}.json`, sha256: 'a'.repeat(64), snapshotId: item.snapshot.id })), manifestPath: 'manifest.json', manifestSha256: 'b'.repeat(64), manifest: { version: 2, kind: 'observation-manifest', sourceUrl: 'about:blank', provenance: { method: 'public-capture', observer: 'playwright', browser: 'chromium' }, packets: [], screenshots: [] } });
      const tab = Object.values(source.facts).find(row => row.snapshotId === packet.snapshot.id && row.kind === 'interaction' && (row.value.details as any).type === 'tab')!;
      assert.equal(source.snapshots.find(item => item.id === packet.snapshot.id)!.nodes[tab.nodeId].attributes?.['aria-selected'], 'true');
      assert.ok(tab.value.layout);
      assert.ok(tab.value.style);
    }
  } finally { await browser.close(); }
});

test('line measurement has bounded cost, distinguishes real BR and rejects fabricated measured-empty evidence', async () => {
  const collector = await readFile('D:/cloneWP/src/replica-v2/collect.browser.js', 'utf8');
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<title>Measurement budget fixture</title><main id="content"><p>First line<br>Second line</p><p>Other paragraph</p></main>');
    const capture = async (options: object) => {
      const transport = JSON.parse(await page.evaluate(`${collector};collectObservationV2(${JSON.stringify({ snapshotId: 'bounded', rootSelectors: ['#content'], ...options })})`));
      return validateObservationPacketV2(JSON.parse(transport.chunks[0].json));
    };
    const packet = await capture({});
    assert.equal(Object.values(packet.texts)[0].textLayout?.hardBreaks, true);
    assert.equal(Object.values(packet.texts)[0].textLayout?.lines.length, 2);
    const bounded = await capture({ maxTextLineCharactersTotal: 1 });
    assert.ok(Object.values(bounded.texts).every(row => row.textLayout?.status === 'unavailable' && row.textLayout.reason === 'character-budget'));
    const broken: ObservationPacketV2 = structuredClone(packet);
    Object.values(broken.texts)[0].textLayout!.lines = [];
    assert.throws(() => validateObservationPacketV2(broken), /measurement status/);
  } finally { await browser.close(); }
});
