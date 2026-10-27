import type { ObservationPacketV2 } from '../replica-v2/observation.js';
import type { SourceFactsV2 } from '../replica-v2/source.js';
import { sourceFooterNodes } from './page-scope.js';

export function publicSourceNodes(packet:ObservationPacketV2,scope:'header-only'|'footer-only'|'header-footer') {
  const owned=scope==='header-only'?new Set<string>():sourceFooterNodes(packet);
  if(scope!=='footer-only')for(const node of Object.values(packet.nodes)){
    let cursor:string|null=node.id;const seen=new Set<string>();
    while(cursor&&!seen.has(cursor)){seen.add(cursor);const n:ObservationPacketV2['nodes'][string]|undefined=packet.nodes[cursor];if(!n)break;if(n.tag.toLowerCase()==='header'||n.attributes.role==='banner'||packet.regions.some(r=>r.nodeId===cursor&&/^(header|banner|site-header)$/.test(r.role))){owned.add(node.id);break;}cursor=n.parentId;}
  }
  return owned;
}
/** Reused body/header facts never create hover obligations outside this scope. */
export function publicHoverFacts(facts:SourceFactsV2,packets:ObservationPacketV2[],scope:'header-only'|'footer-only'|'header-footer'):SourceFactsV2 {
  const selected=new Map<string,Set<string>>();for(const p of packets){const nodes=selected.get(p.snapshot.id)??new Set<string>();for(const id of publicSourceNodes(p,scope))nodes.add(id);selected.set(p.snapshot.id,nodes);}
  return {...facts,facts:Object.fromEntries(Object.entries(facts.facts).filter(([,f])=>selected.get(f.snapshotId)?.has(f.nodeId)))};
}
