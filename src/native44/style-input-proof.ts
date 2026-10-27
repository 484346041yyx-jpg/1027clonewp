import type { ActualBodyPayload } from '../replica-full/body-prepare.js';
import type { FullReplicaPreparedBody } from '../replica-full/types.js';
import type { LegacySchema } from '../wordpress/types.js';

export interface Native44StyleInputProof { readonly kind: 'native44-attested-style-input' }
const proofs = new WeakMap<object, {body: FullReplicaPreparedBody; schemas: Record<string, LegacySchema>}>();
/** The sole mint accepts the actual preparation attestation, never JSON or
 * caller-supplied source/knowledge. Dynamic import avoids a top-level cycle. */
export async function prepareNative44StyleInputProof(body: FullReplicaPreparedBody, schemas: Record<string, LegacySchema>): Promise<Native44StyleInputProof> {
  const {assertActualPreparedBody} = await import('../replica-full/body-prepare.js');
  (assertActualPreparedBody as (value: FullReplicaPreparedBody) => void)(body);
  const proof: Native44StyleInputProof = Object.freeze({kind:'native44-attested-style-input'});
  proofs.set(proof,{body,schemas:structuredClone(schemas)});
  return proof;
}
export async function readNative44StyleInputProof(proof: Native44StyleInputProof) {
  const data = proofs.get(proof);
  if (!data) throw Error('native44_style_input_exact_attestation_required');
  const {assertActualPreparedBody, actualBodyStyleInput} = await import('../replica-full/body-prepare.js');
  (assertActualPreparedBody as (value: FullReplicaPreparedBody) => void)(data.body);
  const body = data.body as FullReplicaPreparedBody & {payload:ActualBodyPayload};
  return {...actualBodyStyleInput(body, structuredClone(data.schemas)), baseProgram: body.payload.baseProgram ?? body.payload.program};
}
