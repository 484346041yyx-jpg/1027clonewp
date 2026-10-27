import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { collectNative44TabsChecks, native44TabsEvidencePassed, validateNative44TabsChecks, type Native44TabsCheck } from '../src/native44/tabs-check.js';
import type { Native44DisclosureCheck } from '../src/native44/disclosure-check.js';
import { analyzeNative44Captures, captureNative44Role, type Native44Capture, type Native44CompareManifest } from '../src/native44/compare.js';

const check: Native44TabsCheck = { componentKey: 'catalog-panels', selector: '[data-id="abcdef1"]', widgetType: 'nested-tabs', tablistSelector: '.tablist', items: ['alpha', 'beta', 'gamma'].map(key => ({ key, tabSelector: `#tab-${key}`, panelSelector: `#panel-${key}` })) };
const disclosure: Native44DisclosureCheck = { componentKey: 'catalog-disclosure', selector: '[data-id="outer42"]', widgetType: 'nested-accordion', detailsSelector: '.disclosure', triggerSelector: '.trigger', panelSelector: '.disclosure-panel' };
async function fixture(options: { vertical?: boolean; manualActivation?: boolean; nestedDisclosure?: boolean; freezePanels?: boolean; blockArrow?: boolean; duplicateId?: boolean; crossOwner?: boolean; initialIndex?: number; buttonType?: 'omitted' | 'button' | 'submit' | 'reset'; formAssociation?: boolean; insideForm?: boolean } = {}) {
  const browser = await chromium.launch({ headless: true }), page = await browser.newPage(), initial = options.initialIndex ?? 0;
  const tabs = `${options.insideForm ? '<form action="https://business.invalid/submit">' : ''}<div data-id="abcdef1" data-widget_type="nested-tabs.default"><div class="tablist" role="tablist" aria-orientation="${options.vertical ? 'vertical' : 'horizontal'}">${check.items.map((item, index) => `<button${options.buttonType === 'omitted' ? '' : ` type="${options.buttonType ?? 'button'}"`}${options.formAssociation ? ' form="business-form"' : ''} id="tab-${item.key}" role="tab" aria-selected="${index === initial}" aria-controls="panel-${item.key}" tabindex="${index === initial ? 0 : -1}">${item.key}</button>`).join('')}</div>${check.items.map((item, index) => `<div id="panel-${item.key}" role="tabpanel" aria-labelledby="tab-${item.key}"${index !== initial ? ' hidden' : ''}><a href="https://business.invalid/${item.key}">Editable ${item.key} content</a></div>`).join('')}</div>${options.insideForm ? '</form>' : ''}${options.formAssociation ? '<form id="business-form" action="https://business.invalid/submit"></form>' : ''}`;
  await page.setContent(`<!doctype html><style>body{margin:0;height:1800px}[role=tabpanel]{padding:30px}[role=tablist]{display:flex;${options.vertical ? 'flex-direction:column' : ''}}</style>${options.nestedDisclosure ? `<div data-id="outer42" data-widget_type="nested-accordion.default"><details class="disclosure" id="outer-details"><summary class="trigger" aria-expanded="false" aria-controls="outer-panel">Browse</summary><div class="disclosure-panel" id="outer-panel">${tabs}</div></details></div>` : tabs}<div data-id="foreign9" data-widget_type="nested-tabs.default"><button id="foreign-tab" role="tab" aria-selected="false">Another owner</button></div>${options.duplicateId ? '<div id="panel-beta">Duplicate</div>' : ''}<script>
    const root=document.querySelector('[data-id="abcdef1"]'), tabs=[...root.querySelectorAll('[role="tab"]')], panels=[...root.querySelectorAll('[role="tabpanel"]')];window.actualInputs=[];
    function paint(index){tabs.forEach((tab,position)=>{tab.setAttribute('aria-selected',String(index===position));tab.tabIndex=index===position?0:-1});if (${!options.freezePanels}) panels.forEach((panel,position)=>panel.hidden=position!==index)}
    tabs.forEach((tab,index)=>{tab.addEventListener('click',event=>{window.actualInputs.push({type:'click',trusted:event.isTrusted});paint(index);if (${Boolean(options.crossOwner)}) {const foreign=document.querySelector('#foreign-tab');foreign.setAttribute('aria-selected',String(foreign.getAttribute('aria-selected')!=='true'))}});tab.addEventListener('keydown',event=>{window.actualInputs.push({type:event.key,trusted:event.isTrusted});let next;if(event.key==='Home')next=0;if(event.key==='End')next=tabs.length-1;if(event.key==='${options.vertical ? 'ArrowDown' : 'ArrowRight'}')next=(index+1)%tabs.length;if(event.key==='${options.vertical ? 'ArrowUp' : 'ArrowLeft'}')next=(index+tabs.length-1)%tabs.length;if(next!==undefined&&!${Boolean(options.blockArrow)}){event.preventDefault();tabs[next].focus();if(!${Boolean(options.manualActivation)})paint(next)}})});
    const details=document.querySelector('details');if(details)details.addEventListener('toggle',()=>details.querySelector('summary').setAttribute('aria-expanded',String(details.open)));
  </script>`);
  return { browser, page };
}

test('nested native tabs prove every actual panel and keyboard navigation, activation, ARIA and initial restoration', async () => {
  const { browser, page } = await fixture({ initialIndex: 1 });
  try {
    const [row] = await collectNative44TabsChecks(page, [check], 'desktop-wide');
    assert.equal(row.status, 'passed', row.problems.join('; ')); assert.equal(native44TabsEvidencePassed(row, check), true); assert.equal(row.before!.selectedKey, 'beta'); assert.equal(row.restored!.selectedKey, 'beta'); assert.deepEqual(row.actions.slice(0, 3).map(action=>action.key), ['alpha', 'beta', 'gamma']); assert.equal(row.actions.length, 9);
    const inputs = await page.evaluate('window.actualInputs') as Array<{type:string;trusted:boolean}>; assert.ok(inputs.every(input=>input.trusted)); assert.ok(inputs.some(input=>input.type==='ArrowRight')); assert.ok(inputs.some(input=>input.type===' ')); assert.equal(page.url(), 'about:blank'); assert.equal(await page.locator('#foreign-tab').getAttribute('aria-selected'), 'false');
  } finally { await browser.close(); }
});

test('native tab buttons without a type attribute remain safe outside forms despite the DOM submit default', async () => {
  const {browser,page}=await fixture({buttonType:'omitted'});
  try {
    assert.equal(await page.locator('#tab-alpha').getAttribute('type'),null);assert.equal(await page.locator('#tab-alpha').evaluate(element=>(element as HTMLButtonElement).type),'submit');
    const [row]=await collectNative44TabsChecks(page,[check],'desktop-wide');assert.equal(row.status,'passed',row.problems.join('; '));assert.equal(native44TabsEvidencePassed(row,check),true);assert.equal(page.url(),'about:blank');
  }finally{await browser.close();}
});

test('explicit submit/reset and associated or ancestor forms are rejected before native tab input', async () => {
  for(const option of [{buttonType:'submit' as const},{buttonType:'reset' as const},{buttonType:'omitted' as const,formAssociation:true},{buttonType:'omitted' as const,insideForm:true}]){
    const {browser,page}=await fixture(option);
    try{const [row]=await collectNative44TabsChecks(page,[check],'desktop-wide');assert.equal(row.status,'failed');assert.match(row.problems.join('; '),/safe native tab\/panel relationship/);assert.equal(row.actions.length,0);assert.deepEqual(await page.evaluate('window.actualInputs'),[]);assert.equal(page.url(),'about:blank');}
    finally{await browser.close();}
  }
});

test('vertical manually activated native tabs use arrow focus then Enter without assuming automatic activation', async () => {
  const { browser, page } = await fixture({ vertical: true, manualActivation: true });
  try {
    const [row] = await collectNative44TabsChecks(page, [check], 'desktop-narrow');
    assert.equal(row.status, 'passed', row.problems.join('; ')); assert.equal(row.before!.orientation, 'vertical'); assert.ok(row.actions.some(action=>action.input==='ArrowDown')); assert.ok(row.actions.some(action=>action.input==='ArrowUp')); assert.equal(row.restored!.selectedKey, 'alpha');
  } finally { await browser.close(); }
});

test('tabs can be revealed through an explicitly bound native ancestor and restore its original closed state', async () => {
  const { browser, page } = await fixture({ nestedDisclosure: true });
  try {
    const nested = { ...check, revealDisclosureKey: disclosure.componentKey }, [row] = await collectNative44TabsChecks(page, [nested], 'desktop-wide', [disclosure]);
    assert.equal(row.status, 'passed', row.problems.join('; ')); assert.deepEqual(row.reveal, { componentKey: disclosure.componentKey, expandedBefore: false, restored: true }); assert.equal(await page.locator('details').getAttribute('open'), null); assert.equal(await page.locator('.trigger').getAttribute('aria-expanded'), 'false'); assert.equal(row.restored!.selectedKey, 'alpha');
  } finally { await browser.close(); }
});

test('native disclosure composition records exact compound roles and ancestor labels while leaving screen-reader semantics unverified', async () => {
  const {browser,page}=await fixture({nestedDisclosure:true,buttonType:'omitted'});
  try{
    await page.evaluate(()=>{document.querySelector('.trigger')!.setAttribute('aria-controls','outer-details');document.querySelector('.tablist')!.removeAttribute('aria-orientation');document.querySelectorAll('[data-id="abcdef1"] [role="tabpanel"]').forEach(panel=>{panel.setAttribute('role','region tabpanel');panel.setAttribute('aria-labelledby',`outer-details ${panel.getAttribute('aria-labelledby')}`);});});
    const nested={...check,revealDisclosureKey:disclosure.componentKey},[row]=await collectNative44TabsChecks(page,[nested],'desktop-wide',[disclosure]);
    assert.equal(row.status,'passed',row.problems.join('; '));assert.equal(native44TabsEvidencePassed(row,nested),true);assert.equal(row.screenReaderVerification,'unverified');assert.deepEqual(row.before!.disclosureContext,{componentKey:disclosure.componentKey,controlsId:'outer-details'});assert.equal(row.before!.orientation,'horizontal');assert.deepEqual(row.before!.bindings.map(binding=>[binding.panelRole,binding.ariaLabelledby,binding.labelledByIds,binding.compoundARIA]),check.items.map(item=>['region tabpanel',`outer-details tab-${item.key}`,['outer-details',`tab-${item.key}`],true]));assert.equal(row.reveal!.restored,true);
    const saved=row.before!.bindings[0].ariaLabelledby;row.before!.bindings[0].ariaLabelledby=`foreign-tab ${saved}`;assert.equal(native44TabsEvidencePassed(row,nested),false);
  }finally{await browser.close();}
});

test('only an actual declared disclosure summary and controls context may provide additional native tab labels', async()=>{
  const {browser,page}=await fixture({nestedDisclosure:true});
  try{
    await page.evaluate(()=>{document.querySelector('.trigger')!.id='outer-summary';document.querySelectorAll('[data-id="abcdef1"] [role="tabpanel"]').forEach(panel=>panel.setAttribute('aria-labelledby',`outer-panel outer-summary ${panel.getAttribute('aria-labelledby')}`));});
    const nested={...check,revealDisclosureKey:disclosure.componentKey},[row]=await collectNative44TabsChecks(page,[nested],'desktop-wide',[disclosure]);
    assert.equal(row.status,'passed',row.problems.join('; '));assert.equal(row.before!.disclosureContext!.summaryId,'outer-summary');assert.equal(row.before!.bindings.every(binding=>binding.compoundARIA),true);assert.equal(row.screenReaderVerification,'unverified');
  }finally{await browser.close();}
});

test('native compound ARIA does not allow undeclared composition, unknown IDREFs, duplicate labels or arbitrary roles',async()=>{
  const variants=['undeclared','foreign-label','missing-label','duplicate-label','extra-role','duplicate-role','missing-tabpanel'] as const;
  for(const variant of variants){
    const {browser,page}=await fixture({nestedDisclosure:true});
    try{
      await page.evaluate(kind=>{document.querySelectorAll('[data-id="abcdef1"] [role="tabpanel"]').forEach(panel=>{const own=panel.getAttribute('aria-labelledby')!;panel.setAttribute('role',kind==='extra-role'?'region tabpanel menu':kind==='duplicate-role'?'tabpanel tabpanel':kind==='missing-tabpanel'?'region':'region tabpanel');panel.setAttribute('aria-labelledby',kind==='foreign-label'?`foreign-tab ${own}`:kind==='missing-label'?`unknown-label ${own}`:kind==='duplicate-label'?`outer-panel ${own} ${own}`:`outer-panel ${own}`);});},variant);
      if(variant==='undeclared')await page.locator('.trigger').click();
      const nested={...check,...(variant!=='undeclared'?{revealDisclosureKey:disclosure.componentKey}:{})},[row]=await collectNative44TabsChecks(page,[nested],'desktop-wide',[disclosure]);
      assert.equal(row.status,'failed',variant);assert.match(row.problems.join('; '),/unique synchronized ARIA ownership|precise declared disclosure context/);assert.equal(row.actions.length,0);assert.deepEqual(await page.evaluate('window.actualInputs'),[]);if(variant!=='undeclared')assert.equal(row.reveal!.restored,true);
    }finally{await browser.close();}
  }
});

test('exact normalized label mappings discover actual generated ARIA ids without guessing panel selectors', async () => {
  const { browser, page } = await fixture({ nestedDisclosure: true });
  try {
    await page.evaluate(() => { document.querySelectorAll('[data-id="abcdef1"] [role="tab"]').forEach((tab,index)=>{ const panel=document.getElementById(tab.getAttribute('aria-controls')!)!;tab.id=`generated-title-${9137+index}`;panel.id=`generated-content-${9137+index}`;tab.setAttribute('aria-controls',panel.id);panel.setAttribute('aria-labelledby',tab.id);tab.textContent=`\n  ${tab.textContent}  \n`; });document.getElementById('foreign-tab')!.textContent='alpha'; });
    const labels: Native44TabsCheck={...check,items:check.items.map(item=>({key:item.key,label:item.key})),revealDisclosureKey:disclosure.componentKey};
    const [row]=await collectNative44TabsChecks(page,[labels],'desktop-wide',[disclosure]);
    assert.equal(row.status,'passed',row.problems.join('; ')); assert.equal(native44TabsEvidencePassed(row,labels),true); assert.deepEqual(row.before!.bindings.map(binding=>[binding.label,binding.tabId,binding.panelId]),[['alpha','generated-title-9137','generated-content-9137'],['beta','generated-title-9138','generated-content-9138'],['gamma','generated-title-9139','generated-content-9139']]);assert.equal(row.reveal!.restored,true);
  } finally {await browser.close();}
});

test('ambiguous native tab labels are rejected before activation and duplicate declared labels fail preflight', async () => {
  const labels: Native44TabsCheck={...check,items:check.items.map(item=>({key:item.key,label:item.key}))};
  assert.throws(()=>validateNative44TabsChecks([{...labels,items:[{key:'one',label:'alpha'},{key:'two',label:'  alpha  '}]}]),/unique explicit/);
  const {browser,page}=await fixture();
  try {await page.locator('#tab-beta').evaluate(element=>element.textContent='alpha');const [row]=await collectNative44TabsChecks(page,[labels],'desktop-wide');assert.equal(row.status,'failed');assert.equal(row.actions.length,0);assert.deepEqual(await page.evaluate('window.actualInputs'),[]);}
  finally {await browser.close();}
});

test('changing only tab ARIA cannot pass when its actual visible panel stays frozen', async () => {
  const { browser, page } = await fixture({ freezePanels: true, nestedDisclosure: true });
  try {
    const [row] = await collectNative44TabsChecks(page, [{ ...check, revealDisclosureKey: disclosure.componentKey }], 'desktop-wide', [disclosure]);
    assert.equal(row.status, 'failed'); assert.match(row.problems.join(' '), /actual visible panel/); assert.equal(row.restored!.selectedKey, 'alpha'); assert.equal(row.reveal!.restored, true); assert.equal(await page.locator('details').getAttribute('open'), null);
  } finally { await browser.close(); }
});

test('clickable tabs without actual arrow keyboard navigation fail and restore their original panel', async () => {
  const { browser, page } = await fixture({ blockArrow: true });
  try {
    const [row] = await collectNative44TabsChecks(page, [check], 'desktop-wide');
    assert.equal(row.status, 'failed'); assert.match(row.problems.join(' '), /did not move keyboard focus/); assert.equal(row.restored!.selectedKey, 'alpha');
  } finally { await browser.close(); }
});

test('duplicate panel ids and cross-owner changes are real tab blockers', async () => {
  for (const option of [{ duplicateId: true }, { crossOwner: true }]) {
    const { browser, page } = await fixture(option);
    try { const [row] = await collectNative44TabsChecks(page, [check], 'desktop-wide'); assert.equal(row.status, 'failed'); assert.match(row.problems.join(' '), option.duplicateId ? /unique synchronized ARIA ownership/ : /another native owner/); }
    finally { await browser.close(); }
  }
});

test('tab declarations reject missing owners, duplicate mappings and undeclared reveals while leaving old manifests unchanged', () => {
  assert.doesNotThrow(()=>validateNative44TabsChecks([])); assert.throws(()=>validateNative44TabsChecks([check,check]), /unique component/); assert.throws(()=>validateNative44TabsChecks([{...check,items:[check.items[0],check.items[0]]}]), /unique explicit/); assert.throws(()=>validateNative44TabsChecks([{...check,revealDisclosureKey:'unknown'}]), /declared owner/); assert.throws(()=>validateNative44TabsChecks([{...check,viewports:['mobile']}],[],['desktop-wide']), /viewport/);
  const digest='a'.repeat(64), manifest={widgetTypes:[],modules:[],tabsChecks:[check]} as unknown as Native44CompareManifest, capture:Native44Capture={viewport:'desktop-wide',width:1920,height:1080,clientWidth:1905,devicePixelRatio:1,source:{screenshot:'source',sha256:digest,modules:[]},target:{screenshot:'target',sha256:digest,modules:[]}};
  assert.deepEqual(analyzeNative44Captures({...manifest,tabsChecks:undefined},[capture]).gaps,[]); assert.match(analyzeNative44Captures(manifest,[capture]).gaps[0].detail,/Declared native tabs/);
});

test('standard capture includes native tab proof after ancestor reveal and restores the menu before pixels', async () => {
  const { browser, page } = await fixture({ nestedDisclosure: true }), directory=await mkdtemp(path.join(os.tmpdir(),'native44-tabs-capture-'));
  try {
    const nested={...check,revealDisclosureKey:disclosure.componentKey}, manifest={pageId:42,modules:[{key:'menu',sourceSelector:disclosure.selector,targetSelector:disclosure.selector}],disclosureChecks:[disclosure],tabsChecks:[nested]} as unknown as Native44CompareManifest;
    const capture=await captureNative44Role(page,'target',manifest,path.join(directory,'target.png'),'desktop-wide');
    assert.equal(capture.disclosureChecks![0].status,'passed'); assert.equal(capture.tabsChecks![0].status,'passed',capture.tabsChecks![0].problems.join('; ')); assert.equal(native44TabsEvidencePassed(capture.tabsChecks![0],nested),true); assert.equal(await page.locator('details').getAttribute('open'),null); assert.equal(capture.tabsChecks![0].reveal!.restored,true);
    const full={viewport:'desktop-wide',width:1920,height:1080,...capture,source:{screenshot:'source',sha256:'a'.repeat(64),modules:[]},target:capture} as Native44Capture;
    assert.deepEqual(analyzeNative44Captures({...manifest,widgetTypes:[],modules:[]},[full]).gaps,[]); capture.tabsChecks![0].actions.pop(); assert.equal(analyzeNative44Captures({...manifest,widgetTypes:[],modules:[]},[full]).gaps[0].blocking,true);
  } finally {await browser.close();await rm(directory,{recursive:true,force:true});}
});
