import { readFile } from 'node:fs/promises';
import { canonicalHeaderJson, headerJsonHash } from '../woodmart-header/contract.js';
import { validateHeaderModuleIdentity, type HeaderModuleIdentity } from '../woodmart-header/generic/wordpress.js';
import type { HeaderPHPWriteIntent, WoodMartHeaderTransport } from '../woodmart-header/transport.js';
import { canonicalV2 } from '../replica-v2/journal.js';
import { assertNavigationFormBoundary, compileNavigationFormPatch, navigationFormPhpHelpers, parseNavigationForms, type NavigationFormSpec } from './navigation-form/index.js';
import { loadFullReplicaHeaderHelper } from './native-helper.js';
import type { FullReplicaRemoteSnapshot } from './driver.js';

function fail(code: string): never { throw Error(`replica_full_navigation_receipt_${code}`); }
const same = (a: unknown, b: unknown) => canonicalV2(a) === canonicalV2(b);
export interface NavigationReceiptRecovery {
  /** Loaded from the original hash-bound durable intent, never reconstructed from the current page. */
  before: FullReplicaRemoteSnapshot;
  current: FullReplicaRemoteSnapshot;
  forms: NavigationFormSpec[]; sourceUrl: string; taskId: string;
  originalOperationId: string; originalPayloadHash: string;
}
export function validateNavigationReceiptRecovery(input: NavigationReceiptRecovery) {
  const forms = parseNavigationForms(input.forms, input.sourceUrl), before = input.before, current = input.current;
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(input.originalOperationId) || !/^[a-f0-9]{64}$/.test(input.originalPayloadHash) || !/^[a-f0-9]{64}$/.test(before.hash) || !/^[a-f0-9]{64}$/.test(current.hash) || !before.page || !current.page || before.page.headerId !== null || current.page.headerId !== null) fail('identity');
  const pageId = before.page.pageId, originalPayloadHash = headerJsonHash({ pageId, sourceUrl: input.sourceUrl, taskId: input.taskId, forms });
  if (originalPayloadHash !== input.originalPayloadHash || Object.hasOwn(before.receipts, input.originalOperationId)) fail('payload');
  const receipt = current.receipts[input.originalOperationId];
  if (receipt?.action !== 'navigation-forms' || receipt.state !== 'started' || receipt.payloadHash !== originalPayloadHash || receipt.result !== undefined) fail('not_started');
  const { [input.originalOperationId]: _receipt, ...remaining } = current.receipts;
  if (!same(remaining, before.receipts) || Object.values(remaining).some(value => value.state !== 'complete')) fail('other_receipts_changed');
  const patch = compileNavigationFormPatch(before.page.elements, forms, input.sourceUrl, input.taskId);
  assertNavigationFormBoundary(before, current, patch, forms, input.sourceUrl, input.taskId);
  return { pageId, forms, patch, originalPayloadHash };
}

/** Receipt-only recovery. It never repeats a document save or creates another navigation operation. */
export class NavigationFormReceiptFinalizer {
  constructor(private readonly transport: Pick<WoodMartHeaderTransport, 'origin' | 'executePHP'>) {}
  async finalize(identityInput: HeaderModuleIdentity, input: NavigationReceiptRecovery, intent: HeaderPHPWriteIntent): Promise<{ snapshot: FullReplicaRemoteSnapshot; result: { pageId: number; widgetIds: string[] }; originalOperationId: string }> {
    const identity = validateHeaderModuleIdentity(identityInput), proof = validateNavigationReceiptRecovery(input);
    if (identity.targetOrigin !== this.transport.origin || !same(identity, input.before.header.snapshot.module?.identity) || !same(identity, input.current.header.snapshot.module?.identity) || input.before.page!.runId !== identity.owner.runId || !/^[A-Za-z0-9_-]{1,100}$/.test(intent.operationId) || intent.operationId === input.originalOperationId || intent.runId !== identity.owner.runId || intent.resource !== `full-replica/${identity.moduleKey}` || intent.expectedSnapshotSha256 !== input.current.hash || !/^[a-f0-9]{64}$/.test(intent.persistedIntentSha256)) fail('intent');
    const payload = { pageId: proof.pageId, before: input.before, forms: proof.forms, sourceUrl: input.sourceUrl, taskId: input.taskId, originalOperationId: input.originalOperationId, originalPayloadHash: proof.originalPayloadHash };
    const [header, helper] = await Promise.all([loadFullReplicaHeaderHelper(), readFile(new URL('./wordpress-full.php', import.meta.url), 'utf8')]);
    const data = canonicalHeaderJson({ identity, action: 'confirm-navigation-forms', operationId: intent.operationId, expectedHash: input.current.hash, payload, payloadHash: headerJsonHash(payload) });
    const code = `$headerRead=static function($input){\n${header}\n};\n${navigationFormPhpHelpers}\n$input=json_decode(base64_decode('${Buffer.from(data).toString('base64')}'),true);\n${helper}`;
    const envelope = await this.transport.executePHP({ name: 'full-replica.confirm-navigation-forms', code, trustedLocalCode: true, intent }) as any;
    if (envelope?.ok !== true || !envelope.value) fail(typeof envelope?.code === 'string' && /^full_[a-z0-9_]{1,100}$/.test(envelope.code) ? envelope.code : 'unconfirmed');
    const result = envelope.value, snapshot = result.snapshot as FullReplicaRemoteSnapshot, receipt = snapshot?.receipts?.[input.originalOperationId];
    if (!snapshot || !/^[a-f0-9]{64}$/.test(snapshot.hash) || result.originalOperationId !== input.originalOperationId || !same(result.result, { pageId: proof.pageId, widgetIds: proof.patch.widgetIds }) || receipt?.action !== 'navigation-forms' || receipt.state !== 'complete' || receipt.payloadHash !== proof.originalPayloadHash || !same(receipt.result, result.result) || !same(snapshot.page, input.current.page) || !same(snapshot.header, input.current.header)) fail('readback');
    const { [input.originalOperationId]: _a, ...afterOthers } = snapshot.receipts, { [input.originalOperationId]: _b, ...beforeOthers } = input.current.receipts;
    if (!same(afterOthers, beforeOthers)) fail('receipt_boundary');
    return result;
  }
}
