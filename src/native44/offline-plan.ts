import path from 'node:path';
import { realpath, readFile } from 'node:fs/promises';
import { readJson } from '../core/config.js';
import { writeJson } from '../core/files.js';
import type { CapabilityReport, TargetCatalogSnapshot } from '../wordpress/types.js';
import { hashV2 } from '../replica-v2/journal.js';
import { prepareLocalTask } from './local-task.js';
import { preflightNative44, usedNative44WidgetTypes } from './compiler.js';
import { toNative44CompilerKnowledge } from './knowledge.js';
import { fingerprintNative44Contracts } from './environment.js';
import { validateNative44Selection } from './selection.js';
import { assertTargetPostsEvidence, type TargetPostsEvidence } from '../wordpress/posts-contract.js';

export async function createOfflineNative44Plan(options: { job: string; registry: string; catalog?: string; posts?: string; stage?: string }, root: string) {
  if (options.stage) throw Error('native44-css-handoff has one complete document and rejects --stage');
  const local = await prepareLocalTask(path.resolve(root, options.job, 'program.json'), root, { allowRequirementGaps: true });
  const registryPath = await realpath(path.resolve(root, options.registry)), relative = path.relative(root, registryPath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw Error('Native44 saved registry must stay inside cloneWP');
  const bytes = await readFile(registryPath), registry = JSON.parse(bytes.toString('utf8')) as CapabilityReport;
  const actualContracts=fingerprintNative44Contracts(registry,usedNative44WidgetTypes(local.program));
  validateNative44Selection(local.program, local.componentPlan, local.sourceFacts, { schemas: registry.legacySchemas, knowledge: local.knowledge });
  let catalog: TargetCatalogSnapshot | undefined;
  if (options.catalog) {
    const filename = await realpath(path.resolve(root, options.catalog)), rel = path.relative(root, filename);
    if (rel.startsWith('..') || path.isAbsolute(rel)) throw Error('Native44 saved catalog must stay inside cloneWP');
    catalog = await readJson(filename);
    const project = await readJson<{targetUrl: string}>(path.join(root, 'config', 'project.json'));
    if (catalog!.targetOrigin !== new URL(project.targetUrl).origin || !catalog!.evidence.length) throw Error('Saved catalog must identify the configured target and actual evidence');
  }
  const project = await readJson<{targetUrl:string}>(path.join(root,'config','project.json'));
  let posts: TargetPostsEvidence[] | undefined;
  if (options.posts) {
    const filename = await realpath(path.resolve(root, options.posts)), rel = path.relative(root, filename);
    if (rel.startsWith('..') || path.isAbsolute(rel)) throw Error('Native44 saved article query must stay inside cloneWP');
    const observed = await readJson<unknown>(filename); posts = Array.isArray(observed) ? observed : [observed];
    for (const snapshot of posts) assertTargetPostsEvidence(snapshot, new URL(project.targetUrl).origin);
  }
  const preflight = preflightNative44(local.program, { schemas: registry.legacySchemas, knowledge: toNative44CompilerKnowledge(local.knowledge, registry.legacySchemas), catalog, posts, targetOrigin:new URL(project.targetUrl).origin });
  const plan = { version: 2, workflow: 'block-replication', executionStrategy: 'native44-css-handoff', ...(local.program.replicationProfile ? { replicationProfile: local.program.replicationProfile, selectionRulesHash: local.program.selectionRulesHash } : {}), environmentPolicy:'component-contract', status: 'capability-planned', ...preflight, componentCatalog: local.program.componentCatalog, knowledge: local.program.knowledge, targetEnvironment: local.program.targetEnvironment, knowledgeBaselineVersions:local.program.targetEnvironment,...actualContracts, registry: { path: registryPath, sha256: hashV2(bytes) }, renderVerificationRequired: true, liveRediscoveryRequired: true, livePlatformVerificationRequired:true,deliveryComplete: false };
  if (local.requirementCoverage) Object.assign(plan, { requirementProfile: local.program.requirementProfile, ...(local.program.goalProfile ? { goalProfile: local.program.goalProfile } : {}), sourceRequirementCoverage: local.requirementCoverage, draftReady: local.requirementCoverage.draftReady, requirementsComplete: false, passed: preflight.passed && local.requirementCoverage.draftReady, status: local.requirementCoverage.draftReady ? 'capability-planned' : 'blocked-source-capabilities' });
  const resultFile = path.join(local.jobDir, 'native-capability-plan.json'); await writeJson(resultFile, plan); return { plan, resultFile };
}
