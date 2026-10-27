import {nativeProductRequestPHP} from '../wordpress/native-product-request.js';
import { currentProductSelectionSchema, type CurrentProductSelection } from '../native44/current-product.js';
import { readFile } from 'node:fs/promises';
import { headerJsonHash } from '../woodmart-header/contract.js';
import { canonicalFullReplicaJson, fullReplicaJsonHash } from './json.js';
import { validateHeaderModuleIdentity, type HeaderModuleIdentity, type HeaderModuleInspection } from '../woodmart-header/generic/wordpress.js';
import type { WoodMartHeaderTransport, HeaderPHPWriteIntent } from '../woodmart-header/transport.js';
import type { ElementorElement } from '../wordpress/types.js';
import { loadFullReplicaHeaderHelper } from './native-helper.js';
import { navigationFormPhpHelpers, parseNavigationForms } from './navigation-form/index.js';
import { native44Id } from '../native44/adapters.js';
import { navigationReturnPhpHelpers } from './navigation-return.js';
import { assertInterruptedStyleProof, type InterruptedStyleProof } from './style-recovery.js';
import { containerTreePlanSchema } from './container-tree.js';
import { inquirySubmissionReadPHP, inquiryBackendObservationSchema, type InquirySubmissionQuery, type InquiryBackendReader } from './inquiry-review.js';

export interface FullReplicaRemotePage {
  pageId: number; runId: string; status: 'draft' | 'publish'; template: string; title: string; slug: string;
  headerId: string | null; elements: ElementorElement[]; settings: Record<string, unknown>; bodyHash: string;
  built: boolean; publicUrl: string; flags: Record<string, string>;
}
export interface FullReplicaRemoteSnapshot {
  hash: string; header: HeaderModuleInspection; page: FullReplicaRemotePage | null;
  receipts: Record<string, { action: FullReplicaDriverAction; payloadHash: string; state: 'started' | 'complete'; result?: Record<string, unknown> }>;
}
export type FullReplicaDriverAction = 'create-page' | 'style' | 'shell' | 'motion' | 'layout' | 'navigation-forms' | 'navigation-return' | 'publish';
export interface FullReplicaDriverRequest { action: FullReplicaDriverAction; operationId: string; expectedHash: string; payload: Record<string, unknown> }
export interface FullReplicaDriverResult { snapshot: FullReplicaRemoteSnapshot; result: Record<string, unknown> }
export interface FullReplicaDriver {
  readInquirySubmission?: InquiryBackendReader;
  inspect(identity: HeaderModuleIdentity): Promise<FullReplicaRemoteSnapshot>;
  mutate(identity: HeaderModuleIdentity, request: FullReplicaDriverRequest, intent: HeaderPHPWriteIntent): Promise<FullReplicaDriverResult>;
  styleDiagnostics?(identity: HeaderModuleIdentity): Promise<{ defaults: Record<string,unknown>; fatal: Array<{sha256:string;at:string}>; lock: unknown }>;
  recoverInterruptedStyle?(identity: HeaderModuleIdentity, proof: InterruptedStyleProof, intent: HeaderPHPWriteIntent): Promise<FullReplicaDriverResult>;
}
type DriverTransport = Pick<WoodMartHeaderTransport, 'origin' | 'readPHP' | 'executePHP'>;
const hash = /^[a-f0-9]{64}$/;
function fail(code: string): never { throw Error(`replica_full_driver_${code}`); }
function snapshot(value: unknown, identity: HeaderModuleIdentity): FullReplicaRemoteSnapshot {
  const result = value as FullReplicaRemoteSnapshot;
  if (!result || !hash.test(result.hash) || !hash.test(result.header?.hash) || !hash.test(result.header?.snapshot?.globalHash) || !result.receipts || typeof result.receipts !== 'object') fail('snapshot_invalid');
  const module = result.header.snapshot.module;
  if (result.header.contract.targetOrigin !== identity.targetOrigin || module && headerJsonHash(module.identity) !== headerJsonHash(identity) || result.header.snapshot.defaultHeaderId === identity.headerId || result.header.snapshot.otherReferences.length || result.header.snapshot.presetReferences.length) fail('snapshot_isolation');
  if (result.page && (!Number.isSafeInteger(result.page.pageId) || result.page.pageId < 1 || result.page.runId !== identity.owner.runId || result.page.template !== 'elementor_header_footer' || !['draft', 'publish'].includes(result.page.status) || !result.page.built || !Array.isArray(result.page.elements) || !hash.test(result.page.bodyHash) || !module?.pages[String(result.page.pageId)] || !result.page.flags || Object.keys(result.page.flags).sort().join(',') !== '_woodmart_copyrights_off,_woodmart_footer_off,_woodmart_prefooter_off' || Object.values(result.page.flags).some(flag => flag !== '1'))) fail('page_boundary');
  return result;
}
/** Fixed, additive Full Width page operations; source content is encoded data only. */
export class WordPressFullReplicaDriver implements FullReplicaDriver {
  async readInquirySubmission(query: InquirySubmissionQuery) {
    const result = await this.transport.readPHP<{ok:boolean;value?:unknown}>({name:'full-replica.inquiry-submission-read',code:inquirySubmissionReadPHP(query),trustedLocalCode:true});
    if (!result?.ok) fail('inquiry_submission_unconfirmed');
    return inquiryBackendObservationSchema.parse(result.value);
  }
  constructor(private readonly transport: DriverTransport, private readonly currentRecord?: CurrentProductSelection) {if(currentRecord)currentProductSelectionSchema.parse(currentRecord);}
  private async code(identityInput: HeaderModuleIdentity, data: Record<string, unknown>): Promise<string> {
    const identity = validateHeaderModuleIdentity(identityInput);
    if (identity.targetOrigin !== this.transport.origin) fail('target_mismatch');
    const [header, originalHelper, recovery, containerTree] = await Promise.all([loadFullReplicaHeaderHelper(!!this.currentRecord), readFile(new URL('./wordpress-full.php', import.meta.url), 'utf8'), readFile(new URL('./style-recovery.php', import.meta.url), 'utf8'), readFile(new URL('./container-tree.php', import.meta.url), 'utf8')]);
    const marker="  if(($input['action']??'')==='inspect')";if(originalHelper.split(marker).length!==2)fail('style_recovery_helper_changed');
    const helper=originalHelper.replace(marker,recovery+'\n'+containerTree+'\n'+marker);
    const input = canonicalFullReplicaJson({ identity, ...(this.currentRecord?{currentRecord:this.currentRecord}:{}), ...data });
    const code=`$headerRead=static function($input){\n${header}\n};\n${navigationFormPhpHelpers}\n${navigationReturnPhpHelpers}\n$input=json_decode(base64_decode('${Buffer.from(input).toString('base64')}'),true);\n${helper}`;return this.currentRecord?nativeProductRequestPHP(this.currentRecord.productId,code):code;
  }
  private unwrap(value: unknown): unknown {
    if (!value || typeof value !== 'object') fail('response_invalid');
    const envelope = value as { ok?: boolean; code?: unknown; value?: unknown };
    if (envelope.ok !== true || !Object.hasOwn(envelope, 'value')) fail(typeof envelope.code === 'string' && /^full_[a-z0-9_]{1,100}$/.test(envelope.code) ? envelope.code : 'operation_unconfirmed');
    return envelope.value;
  }
  async inspect(identity: HeaderModuleIdentity): Promise<FullReplicaRemoteSnapshot> {
    const code = await this.code(identity, { action: 'inspect' });
    return snapshot(this.unwrap(await this.transport.readPHP({ name: 'full-replica.inspect', code, trustedLocalCode: true })), identity);
  }
  async styleDiagnostics(identity: HeaderModuleIdentity) {
    const code=await this.code(identity,{action:'style-diagnostics'});
    return this.unwrap(await this.transport.readPHP({name:'full-replica.style-diagnostics',code,trustedLocalCode:true})) as {defaults:Record<string,unknown>;fatal:Array<{sha256:string;at:string}>;lock:unknown};
  }
  async recoverInterruptedStyle(identity: HeaderModuleIdentity, proof: InterruptedStyleProof, intent: HeaderPHPWriteIntent):Promise<FullReplicaDriverResult> {
    assertInterruptedStyleProof(proof);
    if(intent.expectedSnapshotSha256!==proof.current.hash||intent.runId!==identity.owner.runId||intent.resource!==`full-replica/${identity.moduleKey}`||!hash.test(intent.persistedIntentSha256)||!hash.test(proof.current.hash)||intent.operationId===proof.originalOperationId)fail('style_recovery_intent');
    const {current,...rest}=proof,payload={...rest,pageId:current.page!.pageId};
    const code=await this.code(identity,{action:'confirm-interrupted-style',operationId:intent.operationId,expectedHash:current.hash,payload});
    const result=this.unwrap(await this.transport.executePHP({name:'full-replica.confirm-interrupted-style',code,trustedLocalCode:true,intent})) as FullReplicaDriverResult;
    snapshot(result.snapshot,identity);
    if(fullReplicaJsonHash(result.snapshot.page)!==fullReplicaJsonHash(current.page)||headerJsonHash(result.snapshot.header)!==headerJsonHash(current.header)||result.snapshot.receipts[proof.originalOperationId]?.state!=='complete')fail('style_recovery_boundary');
    return result;
  }
  async mutate(identity: HeaderModuleIdentity, request: FullReplicaDriverRequest, intent: HeaderPHPWriteIntent): Promise<FullReplicaDriverResult> {
    if (!['create-page', 'style', 'shell', 'motion', 'layout', 'navigation-forms', 'navigation-return', 'publish'].includes(request.action) || !/^[A-Za-z0-9_-]{1,100}$/.test(request.operationId) || !hash.test(request.expectedHash) || request.operationId !== intent.operationId || intent.runId !== identity.owner.runId || intent.expectedSnapshotSha256 !== request.expectedHash || intent.resource !== `full-replica/${identity.moduleKey}` || !hash.test(intent.persistedIntentSha256)) fail('intent_invalid');
    if (['shell', 'motion'].includes(request.action) && (!request.payload || Object.keys(request.payload).join(',') !== 'pageId' || !Number.isSafeInteger(request.payload.pageId) || Number(request.payload.pageId) < 1)) fail(`${request.action}_payload_invalid`);
    if (request.action === 'layout' && (!request.payload || Object.keys(request.payload).sort().join(',') !== 'pageId,plan' || !Number.isSafeInteger(request.payload.pageId) || Number(request.payload.pageId) < 1 || !containerTreePlanSchema.safeParse(request.payload.plan).success)) fail('layout_payload_invalid');
    let navigationIds: string[] | undefined;
    if (request.action === 'navigation-forms' || request.action === 'navigation-return') {
      const p = request.payload;
      if (!p || Object.keys(p).sort().join(',') !== 'forms,pageId,sourceUrl,taskId' || !Number.isSafeInteger(p.pageId) || Number(p.pageId) < 1 || typeof p.sourceUrl !== 'string' || typeof p.taskId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(p.taskId)) fail('navigation_form_payload_invalid');
      navigationIds = parseNavigationForms(p.forms, p.sourceUrl).map(form => native44Id(p.taskId as string, 'navigation-form:' + form.key));
    }
    const payloadHash = fullReplicaJsonHash(request.payload), code = await this.code(identity, { ...request, payloadHash });
    const response = this.unwrap(await this.transport.executePHP({ name: `full-replica.${request.action}`, code, trustedLocalCode: true, intent })) as FullReplicaDriverResult;
    if (!response || !response.result || typeof response.result !== 'object') fail('mutation_readback_invalid');
    snapshot(response.snapshot, identity);
    if (navigationIds && (response.snapshot.page?.pageId !== request.payload.pageId || response.result.pageId !== request.payload.pageId || fullReplicaJsonHash(response.result.widgetIds) !== fullReplicaJsonHash(navigationIds))) fail('navigation_form_readback_invalid');
    if (request.action === 'shell' && (response.snapshot.page?.pageId !== request.payload.pageId || response.result.pageId !== request.payload.pageId || response.result.titleDisabled !== true || response.result.sidebarDisabled !== true)) fail('shell_readback_invalid');
    if (request.action === 'motion' && (response.snapshot.page?.pageId !== request.payload.pageId || response.result.pageId !== request.payload.pageId || !Array.isArray(response.result.widgetIds) || !response.result.widgetIds.length || response.result.widgetIds.length > 200 || new Set(response.result.widgetIds).size !== response.result.widgetIds.length || response.result.widgetIds.some(id => typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(id)))) fail('motion_readback_invalid');
    if (request.action === 'layout' && (response.snapshot.page?.pageId !== request.payload.pageId || response.result.pageId !== request.payload.pageId)) fail('layout_readback_invalid');
    const receipt = response.snapshot.receipts[request.operationId];
    if (receipt?.state !== 'complete' || receipt.action !== request.action || receipt.payloadHash !== payloadHash || fullReplicaJsonHash(receipt.result) !== fullReplicaJsonHash(response.result)) fail('receipt_unconfirmed');
    return response;
  }
}
