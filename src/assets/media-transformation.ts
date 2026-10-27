import { createHash } from 'node:crypto';
import { z } from 'zod';

const identity = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,239}$/);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const mime = z.enum(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif', 'image/svg+xml']);
const owner = z.object({ pageId: z.number().int().positive(), runId: identity }).strict();
const bytes = z.object({ sha256, bytes: z.number().int().positive().max(30 * 1024 * 1024), mimeType: mime }).strict();
const policyKind = z.enum(['svg-rasterization', 'raster-reencode', 'svg-sanitization']);
const proof = z.object({
  policyId: identity, policyVersion: identity, kind: policyKind,
  owner, operationId: identity, inputSha256: sha256, outputSha256: sha256,
  receiptSha256: sha256,
}).strict();
export const MediaTransformationContractSchema = z.object({
  version: z.literal(1), kind: z.literal('media-transformation-contract'),
  owner, operationId: identity,
  original: bytes, submitted: bytes,
  localTransformation: proof.optional(),
  stored: z.object({
    owner, operationId: identity, attachmentId: z.number().int().positive(),
    observedAt: z.iso.datetime(), actual: bytes, serverTransformation: proof.optional(),
  }).strict().optional(),
}).strict();
export type MediaByteIdentity = z.infer<typeof bytes>;
export type MediaTransformationContract = z.input<typeof MediaTransformationContractSchema>;
export interface MediaTransformationPolicy {
  id: string; version: string; kind: z.infer<typeof policyKind>;
  phase: 'local' | 'server'; fromMimeType: MediaByteIdentity['mimeType']; toMimeType: MediaByteIdentity['mimeType'];
}
export interface MediaTransformationReconciliation {
  version: 1; kind: 'media-transformation-reconciliation';
  status: 'verified-exact' | 'verified-transformed' | 'needs-reconciliation' | 'blocked';
  code: string; owner: z.infer<typeof owner>; operationId: string; attachmentId?: number;
  hashes: { original: string; submitted: string; stored?: string };
  transformations: Array<{ phase: 'local' | 'server'; policyId: string; policyVersion: string; receiptSha256: string }>;
  exactStoredBytes: boolean; automaticRetryAllowed: false; remoteWrites: 0;
  nextAction: 'bind-existing-attachment' | 'reconcile-existing-attachment' | 'verify-local-conversion' | 'stop-identity-conflict';
  scope: 'provided-byte-and-policy-receipts';
}
/** Fingerprints actual local bytes. MIME is an explicit caller observation, not inferred or sanitized here. */
export function fingerprintMediaTransformationBytes(value: Uint8Array, mimeType: MediaByteIdentity['mimeType']): MediaByteIdentity {
  return bytes.parse({ sha256: createHash('sha256').update(value).digest('hex'), bytes: value.length, mimeType });
}
function sameOwner(left: z.infer<typeof owner>, right: z.infer<typeof owner>): boolean { return left.pageId === right.pageId && left.runId === right.runId; }
function sameBytes(left: MediaByteIdentity, right: MediaByteIdentity): boolean { return left.sha256 === right.sha256 && left.bytes === right.bytes && left.mimeType === right.mimeType; }

/**
 * Read-only reconciliation of original -> submitted -> stored byte identities.
 * Unknown server sanitation is an existing-write reconciliation, never an
 * invitation to upload/register again. A policy must come from trusted caller
 * configuration, not a new name invented inside a media result.
 * This module does not sanitize files, register policies, read a server, or
 * independently attest the caller's transformation/readback receipts.
 */
export function reconcileMediaTransformation(value: unknown, options: { policies?: readonly MediaTransformationPolicy[] } = {}): MediaTransformationReconciliation {
  const parsed = MediaTransformationContractSchema.safeParse(value);
  if (!parsed.success) throw Error('media_transformation_contract_invalid');
  const input = parsed.data, policies = options.policies ?? [];
  const policySchema = z.object({ id: identity, version: identity, kind: policyKind, phase: z.enum(['local', 'server']), fromMimeType: mime, toMimeType: mime }).strict();
  const parsedPolicies = z.array(policySchema).max(100).safeParse(policies);
  if (!parsedPolicies.success || new Set(policies.map(policy => `${policy.id}:${policy.version}:${policy.phase}`)).size !== policies.length) throw Error('media_transformation_policy_registry_invalid');
  const transformations: MediaTransformationReconciliation['transformations'] = [];
  const result = (status: MediaTransformationReconciliation['status'], code: string, nextAction: MediaTransformationReconciliation['nextAction']): MediaTransformationReconciliation => ({
    version: 1, kind: 'media-transformation-reconciliation', status, code, owner: { ...input.owner }, operationId: input.operationId,
    ...(input.stored ? { attachmentId: input.stored.attachmentId } : {}),
    hashes: { original: input.original.sha256, submitted: input.submitted.sha256, ...(input.stored ? { stored: input.stored.actual.sha256 } : {}) },
    transformations: [...transformations], exactStoredBytes: Boolean(input.stored && sameBytes(input.submitted, input.stored.actual)),
    automaticRetryAllowed: false, remoteWrites: 0, nextAction, scope: 'provided-byte-and-policy-receipts',
  });
  const verifyProof = (receipt: z.infer<typeof proof> | undefined, phase: 'local' | 'server', from: MediaByteIdentity, to: MediaByteIdentity): string | undefined => {
    if (!receipt) return `${phase}_transformation_receipt_missing`;
    if (!sameOwner(receipt.owner, input.owner) || receipt.operationId !== input.operationId) return 'transformation_receipt_owner_mismatch';
    if (receipt.inputSha256 !== from.sha256 || receipt.outputSha256 !== to.sha256) return 'transformation_receipt_hash_mismatch';
    const policy = parsedPolicies.data.find(candidate => candidate.id === receipt.policyId && candidate.version === receipt.policyVersion && candidate.phase === phase);
    if (!policy || policy.kind !== receipt.kind || policy.fromMimeType !== from.mimeType || policy.toMimeType !== to.mimeType) return `${phase}_transformation_policy_unverified`;
    if (receipt.kind === 'svg-rasterization' && (phase !== 'local' || from.mimeType !== 'image/svg+xml' || to.mimeType !== 'image/png')
      || receipt.kind === 'svg-sanitization' && (phase !== 'server' || from.mimeType !== 'image/svg+xml' || to.mimeType !== 'image/svg+xml')
      || receipt.kind === 'raster-reencode' && (phase !== 'local' || from.mimeType === 'image/svg+xml' || to.mimeType === 'image/svg+xml')) return 'transformation_policy_kind_conflict';
    transformations.push({ phase, policyId: receipt.policyId, policyVersion: receipt.policyVersion, receiptSha256: receipt.receiptSha256 });
  };
  // Check observed owner/op before accepting any byte lineage; keep identifiers
  // in the result so callers reconcile this operation instead of creating one.
  if (input.stored && (!sameOwner(input.stored.owner, input.owner) || input.stored.operationId !== input.operationId)) return result('blocked', 'stored_media_owner_mismatch', 'stop-identity-conflict');
  if (input.original.sha256 === input.submitted.sha256 && !sameBytes(input.original, input.submitted)) return result('blocked', 'identical_hash_metadata_conflict', 'stop-identity-conflict');
  if (!sameBytes(input.original, input.submitted)) {
    const error = verifyProof(input.localTransformation, 'local', input.original, input.submitted);
    if (error) return result(error === 'transformation_receipt_owner_mismatch' ? 'blocked' : 'needs-reconciliation', error, error === 'transformation_receipt_owner_mismatch' ? 'stop-identity-conflict' : 'verify-local-conversion');
  } else if (input.localTransformation) return result('blocked', 'redundant_local_transformation_receipt', 'stop-identity-conflict');
  if (!input.stored) return result('needs-reconciliation', 'stored_media_readback_missing', 'reconcile-existing-attachment');
  if (input.submitted.sha256 === input.stored.actual.sha256 && !sameBytes(input.submitted, input.stored.actual)) return result('blocked', 'identical_hash_metadata_conflict', 'stop-identity-conflict');
  if (!sameBytes(input.submitted, input.stored.actual)) {
    const error = verifyProof(input.stored.serverTransformation, 'server', input.submitted, input.stored.actual);
    if (error) return result(error === 'transformation_receipt_owner_mismatch' ? 'blocked' : 'needs-reconciliation', error, error === 'transformation_receipt_owner_mismatch' ? 'stop-identity-conflict' : 'reconcile-existing-attachment');
  } else if (input.stored.serverTransformation) return result('blocked', 'redundant_server_transformation_receipt', 'stop-identity-conflict');
  return result(transformations.length ? 'verified-transformed' : 'verified-exact', transformations.length ? 'media_transformation_lineage_verified' : 'stored_bytes_exact', 'bind-existing-attachment');
}
