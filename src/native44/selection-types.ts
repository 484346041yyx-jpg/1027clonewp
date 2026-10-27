import { z } from 'zod';

const id = z.string().min(1).max(240);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const SelectionFileRefSchema = z.object({ path: z.string().min(1), sha256: hash }).strict();
const screenshot = z.object({ snapshotId: id, screenshot: SelectionFileRefSchema }).strict();

/** Source responsibilities are authored from source pixels and ownership, never
 * inferred from the target widget selected later. */
export const SourceUnitSchema = z.object({
  id, snapshotId: id, ownerNodeId: id, regionId: id,
  role: z.enum(['heading', 'description', 'body', 'cta', 'link', 'navigation-list', 'image', 'image-card', 'information-card', 'image-advertisement', 'marketing-card', 'query', 'deferred-query', 'data-query', 'form', 'social-links', 'breadcrumb', 'icon', 'carousel', 'layout', 'decoration']),
  sourceFactIds: z.array(id).min(1),
  evidence: z.object({ factIds: z.array(id).min(1), screenshots: z.array(screenshot).min(1), rationale: z.string().min(20) }).strict(),
  slots: z.array(z.object({ id, kind: z.enum(['text', 'media', 'link', 'interaction']), factIds: z.array(id).min(1), required: z.boolean() }).strict()),
  repeatedItems: z.array(z.object({ id, ownerNodeId: id, slotIds: z.array(id).min(1) }).strict()).optional(),
}).strict();

export const SelectionDecisionSchema = z.object({
  unitId: id,
  componentKeys: z.array(id).min(1),
  candidates: z.array(z.object({ widgetTypes: z.array(id).min(1), conclusion: z.enum(['selected', 'unsuitable']), reason: z.string().min(20), evidence: z.array(SelectionFileRefSchema).min(1) }).strict()).min(1),
  reason: z.string().min(20),
  compositionReason: z.object({ kind: z.enum(['multiple-links', 'nonstandard-content-order', 'unsupported-content-fields', 'source-structure']), detail: z.string().min(30), evidence: z.array(SelectionFileRefSchema).min(1) }).strict().optional(),
  slotBindings: z.array(z.object({ slotId: id, componentKey: id, settingPath: z.string().regex(/^[A-Za-z_][A-Za-z0-9_-]*(?:\.(?:[A-Za-z_][A-Za-z0-9_-]*|[0-9]+))*$/) }).strict()),
  contractRefs: z.array(z.object({ widgetType: id, scope: z.enum(['local-source', 'target-registered']), schemaSha256: hash, evidence: SelectionFileRefSchema }).strict()).min(1),
}).strict();

export const SelectionReviewSchema = z.object({
  reviewer: z.literal('codex'), status: z.literal('approved'), reviewedAt: z.iso.datetime(),
  sourceFacts: SelectionFileRefSchema, selectionRulesHash: hash, decisionsSha256: hash,
  screenshots: z.array(screenshot).min(1), reviewedUnitIds: z.array(id).min(1),
  checks: z.object({ moduleOrder: z.literal(true), contentOwnership: z.literal(true), componentSuitability: z.literal(true), editingGranularity: z.literal(true) }).strict(),
  judgment: z.string().min(40),
}).strict();

export const DesktopSelectionFields = {
  replicationProfile: z.literal('desktop-browser-v1').optional(),
  selectionRulesHash: hash.optional(),
  sourceUnits: z.array(SourceUnitSchema).min(1).optional(),
  selectionDecisions: z.array(SelectionDecisionSchema).min(1).optional(),
  selectionReview: SelectionReviewSchema.optional(),
};

export type Native44SourceUnit = z.infer<typeof SourceUnitSchema>;
export type Native44SelectionDecision = z.infer<typeof SelectionDecisionSchema>;
export type Native44SelectionReview = z.infer<typeof SelectionReviewSchema>;
