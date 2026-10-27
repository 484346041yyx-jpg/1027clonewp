import { createHash } from 'node:crypto';
import { z } from 'zod';
import { walkNative44 } from '../native44/types.js';
import type { PreparationFileRef, PreparationJob, PreparationJobResult } from './types.js';

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const key = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,79}$/);
export const componentGuidanceReviewSchema = z.object({
  guideSha256: hash,
  decisions: z.array(z.object({
    sectionKey: key, principleSections: z.array(z.number().int().min(1).max(5)).min(1).max(5),
    componentKeys: z.array(key).min(1).max(1000),
    compositionReason: z.string().trim().min(20).max(4000),
    settingsReason: z.string().trim().min(20).max(4000),
    phoneReason: z.string().trim().min(20).max(4000),
    phoneMode: z.enum(['shared', 'duplicate', 'desktop-only', 'phone-only', 'not-in-scope']),
  }).strict()).min(1).max(2000),
}).strict();
export type ComponentGuidanceReview = z.infer<typeof componentGuidanceReviewSchema>;

/** The unified principles are planning input, never a source of settings or source facts. */
export function createComponentGuidance(text: string, source: PreparationFileRef) {
  if (Buffer.byteLength(text) > 262144 || createHash('sha256').update(text).digest('hex') !== source.sha256 ||
    ![1, 2, 3, 4, 5].every(section => text.includes(`## ${section}.`))) throw Error('replica_preparation_component_guidance_source');
  return {
    version: 1 as const, kind: 'component-planning-guidance' as const, source, text,
    policy: { settingDefaults: false, instanceArchivesExpanded: false, sourceEvidence: false, grantsComponentPermission: false },
    instructions: 'Read the unified principles before choosing component groups, native settings and phone mechanisms. Apply only relevant principles to this current source and enabled catalog; never copy sample numbers, IDs, URLs, queries or defects. Return componentGuidanceReview with guideSha256 equal to source.sha256 and one decision for every owned section: sectionKey, relevant principleSections (1..5), actual componentKeys including the principal section, compositionReason, settingsReason, phoneReason, and phoneMode matching section.responsive.mode (not-in-scope only without a phone plan). Explain source-driven choices, conditions, inheritance and unresolved limitations, not a claim of rendered success. Settings belong in the existing blocks/nativeStyleSettings and responsive fields with current source facts; prose alone cannot implement them.',
  };
}
export type ComponentGuidance = ReturnType<typeof createComponentGuidance>;

/** Bind the model's reasoning to actual emitted owners; existing settings/phone gates still execute. */
export function componentGuidanceApplication(guidance: ComponentGuidance, job: PreparationJob, result: PreparationJobResult) {
  const fail = (): never => { throw Error('replica_preparation_component_guidance_review'); };
  if (job.responsibility !== 'body') return fail();
  const parsed = componentGuidanceReviewSchema.safeParse(result.componentGuidanceReview);
  if (!parsed.success || parsed.data.guideSha256 !== guidance.source.sha256) return fail();
  const review = parsed.data, sections = result.sections ?? [];
  if (review.decisions.length !== job.sectionKeys.length || new Set(review.decisions.map(row => row.sectionKey)).size !== job.sectionKeys.length || sections.length !== job.sectionKeys.length) return fail();
  return {
    jobId: job.jobId, guideSha256: review.guideSha256, renderedVerified: false,
    decisions: review.decisions.map(decision => {
      const section = sections.find(row => row.key === decision.sectionKey);
      if (!section || !job.sectionKeys.includes(section.key)) return fail();
      const nodes = walkNative44(section.blocks), owners = new Map(nodes.map(node => [node.key, node]));
      if (!decision.componentKeys.includes(section.key) || new Set(decision.componentKeys).size !== decision.componentKeys.length ||
        decision.componentKeys.some(owner => !owners.has(owner)) || new Set(decision.principleSections).size !== decision.principleSections.length ||
        decision.phoneMode !== (section.responsive?.mode ?? 'not-in-scope')) return fail();
      return { ...decision, actualPlan: {
        components: nodes.map(node => ({ key: node.key, kind: node.kind, ...('widgetType' in node ? { widgetType: node.widgetType } : {}),
          settingFields: Object.keys({ ...node.settings, ...('widgetSettings' in node ? node.widgetSettings : {}) }),
          nativeSettingControls: (node.nativeStyleSettings ?? []).map(setting => setting.controlId), sourceFactIds: node.sourceFactIds ?? [],
        })),
        phoneSettingFields: section.responsive?.settings.map(patch => ({ componentKey: patch.componentKey, fields: Object.keys(patch.values) })) ?? [],
        phoneNativeSettingControls: section.responsive?.nativeStyleSettings?.map(item => ({ componentKey: item.componentKey, controlId: item.setting.controlId })) ?? [],
        phoneStyleBindingCount: section.responsive?.styleBindings?.length ?? 0,
        phoneContentBindingCount: section.responsive?.contentBindings?.length ?? 0,
      } };
    }),
  };
}
