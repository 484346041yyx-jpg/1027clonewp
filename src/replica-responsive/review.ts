import path from 'node:path';
import { z } from 'zod';
import sharp from 'sharp';
import {NATIVE_VIEWPORT_CAPTURE,nativeViewportRasterMapping} from '../core/native-viewport-raster.js';
import { native44Id } from '../native44/adapters.js';
import type { ResponsivePlan } from './contract.js';
import { responsiveFail as fail, requiredReplicaViewports } from './contract.js';
import { mobileComponentKey } from './body.js';

import { verifyResponsiveDecisionReview } from './decision-review.js';
import type { ResponsiveDecisionContext } from './decisions.js';
import { responsiveSourceVisibility, type ResponsiveVisibilityIdentity } from './source-visibility.js';

const box = z.object({ id: z.string().min(1), display: z.string().min(1), width: z.number().finite().nonnegative(), height: z.number().finite().nonnegative() }).strict();
const ref = z.object({ path: z.string().min(1), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
const view = z.object({ width: z.number().int().positive(), height: z.number().int().positive(), clientWidth: z.number().int().positive(), scrollWidth: z.number().int().positive(),
  captureMode:z.literal(NATIVE_VIEWPORT_CAPTURE).optional(),
  observedAt: z.string().datetime(), sections: z.array(z.object({ key: z.string(), desktop: box, mobile: box.optional() }).strict()),
  header: z.object({ id: z.string(), desktop: z.array(box).min(1), mobile: z.array(box).min(1) }).strict(),
}).strict();
const check = z.object({ version: z.union([z.literal(1), z.literal(2)]), decisionEvidence: z.array(ref).length(4).optional(), kind: z.literal('clonewp-responsive-review'), taskId: z.string(), runId: z.string(), pageId: z.number().int().positive(), fingerprint: z.string(),
  views: z.array(view).length(4), tablet: view.extend({ screenshot: ref, dom: ref }).strict(),
}).strict();
type ReviewRef = z.infer<typeof ref>;
type Read = (reference: ReviewRef, base?: string) => Promise<{ filename: string; bytes: Buffer }>;
const visible = (b: z.infer<typeof box>) => b.display !== 'none' && b.width > 0 && b.height > 0;
export async function verifyResponsiveReview(input: unknown, plan: ResponsivePlan, identity: { taskId: string; runId: string; pageId: number; fingerprint: string; headerId: string; observedAt: string } & ResponsiveDecisionContext & ResponsiveVisibilityIdentity, read: Read, base: string, htmlByViewport: ReadonlyMap<string, string>) {
  const proof = check.parse(input);
  if (plan.version === 2 ? proof.version !== 2 || !proof.decisionEvidence : proof.version !== 1 || proof.decisionEvidence !== undefined) fail('review_decision_version');
  if (plan.decisions) await verifyResponsiveDecisionReview(proof.decisionEvidence!, plan.decisions, plan.viewports, identity, read, base, plan.sections.filter(s => s.mode === 'duplicate').map(s => s.key));
  if (['taskId', 'runId', 'pageId', 'fingerprint'].some(k => (proof as any)[k] !== (identity as any)[k])) fail('review_identity');
  const sizes = requiredReplicaViewports(plan);
  if (new Set(proof.views.map(v => `${v.width}x${v.height}`)).size !== sizes.length || sizes.some(size => !proof.views.some(v => v.width === size.width && v.height === size.height))) fail('review_sizes');
  if (proof.tablet.width !== Math.max(900, plan.mobileMaxWidth + 1) || proof.tablet.height !== 900) fail('tablet_boundary_viewport');
  const tabletFile = await read(proof.tablet.dom, base), tabletDOM = JSON.parse(tabletFile.bytes.toString('utf8'));
  const sourceVisibility = await responsiveSourceVisibility(plan, identity, read);
  for (const row of [...proof.views, proof.tablet]) {
    if (row.clientWidth > row.width || row.width - row.clientWidth > 24 || row.scrollWidth > row.clientWidth + 1 || Math.abs(Date.parse(identity.observedAt) - Date.parse(row.observedAt)) > 3600000) fail('review_overflow_or_stale');
    const phone = row.width <= plan.mobileMaxWidth;
    const html = row === proof.tablet ? tabletDOM.html : htmlByViewport.get(`${row.width}x${row.height}`);
    if (typeof html !== 'string') fail('review_dom_missing');
    if (row.header.id !== identity.headerId || (phone ? row.header.desktop.some(visible) || !row.header.mobile.some(visible) : !row.header.desktop.some(visible) || row.header.mobile.some(visible))) fail('review_header_presentation');
    if (new Set(row.sections.map(s => s.key)).size !== plan.sections.length || row.sections.length !== plan.sections.length) fail('review_section_coverage');
    for (const section of plan.sections) {
      const actual = row.sections.find(s => s.key === section.key); if (!actual || actual.desktop.id !== native44Id(identity.taskId, section.key)) fail('review_section_identity');
      if (!html.includes(`data-id="${actual.desktop.id}"`) || actual.mobile && !html.includes(`data-id="${actual.mobile.id}"`)) fail('review_section_dom_identity');
      if (section.mode === 'shared') { const expected = sourceVisibility ? sourceVisibility.get(`${row === proof.tablet ? 'tablet' : `${row.width}x${row.height}`}:${section.key}`) : true; if (typeof expected !== 'boolean') fail('review_shared_source_visibility'); if (actual.mobile || visible(actual.desktop) !== expected) fail('review_shared_section'); }
      else if (section.mode === 'desktop-only') { if (actual.mobile || visible(actual.desktop) === phone) fail('review_desktop_only_section'); }
      else if (section.mode === 'phone-only') { if (actual.mobile || visible(actual.desktop) !== phone) fail('review_phone_only_section'); }
      else if (!actual.mobile || actual.mobile.id !== native44Id(identity.taskId, mobileComponentKey(section.key)) || visible(actual.desktop) === phone || visible(actual.mobile) !== phone) fail('review_duplicate_visibility');
    }
  }
  const screenshot = await read(proof.tablet.screenshot, base), meta = await sharp(screenshot.bytes).metadata();
  if (!nativeViewportRasterMapping(meta,proof.tablet,proof.tablet.captureMode)) fail('tablet_screenshot');
  if (tabletDOM.pageId !== identity.pageId || tabletDOM.viewport?.width !== proof.tablet.width || tabletDOM.viewport?.height !== 900 || typeof tabletDOM.html !== 'string' || !tabletDOM.html.includes(`whb-${identity.headerId}`) || !tabletDOM.html.includes(`elementor-${identity.pageId}`)) fail('tablet_dom');
}
