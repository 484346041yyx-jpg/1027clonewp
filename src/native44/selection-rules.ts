import { createHash } from 'node:crypto';
import { NATIVE44_PAGE_CONTEXT_RULES } from './page-context.js';

/** This small, versioned selection layer does not rewrite the frozen source
 * knowledge package or misrepresent historical runtime evidence. */
export const NATIVE44_SELECTION_RULES = {
  version: 2,
  pageContexts: NATIVE44_PAGE_CONTEXT_RULES,
  profile: 'desktop-browser-v1',
  identity: 'source-responsibilities-before-widget-selection',
  navigation: ['wd_list', 'wd_extra_menu_list', 'text-editor', 'wd_text_block'],
  headings: ['heading', 'wd_title'],
  body: ['text-editor', 'wd_text_block'],
  images: ['wd_image_or_svg'],
  imageCards: ['image-box'],
  informationCards: ['wd_infobox'],
  cta: ['button', 'wd_button'],
  staticMarketingForbiddenQueries: ['wd_products', 'woocommerce-products', 'wd_products_tabs', 'wd_product_categories', 'wd_products_brands'],
  completeCardPreference: true,
  requireSourceSlotCoverage: true,
  rejectNavigationAsButtons: true,
  rejectDescriptionAsHeading: true,
  rejectStyleOnlyCompositionExceptions: true,
  preservedText: 'exact-selected-field-source-dom-order',
  preservedMedia: 'exact-selected-task-asset',
  externalLinks: 'exact-selected-field',
  products: {
    content: 'verified-target-woocommerce-products-source-item-match-not-required',
    implementation: 'native-editable-product-components-and-real-queries',
    presentation: 'preserve-source-card-layout-typography-spacing-borders-image-area-and-carousel-controls',
    unspecifiedItems: 'keep-native-product-area-use-real-target-items',
    categoryMismatch: 'does-not-authorize-product-area-omission',
  },
  catalogDeferral: 'explicit-whole-product-area-omission-only-scope-v2-preserved-facts-editable-structural-placeholder',
} as const;

export type Native44CatalogOmission = {
  snapshotId: string;
  groupId: string;
  componentId: string;
  userRequestedOmission?: 'leave-product-area-empty' | 'remove-product-area';
};

/** A promise to choose products later only relaxes item matching. Omission of
 * a whole area needs a separate, exact, user-authored scope declaration. The
 * old v1 marker remains historical data, never an inferred v2 authorization. */
export function assertNative44CatalogOmissionScope(value: unknown, taskId: string, item: Native44CatalogOmission): void {
  const scope = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
  if (!scope || scope.version !== 2 || scope.kind !== 'clonewp-task-scope' || scope.taskId !== taskId || typeof scope.summary !== 'string' || !scope.summary.trim() || scope.summary.length > 3000 || !Array.isArray(scope.constraints) || scope.constraints.length > 100 || scope.constraints.some(constraint => typeof constraint !== 'string' || !constraint.trim() || constraint.length > 1000) || !Array.isArray(scope.catalogAreaOmissions) || scope.catalogAreaOmissions.length > 1000) throw Error('Catalog deferral requires an explicit whole-product-area user-scope v2 record; choosing products later does not omit the product area');
  const matches = scope.catalogAreaOmissions.filter(candidate => candidate && typeof candidate === 'object' && !Array.isArray(candidate) && candidate.snapshotId === item.snapshotId && candidate.groupId === item.groupId && candidate.componentId === item.componentId) as Record<string, unknown>[];
  const omission = matches[0];
  if (matches.length !== 1 || !item.userRequestedOmission || omission.action !== item.userRequestedOmission || !['leave-product-area-empty', 'remove-product-area'].includes(String(omission.action)) || typeof omission.userInstruction !== 'string' || !omission.userInstruction.trim() || omission.userInstruction.length > 4096) throw Error('Catalog deferral must match one explicit user instruction to leave empty or remove this exact product area');
}

export function canonicalSelectionJson(value: unknown): string {
  return JSON.stringify(value, (_key, child) => child && typeof child === 'object' && !Array.isArray(child)
    ? Object.fromEntries(Object.entries(child).sort(([a], [b]) => a.localeCompare(b))) : child);
}
export const native44SelectionHash = (value: unknown): string => createHash('sha256').update(canonicalSelectionJson(value)).digest('hex');
export const NATIVE44_SELECTION_RULES_HASH = native44SelectionHash(NATIVE44_SELECTION_RULES);
