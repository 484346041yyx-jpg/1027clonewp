import test from 'node:test';
import assert from 'node:assert/strict';
import { buildNative44DeliverySummary } from '../src/native44/delivery-summary.js';
import type { Native44CurrentState } from '../src/native44/current-state.js';

test('delivery merges the exact named quality issue without suppressing a different owner or losing evidence', () => {
  const ref = { path: 'runs/run/review.json', sha256: 'a'.repeat(64) }, note = (region: string) => ({ domain: 'interaction' as const, region, issue: 'Missing control.', impact: 'Control unavailable.', nextAction: 'Keep this unfinished capability visible.', evidence: [ref] });
  const state = { version: 1, kind: 'verified-native44-current-state', unpublished: true, originalDocumentHash: 'b'.repeat(64), requestedScope: 'Fixture delivery review', counts: { containers: 0, widgets: 0, html: 0, productWidgets: 0 }, authority: 'verified-local-evidence', observedAt: new Date().toISOString(), evidence: [], taskId: 'task', runId: 'run', pageId: 1, documentHash: 'b'.repeat(64), currentSnapshot: ref, currentCSS: ref, verification: ref, visualReview: ref, status: 'reviewed-with-gaps', visualVerification: 'reviewed-with-gaps', deliveryComplete: false, currentCaptureReview: { reviewGoal: 'component-reference-v1', frozenContractPreserved: true, requirementsComplete: false, review: 'reviewed', automated: 'passed', qualityFloor: { status: 'blocked', issues: ['hero: Missing control.', 'Another actual check failed.'] }, draftReady: false, deliveryReady: false, canonicalCSSHash: 'c'.repeat(64), record: { path: 'runs/run/current-review.json', sha256: 'd'.repeat(64) }, notes: { completedAndVerified: [], unfinished: [note('hero'), note('secondary-carousel')], minorIssues: [], unverified: [], productContentReplacement: [], componentExceptions: [] } } } as Native44CurrentState;
  const summary = buildNative44DeliverySummary(state, { generatedAt: new Date().toISOString() });
  assert.equal(summary.sections.unfinished.length, 3);
  assert.equal(summary.sections.unfinished.filter(item => item.region === 'hero').length, 1);
  assert.equal(summary.sections.unfinished.filter(item => item.region === 'secondary-carousel').length, 1);
  assert.ok(summary.sections.unfinished.find(item => item.region === 'hero')!.evidence.some(item => item.sha256 === 'd'.repeat(64)));
  assert.ok(summary.sections.unfinished.some(item => item.issue === 'Another actual check failed.'));
  assert.equal(summary.axes.qualityFloor, 'blocked'); assert.equal(summary.deliveryComplete, false);
});
