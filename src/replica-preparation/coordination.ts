import { z } from 'zod';
import { buildPreparationJobs, preparationHash, preparationSharedHash, validatePreparationPlan } from './contract.js';
import type { PreparationJob, PreparationPlan } from './types.js';
import type { PresentationFinding } from './presentation.js';

function fail(reason: string): never { throw Error(`replica_preparation_coordination_${reason}`); }
function scope(input: PreparationPlan, jobs: PreparationJob[]) {
  const plan = validatePreparationPlan(input);
  if (!plan.executionPolicy) fail('policy_required');
  if (preparationHash(jobs) !== preparationHash(buildPreparationJobs(plan))) fail('jobs_changed');
  return plan;
}

/** A task-bound operating plan. It never creates browser windows, chats or remote resources. */
export function createPreparationCoordination(input: PreparationPlan, jobs: PreparationJob[]) {
  const plan = scope(input, jobs);
  return {
    version: 1, kind: 'clonewp-preparation-coordination', taskId: plan.taskId, runId: plan.runId,
    contractHash: preparationHash(plan), sharedHash: preparationSharedHash(plan), policy: plan.executionPolicy,
    controller: { owner: 'coordinator', browser: 'serial', credentials: 'coordinator-only', remoteWrites: 'serial-with-intent-cas-readback', workersMayWriteRemote: false },
    browser: {
      mode: 'two-window-single-controller', windows: [
        { role: 'desktop', label: '复刻｜桌面对照', tabs: ['source', 'target', 'single-owned-editor'] },
        { role: 'phone', label: '复刻｜手机对照', tabs: ['source', 'target'] },
      ],
      match: 'actual-clientWidth-and-state', requiredViewports: 'all-frozen-desktop-and-phone-views',
      reuse: 'existing-correct-browser-and-tabs-first', naming: 'documented-window-or-tab-group-api; otherwise-session-label-and-binding',
      unavailable: 'report-capability-gap-without-closing-user-tabs-or-claiming-created-windows',
    },
    materials: {
      identity: 'task-run-contract-shared-hash',
      refs: { sourceEvidence: plan.sourceEvidence, sourceFacts: plan.sourceFacts, sourceUnits: plan.sourceUnits, bodyAssets: plan.bodyAssets, ...(plan.headerAssets ? { headerAssets: plan.headerAssets } : {}) },
      reuse: 'frozen-source-and-unchanged-version-applicable-knowledge',
      recapture: 'named-missing-state-or-observed-source-change-only',
      invalidation: 'changed-source-or-shared-hash-requires-new-bound-results',
      backendStateCache: false, deduplicateMedia: 'source-and-byte-hash-before-serial-upload',
    },
    workflow: ['complete-source', 'shared-planning', 'parallel-owned-production', 'local-whole-page-merge', 'serial-complete-save', 'consolidated-whole-page-review', 'batched-owned-repair', 'final-review-publish-editor-reopen'],
    duringProduction: { check: ['structure', 'actual-font', 'native-component-capability', 'critical-interaction'], avoid: 'per-detail-save-and-whole-page-review' },
    coordinatorOverlap: ['prepare-and-deduplicate-assets', 'resolve-named-gaps', 'validate-finished-local-results', 'prepare-merge'],
    communication: ['start', 'named-blocker-or-shared-decision', 'actual-result-delivery', 'repair-complete'],
    ownership: jobs.map(job => ({ jobId: job.jobId, sectionKeys: job.sectionKeys, responsibility: job.responsibility, output: `jobs/${job.jobId}/result.json`, ownsDesktopAndPhone: job.responsibility === 'body', canChangeSharedRules: false })),
    review: { mode: 'whole-page-batched', candidateIsApproval: false, finalQualityGates: 'unchanged', beforeMergeRepairs: 'version-bound-rework-batch', afterMergeRepairs: 'existing-authorized-revision-cas-readback', smallChange: 'recheck-affected-scope-and-page-seams', globalChange: 'recheck-all-required-views', noTimeBasedPass: true },
    inquiryTesting: 'user-managed-no-automatic-submission-or-test-email',
    measurement: { total: 'actual-wall-time-not-sum-of-worker-durations', failuresAndWaits: 'included', systemDevelopment: 'separate-from-page-production', speedup: 'unmeasured-until-comparable-real-tasks' },
    planIsRuntimeEvidence: false, remoteWrites: 0,
  } as const;
}

const identity = z.string().min(1).max(240);
export const preparationBrowserWorkspaceSchema = z.object({
  version: z.literal(1), kind: z.literal('clonewp-browser-workspace-observation'), taskId: identity, runId: identity,
  contractHash: z.string().regex(/^[a-f0-9]{64}$/),
  windows: z.array(z.object({ role: z.enum(['desktop', 'phone']), browserId: identity, windowId: identity, sourceTabId: identity, targetTabId: identity, sourceClientWidth: z.number().int().positive().max(20000), targetClientWidth: z.number().int().positive().max(20000) }).strict()).length(2),
  editor: z.object({ tabId: identity, browserId: identity, windowId: identity, pageId: z.number().int().positive(), dirty: z.boolean(), saving: z.boolean(), pendingSaveRequests: z.number().int().nonnegative(), saveOutcomeUnknown: z.boolean() }).strict(),
}).strict();

/** Validates tool-observed bindings only; unsupported window APIs never become fabricated evidence. */
export function checkPreparationBrowserWorkspace(plan: PreparationPlan, input: unknown, expectedPageId: number) {
  const value = preparationBrowserWorkspaceSchema.parse(input);
  if (!plan.executionPolicy || value.taskId !== plan.taskId || value.runId !== plan.runId || value.contractHash !== preparationHash(plan)) fail('browser_scope');
  const desktop = value.windows.find(w => w.role === 'desktop'), phone = value.windows.find(w => w.role === 'phone');
  if (!desktop || !phone || desktop.browserId !== phone.browserId || desktop.windowId === phone.windowId) fail('browser_roles');
  const tabs = value.windows.flatMap(w => [w.sourceTabId, w.targetTabId]);
  if (new Set([...tabs, value.editor.tabId]).size !== 5) fail('browser_duplicate_tab');
  const breakpoint = plan.responsive?.mobileMaxWidth;
  if (!breakpoint || value.windows.some(w => w.sourceClientWidth !== w.targetClientWidth) || desktop.sourceClientWidth <= breakpoint || phone.sourceClientWidth > breakpoint) fail('browser_viewport');
  if (value.editor.pageId !== expectedPageId || value.editor.browserId !== desktop.browserId || value.editor.windowId !== desktop.windowId) fail('editor_scope');
  return { bindings: value, controller: 'coordinator-only', canRefreshEditor: !value.editor.dirty && !value.editor.saving && value.editor.pendingSaveRequests === 0 && !value.editor.saveOutcomeUnknown, allRequiredViewsVerified: false, visualApproval: false, remoteWrites: 0 };
}

/** Route one consolidated finding set back to its production owner. Unknown/shared findings stay central. */
export function createPreparationRepairPlan(input: PreparationPlan, jobs: PreparationJob[], findings: PresentationFinding[], extraOwners: Record<string, string> = {}) {
  const plan = scope(input, jobs), owners = new Map<string, string>();
  for (const section of plan.sections) for (const fact of section.sourceFactIds) owners.set(fact, section.key);
  for (const [fact, section] of Object.entries(extraOwners)) {
    if (!plan.sections.some(s => s.key === section) || owners.has(fact) && owners.get(fact) !== section) fail('repair_owner');
    owners.set(fact, section);
  }
  const grouped = new Map<string, { jobId: string; sectionKeys: string[]; findings: PresentationFinding[] }>();
  const shared: PresentationFinding[] = [];
  for (const finding of findings) {
    const section = owners.get(finding.sourceFactId), job = section ? jobs.find(j => j.sectionKeys.includes(section)) : undefined;
    if (!job || !section) { shared.push(finding); continue; }
    let group = grouped.get(job.jobId);
    if (!group) { group = { jobId: job.jobId, sectionKeys: [], findings: [] }; grouped.set(job.jobId, group); }
    if (!group.sectionKeys.includes(section)) group.sectionKeys.push(section);
    group.findings.push(structuredClone(finding));
  }
  return {
    version: 1, kind: 'clonewp-consolidated-repair-plan', taskId: plan.taskId, runId: plan.runId, contractHash: preparationHash(plan),
    batchHash: preparationHash({ findings, extraOwners }), batches: [...grouped.values()], coordinatorFindings: structuredClone(shared),
    affectedSectionKeys: plan.sections.filter(s => [...grouped.values()].some(g => g.sectionKeys.includes(s.key))).map(s => s.key),
    globalChanges: ['fonts', 'content-width', 'breakpoints', 'shared-css'],
    globalChangeRequiresAllViews: true, seamsRequireRecheck: true,
    beforeMerge: 'coordinator-version-bound-rework', afterMerge: 'existing-authorized-revision-with-fresh-current-page-cas',
    findingsAreApproval: false, zeroFindingsAreApproval: false, automaticRemoteWrite: false, remoteWrites: 0,
  } as const;
}
