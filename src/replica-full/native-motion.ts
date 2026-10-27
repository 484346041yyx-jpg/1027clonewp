import { canonicalV2 } from '../replica-v2/journal.js';
import type { ElementorElement } from '../wordpress/types.js';
import type { FullReplicaRemoteSnapshot } from './driver.js';

function fail(code: string): never { throw Error(`replica_full_native_motion_${code}`); }
const same = (a: unknown, b: unknown) => canonicalV2(a) === canonicalV2(b);
export interface NativeMotionPatch { elements: ElementorElement[]; widgetIds: string[] }

/** The only accepted document edit is native nested-carousel settings.speed = 0. */
export function patchNativeCarouselMotion(input: ElementorElement[]): NativeMotionPatch {
  const elements = structuredClone(input), widgetIds: string[] = [];
  const visit = (nodes: ElementorElement[]): void => {
    for (const node of nodes) {
      if (node.elType === 'widget' && node.widgetType === 'nested-carousel') {
        if (!/^[A-Za-z0-9_-]{1,100}$/.test(node.id) || widgetIds.includes(node.id) || !node.settings || typeof node.settings !== 'object' || Array.isArray(node.settings)) fail('widget_invalid');
        node.settings.speed = 0; widgetIds.push(node.id);
      }
      if (!Array.isArray(node.elements)) fail('tree_invalid'); visit(node.elements);
    }
  };
  if (!Array.isArray(elements)) fail('tree_invalid'); visit(elements);
  if (!widgetIds.length || widgetIds.length > 200) fail('widget_missing'); return { elements, widgetIds };
}

export function assertNativeMotionBoundary(before: FullReplicaRemoteSnapshot, after: FullReplicaRemoteSnapshot, patch: NativeMotionPatch): void {
  const a = before.page, b = after.page;
  if (!a || !b || a.status !== 'draft' || b.status !== 'draft') fail('draft_required');
  const { elements: _a, bodyHash: _b, ...pageA } = a, { elements: _c, bodyHash: _d, ...pageB } = b;
  if (!same(pageA, pageB) || !same(b.elements, patch.elements) || !same(patchNativeCarouselMotion(a.elements), patch)) fail('page_boundary_changed');
  const prior = structuredClone(before.header.snapshot), next = structuredClone(after.header.snapshot), key = String(a.pageId), priorPage = prior.module?.pages[key], nextPage = next.module?.pages[key];
  if (!priorPage || !nextPage) fail('native_page_missing');
  priorPage.bodyHash = nextPage.bodyHash; priorPage.snapshotHash = nextPage.snapshotHash;
  if (!same(prior, next)) fail('header_boundary_changed');
}
