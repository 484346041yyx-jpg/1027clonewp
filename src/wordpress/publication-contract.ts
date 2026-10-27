import { canonicalV2, documentHashV2 } from '../replica-v2/journal.js';
import { WordPressError } from './errors.js';
import type { DraftSnapshot, PublishedSnapshot } from './types.js';

/** A publication changes visibility, never the reviewed content. Historical
 * draft hashes remain historical even when Elementor exposes the new status. */
export function assertOwnedPublishedSnapshot(before: DraftSnapshot, after: PublishedSnapshot): 'retained' | 'published' {
  const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
  if (!before || !after || before.status !== 'draft' || after.status !== 'publish' || !Number.isSafeInteger(before.pageId) || before.pageId < 1 || before.pageId !== after.pageId || !/^[A-Za-z\d_-]{4,100}$/.test(before.runId) || before.runId !== after.runId || typeof before.title !== 'string' || before.title !== after.title || !Array.isArray(before.elements) || !Array.isArray(after.elements) || !object(before.settings) || !object(after.settings) || !/^[a-f\d]{64}$/.test(before.hash) || !/^[a-f\d]{64}$/.test(after.hash) || documentHashV2(before.elements, before.settings) !== before.hash || documentHashV2(after.elements, after.settings) !== after.hash || Object.hasOwn(before.settings, 'post_status') && before.settings.post_status !== 'draft') throw new WordPressError('invalid_publication_snapshot', 'Publication snapshots must bind the exact owned draft and published page with complete valid hashes.');
  const retained = canonicalV2(after.settings) === canonicalV2(before.settings);
  const published = Object.hasOwn(before.settings, 'post_status') && canonicalV2(after.settings) === canonicalV2({ ...before.settings, post_status: 'publish' });
  if (canonicalV2(after.elements) !== canonicalV2(before.elements) || !retained && !published) throw new WordPressError('publication_readback_mismatch', 'The published readback changed more than page status; preserve it and reconcile the complete observed checkpoint.');
  return retained ? 'retained' : 'published';
}
