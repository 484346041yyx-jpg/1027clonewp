import path from 'node:path';
import { lstat, readFile, realpath, open, statfs } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { validateNative44Program } from '../../native44/validate.js';
import { walkNative44, type Native44Program, type Native44Compiled } from '../../native44/types.js';
import { compileNative44, assertNative44Compilation, referencedNative44Assets, usedNative44WidgetTypes } from '../../native44/compiler.js';
import { loadNative44Knowledge, native44KnowledgeIdentity, toNative44CompilerKnowledge } from '../../native44/knowledge.js';
import { validateSourceFactsV2, buildSourceFactsV2 } from '../../replica-v2/source.js';
import { validateObservationPacketV2, type ObservationPacketV2 } from '../../replica-v2/observation.js';
import { headerJsonHash } from '../contract.js';
import type { HeaderModuleMenu } from './contract.js';
import type { WordPressClient } from '../../wordpress/client.js';
import type {ImportedAssetV2,FileRef} from '../../replica-v2/types.js';
import {headerDropdownSchema,compileHeaderDropdown,type HeaderDropdownSettings} from './dropdown.js';

export interface HeaderMenuContent { key: string; name: string; menuKey: string; itemKey: string; program: Native44Program; version?:2; dropdown?:HeaderDropdownSettings; assets?:FileRef; assetSource?:'header-assets'; retireChildren?:string[] }
export interface HeaderMenuContentPayload {
  key: string; name: string; menuKey: string; itemKey: string; programHash: string; contractFingerprint: string;
  elements: Native44Compiled['composition']['elements']; settings: Native44Compiled['composition']['pageSettings'];
  queries: Native44Compiled['queryReceipts'];
  version?:2; dropdown?:Record<string,string>; media?:ImportedAssetV2[]; retireChildren?:string[];
}
export type HeaderMenuContentClient = Pick<WordPressClient, 'discoverCapabilities' | 'readTargetCatalog'>;
const root = 'D:/cloneWP';
const allowed = new Set(['heading', 'text-editor', 'wd_list', 'button', 'wd_button']);
const sha = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
function fail(code: string): never { throw Error(`woodmart_header_content_${code}`); }
/** Conversion authorizes the exact old branch, never an arbitrary list of menu items. */
export function assertHeaderMenuRetirement(items:Array<{key:string;parentKey:string|null}>,owner:string,retired:string[]):void{
  const descendants=new Set([owner]);let changed=true;
  while(changed){changed=false;for(const item of items)if(item.parentKey&&descendants.has(item.parentKey)&&!descendants.has(item.key)){descendants.add(item.key);changed=true;}}
  descendants.delete(owner);
  if(new Set(retired).size!==retired.length||retired.length!==descendants.size||retired.some(k=>!descendants.has(k)))fail('retirement_exact_branch_required');
}
const entrySchema = z.object({ key: z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,79}$/), name: z.string().trim().min(1).max(200), menuKey: z.string(), itemKey: z.string(), program: z.unknown(),version:z.literal(2).optional(),dropdown:headerDropdownSchema.optional(),assets:z.object({path:z.string(),sha256:z.string().regex(/^[a-f0-9]{64}$/)}).strict().optional(),assetSource:z.literal('header-assets').optional(),retireChildren:z.array(z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/)).min(1).max(199).optional() }).strict();

/** v1 deliberately reuses existing native containers, static navigation and wd_products only. */
export function validateHeaderMenuContent(input: unknown, menus: HeaderModuleMenu[], runId: string): HeaderMenuContent[] {
  const entries = z.array(entrySchema).min(1).max(40).parse(input), keys = new Set<string>(), bindings = new Set<string>();
  return entries.map(entry => {
    const binding = `${entry.menuKey}/${entry.itemKey}`, menu = menus.find(item => item.key === entry.menuKey), owner = menu?.items.find(item => item.key === entry.itemKey);
    if (!owner || menu!.items.some(item => item.parentKey === owner.key) || keys.has(entry.key) || bindings.has(binding)) fail('leaf_binding_required');
    keys.add(entry.key); bindings.add(binding);
    const mega=entry.version===2;
    if(mega?!entry.dropdown:entry.dropdown!==undefined||entry.assets!==undefined||entry.assetSource!==undefined||entry.retireChildren!==undefined)fail('content_version_contract');
    if(entry.assets&&entry.assetSource)fail('media_source_conflict');
    if(entry.retireChildren&&(new Set(entry.retireChildren).size!==entry.retireChildren.length||entry.retireChildren.some(k=>k===entry.itemKey||menu!.items.some(i=>i.key===k))))fail('retired_children_must_be_absent_from_desired_menu');
    const program = validateNative44Program(entry.program), nodes = walkNative44(program.blocks);
    if (program.taskId !== runId || program.replicationProfile !== 'desktop-browser-v1' || !mega&&referencedNative44Assets(program).size || nodes.length > 500) fail('program_scope_invalid');
    if(mega&&referencedNative44Assets(program).size&&!entry.assets&&!entry.assetSource)fail('mega_media_ledger_required');
    if (!mega&&!nodes.some(node => node.kind === 'native-products')) fail('products_required');
    for (const node of nodes) {
      if (node.kind === 'composite') continue;
      if (node.kind === 'native-products' && node.widgetType === 'wd_products' && node.query && node.query.ids.length <= 8) continue;
      if (node.kind === 'native' && allowed.has(node.widgetType) && !node.children?.length && !node.pendingForm && !node.resources?.length) continue;
      if(mega&&node.kind==='native'&&['wd_image_or_svg','image-box','divider'].includes(node.widgetType)&&!node.children?.length&&!node.pendingForm&&!node.resources?.length)continue;
      fail('unsupported_component');
    }
    return { ...entry, program };
  });
}

/** Hash-bound local files, contained paths, and current knowledge are checked before network access. */
async function readBound(ref: { path: string; sha256: string }): Promise<unknown> {
  if (!path.isAbsolute(ref.path)) fail('absolute_reference_required');
  const absolute = path.resolve(ref.path), base = await realpath(root), relative = path.relative(base, absolute);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) fail('path_escape');
  let current = base;
  for (const part of relative.split(path.sep)) { current = path.join(current, part); const info = await lstat(current); if (info.isSymbolicLink() || (await realpath(current)).toLowerCase() !== current.toLowerCase()) fail('reparse_path'); }
  const info = await lstat(current); if (!info.isFile() || info.size > 32 * 1024 * 1024) fail('file_limit');
  const bytes = await readFile(current); if (sha(bytes) !== ref.sha256) fail('reference_changed');
  return JSON.parse(bytes.toString('utf8'));
}
export async function prepareHeaderMenuContentLocal(entries: HeaderMenuContent[]): Promise<void> {
  const identity = await native44KnowledgeIdentity(root);
  for (const entry of entries) {
    const program = entry.program;
    if(entry.assets)await readMenuAssets(entry);
    if (headerJsonHash(program.knowledge) !== headerJsonHash(identity.knowledge) || headerJsonHash(program.componentCatalog) !== headerJsonHash(identity.componentCatalog) || headerJsonHash(program.targetEnvironment) !== headerJsonHash(identity.targetEnvironment)) fail('knowledge_changed');
    const [factsValue] = await Promise.all([readBound(program.sourceFacts), readBound(program.componentPlan), readBound(program.assetsManifest), readBound(program.knowledge), readBound(program.componentCatalog)]);
    const facts = validateSourceFactsV2(factsValue); if (facts.sourceUrl !== program.sourceUrl) fail('source_changed');
    const selected = [...new Set(walkNative44(program.blocks).flatMap(node => node.sourceFactIds ?? []))], packets = new Map<string, ObservationPacketV2>();
    for (const node of walkNative44(program.blocks)) if (node.kind !== 'composite' && (!node.sourceFactIds?.length || node.sourceFactIds.some(id => !facts.facts[id]))) fail('source_fact_missing');
    const refs = new Map(facts.snapshots.flatMap(snapshot => snapshot.evidence).map(ref => [ref.path, ref]));
    for (const ref of refs.values()) {
      const bound = { ...ref, path: path.resolve(path.dirname(program.sourceFacts.path), ref.path) }, packet = validateObservationPacketV2(await readBound(bound));
      if (packet.snapshot.url !== program.sourceUrl) fail('source_changed'); packets.set(ref.path, packet);
    }
    const expected = buildSourceFactsV2({ manifestPath: facts.observation.path, manifestSha256: facts.observation.sha256, manifest: { version: 2, kind: 'observation-manifest', sourceUrl: program.sourceUrl, provenance: { method: 'user-opened-browser', observer: 'cua_repl', browser: 'chrome' }, packets: [], screenshots: [] }, packets: [...packets.values()], packetFiles: [...refs.values()].map(ref => ({ ...ref, snapshotId: packets.get(ref.path)!.snapshot.id })) });
    for (const id of selected) {
      const fact = facts.facts[id], packet = packets.get(fact.evidence.path)!;
      if (!expected.facts[id] || headerJsonHash(expected.facts[id]) !== headerJsonHash(fact)) fail('fact_not_packet_derived');
      let cursor: string | null = fact.nodeId, header = false; const seen = new Set<string>();
      while (cursor && !seen.has(cursor)) { seen.add(cursor); const node: ObservationPacketV2['nodes'][string] | undefined = packet.nodes[cursor]; if (!node) break; if (node.tag.toLowerCase() === 'header' || node.attributes.role === 'banner' || packet.regions.some(region => region.nodeId === cursor && region.role === 'header')) header = true; cursor = node.parentId; }
      if (!header) fail('fact_outside_header');
    }
  }
}

async function readMenuAssets(entry:HeaderMenuContent, imported?:ImportedAssetV2[]):Promise<ImportedAssetV2[]>{
  const wanted=referencedNative44Assets(entry.program);
  const value=entry.assetSource?imported?.filter(asset=>wanted.has(asset.key)):entry.assets?await readBound(entry.assets):[];
  if(!Array.isArray(value)||value.length>100)fail('media_ledger_invalid');
  const seen=new Set<string>();
  for(const a of value){if(!a||typeof a.key!=='string'||seen.has(a.key)||!wanted.has(a.key)||!Number.isSafeInteger(a.attachmentId)||a.attachmentId<1||!/^[a-f0-9]{64}$/.test(a.sha256)||typeof a.url!=='string')fail('media_ledger_invalid');seen.add(a.key);const u=new URL(a.url);if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash)fail('media_url_invalid');}
  if(seen.size!==wanted.size)fail('media_ledger_incomplete');return value;
}

/** Exact compiler objects stay in memory; serialized elements never authorize a write. */
export async function compileHeaderMenuContent(entries: HeaderMenuContent[], client: HeaderMenuContentClient, targetOrigin: string, contractFingerprint: string, directory: string, imported?:ImportedAssetV2[]): Promise<Array<{ payload: HeaderMenuContentPayload; compiled: Native44Compiled }>> {
  await prepareHeaderMenuContentLocal(entries);
  const types = [...new Set(entries.flatMap(entry => usedNative44WidgetTypes(entry.program)))];
  const capabilities = await client.discoverCapabilities(types), needsCatalog=entries.some(e=>walkNative44(e.program.blocks).some(n=>n.kind==='native-products'));
  const observed=needsCatalog?await client.readTargetCatalog(200):undefined;
  if (observed&&(observed.targetOrigin !== targetOrigin || !observed.products.length)) fail('target_catalog_unavailable');
  // A catalog read is durable before it is used as compiler/query evidence.
  const bytes = JSON.stringify(observed??{}), evidence = path.join(directory, `menu-content-catalog-${sha(bytes)}.json`);
  const actualDirectory = await realpath(directory), relative = path.relative(await realpath(root), actualDirectory);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || actualDirectory.toLowerCase() !== path.resolve(directory).toLowerCase()) fail('evidence_path');
  const space = await statfs(actualDirectory); if (space.bavail * space.bsize < 512 * 1024 * 1024) fail('evidence_space');
  try { if(observed){const handle = await open(evidence, 'wx'); try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }} }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; const info = await lstat(evidence); if (!info.isFile() || info.isSymbolicLink() || (await realpath(evidence)).toLowerCase() !== evidence.toLowerCase() || sha(await readFile(evidence)) !== sha(bytes)) fail('evidence_changed'); }
  const knowledge = await loadNative44Knowledge(types);
  return Promise.all(entries.map(async entry => {
    const assets=await readMenuAssets(entry, imported);if(assets.some(a=>new URL(a.url).origin!==targetOrigin))fail('media_origin_invalid');
    const compiled = compileNative44(entry.program, { schemas: capabilities.legacySchemas, assets, targetOrigin, ...(observed?{catalog:{targetOrigin,products:observed.products,evidence:[evidence]}}:{}), knowledge: toNative44CompilerKnowledge(knowledge, capabilities.legacySchemas) });
    assertNative44Compilation(compiled, compiled.composition);
    return { compiled, payload: { key: entry.key, name: entry.name, menuKey: entry.menuKey, itemKey: entry.itemKey, programHash: headerJsonHash(entry.program), contractFingerprint, elements: compiled.composition.elements, settings: compiled.composition.pageSettings, queries: compiled.queryReceipts,...(entry.version===2?{version:2 as const,dropdown:compileHeaderDropdown(entry.dropdown!),media:assets,...(entry.retireChildren?{retireChildren:entry.retireChildren}:{})}:{}) } };
  }));
}
