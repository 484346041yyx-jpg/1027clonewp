import path from 'node:path';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { native44KnowledgeIdentity } from './knowledge.js';
import { walkNative44, type Native44Program } from './types.js';
import { buildSourceFactsV2, validateSourceFactsV2 } from '../replica-v2/source.js';
import { validateObservationPacketV2 } from '../replica-v2/observation.js';
import { sourceFooterNodes } from '../replica-full/page-scope.js';
import { fullReplicaHash } from '../replica-full/contract.js';

const root = 'D:/cloneWP';
export async function readNativeContentRef(ref: {path:string;sha256:string}, base=root): Promise<Buffer> {
  if (!/^[a-f0-9]{64}$/.test(ref.sha256)) throw Error('replica_full_public_reference');
  const actualRoot = await realpath(root), filename = path.resolve(base, ref.path), relative = path.relative(actualRoot, filename);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw Error('replica_full_public_path');
  let cursor = actualRoot;
  for (const part of relative.split(path.sep)) { cursor = path.join(cursor, part); const info = await lstat(cursor); if (info.isSymbolicLink() || (await realpath(cursor)).toLowerCase() !== cursor.toLowerCase()) throw Error('replica_full_public_reparse'); }
  const info = await lstat(filename); if (!info.isFile() || info.size > 32*1024*1024) throw Error('replica_full_public_file_size');
  const bytes = await readFile(filename); if (createHash('sha256').update(bytes).digest('hex') !== ref.sha256) throw Error('replica_full_public_reference_changed'); return bytes;
}
/** Same native44 evidence and knowledge, with the selected public region as owner. */
export async function verifyNativeContentSource(program: Native44Program, role:'header'|'footer') {
  const identity = await native44KnowledgeIdentity(root);
  for (const key of ['knowledge','componentCatalog','targetEnvironment'] as const) if (fullReplicaHash(program[key]) !== fullReplicaHash(identity[key])) throw Error('replica_full_public_knowledge_changed');
  const facts = validateSourceFactsV2(JSON.parse((await readNativeContentRef(program.sourceFacts)).toString('utf8')));
  await Promise.all([program.componentPlan,program.assetsManifest].map(ref=>readNativeContentRef(ref)));
  if (facts.sourceUrl !== program.sourceUrl) throw Error('replica_full_public_source_changed');
  const refs = [...new Map(facts.snapshots.flatMap(s=>s.evidence).map(ref=>[ref.path,ref])).values()];
  const packets = await Promise.all(refs.map(async ref=>validateObservationPacketV2(JSON.parse((await readNativeContentRef(ref,path.dirname(program.sourceFacts.path))).toString('utf8')))));
  if (packets.some(p=>p.snapshot.url!==program.sourceUrl)) throw Error('replica_full_public_source_changed');
  const expected=buildSourceFactsV2({manifestPath:facts.observation.path,manifestSha256:facts.observation.sha256,manifest:{version:2,kind:'observation-manifest',sourceUrl:program.sourceUrl,provenance:{method:'user-opened-browser',observer:'cua_repl',browser:'chrome'},packets:[],screenshots:[]},packets,packetFiles:refs.map((ref,i)=>({...ref,snapshotId:packets[i].snapshot.id}))});
  for (const node of walkNative44(program.blocks)) {
    if (node.kind!=='composite'&&!node.sourceFactIds?.length) throw Error('replica_full_public_fact_missing');
    for (const id of node.sourceFactIds??[]) {
      const fact=facts.facts[id], packet=fact&&packets[refs.findIndex(ref=>ref.path===fact.evidence.path)];
      if(!fact||!packet||!expected.facts[id]||fullReplicaHash(expected.facts[id])!==fullReplicaHash(fact))throw Error('replica_full_public_fact_not_observed');
      const footerNodes=sourceFooterNodes(packet);
      let cursor:string|null=fact.nodeId, owned=role==='footer'&&footerNodes.has(fact.nodeId);const seen=new Set<string>();
      while(role==='header'&&cursor&&!seen.has(cursor)){seen.add(cursor);const n:typeof packet.nodes[string]|undefined=packet.nodes[cursor];if(!n)break;if(n.tag==='header'||n.attributes.role==='banner'||packet.regions.some(r=>r.nodeId===cursor&&r.role==='header'))owned=true;cursor=n.parentId;}
      if(!owned)throw Error('replica_full_public_fact_outside_'+role);
    }
  }
  return facts;
}
