import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { validatePublicReplicaManifest } from '../src/replica-full/public-contract.js';
import { selectReplicaEntry } from '../src/replica-full/entry.js';
import { replicaInstructionScope } from '../src/replica-full/page-scope.js';
import { publicSourceNodes, publicHoverFacts } from '../src/replica-full/public-source.js';
import { PublicResourceDriver, publicPayloadHash } from '../src/replica-full/public-driver.js';
import { createHash } from 'node:crypto';
import { publicHeaderProtection } from '../src/replica-full/public-scope.js';

const ref={path:'source.json',sha256:'a'.repeat(64)};
function fixture(scope='footer-only'){
  const header={plan:{kind:'clonewp-header-module',version:1,moduleKey:'new-header',targetOrigin:'https://target.example',owner:{ownerId:'new-public',runId:'new-public-run'},name:'New header',menus:[{key:'main',name:'New menu',items:[{key:'home',parentKey:null,title:'Home',url:'/'}]}],layout:{rows:[{slot:'general-header',params:{},columns:{left:[],center:[{key:'nav',type:'mainmenu',menuKey:'main',params:{}}],right:[]}}],settings:{}},style:{css:'',fonts:[]}},bundleDirectory:'header'};
  const footer={program:ref,css:ref,assets:ref,responsive:{version:1,tablet:'desktop',mobileMaxWidth:768,viewports:[{width:390,height:844},{width:430,height:932}],source:ref,sections:[{key:'footer',mode:'shared',reason:'The source footer keeps one common editable content tree.',evidence:[{snapshotId:'phone1',nodeId:'footer'},{snapshotId:'phone2',nodeId:'footer'}],settings:[],childOrders:[],css:''}]}};
  return {version:5,kind:'clonewp-full-replica',taskId:'new-public',runId:'new-public-run',pageScope:scope,title:'New footer',sourceUrl:'https://source.example/',targetOrigin:'https://target.example',sourceEvidence:ref,preview:{title:'New public preview',slug:'new-public-preview'},deliveryPolicy:'draft-for-user-review',...(scope!=='footer-only'?{header}:{}),...(scope!=='header-only'?{footer}:{})};
}
test('three public commands keep their exact scopes and use the existing full creation entry',()=>{
  for(const [command,scope] of [['复刻页眉页脚','header-footer'],['复刻页眉','header-only'],['复刻页脚','footer-only']] as const){assert.equal(replicaInstructionScope(command),scope);const m=validatePublicReplicaManifest(fixture(scope));assert.equal(selectReplicaEntry(m,[]),'public');assert.equal(m.header!==undefined,scope!=='footer-only');assert.equal(m.footer!==undefined,scope!=='header-only');}
  assert.equal(replicaInstructionScope('复刻网页'),'body-only');assert.throws(()=>replicaInstructionScope('复刻其它'));
  assert.throws(()=>validatePublicReplicaManifest({...fixture(),header:(fixture('header-only') as any).header}),/scope/);
  assert.throws(()=>validatePublicReplicaManifest({...fixture(),footer:undefined}),/scope/);
  assert.throws(()=>validatePublicReplicaManifest({...fixture(),globalFooterId:21558}));
  assert.throws(()=>validatePublicReplicaManifest({...fixture(),deliveryPolicy:'publish-without-review'}));
});
function packet(){const defs=[['header',null,'header'],['header-link','header','a'],['main',null,'main'],['body-link','main','a'],['footer',null,'footer'],['footer-link','footer','a'],['card-footer','main','footer']];return {snapshot:{id:'wide'},regions:[],nodes:Object.fromEntries(defs.map(([id,parentId,tag])=>[id,{id,parentId,tag,attributes:{},childIds:[],selector:'#'+id}]))} as any;}
test('hover source scope selects public regions without body or article footers, including split packets',()=>{
  const p=packet();assert.deepEqual([...publicSourceNodes(p,'footer-only')].sort(),['footer','footer-link']);assert.deepEqual([...publicSourceNodes(p,'header-only')].sort(),['header','header-link']);
  const facts={snapshots:[],facts:Object.fromEntries(['header-link','body-link','footer-link'].map(id=>[id,{nodeId:id,snapshotId:'wide'}]))} as any;
  assert.deepEqual(Object.keys(publicHoverFacts(facts,[p],'footer-only').facts),['footer-link']);
  const header=structuredClone(p),footer=structuredClone(p);delete header.nodes.footer;delete header.nodes['footer-link'];delete footer.nodes.header;delete footer.nodes['header-link'];
  assert.deepEqual(Object.keys(publicHoverFacts(facts,[header,footer],'header-footer').facts),['header-link','footer-link']);
});
test('known preview edits cannot authorize accepting changed public header resources',()=>{
  const snapshot:any={globalHash:'a',defaultHeaderId:'header_1',presetReferences:[],otherReferences:[],module:{identity:{runId:'own'},name:'Header',menus:{main:{id:9}},style:{id:10,css:'one'},header:{id:'header_2'},pages:{},receipts:{}}};
  const before=publicHeaderProtection(snapshot);snapshot.module.pages[100]={content:'new preview'};snapshot.module.receipts.saved={state:'complete'};assert.equal(publicHeaderProtection(snapshot),before);
  snapshot.module.menus.main.id=11;assert.notEqual(publicHeaderProtection(snapshot),before);
});
test('public footer writes require current-process compiler proof and stop at incomplete receipts',async()=>{
  let writes=0;const driver=new PublicResourceDriver({origin:'https://target.example',async readPHP(){throw Error('unused');},async executePHP(){writes++;throw Error('unexpected');}}, {targetOrigin:'https://target.example',runId:'new-run',contractHash:'a'.repeat(64)});
  const before:any={hash:'b'.repeat(64),snapshot:{preview:null,footer:null,globalHash:'c'.repeat(64),receipts:{}}};const intent={runId:'new-run',resource:'public-resources/new-run',operationId:'op',expectedSnapshotSha256:before.hash,persistedIntentSha256:'d'.repeat(64)};
  await assert.rejects(driver.mutate('save-footer',{elements:[],settings:{}},before,intent),/compiler_required/);before.snapshot.receipts.old={state:'started'};
  await assert.rejects(driver.mutate('create-preview',{title:'New',slug:'new'},before,intent),/reconcile_required/);assert.equal(writes,0);
});
test('public payload hashes match PHP associative decoding without losing nonempty settings',()=>{
  assert.equal(publicPayloadHash({}),createHash('sha256').update('[]').digest('hex'));
  assert.equal(publicPayloadHash({settings:{},elements:[]}),publicPayloadHash({settings:[],elements:[]}));
  assert.notEqual(publicPayloadHash({settings:{title:'one'}}),publicPayloadHash({settings:{title:'two'}}));
});
const php=join('D:/cloneWP','.cache','php-8.3','php.exe');
test('actual PHP public adapter preserves existing footer and globals, refuses stale/unknown writes, and saves a native footer with a referencing preview',{skip:!existsSync(php)},()=>{
  const out=execFileSync(php,['D:/cloneWP/tests/fixtures/public-resource-driver.php'],{cwd:'D:/cloneWP',encoding:'utf8',timeout:10000});assert.match(out,/public resource ownership, CAS, native save and preview passed/);
});
