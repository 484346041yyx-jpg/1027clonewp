import { z } from 'zod';

const key = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,79}$/);
const owner = z.object({ snapshotId: z.string().min(1), nodeId: z.string().min(1) }).strict();
const relativeSelector = z.string().min(2).max(180).regex(/^\.[A-Za-z][A-Za-z0-9_-]*(?:[ >]+(?:\.[A-Za-z][A-Za-z0-9_-]*|a|img|svg|span))*(?:::before|::after)?$/);
const value = z.string().trim().min(1).max(80).refine(text => !/[;{}<>!]|url\s*\(/i.test(text), 'Only a literal paint value is allowed');

/** Phone treatments are explicit source decisions, never a rewrite of :hover.
 * A direct link stays one-tap; a disclosure keeps its native click state. */
export const mobileTouchTreatmentSchema = z.object({
  key,
  behavior: z.enum(['press-feedback', 'native-disclosure', 'always-visible', 'no-mobile-equivalent']),
  reason: z.string().trim().min(15).max(1000),
  sourceOwners: z.array(owner).length(2),
  press: z.object({
    trigger: relativeSelector,
    target: relativeSelector.optional(),
    property: z.enum(['transform', 'opacity', 'filter', 'width']),
    value,
  }).strict().superRefine((press, context) => {
    if (press.trigger.includes('::') || press.target?.includes(':active')) context.addIssue({ code: 'custom', message: 'Press trigger must be an ordinary element' });
    const allowed = press.property === 'transform' ? /^(?:none|translateX\(-?\d{1,3}px\)|scale\(1(?:\.\d{1,2})?\))$/
      : press.property === 'opacity' ? /^(?:0(?:\.\d{1,2})?|1(?:\.0{1,2})?)$/
      : press.property === 'width' ? /^\d{1,3}(?:px|%)$/
      : /^(?:brightness|saturate)\(\d{1,3}%\)$/;
    if (!allowed.test(press.value)) context.addIssue({ code: 'custom', message: 'Press value must be a bounded visual paint' });
  }).optional(),
}).strict().superRefine((row, context) => {
  if (row.behavior === 'press-feedback' ? !row.press : !!row.press) context.addIssue({ code: 'custom', message: 'Press paint must match the phone treatment' });
  if (new Set(row.sourceOwners.map(item => item.snapshotId)).size !== 2) context.addIssue({ code: 'custom', message: 'Two distinct phone observations are required' });
});
export type MobileTouchTreatment = z.infer<typeof mobileTouchTreatmentSchema>;

/** Compile only short-lived visual feedback. Content and menu expansion must
 * be present in native markup or an actual click-controlled component. */
export function compileMobileTouchCSS(sectionClass: string, breakpoint: number, rows: MobileTouchTreatment[]): string {
  if (!/^cwp-n44-[a-f0-9]+$/.test(sectionClass) || !Number.isInteger(breakpoint) || breakpoint < 600 || breakpoint > 900) throw Error('replica_responsive_touch_scope');
  const parsed = rows.map(row => mobileTouchTreatmentSchema.parse(row));
  if (new Set(parsed.map(row => row.key)).size !== parsed.length) throw Error('replica_responsive_touch_duplicate');
  const rules = parsed.flatMap(row => {
    if (!row.press) return [];
    const { trigger, target, property, value } = row.press;
    const selector = `:page .${sectionClass} ${trigger}:active${target ? ` ${target}` : ''}`;
    return [`${selector}{${property}:${value}}`];
  });
  return rules.length ? `@media(max-width:${breakpoint}px) and (hover:none) and (pointer:coarse){${rules.join('')}}` : '';
}
