/** Frozen v1-v3 task documents keep their original contract. New tasks use v4,
 * which requires source-bound phone visual evidence as well as responsive QA. */
export const CURRENT_REPLICA_WORKFLOW_VERSION = 4 as const;
export const CURRENT_REPLICA_RESPONSIVE_DEFAULTS = Object.freeze({ tablet: 'desktop' as const, mobileMaxWidth: 768 as const, viewports: Object.freeze([{ width: 390, height: 844 }, { width: 430, height: 932 }]) });
export function responsivePageShellCSS(pageId: number): string {
  if (!Number.isSafeInteger(pageId) || pageId < 1) throw Error('replica_responsive_page_identity');
  return `@media(max-width:1024px){body.page-id-${pageId} .wd-toolbar{display:none!important}body.page-id-${pageId}.sticky-toolbar-on{padding-bottom:0!important}}`;
}
