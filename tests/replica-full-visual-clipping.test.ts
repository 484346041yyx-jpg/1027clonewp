import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { sampleFullReplicaVisualModule, sourceVisual } from '../src/replica-full/visual-review.js';
import type { ObservationPacketV2 } from '../src/replica-v2/observation.js';
import { compareNative44VisualModules } from '../src/native44/visual-audit.js';

test('a padded button and a native span-wrapped label retain the same measured boundary and real line count', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
    const html = (label: string) => '<style>body{margin:0}section{width:500px;background:white}button{font:16px/22.4px Arial;padding:10px 40px;border:0;border-radius:5px;background:rgb(237,181,9);color:white;white-space:normal}</style><section id="root"><button>' + label + '</button></section>';
    await page.setContent(html('Submit')); await page.evaluate('globalThis.__name=(value)=>value');
    const source = await page.evaluate(() => {
      const elements = [document.querySelector('#root')!, document.querySelector('button')!], nodes: any = {}, styles: any = {}, layouts: any = {};
      elements.forEach((element, index) => {
        const id = index ? 'button' : 'root', s = getComputedStyle(element), r = element.getBoundingClientRect();
        nodes[id] = {id, tag:element.tagName.toLowerCase(), attributes:{}, parentId:index?'root':null, childIds:index?[]:['button'],styleId:id,layoutId:id,visible:true};
        styles[id] = {display:s.display,visibility:s.visibility,opacity:s.opacity,color:s.color,'font-size':s.fontSize,'line-height':s.lineHeight,'white-space':s.whiteSpace,'background-color':s.backgroundColor,'background-image':s.backgroundImage,'border-width':s.borderWidth,'border-style':s.borderStyle,'border-color':s.borderColor,'border-radius':s.borderRadius,'border-bottom-width':s.borderBottomWidth,'box-shadow':s.boxShadow,'before:content':getComputedStyle(element,'::before').content,'after:content':getComputedStyle(element,'::after').content};
        layouts[id] = {rect:{x:r.x,y:r.y,width:r.width,height:r.height}};
      });
      return {nodes,styles,layouts,texts:{submit:{nodeId:'button',text:'Submit',lineCount:1}}};
    });
    const frozen = JSON.stringify(source), expected = sourceVisual(source as unknown as ObservationPacketV2,'root',['root','button']);
    assert.equal(expected.texts[0].lineCount,1);
    await page.setContent(html('<span><span>Submit</span></span>')); await page.evaluate('globalThis.__name=(value)=>value');
    const wrapped = await page.$eval('#root',sampleFullReplicaVisualModule);
    assert.deepEqual(compareNative44VisualModules(expected,wrapped,true,true),[]);
    await page.locator('button').evaluate(element => { (element as HTMLElement).style.padding='12px 60px'; });
    assert.ok(compareNative44VisualModules(expected,await page.$eval('#root',sampleFullReplicaVisualModule),true,true).some(row=>/control width/.test(row.detail)));
    await page.locator('button').evaluate(element => { (element as HTMLElement).style.padding='10px 40px'; const label=element.querySelector('span span') as HTMLElement; label.style.cssText='display:inline-block;width:30px;word-break:break-all'; });
    assert.ok(compareNative44VisualModules(expected,await page.$eval('#root',sampleFullReplicaVisualModule),true,true).some(row=>/rendered lines 1 -> 2/.test(row.detail)));
    assert.equal(JSON.stringify(source),frozen);
  } finally { await browser.close(); }
});

test('source and target visual sampling use identical ancestor clipping without deleting clone facts or partially painted media', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
    await page.setContent('<style>body{margin:0}#root{width:300px;height:80px;overflow:hidden;position:relative}.track{display:flex;width:1500px;transform:translateX(-300px)}img{width:100px;height:50px;flex:none}</style><section id="root"><div class="track">' + Array.from({ length: 15 }, (_, index) => `<img class="${index < 5 ? 'clone' : 'original'}" src="data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%27100%27 height=%2750%27/%3E">`).join('') + '</div></section>');
    await page.evaluate('globalThis.__name=(value)=>value');
    const packet = async () => page.evaluate(() => {
      const elements = [...document.querySelectorAll('*')], ids = new Map(elements.map((element, index) => [element, `node-${index}`])), nodes: any = {}, styles: any = {}, layouts: any = {};
      for (const element of elements) {
        const id = ids.get(element)!, style = getComputedStyle(element), box = element.getBoundingClientRect();
        nodes[id] = { id, tag: element.tagName.toLowerCase(), attributes: Object.fromEntries([...element.attributes].map(attribute => [attribute.name, attribute.value])), parentId: element.parentElement ? ids.get(element.parentElement) : null, childIds: [...element.children].map(child => ids.get(child)), styleId: id, layoutId: id, visible: box.width > 0 && box.height > 0 };
        styles[id] = { display: style.display, visibility: style.visibility, opacity: style.opacity, overflow: style.overflow, 'overflow-x': style.overflowX, 'overflow-y': style.overflowY, 'background-color': style.backgroundColor, 'background-image': style.backgroundImage, 'border-width': style.borderWidth, 'border-style': style.borderStyle, 'box-shadow': style.boxShadow };
        layouts[id] = { rect: { x: box.x, y: box.y, width: box.width, height: box.height } };
      }
      const rootId = ids.get(document.querySelector('#root')!)!, included: string[] = []; const visit = (id: string) => { included.push(id); nodes[id].childIds.forEach(visit); }; visit(rootId);
      return { packet: { nodes, styles, layouts, texts: {} }, rootId, included };
    });
    for (const [offset, expectedWidths] of [[-300, [100, 100, 100]], [-275, [25, 100, 100, 75]]] as const) {
      await page.locator('.track').evaluate((element, offset) => { (element as HTMLElement).style.transform = `translateX(${offset}px)`; }, offset);
      const source = await packet(), frozen = JSON.stringify(source.packet), sampled = sourceVisual(source.packet as unknown as ObservationPacketV2, source.rootId, source.included), target = await page.$eval('#root', sampleFullReplicaVisualModule);
      assert.deepEqual(sampled.mediaGeometry?.map(box => box.width), expectedWidths); assert.deepEqual(target.mediaGeometry, sampled.mediaGeometry);
      assert.equal(Object.values(source.packet.nodes).filter((node: any) => node.tag === 'img' && node.visible).length, 15); assert.equal(JSON.stringify(source.packet), frozen);
    }
    await page.locator('#root').evaluate(element => { (element as HTMLElement).style.overflowX = 'clip'; (element as HTMLElement).style.overflowY = 'visible'; const image = document.createElement('img'); image.id = 'vertical'; image.style.cssText = 'position:absolute;left:50px;top:120px;width:40px;height:40px'; element.append(image); });
    const vertical = await packet(), verticalSource = sourceVisual(vertical.packet as unknown as ObservationPacketV2, vertical.rootId, vertical.included), verticalTarget = await page.$eval('#root', sampleFullReplicaVisualModule);
    assert.deepEqual(verticalSource.mediaGeometry, verticalTarget.mediaGeometry); assert.ok(verticalSource.mediaGeometry?.some(box => box.y === 120 && box.height === 40));
    await page.locator('#root').evaluate(element => { (element as HTMLElement).style.overflowY = 'hidden'; });
    const clippedVertical = await packet(); assert.ok(!sourceVisual(clippedVertical.packet as unknown as ObservationPacketV2, clippedVertical.rootId, clippedVertical.included).mediaGeometry?.some(box => box.y === 120));
    await page.locator('#root').evaluate(element => { (element as HTMLElement).style.opacity = '0'; });
    const hidden = await packet(); assert.equal(sourceVisual(hidden.packet as unknown as ObservationPacketV2, hidden.rootId, hidden.included).mediaGeometry?.length, 0); assert.equal((await page.$eval('#root', sampleFullReplicaVisualModule)).mediaGeometry?.length, 0);
  } finally { await browser.close(); }
});
