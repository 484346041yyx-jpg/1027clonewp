import type { WordPressClient } from '../wordpress/client.js';
import type { CapabilityReport } from '../wordpress/types.js';
import { canonicalV2, retryReadV2 } from '../replica-v2/journal.js';
import { usedNative44WidgetTypes } from './compiler.js';
import { assertNative44Environment, checkNative44Environment, type Native44EnvironmentCheck } from './environment.js';
import { toNative44CompilerKnowledge } from './knowledge.js';
import { validateNative44Selection } from './selection.js';
import { walkNative44 } from './types.js';
import type { ValidatedTaskInput } from './local-task.js';
import { normalizeTargetPostsQuery, targetPostsQueryKey, type TargetPostsEvidence } from '../wordpress/posts-contract.js';
import { prepareProgramCurrentProduct } from './current-product.js';

/** Platform preparation cannot create a page, import media or save a document. */
export type Native44TargetReader = Pick<WordPressClient, 'preflight' | 'discoverCapabilities' | 'readTargetCatalog'> & Partial<Pick<WordPressClient, 'readTargetPosts' | 'readTargetProduct'>>;
export class Native44TargetContextError extends Error {
  constructor(message: string, readonly environment: Native44EnvironmentCheck) { super(message); }
}
/** Bounded read-only batches keep the large control registry within transport limits. */
export async function discoverNative44Contracts(client: Pick<Native44TargetReader, 'discoverCapabilities'>, types: string[]): Promise<CapabilityReport> {
  let result: CapabilityReport | undefined; const schemas: CapabilityReport['legacySchemas'] = {};
  for (let offset = 0; offset < types.length; offset += 4) {
    const batch = await retryReadV2(() => client.discoverCapabilities(types.slice(offset, offset + 4)));
    if (result && canonicalV2(batch.versions) !== canonicalV2(result.versions)) throw Error('Target versions changed during registry observation');
    Object.assign(schemas, batch.legacySchemas); result = batch;
  }
  if (!result) throw Error('Empty native44 component request');
  return { ...result, legacySchemas: schemas };
}
export async function prepareTargetContext(client: Native44TargetReader, input: Pick<ValidatedTaskInput, 'program' | 'componentPlan' | 'sourceFacts' | 'knowledge'>, targetUrl: string) {
  const types = usedNative44WidgetTypes(input.program), preflight = await retryReadV2(() => client.preflight());
  const preliminary = checkNative44Environment(preflight, undefined, { usedTypes: types, requireContracts: false });
  if (preliminary.blockers.length) throw new Native44TargetContextError(`Native44 required platform unavailable: ${preliminary.blockers.join('; ')}`, preliminary);
  const capabilities = await discoverNative44Contracts(client, types), environment = checkNative44Environment(preflight, capabilities, { usedTypes: types });
  try { assertNative44Environment(environment); }
  catch (error) { throw new Native44TargetContextError(error instanceof Error ? error.message : String(error), environment); }
  validateNative44Selection(input.program, input.componentPlan, input.sourceFacts, { schemas: capabilities.legacySchemas, knowledge: input.knowledge });
  const knowledge = toNative44CompilerKnowledge(input.knowledge, capabilities.legacySchemas);
  const catalog = walkNative44(input.program.blocks).some(node => node.kind === 'native-products') ? await retryReadV2(() => client.readTargetCatalog(200)) : undefined;
  const postQueries = new Map(walkNative44(input.program.blocks).filter(node => node.kind === 'native-posts').map(node => [targetPostsQueryKey(node.query), normalizeTargetPostsQuery(node.query)]));
  let posts: TargetPostsEvidence[] | undefined;
  if (postQueries.size) {
    if (!client.readTargetPosts) throw Error('The target reader has no published-posts query adapter');
    posts = [];
    for (const query of postQueries.values()) posts.push(await retryReadV2(() => client.readTargetPosts!(query)));
  }
  // The execution layer persists the observed catalog before invoking the
  // compiler preflight. A read alone is not a durable query-evidence reference.
  const record = await prepareProgramCurrentProduct({ readTargetProduct: id => { if (!client.readTargetProduct) throw Error('target_current_product_reader_missing'); return client.readTargetProduct(id); } }, input.program, { targetOrigin: targetUrl, schemas: capabilities.legacySchemas, controlsByWidget: knowledge.controlsByWidget });
  return { preflight, capabilities, environment, knowledge, catalog, posts, currentProduct: record?.provider, productBindings: record?.bindings };
}
export type TargetContext = Awaited<ReturnType<typeof prepareTargetContext>>;
