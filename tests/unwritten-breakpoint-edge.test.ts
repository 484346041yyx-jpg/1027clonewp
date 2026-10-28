import test from 'node:test';
import assert from 'node:assert/strict';
import {assertBreakpointEdgeMetadataOnly,assertUnwrittenBreakpointEdgeState,unwrittenBodyStyleRequestSchema} from '../src/replica-full/unwritten-body-style-amendment.js';
import {fullReplicaHash} from '../src/replica-full/contract.js';

/** Synthetic isolated fixtures: no browser, credentials, files or remote calls. */
function metadataFixture(){
 const original:any={version:2,sourceUrl:'https://reference.example/contact',taskId:'edge-fixture',blocks:[{kind:'composite',key:'contact',settings:{flex_direction:'column'},sourceFactIds:['wide:title','narrow:title'],children:[{kind:'native',key:'contact_title',widgetType:'heading',widgetSettings:{title:'Unchanged inquiry title',typography_font_size_mobile:{unit:'px',size:24}},sourceFactIds:['wide:title','narrow:title'],styleBindings:[{sourceFactId:'wide:title',selector:'.elementor-heading-title',minWidth:768,maxWidth:10000,properties:['font-size']},{sourceFactId:'narrow:title',selector:'.elementor-heading-title',minWidth:1000,maxWidth:1600,properties:['line-height']}],nativeStyleSettings:[{controlId:'typography_font_size',value:{unit:'px',size:32},minWidth:768,maxWidth:10000,sourceFactIds:['wide:title','narrow:title'],reason:'Actual desktop typography remains unchanged.'},{controlId:'align',value:'center',minWidth:1000,maxWidth:1600,sourceFactIds:['narrow:title'],reason:'Unchanged independently scoped intent.'}]}]}]};
 const source:any={version:2,kind:'source-facts',sourceUrl:original.sourceUrl,snapshots:[{id:'wide',viewport:{width:1920}},{id:'narrow',viewport:{width:1440}},{id:'phone',viewport:{width:390}}],facts:{'wide:title':{id:'wide:title',snapshotId:'wide',kind:'text'},'narrow:title':{id:'narrow:title',snapshotId:'narrow',kind:'text'}}};
 const responsive:any={mobileMaxWidth:768,sections:[{key:'contact',css:':page .contact{color:#222}',settings:[]}]};
 const effective=structuredClone(original);effective.blocks[0].children[0].styleBindings[0].minWidth=769;effective.blocks[0].children[0].nativeStyleSettings[0].minWidth=769;
 return {original,effective,source,responsive};
}
const title=(program:any)=>program.blocks[0].children[0];

test('breakpoint edge amendment accepts existing binding and native intent together and separately',()=>{
 for(const family of ['both','binding','native'] as const){
  const f=metadataFixture();
  if(family==='binding')title(f.effective).nativeStyleSettings[0].minWidth=768;
  if(family==='native')title(f.effective).styleBindings[0].minWidth=768;
  const before=structuredClone(f);
  assert.doesNotThrow(()=>assertBreakpointEdgeMetadataOnly(f.original,f.effective,f.responsive,f.source));
  assert.deepEqual(f,before,'validation must not mutate either program or evidence');
 }
});

const metadataAttacks:Array<[string,(f:ReturnType<typeof metadataFixture>)=>void]>=[
 ['no change',f=>{f.effective=structuredClone(f.original);}],
 ['old binding lower edge is not breakpoint',f=>{title(f.original).styleBindings[0].minWidth=767;}],
 ['new binding lower edge jumps two pixels',f=>{title(f.effective).styleBindings[0].minWidth=770;}],
 ['old native intent lower edge is not breakpoint',f=>{title(f.original).nativeStyleSettings[0].minWidth=767;}],
 ['new native intent lower edge jumps two pixels',f=>{title(f.effective).nativeStyleSettings[0].minWidth=770;}],
 ['binding maximum changes',f=>{title(f.effective).styleBindings[0].maxWidth=9999;}],
 ['native intent maximum changes',f=>{title(f.effective).nativeStyleSettings[0].maxWidth=9999;}],
 ['native value changes',f=>{title(f.effective).nativeStyleSettings[0].value.size=33;}],
 ['native control identity changes',f=>{title(f.effective).nativeStyleSettings[0].controlId='typography_line_height';}],
 ['binding selector changes',f=>{title(f.effective).styleBindings[0].selector='.other';}],
 ['binding properties change',f=>{title(f.effective).styleBindings[0].properties.push('color');}],
 ['binding source identity changes',f=>{title(f.effective).styleBindings[0].sourceFactId='narrow:title';}],
 ['native source identities change',f=>{title(f.effective).nativeStyleSettings[0].sourceFactIds=['wide:title'];}],
 ['binding row inserted',f=>{title(f.effective).styleBindings.push(structuredClone(title(f.effective).styleBindings[0]));}],
 ['native row removed',f=>{title(f.effective).nativeStyleSettings.pop();}],
 ['binding order changes',f=>{title(f.effective).styleBindings.reverse();}],
 ['native order changes',f=>{title(f.effective).nativeStyleSettings.reverse();}],
 ['widget content changes',f=>{title(f.effective).widgetSettings.title='Replacement title';}],
 ['embedded mobile value changes',f=>{title(f.effective).widgetSettings.typography_font_size_mobile.size=25;}],
 ['component key changes',f=>{title(f.effective).key='contact_other';}],
 ['component order changes',f=>{f.effective.blocks.unshift({kind:'composite',key:'new',children:[]});}],
 ['breakpoint disagrees with existing edge',f=>{f.responsive.mobileMaxWidth=767;}],
 ['changed binding points to missing actual fact',f=>{delete f.source.facts['wide:title'];}],
 ['changed native intent points to missing snapshot',f=>{f.source.snapshots=f.source.snapshots.filter((s:any)=>s.id!=='narrow');}],
 ['actual binding viewport lost by new lower edge',f=>{f.source.snapshots[0].viewport.width=768;}],
 ['actual native viewport lost by unchanged maximum',f=>{f.source.snapshots[1].viewport.width=10001;}],
 ['source URL mismatch',f=>{f.source.sourceUrl='https://other.example/contact';}],
];
for(const[name,attack]of metadataAttacks)test('breakpoint edge amendment rejects '+name,()=>{
 const f=metadataFixture();attack(f);
 assert.throws(()=>assertBreakpointEdgeMetadataOnly(f.original,f.effective,f.responsive,f.source));
});

function stateFixture(){
 const manifest:any={version:4,kind:'clonewp-full-replica',taskId:'independent-edge-task',runId:'independent-edge-run',targetOrigin:'https://owned.example',headerProvider:'reused-woodmart-header',reusedHeader:{headerId:'header_42'},responsive:{mobileMaxWidth:768},body:{program:{path:'unused-program.json',sha256:'a'.repeat(64)}}};
 const page={pageId:54321,runId:manifest.runId,status:'draft',template:'elementor_header_footer',headerId:null,bodyHash:'b'.repeat(64)};
 const state:any={taskId:manifest.taskId,runId:manifest.runId,manifestHash:fullReplicaHash(manifest),status:'building',revision:7,pending:null,checkpoints:{page},review:null};
 return{manifest,state,pageId:page.pageId};
}
test('generic breakpoint state accepts exact owned page independently of historic literal task',()=>{
 const f=stateFixture();assert.doesNotThrow(()=>assertUnwrittenBreakpointEdgeState(f.manifest,f.state,f.pageId));
});
const stateAttacks:Array<[string,(f:ReturnType<typeof stateFixture>)=>void]>=[
 ['different task',f=>{f.state.taskId='foreign-task';}],
 ['different run',f=>{f.state.runId='foreign-run';}],
 ['manifest hash drift',f=>{f.state.manifestHash='c'.repeat(64);}],
 ['requested page differs',f=>{f.pageId++;}],
 ['page run differs',f=>{f.state.checkpoints.page.runId='foreign-run';}],
 ['unreconciled pending operation',f=>{f.state.pending={operationId:'unresolved'};}],
 ['saved body checkpoint',f=>{f.state.checkpoints.body={pageId:f.pageId};}],
 ['bound header checkpoint',f=>{f.state.checkpoints.bound={pageId:f.pageId};}],
 ['page already bound',f=>{f.state.checkpoints.page.headerId='header_42';}],
 ['published page',f=>{f.state.checkpoints.page.status='publish';}],
 ['different page template',f=>{f.state.checkpoints.page.template='elementor_canvas';}],
 ['existing review',f=>{f.state.review={accepted:true};}],
 ['existing amendment pointer',f=>{f.state.bodyStyleAmendment={path:'existing',sha256:'d'.repeat(64)};}],
 ['nonbuilding state',f=>{f.state.status='write-unknown';}],
 ['unsupported manifest version',f=>{f.manifest.version=3;f.state.manifestHash=fullReplicaHash(f.manifest);}],
 ['different header provider',f=>{f.manifest.headerProvider='woodmart-header-builder';f.state.manifestHash=fullReplicaHash(f.manifest);}],
 ['absent shared header identity',f=>{delete f.manifest.reusedHeader;f.state.manifestHash=fullReplicaHash(f.manifest);}],
 ['absent responsive plan',f=>{delete f.manifest.responsive;f.state.manifestHash=fullReplicaHash(f.manifest);}],
];
for(const[name,attack]of stateAttacks)test('generic breakpoint state rejects '+name,()=>{
 const f=stateFixture();attack(f);assert.throws(()=>assertUnwrittenBreakpointEdgeState(f.manifest,f.state,f.pageId));
});

test('generic v3 request does not permit a replacement responsive plan',()=>{
 const ref={path:'synthetic.json',sha256:'a'.repeat(64)};
 const request={version:3,kind:'clonewp-unwritten-breakpoint-edge-amendment-request',taskId:'edge-fixture',runId:'edge-run',pageId:54321,expectedManifestHash:'b'.repeat(64),expectedStateRevision:1,expectedCheckpointHash:'c'.repeat(64),reason:'Correct only the existing desktop breakpoint edge.',program:ref,evidence:[ref]};
 assert.equal(unwrittenBodyStyleRequestSchema.safeParse(request).success,true);
 assert.equal(unwrittenBodyStyleRequestSchema.safeParse({...request,responsive:{mobileMaxWidth:700}}).success,false);
});
