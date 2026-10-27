import { z } from 'zod';

const text = z.string().trim().min(1).max(4000);
const identifier = z.string().regex(/^[A-Za-z\d][A-Za-z\d_.-]{0,159}$/).refine(value => !value.includes('..'));
const digest = z.string().regex(/^[a-f\d]{64}$/);
export const Native44CurrentReviewRefSchema = z.object({ path: z.string().min(1).max(4096), sha256: digest }).strict();
const entry = z.object({ region: text, issue: text, impact: text, nextAction: text, evidence: z.array(Native44CurrentReviewRefSchema).min(1).max(100) }).strict();

/** Explicit current-capture review of a historical saved draft. These notes do
 * not migrate its frozen component plan or claim source requirements complete. */
export const Native44CurrentReviewNotesSchema = z.object({
  completedAndVerified: z.array(entry).max(1000),
  unfinished: z.array(entry.extend({ domain: z.enum(['content', 'native-editing', 'product-data', 'layout', 'interaction', 'supporting-integration']) })).max(1000),
  minorIssues: z.array(entry.extend({ domain: z.enum(['geometry', 'typography', 'decoration']) })).max(1000),
  unverified: z.array(entry.extend({ domain: z.enum(['quality-floor', 'supporting-integration', 'out-of-scope', 'requirements-coverage']) })).max(1000),
  productContentReplacement: z.array(entry).max(1000),
  componentExceptions: z.array(entry).max(1000),
}).strict();
export type Native44CurrentReviewNotes = z.infer<typeof Native44CurrentReviewNotesSchema>;
const reviewedGap = z.object({
  gapHash: digest, category: z.literal('interaction'), moduleKey: identifier, viewport: z.enum(['desktop-wide', 'desktop-narrow']),
  basis: z.literal('noninteractive-native-layout'), reason: text.min(40), evidence: z.array(Native44CurrentReviewRefSchema).min(1).max(100),
}).strict();
export const Native44CurrentCaptureReviewRequestSchema = z.object({
  version: z.literal(1), kind: z.literal('native44-current-capture-review-request'),
  taskId: identifier, runId: identifier, pageId: z.number().int().positive(),
  expectedPointerHash: digest, documentHash: digest,
  userInstruction: text.min(20), report: Native44CurrentReviewRefSchema, visualReview: Native44CurrentReviewRefSchema,
  notes: Native44CurrentReviewNotesSchema,
  gapReviews: z.array(reviewedGap).max(100).default([]),
}).strict();
export type Native44CurrentCaptureReviewRequest = z.infer<typeof Native44CurrentCaptureReviewRequestSchema>;
export const Native44CurrentCaptureReviewSchema = z.object({
  version: z.literal(1), kind: z.literal('native44-current-capture-review'),
  taskId: identifier, runId: identifier, pageId: z.number().int().positive(), documentHash: digest,
  reviewGoal: z.literal('component-reference-v1'), frozenContractPreserved: z.literal(true), requirementsComplete: z.literal(false),
  userInstruction: text.min(20), recordedAt: z.iso.datetime(), parentPointerHash: digest,
  request: Native44CurrentReviewRefSchema,
  currentSnapshot: Native44CurrentReviewRefSchema, currentCSS: Native44CurrentReviewRefSchema,
  report: Native44CurrentReviewRefSchema, manifest: Native44CurrentReviewRefSchema, visualReview: Native44CurrentReviewRefSchema,
  notes: Native44CurrentReviewNotesSchema,
  gapReviews: z.array(reviewedGap).max(100),
}).strict();
export type Native44CurrentCaptureReview = z.infer<typeof Native44CurrentCaptureReviewSchema>;
export interface Native44CurrentCaptureReviewState {
  reviewGoal: 'component-reference-v1'; frozenContractPreserved: true; requirementsComplete: false;
  review: 'reviewed'; automated: 'passed' | 'has-failures';
  qualityFloor: { status: 'satisfied' | 'blocked'; issues: string[] };
  draftReady: boolean; deliveryReady: boolean; canonicalCSSHash: string;
  record: z.infer<typeof Native44CurrentReviewRefSchema>; notes: Native44CurrentReviewNotes;
}
