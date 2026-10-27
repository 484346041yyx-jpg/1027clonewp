import { validateFullReplicaManifest, assertFullReplicaBodyScope, fullReplicaHash } from './contract.js';
import type { FullReplicaDependencies, FullReplicaPrepared } from './types.js';

/** Both local jobs start together. No remote interface is exposed to this phase. */
export async function prepareFullReplica(input: unknown, dependencies: Pick<FullReplicaDependencies, 'prepareHeader' | 'prepareBody' | 'assertPreparedBody'>): Promise<FullReplicaPrepared> {
  const manifest = validateFullReplicaManifest(input);
  if (manifest.headerProvider === 'reused-woodmart-header') {
    const body = await dependencies.prepareBody(manifest);
    assertFullReplicaBodyScope(body, manifest); await dependencies.assertPreparedBody(body, manifest);
    return { manifest, manifestHash: fullReplicaHash(manifest), body };
  }
  if (manifest.headerProvider !== 'woodmart-header-builder' || !manifest.header) throw Error('replica_full_component_uses_legacy_entry');
  const [header, body] = await Promise.all([dependencies.prepareHeader(manifest), dependencies.prepareBody(manifest)]);
  if (!header || header.moduleKey !== manifest.header.plan.moduleKey || header.planHash !== fullReplicaHash(manifest.header.plan) || header.bundleDirectory !== manifest.header.bundleDirectory) throw Error('replica_full_header_preparation_identity');
  assertFullReplicaBodyScope(body, manifest);
  await dependencies.assertPreparedBody(body, manifest);
  return { manifest, manifestHash: fullReplicaHash(manifest), header, body };
}
