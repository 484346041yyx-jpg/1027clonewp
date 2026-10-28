import { readFile } from 'node:fs/promises';
import { headerTargetOrigin, canonicalHeaderJson, headerJsonHash, type HeaderOwner, type HeaderMenuItem } from '../contract.js';
import { WoodMartHeaderTransport, type HeaderPHPWriteIntent } from '../transport.js';
import type { WhbRawHeader } from '../layout.js';
import { orderHeaderMenuItems } from './contract.js';
import type { NativeHeaderContract, ResolvedHeaderResources } from './compiler.js';
import { compileHeaderMenuContent, prepareHeaderMenuContentLocal, type HeaderMenuContent, type HeaderMenuContentClient, type HeaderMenuContentPayload } from './menu-content.js';
import { assertNative44Compilation } from '../../native44/compiler.js';
import type { Native44Compiled } from '../../native44/types.js';
import type { ImportedAssetV2 } from '../../replica-v2/types.js';
import { assertHeaderMenuParameterShape } from './menu-binding.js';

export interface HeaderModuleIdentity { moduleKey: string; owner: HeaderOwner; targetOrigin: string; headerId: string }
export interface HeaderPageObservation { pageId: number; postType: string; status: string; template: string; runId: string; bodyHash: string; headerId: string | null; snapshotHash: string }
export interface HeaderRemoteMenuItem { id: number; key: string; parentKey: string | null; title: string; url: string; order: number; content?: { blockId: number; documentHash: string; metaHash: string; dropdown?:Record<string,string> }; imageId?: number }
export interface HeaderRemoteMenuContent { id: number; name: string; menuKey: string; itemKey: string; programHash: string; elements: HeaderMenuContentPayload['elements']; settings: HeaderMenuContentPayload['settings']; documentHash: string }
export interface HeaderRemoteModule {
  identity: HeaderModuleIdentity;
  name: string;
  menus: Record<string, { id: number; slug: string; name: string; items: HeaderRemoteMenuItem[] }>;
  style: null | { id: number; css: string };
  header: WhbRawHeader | null;
  pages: Record<string, HeaderPageObservation>;
  receipts: Record<string, { action: HeaderMutationAction; payloadHash: string; state: 'started' | 'complete'; result?: unknown }>;
  conflicts?: Record<string, unknown>;
  menuContent?: Record<string, HeaderRemoteMenuContent>;
}
export interface HeaderRemoteSnapshot {
  module: HeaderRemoteModule | null;
  globalHash: string;
  defaultHeaderId: string;
  presetReferences: string[];
  otherReferences: Array<{ kind: string; id: string; field: string }>;
  candidatePage?: HeaderPageObservation;
}
export type HeaderMutationAction = 'reserve' | 'menu' | 'menu-content' | 'style' | 'header' | 'create-page' | 'bind';
export interface HeaderPublishedRevision {pageId:number;bodyHash:string;snapshotHash:string}
export interface HeaderMutationRequest { operationId: string; expectedHash: string; action: HeaderMutationAction; payload: unknown; publishedRevision?:HeaderPublishedRevision }
export interface HeaderInspection { contract: NativeHeaderContract; resources: ResolvedHeaderResources; snapshot: HeaderRemoteSnapshot; hash: string }
export type HeaderModuleInspection = HeaderInspection;
export interface HeaderMutationResponse { snapshot: HeaderRemoteSnapshot; hash: string; result?: unknown }
export interface HeaderModuleDriver {
  prepareMenuContent?(identity: HeaderModuleIdentity, entries: HeaderMenuContent[], directory: string, imported?: ImportedAssetV2[]): Promise<HeaderMenuContentPayload[]>;
  inspect(identity: HeaderModuleIdentity, mediaIds?: Record<string, number>, pageId?: number): Promise<HeaderInspection>;
  mutate(identity: HeaderModuleIdentity, request: HeaderMutationRequest, intent: HeaderPHPWriteIntent): Promise<HeaderMutationResponse>;
}
type HeaderDriverTransport = Pick<WoodMartHeaderTransport, 'origin' | 'readPHP' | 'executePHP'>;
const hash = /^[a-f0-9]{64}$/;
function fail(code: string): never { throw new Error(`woodmart_header_driver_${code}`); }
export function validateHeaderModuleIdentity(input: HeaderModuleIdentity): HeaderModuleIdentity {
  const value = JSON.parse(canonicalHeaderJson(input)) as HeaderModuleIdentity;
  if (!value || Object.keys(value).sort().join(',') !== 'headerId,moduleKey,owner,targetOrigin' || !/^[a-z][a-z0-9_-]{0,63}$/.test(value.moduleKey) || !/^header_[A-Za-z0-9_-]{1,89}$/.test(value.headerId) || !value.owner || Object.keys(value.owner).sort().join(',') !== 'ownerId,runId' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(value.owner.ownerId) || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(value.owner.runId)) fail('identity_invalid');
  value.targetOrigin = headerTargetOrigin(value.targetOrigin); return value;
}

/** Fixed local server helper, never source PHP supplied by a website or plan. */
export class WordPressHeaderModuleDriver implements HeaderModuleDriver {
  private readonly contentProofs = new Map<string, { compiled: Native44Compiled; identityHash: string; payloadHash: string }>();
  constructor(private readonly transport: HeaderDriverTransport, private readonly contentClient?: HeaderMenuContentClient, private readonly menuBindingVersion?: 1) {}
  async inspectMenuContentContract(identity: HeaderModuleIdentity): Promise<{ fingerprint: string }> {
    const code = await this.code(identity, { action: 'inspect-menu-content' });
    const contract = this.unwrap<{ fingerprint: string }>(await this.transport.readPHP({ name: 'whb-module.menu-content-contract', code, trustedLocalCode: true }));
    if (!hash.test(contract.fingerprint)) fail('menu_content_contract_invalid');
    return contract;
  }
  async prepareMenuContent(identity: HeaderModuleIdentity, entries: HeaderMenuContent[], directory: string, imported?: ImportedAssetV2[]): Promise<HeaderMenuContentPayload[]> {
    await prepareHeaderMenuContentLocal(entries);
    if (!this.contentClient) fail('menu_content_client_required');
    const contract = await this.inspectMenuContentContract(identity);
    const prepared = await compileHeaderMenuContent(entries, this.contentClient, identity.targetOrigin, contract.fingerprint, directory, imported);
    for (const { payload, compiled } of prepared) this.contentProofs.set(payload.key, { compiled, identityHash: headerJsonHash(identity), payloadHash: headerJsonHash(payload) });
    return prepared.map(item => item.payload);
  }
  private async code(identityInput: HeaderModuleIdentity, data: Record<string, unknown>): Promise<string> {
    const identity = validateHeaderModuleIdentity(identityInput);
    if (headerTargetOrigin(this.transport.origin) !== identity.targetOrigin) fail('target_mismatch');
    const payload = canonicalHeaderJson({ identity, ...data, ...(this.menuBindingVersion ? { menuBindingVersion: this.menuBindingVersion } : {}) });
    const helper = await readFile(new URL('./wordpress.php', import.meta.url), 'utf8');
    return `$input=json_decode(base64_decode('${Buffer.from(payload, 'utf8').toString('base64')}'),true);\n${helper}`;
  }
  private unwrap<T>(response: unknown): T {
    if (!response || typeof response !== 'object') fail('server_response_invalid');
    const envelope = response as { ok?: boolean; code?: string; value?: T };
    if (envelope.ok !== true || !Object.hasOwn(envelope, 'value')) fail(typeof envelope.code === 'string' && /^[a-z0-9_]{1,100}$/.test(envelope.code) ? envelope.code : 'server_operation_failed');
    return envelope.value!;
  }
  async inspect(identity: HeaderModuleIdentity, mediaIds: Record<string, number> = {}, pageId?: number): Promise<HeaderInspection> {
    if (Object.keys(mediaIds).length > 100 || Object.entries(mediaIds).some(([key, id]) => !/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(key) || !Number.isSafeInteger(id) || id < 1) || pageId !== undefined && (!Number.isSafeInteger(pageId) || pageId < 1)) fail('inspect_resources_invalid');
    const code = await this.code(identity, { action: 'inspect', mediaIds, ...(pageId === undefined ? {} : { pageId }) });
    return this.unwrap(await this.transport.readPHP({ name: 'whb-module.inspect', code, trustedLocalCode: true }));
  }
  async mutate(identity: HeaderModuleIdentity, requestInput: HeaderMutationRequest, intent: HeaderPHPWriteIntent): Promise<HeaderMutationResponse> {
    const request = JSON.parse(canonicalHeaderJson(requestInput)) as HeaderMutationRequest;
    if (!['reserve', 'menu', 'menu-content', 'style', 'header', 'create-page', 'bind'].includes(request.action) || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(request.operationId) || !hash.test(request.expectedHash) || request.expectedHash !== intent.expectedSnapshotSha256 || request.operationId !== intent.operationId || identity.owner.runId !== intent.runId || intent.resource !== `header-module/${identity.moduleKey}` || !hash.test(intent.persistedIntentSha256)) fail('mutation_intent_invalid');
    const requestHash = headerJsonHash(request.payload);
    if (!request.payload || typeof request.payload !== 'object' || Array.isArray(request.payload)) fail('mutation_payload_invalid');
    const payload = request.payload as Record<string, unknown>;
    if (this.menuBindingVersion && request.action === 'header') assertHeaderMenuParameterShape(payload.raw as WhbRawHeader);
    if (request.action === 'menu-content') {
      const proof = this.contentProofs.get(String(payload.key));
      if (!proof || proof.identityHash !== headerJsonHash(identity) || proof.payloadHash !== headerJsonHash(payload)) fail('menu_content_compiler_proof_required');
      assertNative44Compilation(proof.compiled, proof.compiled.composition);
    }
    if (request.action === 'menu') payload.items = orderHeaderMenuItems(payload.items, identity.targetOrigin).map(item => ({ ...item, url: new URL(item.url, identity.targetOrigin).href })) satisfies HeaderMenuItem[];
    const code = await this.code(identity, { ...request, requestHash });
    return this.unwrap(await this.transport.executePHP({ name: `whb-module.${request.action}`, code, trustedLocalCode: true, intent }));
  }
}
export { WordPressHeaderModuleDriver as HeaderWordPressDriver };
