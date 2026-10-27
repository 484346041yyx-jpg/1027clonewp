import type { Native44CompareManifest } from './compare.js';
import type { Native44CurrentState } from './current-state.js';
import { NATIVE44_WHOLE_PAGE_REVIEW_WORKFLOW } from './types.js';
import type { DraftSnapshot, ElementorElement } from '../wordpress/types.js';

type ReviewJournal = {
  reviewWorkflow?: string; taskId: string; runId: string; pageId?: number;
  status: string; mutations: Array<{ kind?: string; checkpoint?: string; status: string }>;
};

/** Scheduling preflight only. It never supplies visual or interaction verdicts.
 * Missing policy preserves frozen tasks' original comparison workflow. */
export function assertNative44WholePageReviewReady(input: {
  manifest: Native44CompareManifest; journal?: ReviewJournal; current?: Native44CurrentState;
  snapshot?: DraftSnapshot; expectedModuleKeys?: string[];
}): void {
  const { manifest, journal, current, snapshot } = input;
  if (!manifest.reviewWorkflow && !journal?.reviewWorkflow) return;
  if (manifest.reviewWorkflow !== NATIVE44_WHOLE_PAGE_REVIEW_WORKFLOW || journal?.reviewWorkflow !== manifest.reviewWorkflow) throw Error('native44_review_workflow_identity_conflict');
  if (!current?.axes || !current.cssModel || !current.currentManifest || current.axes.write.status !== 'confirmed' || current.axes.css.status !== 'applied') throw Error('native44_whole_page_css_not_ready: finish the complete body and apply the consolidated page CSS through revision prepare/apply before --capture-current; full visual and interaction review has not started.');
  if (journal.taskId !== manifest.taskId || journal.runId !== manifest.runId || journal.pageId !== manifest.pageId || current.taskId !== manifest.taskId || current.runId !== manifest.runId || current.pageId !== manifest.pageId || current.documentHash !== manifest.documentHash) throw Error('native44_whole_page_review_identity_conflict');
  if (!['draft-saved', 'awaiting-comparison', 'delivered'].includes(journal.status) || journal.mutations.some(item => item.status !== 'confirmed') || journal.mutations.filter(item => item.kind === 'document-save' && item.checkpoint === 'complete-body' && item.status === 'confirmed').length !== 1) throw Error('native44_whole_page_body_not_confirmed');
  if (!snapshot || snapshot.pageId !== manifest.pageId || snapshot.runId !== manifest.runId || snapshot.hash !== manifest.documentHash || snapshot.status !== 'draft' || typeof snapshot.settings.custom_css !== 'string' || snapshot.settings.custom_css !== manifest.pageCss) throw Error('native44_whole_page_snapshot_or_css_not_current');
  const nodes: ElementorElement[] = [];
  const walk = (elements: ElementorElement[]) => { for (const node of elements) { nodes.push(node); walk(node.elements ?? []); } }; walk(snapshot.elements);
  for (const module of manifest.modules) {
    const owners = nodes.filter(node => ['css_classes', '_css_classes'].some(key => typeof node.settings[key] === 'string' && (node.settings[key] as string).split(/\s+/).includes(module.className)));
    if (owners.length !== 1) throw Error(`native44_whole_page_module_not_complete: ${module.key}`);
  }
  if (input.expectedModuleKeys) assertNative44WholePageModuleCoverage(manifest, input.expectedModuleKeys);
}

export function assertNative44WholePageModuleCoverage(manifest: Native44CompareManifest, expectedModuleKeys: string[]): void {
  if (!manifest.reviewWorkflow) return;
  const expected = [...expectedModuleKeys].sort(), actual = manifest.modules.map(module => module.key).sort();
  if (new Set(expected).size !== expected.length || JSON.stringify(expected) !== JSON.stringify(actual)) throw Error('native44_whole_page_module_coverage_incomplete');
}
