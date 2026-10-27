import { z } from 'zod';

const unit = z.string().min(1).max(240).regex(/^[A-Za-z0-9][A-Za-z0-9_.:/-]*$/);
const units = z.array(unit).max(10_000);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);

/** New tasks default to WHB. Frozen legacy tasks are never routed or migrated. */
export const ReplicaHeaderChoiceSchema = z.object({
  version: z.literal(1),
  kind: z.literal('clonewp-replica-header-choice'),
  provider: z.enum(['component', 'woodmart-header-builder']).default('woodmart-header-builder'),
  sourcePartition: z.object({
    allUnits: units.min(1),
    headerUnits: units.min(1),
    bodyUnits: units,
  }).strict(),
}).strict();

export type ReplicaHeaderChoice = z.infer<typeof ReplicaHeaderChoiceSchema>;

function fail(reason: string): never {
  throw new Error(`woodmart_header_route_${reason}`);
}

export function validateReplicaHeaderChoice(input: unknown): ReplicaHeaderChoice {
  const choice = ReplicaHeaderChoiceSchema.parse(input);
  if (choice.provider === 'component') fail('retired_component');
  const { allUnits, headerUnits, bodyUnits } = choice.sourcePartition;
  for (const [name, values] of Object.entries({ allUnits, headerUnits, bodyUnits })) {
    if (new Set(values).size !== values.length) fail(`duplicate_${name}`);
  }
  const all = new Set(allUnits), header = new Set(headerUnits), body = new Set(bodyUnits);
  if (headerUnits.some(id => body.has(id))) fail('header_body_overlap');
  if ([...headerUnits, ...bodyUnits].some(id => !all.has(id))) fail('unit_outside_inventory');
  if (allUnits.some(id => !header.has(id) && !body.has(id))) fail('missing_source_coverage');
  return choice;
}

export type ReplicaHeaderRoute = {
  version: 1;
  kind: 'clonewp-replica-header-route';
  provider: ReplicaHeaderChoice['provider'];
  entryPoint: 'src/woodmart-header/generic/cli.ts';
  invocation: string;
  sourcePartition: ReplicaHeaderChoice['sourcePartition'];
  pagePipelineScope: 'separate-body-plan';
  independentlyEditableHeader: boolean;
  pageTemplate: 'elementor_header_footer';
  legacyTasks: 'not-supported';
  executes: false;
  remoteWrites: 0;
};

/** Routing is local advice only. It neither invokes the old writer nor contacts WP. */
export function routeReplicaHeaderChoice(input: unknown): ReplicaHeaderRoute {
  const choice = validateReplicaHeaderChoice(input);
  return {
    version: 1,
    kind: 'clonewp-replica-header-route',
    provider: choice.provider,
    entryPoint: 'src/woodmart-header/generic/cli.ts',
    invocation: 'npx tsx src/woodmart-header/generic/cli.ts --help',
    sourcePartition: structuredClone(choice.sourcePartition),
    pagePipelineScope: 'separate-body-plan',
    independentlyEditableHeader: true,
    pageTemplate: 'elementor_header_footer',
    legacyTasks: 'not-supported',
    executes: false,
    remoteWrites: 0,
  };
}

export const OwnedDraftHeaderBindingObservationSchema = z.object({
  pageId: z.number().int().positive(),
  postType: z.string().min(1),
  status: z.string().min(1),
  template: z.string().min(1),
  /** Actual _clonewp_run_id read from the target page. */
  runId: z.string().min(1).max(200),
  bodyHash: sha256,
  headerId: z.string().min(1).max(200).nullable(),
  snapshotHash: sha256,
}).strict();

export type OwnedDraftHeaderBindingObservation = z.infer<typeof OwnedDraftHeaderBindingObservationSchema>;

/**
 * Semantic preflight, not a capability or authentication proof. The server must
 * freshly re-read _clonewp_run_id, draft status, template, body and binding under
 * its write lock, compare the whole-page CAS, then verify the unchanged body.
 */
export function validateOwnedDraftHeaderBinding(
  input: unknown,
  expected: { pageId: number; runId: string },
): OwnedDraftHeaderBindingObservation {
  const wanted = z.object({ pageId: z.number().int().positive(), runId: z.string().min(1).max(200) }).strict().parse(expected);
  const page = OwnedDraftHeaderBindingObservationSchema.parse(input);
  if (page.pageId !== wanted.pageId) fail('binding_page_identity');
  if (page.runId !== wanted.runId) fail('binding_ownership');
  if (page.postType !== 'page') fail('binding_page_type');
  if (page.status !== 'draft') fail('binding_requires_draft');
  if (page.template !== 'elementor_header_footer') fail('binding_requires_full_width');
  if (page.headerId !== null) fail('binding_existing_header');
  return page;
}
