import { z } from 'zod';
import { NATIVE44_ALL_TYPES, NATIVE44_CATALOG_HASH, NATIVE44_REQUIRED_ENVIRONMENT, validateNative44Catalog } from '../native44/catalog.js';
import { EXTENDED_NATIVE_TYPES } from '../native44/catalog.js';
import { currentProductExtension, readProductExtension } from '../native44/product-extension.js';
import type { Native44KnowledgeIndex, Native44ComponentKnowledge } from '../native44/knowledge.js';
import { NATIVE44_SELECTION_RULES_HASH } from '../native44/selection-rules.js';
import type { SystemRelease } from '../system/contracts.js';
import { componentAdapterDeclarations } from './capabilities.js';
import { componentCanonical, componentFileRef, componentHash, componentPath, readComponentBytes, readComponentRef, writeComponentJson } from './io.js';
import type { ComponentFileRef, ComponentQualification, ComponentRegistration, ComponentRegistry, LearningRecord, LearningRelease } from './types.js';

const fileRefSchema = z.object({ path: z.string().min(1), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
const learningReleaseSchema = z.object({
  version: z.literal(1), kind: z.literal('component-learning-release'), releaseId: z.string().regex(/^[a-f0-9]{64}$/),
  previous: fileRefSchema.optional(), records: z.array(fileRefSchema).min(1), baseKnowledgeFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  enabledSetHash: z.literal(NATIVE44_CATALOG_HASH), activation: z.literal('knowledge-only'),
}).strict();
const qualificationSchema = z.object({ source: z.enum(['unverified', 'source-studied']), save: z.enum(['unverified', 'local-replay-verified']), render: z.enum(['unverified', 'local-replay-verified']), interaction: z.enum(['unverified', 'local-replay-verified']), resources: z.literal('task-local-only'), registration: z.literal('task-local-only') }).strict();
export const learningRecordSchema = z.object({
  version: z.literal(1), kind: z.enum(['component-learning-record', 'page-learning-record']), learningId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,100}$/),
  createdAt: z.iso.datetime(), widgetType: z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,100}$/).optional(), provider: z.string().min(1).max(120).optional(),
  mode: z.enum(['existing-component-recipe', 'new-component-candidate', 'page-pattern']),
  evidence: z.array(fileRefSchema.extend({ kind: z.string().min(1), scope: z.string().min(1) })).min(1),
  conclusions: z.array(z.object({ responsibility: z.string().min(1), statement: z.string().min(1), evidenceIndexes: z.array(z.number().int().nonnegative()).min(1) }).strict()).min(1),
  conclusionStatus: z.literal('candidate-interpretation'),
  qualification: qualificationSchema, constraints: z.array(z.string().min(1)).min(1), baseKnowledgeFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

async function readFrozenKnowledgeIndex(root: string): Promise<Native44KnowledgeIndex> {
  const index = JSON.parse((await readComponentBytes(root, 'data/native44/index.json')).toString('utf8')) as Native44KnowledgeIndex;
  const { fingerprint, ...identity } = index;
  if (index.schemaVersion !== 1 || index.artifactType !== 'native44-knowledge' || index.catalogHash !== NATIVE44_CATALOG_HASH || componentHash(JSON.stringify(identity)) !== fingerprint || JSON.stringify(index.requiredEnvironment) !== JSON.stringify(NATIVE44_REQUIRED_ENVIRONMENT) || Object.keys(index.components).length !== 44 || NATIVE44_ALL_TYPES.some(type => !index.components[type] || index.components[type].path !== `components/${type}.json`) || index.sharedControls.path !== 'shared-controls.json') throw Error('component_release_knowledge_identity_invalid');
  const shared = await readComponentRef(root, { ...index.sharedControls, path: `data/native44/${index.sharedControls.path}` });
  JSON.parse(shared.toString('utf8'));
  return index;
}

/** No writes or target/authentication imports. The executable contract stays
 * frozen; an optional knowledge-only release is separately pinned for tasks.
 * undefined follows the current pointer, null explicitly freezes base-only. */
export async function readCurrentRelease(root = 'D:/cloneWP', options: { learningRelease?: ComponentFileRef | null; componentExtension?: ComponentFileRef | null } = {}): Promise<SystemRelease> {
  const catalog = await readComponentBytes(root, 'config/native44-component-set.json');
  if (componentHash(catalog) !== NATIVE44_CATALOG_HASH) throw Error('component_release_catalog_hash_mismatch');
  validateNative44Catalog(JSON.parse(catalog.toString('utf8')));
  const knowledge = await readFrozenKnowledgeIndex(root);
  const selectionFiles = await Promise.all(['src/native44/selection-rules.ts', 'src/native44/selection.ts', 'src/native44/page-context.ts'].map(name => componentFileRef(root, name)));

  const index = await componentFileRef(root, 'data/native44/index.json');
  const learning = await readLearningReleases(root, knowledge.fingerprint, { release: options.learningRelease, verifyEvidence: false });
  const learningRelease = learning.at(-1)?.ref;
  const componentExtension=options.componentExtension===null?undefined:options.componentExtension??await currentProductExtension(root);
  if(componentExtension)await readProductExtension(componentExtension,root);
  const adapters = (await componentAdapterDeclarations(root,componentExtension??null))[0];
  return {
    version: 1, executorId: 'native44',...(componentExtension?{componentExtension}:{}),
    componentSet: { id: componentExtension?'native44-plus-core-product-v1':'native44-v1', catalog: await componentFileRef(root, 'config/native44-component-set.json'), types: [...(componentExtension?EXTENDED_NATIVE_TYPES:NATIVE44_ALL_TYPES)] },
    knowledge: { id: `native44-${knowledge.fingerprint}`, index, fingerprint: knowledge.fingerprint, ...(learningRelease ? { learningRelease } : {}) },
    selectionRules: { id: 'desktop-browser-v1', sha256: NATIVE44_SELECTION_RULES_HASH, files: selectionFiles },
    adapters: { id: adapters.id, sha256: componentHash(componentCanonical(adapters.sourceRefs)), files: adapters.sourceRefs },
  };
}

export async function readLearningReleases(root: string, fingerprint: string, options: { release?: ComponentFileRef | null; verifyEvidence?: boolean } = {}): Promise<Array<{ ref: ComponentFileRef; release: LearningRelease; records: Array<{ ref: ComponentFileRef; record: LearningRecord }> }>> {
  if (options.release === null) return [];
  let selected: ComponentFileRef;
  if (options.release) selected = fileRefSchema.parse(options.release);
  else {
    try {
      const pointer = z.object({ version: z.literal(1), release: fileRefSchema.nullable() }).strict().parse(JSON.parse((await readComponentBytes(root, 'data/system/knowledge-current.json')).toString('utf8')));
      // An explicit null archives the current candidate chain without deleting
      // immutable evidence or changing tasks that name a frozen release.
      if (pointer.release === null) return [];
      selected = pointer.release;
    }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
  }
  const result: Array<{ ref: ComponentFileRef; release: LearningRelease; records: Array<{ ref: ComponentFileRef; record: LearningRecord }> }> = [], seen = new Set<string>();
  let ref: ComponentFileRef | undefined = selected;
  while (ref) {
    if (!/^learning\/releases\/[a-f0-9]{64}\.json$/.test(ref.path) || seen.has(ref.path) || result.length >= 10000) throw Error('component_learning_release_chain_invalid');
    seen.add(ref.path);
    const release = learningReleaseSchema.parse(JSON.parse((await readComponentRef(root, ref)).toString('utf8')));
    const { releaseId, ...identity } = release;
    if (componentHash(componentCanonical(identity)) !== releaseId || ref.path !== `learning/releases/${releaseId}.json` || release.baseKnowledgeFingerprint !== fingerprint) throw Error('component_learning_release_identity_mismatch');
    const records = await Promise.all(release.records.map(async recordRef => {
      if (!/^learning\/[A-Za-z0-9][A-Za-z0-9_-]{0,100}\/record\.json$/.test(recordRef.path)) throw Error('component_learning_record_path_invalid');
      const record = learningRecordSchema.parse(JSON.parse((await readComponentRef(root, recordRef)).toString('utf8')));
      if (record.baseKnowledgeFingerprint !== fingerprint || recordRef.path !== `learning/${record.learningId}/record.json`) throw Error('component_learning_record_identity_mismatch');
      if (record.kind === 'component-learning-record' && !record.widgetType || record.kind === 'page-learning-record' && record.widgetType) throw Error('component_learning_record_kind_mismatch');
      if (record.conclusions.some(conclusion => conclusion.evidenceIndexes.some(index => !record.evidence[index]))) throw Error('component_learning_record_conclusion_evidence_missing');
      if (record.qualification.source === 'source-studied' && !record.evidence.some(evidence => evidence.kind === 'source-contract' && evidence.scope === 'source-contract') || record.qualification.save === 'local-replay-verified' && !record.evidence.some(evidence => evidence.kind === 'save-replay' && evidence.scope === 'local-save-replay') || record.qualification.render === 'local-replay-verified' && !record.evidence.some(evidence => evidence.kind === 'render-replay' && evidence.scope === 'local-render-replay') || record.qualification.interaction === 'local-replay-verified' && !record.evidence.some(evidence => evidence.kind === 'interaction-replay' && evidence.scope === 'local-interaction-replay')) throw Error('component_learning_qualification_evidence_missing');
      for (const evidence of record.evidence) {
        if (!new RegExp(`^learning/${record.learningId}/evidence/[a-f0-9]{64}\\.(?:json|php|txt|png|jpg|webp)$`).test(evidence.path)) throw Error('component_learning_evidence_path_invalid');
        if (options.verifyEvidence !== false) await readComponentRef(root, evidence);
      }
      return { ref: recordRef, record: record as LearningRecord };
    }));
    result.push({ ref, release: release as LearningRelease, records });
    ref = release.previous;
  }
  return result.reverse();
}

const unverified = (scope: string): ComponentQualification => ({ status: 'unverified', scope, evidence: [], limitations: ['Knowledge does not certify the current target, resource availability or every mode.'] });

/** Reads authoritative source contracts and append-only learning releases.
 * The optional JSON snapshot is a generated view, never a second authority. */
export async function loadComponentRegistry(root = 'D:/cloneWP', usedTypes?: readonly string[], options: { learningRelease?: ComponentFileRef | null;componentExtension?:ComponentFileRef|null } = {}): Promise<ComponentRegistry> {
  if (usedTypes && new Set(usedTypes).size !== usedTypes.length) throw Error('component_registry_duplicate_request');

  const release = await readCurrentRelease(root, options), index = await readFrozenKnowledgeIndex(root);
  if (release.knowledge.fingerprint !== index.fingerprint) throw Error('component_release_knowledge_changed_during_read');
  const extension=release.componentExtension?await readProductExtension(release.componentExtension,root):undefined;
  const frozenTypes=release.componentSet.types.filter(type=>!usedTypes||usedTypes.includes(type));
  const componentRef=(type:string)=>extension?.index.components[type]??{ path:`data/native44/${index.components[type].path}`,sha256:index.components[type].sha256 };
  const components = Object.fromEntries(await Promise.all(frozenTypes.map(async type => {
    const ref = componentRef(type);
    const component = JSON.parse((await readComponentRef(root, ref)).toString('utf8')) as Native44ComponentKnowledge;
    if (component.componentType !== type || !component.usage || !component.evidence) throw Error(`component_registry_contract_invalid: ${type}`);
    return [type, component] as const;
  })));
  const adapters = await componentAdapterDeclarations(root,release.componentExtension??null);
  const entries: ComponentRegistration[] = frozenTypes.map(type => {
    const component = components[type], ref = componentRef(type);
    const source: ComponentQualification = { status: component.evidence.sourceStudied ? 'source-studied' : 'unverified', scope: 'frozen-source-contract', evidence: [ref], limitations: ['Research baseline is separate from the current target contract.'] };
    const historical = (observed: boolean, scope: string): ComponentQualification => observed
      ? { status: 'historical-qualified', scope, evidence: [ref], limitations: [`Historical environment only: Core ${component.evidence.historicalCore}; current target must be checked separately.`, 'Record coverage does not prove all modes or interactions.'] }
      : unverified(scope);
    return {
      widgetType: type, provider: type.startsWith('wd_') ? 'woodmart' : type === 'breadcrumbs' ? 'provider-requires-target-contract' : 'elementor', activation: 'enabled',
      contractRefs: [ref], recipeRefs: [ref], resourceDependencies: [...component.usage.resourceDependencies], adapterRefs: ['native44-desktop-v1'],
      contentModel: component.usage.contentModel, suitableFor: [...component.usage.suitableFor], restrictions: [...component.usage.restrictions],
      qualifications: { source, save: unverified('save-receipts-not-independently-imported'), render: historical(component.evidence.effectRecordCount > 0, 'historical-effect-records'), interaction: historical(component.evidence.interactionChanged > 0, 'historical-interaction-records'), resources: unverified('current-task-only') },
    };
  });
  const learning = await readLearningReleases(root, index.fingerprint, { release: release.knowledge.learningRelease ?? null, verifyEvidence: false });
  for (const batch of learning) for (const { ref, record } of batch.records) {
    if (record.kind !== 'component-learning-record' || !record.widgetType || usedTypes && !usedTypes.includes(record.widgetType)) continue;
    for (const evidence of record.evidence) await readComponentRef(root, evidence);
    let entry = entries.find(component => component.widgetType === record.widgetType);
    if (!entry) {
      entry = {
        widgetType: record.widgetType, provider: record.provider!, activation: 'reference-only', contractRefs: [], recipeRefs: [], resourceDependencies: [], adapterRefs: [], contentModel: 'unverified',
        suitableFor: [], restrictions: ['Not in the enabled component set. Requires explicit authorization, execution adapter and scoped verification before generation.'],
        qualifications: { source: unverified('learning-candidate'), save: unverified('learning-candidate'), render: unverified('learning-candidate'), interaction: unverified('learning-candidate'), resources: unverified('current-task-only') },
      };
      entries.push(entry);
    }
    entry.recipeRefs.push(ref);
    if (entry.activation !== 'enabled' && record.qualification.source === 'source-studied') entry.activation = 'adapter-pending';
    // Local replay qualification is retained on the record. It never upgrades
    // global/live qualification or the production writer's frozen knowledge.
    if (entry.activation !== 'enabled') entry.contractRefs.push(...record.evidence.filter(evidence => evidence.kind === 'source-contract').map(({ path, sha256 }) => ({ path, sha256 })));
  }
  for (const type of usedTypes ?? []) if (!entries.some(entry => entry.widgetType === type)) throw Error(`component_registry_unknown_component: ${type}`);
  const patterns = learning.flatMap(batch => batch.records).filter(item => item.record.kind === 'page-learning-record').reverse();
  const pagePatterns: ComponentRegistry['pagePatterns'] = {
    total: patterns.length,
    entries: patterns.slice(0, 20).map(({ ref, record }) => ({
      learningId: record.learningId, recordRef: ref, conclusionStatus: record.conclusionStatus,
      conclusionCount: record.conclusions.length,
      conclusions: record.conclusions.slice(0, 10).map(conclusion => ({ ...conclusion, statement: conclusion.statement.slice(0, 1600), statementTruncated: conclusion.statement.length > 1600 })),
      evidenceCount: record.evidence.length, evidence: record.evidence.slice(0, 12),
    })),
    additionalRecordRefs: patterns.slice(20).map(item => item.ref),
  };
  const identity = {
    version: 1 as const, kind: 'component-registry' as const,
    enabledSet: { id: release.componentExtension?'native44-plus-core-product-v1' as const:'native44-v1' as const, ref: release.componentSet.catalog, widgetTypes: [...release.componentSet.types] },
    knowledge: { fingerprint: index.fingerprint, index: release.knowledge.index, ...(release.knowledge.learningRelease ? { learningRelease: release.knowledge.learningRelease } : {}) }, entries, adapters, learningReleases: learning.map(item => item.ref), pagePatterns,
  };
  return { ...identity, fingerprint: componentHash(componentCanonical(identity)) };
}

export async function writeComponentRegistry(root = 'D:/cloneWP'): Promise<{ registry: ComponentRegistry; ref: ComponentFileRef }> {
  const registry = await loadComponentRegistry(root);
  return { registry, ref: await writeComponentJson(root, 'data/system/component-registry.json', registry) };
}
