import path from 'node:path';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {validateObservationPacketV2} from '../replica-v2/observation.js';
import {carouselMotionFrameSchema} from './motion-review.js';

type Ref={path:string;sha256:string};
type Reader=(reference:Ref,base?:string)=>Promise<{filename:string;bytes:Buffer}>;
const digest=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
function fail(reason:string):never{throw Error(`replica_responsive_projection_${reason}`);}
const token=(value:unknown,name:string)=>typeof value==='string'&&value.split(/\s+/).includes(name);

/** Projects a real native action into a separate packet. The original static
 * packet remains declared. This is not a generic status or count override. */
export async function projectObservedPhoneCarousel(input:{sourcePacket:Ref;actionSource:Ref;actionName:string;interactionId:string;componentKey:string;sectionKey:string;taskId:string;read:Reader}){
 const checked=async(reference:Ref,base?:string)=>{const file=await input.read(reference,base);if(digest(file.bytes)!==reference.sha256)fail('reference_changed');return file;};
 const originalFile=await checked(input.sourcePacket),actionFile=await checked(input.actionSource);
 const original=validateObservationPacketV2(JSON.parse(originalFile.bytes.toString('utf8'))),raw=JSON.parse(actionFile.bytes.toString('utf8'));
 if(!['source-native-interactions','source-phone-gallery-native-motion'].includes(raw.kind)||raw.version!==1||raw.provenance?.method!=='agent-opened-browser'||raw.provenance?.observer!=='playwright'||!raw.binding?.browserId||!raw.binding?.tabId||!raw.binding?.frameId||raw.sourceUrl!==original.snapshot.url)fail('action_provenance');
 if(raw.viewport?.width!==original.snapshot.viewport.width||raw.viewport?.height!==original.snapshot.viewport.height||original.snapshot.viewport.width>767)fail('viewport');
 const records=raw.records??raw.actions,actions=Array.isArray(records)?records.filter((row:any)=>row.name===input.actionName):[];
 if(actions.length!==1)fail('action_identity');
 const action=actions[0];if((action.kind??action.nativeAction)!=='click'||!action.selector||action.target?.insideForm)fail('native_action');
 const interaction=original.interactions[input.interactionId];
 if(!interaction||interaction.kind!=='carousel'||!interaction.trackNodeId)fail('interaction_identity');
 const track=original.nodes[interaction.trackNodeId],owner=original.nodes[interaction.nodeId];
 if(!track||!owner)fail('track_owner');
 const tree:string[]=[];
 const visit=(id:string)=>{const node=original.nodes[id];if(!node)fail('source_tree');if(token(node.attributes.class,'swiper-slide'))tree.push(id);for(const child of node.childIds)visit(child);};visit(track.id);
 const declared=new Set([...(interaction.itemNodeIds??[]),...(interaction.cloneNodeIds??[])]);
 if(tree.length<2||tree.length!==declared.size||tree.some(id=>!declared.has(id)))fail('track_inventory');
 const originalTrack=original.layouts[track.layoutId].rect;
 const gallery=raw.kind==='source-phone-gallery-native-motion';
 const states=[action.before,action.after];
 const frames:any[]=[],shots:Ref[]=[],visibleCounts:number[]=[];
 for(const capture of states){
  if(!capture?.before||!capture.after||!capture.screenshot)fail('capture_pair');
  const state=capture.before,end=capture.after;
  if(state.url!==original.snapshot.url||state.viewport?.width!==original.snapshot.viewport.width||state.viewport?.height!==original.snapshot.viewport.height||state.viewport?.clientWidth!==original.snapshot.viewport.clientWidth||end.url!==state.url||!Number.isFinite(Date.parse(state.observedAt))||!Number.isFinite(Date.parse(end.observedAt)))fail('capture_identity');
  let observed:any,settled:any;
  if(gallery){
   const sourceGallery=Object.values(original.nodes).find(n=>token(n.attributes.class,'pro_img'));
   if(!sourceGallery||Math.abs(original.layouts[sourceGallery.layoutId].rect.width-state.gallery?.rect?.width)>2)fail('gallery_viewport');
   const inset=originalTrack.x-original.layouts[sourceGallery.layoutId].rect.x;
   observed={rect:{...originalTrack,x:state.gallery.rect.x+inset},slides:state.gallery?.thumbnails};
   settled={rect:{...originalTrack,x:end.gallery.rect.x+inset},slides:end.gallery?.thumbnails};
  }else{
   const candidates=(state.carousels??[]).filter((c:any)=>c.slides?.length===tree.length&&c.slides.every((s:any,i:number)=>s.label===original.nodes[tree[i]].attributes['aria-label']));
   const settledCandidates=(end.carousels??[]).filter((c:any)=>c.slides?.length===tree.length&&c.slides.every((s:any,i:number)=>s.label===original.nodes[tree[i]].attributes['aria-label']));
   if(candidates.length!==1||settledCandidates.length!==1)fail('track_ambiguous');
   observed=candidates[0];settled=settledCandidates[0];
  }
  if(!Array.isArray(observed.slides)||observed.slides.length!==tree.length||!Array.isArray(settled.slides)||settled.slides.length!==tree.length||Math.abs(observed.rect.width-originalTrack.width)>2)fail('track_geometry');
  const active=observed.slides.filter((s:any)=>token(s.class,'swiper-slide-active'));
  if(active.length!==1)fail('active_identity');
  for(let i=0;i<tree.length;i++){
   const s=observed.slides[i],after=settled.slides[i],source=original.layouts[original.nodes[tree[i]].layoutId].rect;
   if(s.index!==i||after.index!==i||Math.abs(s.rect.width-source.width)>2||Math.abs(s.rect.x-after.rect.x)>1||Math.abs(s.rect.width-after.rect.width)>1||token(s.class,'swiper-slide-active')!==token(after.class,'swiper-slide-active'))fail('unsettled_or_reordered');
  }
  const frame=carouselMotionFrameSchema.parse({viewportWidth:observed.rect.width,activeIndex:active[0].index,items:observed.slides.map((s:any)=>({index:s.index,x:s.rect.x-observed.rect.x,width:s.rect.width}))});
  frames.push(frame);visibleCounts.push(frame.items.filter(s=>s.x>=-2&&s.x+s.width<=frame.viewportWidth+2).length);
  const screenshot={path:capture.screenshot.path,sha256:capture.screenshot.sha256};
  const image=await checked(screenshot,path.dirname(actionFile.filename)),metadata=await sharp(image.bytes).metadata();
  if(metadata.width!==state.viewport.width*state.viewport.devicePixelRatio||metadata.height!==state.viewport.height*state.viewport.devicePixelRatio)fail('screenshot_dimensions');
  shots.push({path:image.filename,sha256:screenshot.sha256});
 }
 if(frames[0].activeIndex===frames[1].activeIndex||!frames[0].items.some((s:any)=>Math.abs(s.x-frames[1].items[s.index].x)>2))fail('no_track_motion');
 if(!visibleCounts[0]||visibleCounts[0]!==visibleCounts[1])fail('visible_count_changed');
 const packet=structuredClone(original),projected=packet.interactions[input.interactionId];
 projected.status='observed';projected.details={...projected.details,behaviorVerified:true,visibleItems:visibleCounts[0],projection:'hash-bound-native-click-v1'};
 // Only the action has become observed. Static nodes, geometry and screenshot
 // identities stay exactly as captured; motion frames carry their own pixels.
 validateObservationPacketV2(packet);
 return {packet,receipt:{version:1,kind:'clonewp-responsive-observed-interaction-projection',taskId:input.taskId,sourceUrl:original.snapshot.url,sourcePacket:input.sourcePacket,actionSource:input.actionSource,actionName:input.actionName,interactionId:input.interactionId,provenance:raw.provenance,binding:raw.binding,beforeScreenshot:shots[0],afterScreenshot:shots[1]},
  motionRow:{componentKey:input.componentKey,sectionKey:input.sectionKey,snapshotId:original.snapshot.id,sourceNodeId:track.id,width:original.snapshot.viewport.width,height:original.snapshot.viewport.height,clientWidth:original.snapshot.viewport.clientWidth,observedAt:action.after.before.observedAt,before:frames[0],after:frames[1],beforeScreenshot:shots[0],afterScreenshot:shots[1]}};
}
