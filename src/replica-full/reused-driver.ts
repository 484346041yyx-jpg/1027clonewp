import {nativeProductRequestPHP} from '../wordpress/native-product-request.js';
import { assertTaskReviewSkipScope } from './review-skip-policy.js';
import { readFile } from 'node:fs/promises';
import { fullReplicaHash, reusedHeaderResourceSchema } from './contract.js';
import type { FullReplicaManifest, FullReplicaReusedHeader } from './types.js';
import type { HeaderPHPWriteIntent, WoodMartHeaderTransport } from '../woodmart-header/transport.js';
import type { ElementorElement } from '../wordpress/types.js';

export interface ReusedBodyRemotePage {
  pageId: number; runId: string; status: 'draft' | 'publish'; title: string; slug: string;
  template: string; headerId: string | null; elements: ElementorElement[]; settings: Record<string, unknown>;
  bodyHash: string; documentHash: string; publicUrl: string; metaHash: string; flags: Record<string, string>;
}
export interface ReusedBodySnapshot {
  hash: string; resources: FullReplicaReusedHeader; page: ReusedBodyRemotePage | null;
  receipts: Record<string, { action: string; payloadHash: string; state: 'started' | 'complete'; result?: Record<string, unknown> }>;
}
export type ReusedBodyAction = 'create-page' | 'style' | 'bind' | 'publish';
type Transport = Pick<WoodMartHeaderTransport, 'origin' | 'readPHP' | 'executePHP'>;
const hash = /^[a-f0-9]{64}$/;
function unwrap(value: unknown): any {
  const result = value as { ok?: unknown; value?: unknown; code?: unknown };
  if (result?.ok !== true || !Object.hasOwn(result, 'value')) throw Error(`replica_full_${typeof result?.code === 'string' && /^reuse_[a-z0-9_]{1,100}$/.test(result.code) ? result.code : 'reuse_unconfirmed'}`);
  return result.value;
}
export async function reusedBodyDriverCode(identity: { targetOrigin: string; headerId: string; mobileMaxWidth: number; pageScope?: 'body-only' }, data: Record<string, unknown>): Promise<string> {
  const origin = new URL(identity.targetOrigin); if (origin.origin !== identity.targetOrigin || !/^header_[1-9]\d{0,17}$/.test(identity.headerId) || !Number.isInteger(identity.mobileMaxWidth) || identity.mobileMaxWidth < 320 || identity.mobileMaxWidth > 1024) throw Error('replica_full_reuse_identity');
  const input = Buffer.from(JSON.stringify({ ...identity, ...data })).toString('base64');
  const code=`$input=json_decode(base64_decode('${input}'),true);\n${await readFile(new URL('./reused-driver.php', import.meta.url), 'utf8')}`;return data.currentRecord?nativeProductRequestPHP((data.currentRecord as {productId:number}).productId,code):code;
}
export async function inspectReusedHeaderResources(transport: Transport, input: { headerId: string; mobileMaxWidth: number; pageScope?: 'body-only' }): Promise<FullReplicaReusedHeader> {
  const code = await reusedBodyDriverCode({ ...input, targetOrigin: transport.origin }, { action: 'resources' });
  return reusedHeaderResourceSchema.parse(unwrap(await transport.readPHP({ name: 'full-replica.reuse-resources', code, trustedLocalCode: true })));
}
export class WordPressReusedBodyDriver {
  constructor(private readonly transport: Transport, private readonly manifest: FullReplicaManifest) {
    assertTaskReviewSkipScope(manifest);
    if (manifest.headerProvider !== 'reused-woodmart-header' || !manifest.reusedHeader || transport.origin !== manifest.targetOrigin) throw Error('replica_full_reuse_provider');
  }
  private async code(data: Record<string, unknown>) {
    const contractHash = this.manifest.taskId === 'huaqi-product-layout-jiangubottle-20261028' && this.manifest.reviewSkipPolicy
      ? fullReplicaHash((({ reviewSkipPolicy: _authorization, ...frozen }) => frozen)(this.manifest))
      : fullReplicaHash(this.manifest);
    return reusedBodyDriverCode({ targetOrigin: this.manifest.targetOrigin, headerId: this.manifest.reusedHeader!.headerId, mobileMaxWidth: this.manifest.reusedHeader!.mobileMaxWidth, ...(this.manifest.pageScope ? { pageScope: this.manifest.pageScope } : {}) }, { ...(this.manifest.currentRecord?{currentRecord:this.manifest.currentRecord}:{}), runId: this.manifest.runId, contractHash, ...(this.manifest.reviewSkipPolicy ? { publicationAuthorizationHash: fullReplicaHash(this.manifest.reviewSkipPolicy) } : {}), ...data });
  }
  private snapshot(value: ReusedBodySnapshot): ReusedBodySnapshot {
    if (!value || !hash.test(value.hash) || fullReplicaHash(reusedHeaderResourceSchema.parse(value.resources)) !== fullReplicaHash(this.manifest.reusedHeader) || !value.receipts || typeof value.receipts !== 'object') throw Error('replica_full_reuse_resources_changed');
    const page = value.page;
    if (page && (!Number.isSafeInteger(page.pageId) || page.pageId < 1 || page.runId !== this.manifest.runId || !['draft', 'publish'].includes(page.status) || !Array.isArray(page.elements) || !hash.test(page.bodyHash) || !hash.test(page.documentHash) || !hash.test(page.metaHash) || page.headerId !== null && page.headerId !== this.manifest.reusedHeader!.headerId)) throw Error('replica_full_reuse_page_boundary');
    if (page && (page.template !== 'elementor_header_footer' || !page.flags || Object.keys(page.flags).sort().join(',') !== '_woodmart_copyrights_off,_woodmart_footer_off,_woodmart_main_layout,_woodmart_prefooter_off,_woodmart_title_off' || ['_woodmart_title_off', '_woodmart_prefooter_off', '_woodmart_footer_off', '_woodmart_copyrights_off'].some(key => page.flags[key] !== (this.manifest.pageScope === 'body-only' && key !== '_woodmart_title_off' ? '' : '1')) || page.flags._woodmart_main_layout !== 'full-width')) throw Error('replica_full_reuse_page_shell');
    return value;
  }
  async inspect(): Promise<ReusedBodySnapshot> {
    return this.snapshot(unwrap(await this.transport.readPHP({ name: 'full-replica.reuse-inspect', code: await this.code({ action: 'inspect' }), trustedLocalCode: true })));
  }
  async recoverStartedStyleBefore(before: ReusedBodySnapshot, operationId: string, payload: { receiptId: string; payloadHash: string; bodyHash: string }, intent: HeaderPHPWriteIntent) {
    this.snapshot(before);
    if (intent.operationId !== operationId || intent.runId !== this.manifest.runId || intent.expectedSnapshotSha256 !== before.hash || intent.resource !== `full-replica-reuse/${this.manifest.runId}`) throw Error('replica_full_reuse_recovery_intent');
    const original = before.receipts[payload.receiptId];
    if (!original || original.action !== 'style' || original.state !== 'started' || original.payloadHash !== payload.payloadHash || before.page?.bodyHash !== payload.bodyHash || before.page?.headerId !== null || String(before.page?.settings.custom_css ?? '') !== '') throw Error('replica_full_reuse_recovery_boundary');
    const result = unwrap(await this.transport.executePHP({ name: 'full-replica.reuse-recover-style-before', code: await this.code({ action: 'recover-style-before', expectedHash: before.hash, operationId, resources: before.resources, payload }), trustedLocalCode: true, intent })) as { snapshot: ReusedBodySnapshot; result: { pageId: number } };
    this.snapshot(result.snapshot);
    if (result.snapshot.receipts[payload.receiptId] || result.snapshot.page?.bodyHash !== before.page?.bodyHash || result.snapshot.page?.documentHash !== before.page?.documentHash || result.snapshot.page?.headerId !== null || result.result.pageId !== before.page?.pageId) throw Error('replica_full_reuse_recovery_readback');
    return result;
  }
  async recoverStartedStyleAfter(before: ReusedBodySnapshot, operationId: string, payload: { receiptId: string; payloadHash: string; bodyHash: string; documentHash: string; cssHash: string }, intent: HeaderPHPWriteIntent) {
    this.snapshot(before);
    if (intent.operationId !== operationId || intent.runId !== this.manifest.runId || intent.expectedSnapshotSha256 !== before.hash || intent.resource !== `full-replica-reuse/${this.manifest.runId}`) throw Error('replica_full_reuse_recovery_intent');
    const original = before.receipts[payload.receiptId];
    if (!original || original.action !== 'style' || original.state !== 'started' || original.payloadHash !== payload.payloadHash || before.page?.bodyHash !== payload.bodyHash || before.page?.documentHash !== payload.documentHash || before.page?.headerId !== this.manifest.reusedHeader!.headerId || before.page?.settings.custom_css === undefined) throw Error('replica_full_reuse_recovery_boundary');
    const result = unwrap(await this.transport.executePHP({ name: 'full-replica.reuse-recover-style-after', code: await this.code({ action: 'recover-style-after', expectedHash: before.hash, operationId, resources: before.resources, payload }), trustedLocalCode: true, intent })) as { snapshot: ReusedBodySnapshot; result: { pageId: number } };
    this.snapshot(result.snapshot);
    const receipt = result.snapshot.receipts[payload.receiptId];
    if (receipt?.state !== 'complete' || receipt.action !== 'style' || receipt.payloadHash !== payload.payloadHash || receipt.result?.pageId !== before.page?.pageId || result.snapshot.page?.bodyHash !== before.page.bodyHash || result.snapshot.page?.documentHash !== before.page.documentHash) throw Error('replica_full_reuse_recovery_readback');
    return result;
  }
  async mutate(action: ReusedBodyAction, before: ReusedBodySnapshot, operationId: string, payload: Record<string, unknown>, intent: HeaderPHPWriteIntent) {
    this.snapshot(before);
    if (Object.values(before.receipts).some(receipt => !receipt || receipt.state !== 'complete')) throw Error('replica_full_reuse_reconcile_required');
    if (!['create-page', 'style', 'bind', 'publish'].includes(action) || !/^[A-Za-z0-9_-]{4,100}$/.test(operationId) || intent.operationId !== operationId || intent.runId !== this.manifest.runId || intent.expectedSnapshotSha256 !== before.hash || intent.resource !== `full-replica-reuse/${this.manifest.runId}` || !hash.test(intent.persistedIntentSha256)) throw Error('replica_full_reuse_intent');
    const wantedKeys = action === 'create-page' ? 'slug,title' : action === 'style' ? 'css,pageId' : action === 'publish' ? this.manifest.reviewSkipPolicy ? 'pageId,publicationAuthorizationHash' : 'pageId,reviewHash' : 'pageId';
    if (Object.keys(payload).sort().join(',') !== wantedKeys || action !== 'create-page' && (!Number.isSafeInteger(payload.pageId) || Number(payload.pageId) < 1)) throw Error('replica_full_reuse_payload');
    if (action === 'publish' && this.manifest.reviewSkipPolicy && payload.publicationAuthorizationHash !== fullReplicaHash(this.manifest.reviewSkipPolicy)) throw Error('replica_full_review_skip_authorization_changed');
    const code = await this.code({ action, expectedHash: before.hash, operationId, resources: before.resources, payload });
    const result = unwrap(await this.transport.executePHP({ name: `full-replica.reuse-${action}`, code, trustedLocalCode: true, intent })) as { snapshot: ReusedBodySnapshot; result: Record<string, unknown> };
    this.snapshot(result.snapshot);
    const receipt = result.snapshot.receipts[operationId];
    if (!receipt || receipt.state !== 'complete' || receipt.action !== action || receipt.payloadHash !== fullReplicaHash(payload) || fullReplicaHash(receipt.result) !== fullReplicaHash(result.result)) throw Error('replica_full_reuse_receipt');
    return result;
  }
}
