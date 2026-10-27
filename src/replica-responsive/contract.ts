import { z } from 'zod';
import { responsiveDecisionsSchema, assertDecisionViewports } from './decisions.js';
import { mobileTouchTreatmentSchema } from './touch.js';
import { styleBindingSchema, nativeStyleSettingSchema } from '../native44/style-resolution.js';

const key = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,79}$/);
const ref = z.object({ path: z.string().min(1).max(4096), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export const responsiveViewportSchema = z.object({ width: z.number().int().min(320).max(767), height: z.number().int().min(568).max(1200) }).strict();
/** Added to the existing preparation/full workflow; never inferred on resume. */
export const responsiveSourceSchema = z.object({
  version: z.union([z.literal(1), z.literal(2)]), decisions: responsiveDecisionsSchema.optional(), tablet: z.literal('desktop'), mobileMaxWidth: z.number().int().min(600).max(900),
  viewports: z.array(responsiveViewportSchema).length(2), source: ref,
  carouselMotionSource: ref.optional(),
}).strict().superRefine((value, context) => {
  if (value.version === 2 ? !value.decisions : value.decisions !== undefined) context.addIssue({ code: 'custom', message: 'Responsive decisions version mismatch' });
  if (value.decisions) assertDecisionViewports(value.decisions, value.viewports);
  if (value.viewports.some(v => v.width > value.mobileMaxWidth) || value.viewports.length === 2 && value.viewports[0].width === value.viewports[1].width) context.addIssue({ code: 'custom', message: 'Two different phone widths are required' });
});
export const responsiveSectionSchema = z.object({
  styleBindings: z.array(z.object({ componentKey: key, binding: styleBindingSchema }).strict()).max(10000).optional(),
  nativeStyleSettings: z.array(z.object({ componentKey: key, setting: nativeStyleSettingSchema }).strict()).max(10000).optional(),
  key, mode: z.enum(['shared', 'duplicate', 'desktop-only', 'phone-only']), reason: z.string().trim().min(15).max(2000),
  evidence: z.array(z.object({ snapshotId: z.string().min(1), nodeId: z.string().min(1) }).strict()).min(2).max(20),
  settings: z.array(z.object({ componentKey: key, values: z.record(z.string(), z.unknown()) }).strict()).max(1000),
  childOrders: z.array(z.object({ componentKey: key, children: z.array(key).min(1).max(1000) }).strict()).max(500),
  css: z.string().max(262144),
  visibility: z.array(z.object({ componentKey: key, hideOn: z.array(z.enum(['desktop','tablet','mobile'])).min(1).max(2) }).strict()).max(1000).optional(),
  touch: z.array(mobileTouchTreatmentSchema).max(100).optional(),
  contentBindings: z.array(z.object({ snapshotId: z.string().min(1), nodeId: z.string().min(1), componentKey: key }).strict()).max(10000).optional(),
}).strict();
// Keep the source policy separate from per-section authoring so each existing
// body preparation worker owns both presentations of its assigned section.
export const responsiveBodyPlanSchema = z.object({
  version: z.union([z.literal(1), z.literal(2)]), decisions: responsiveDecisionsSchema.optional(), tablet: z.literal('desktop'), mobileMaxWidth: z.number().int().min(600).max(900),
  viewports: z.array(responsiveViewportSchema).length(2), source: ref,
  carouselMotionSource: ref.optional(),
  sections: z.array(responsiveSectionSchema).min(1).max(2000),
}).strict().superRefine((value, context) => {
  if (value.version === 2 ? !value.decisions : value.decisions !== undefined) context.addIssue({ code: 'custom', message: 'Responsive decisions version mismatch' });
  if (value.decisions) assertDecisionViewports(value.decisions, value.viewports);
  if (value.viewports.some(v => v.width > value.mobileMaxWidth) || value.viewports.length === 2 && value.viewports[0].width === value.viewports[1].width || new Set(value.sections.map(s => s.key)).size !== value.sections.length) context.addIssue({ code: 'custom', message: 'Duplicate responsive viewport or section' });
});
export type ResponsiveSource = z.infer<typeof responsiveSourceSchema>;
export type ResponsiveSection = z.infer<typeof responsiveSectionSchema>;
export type ResponsivePlan = z.infer<typeof responsiveBodyPlanSchema>;
export function responsiveFail(code: string): never { throw Error(`replica_responsive_${code}`); }
export function requiredReplicaViewports(plan?: ResponsiveSource) {
  return [{ width: 1920, height: 1080 }, { width: 1440, height: 1000 }, ...(plan?.viewports ?? [])];
}
