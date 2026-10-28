import {currentProductExtension,readProductExtension} from '../native44/product-extension.js';
import type {FileRef} from '../replica-v2/types.js';
import { NATIVE44_ALL_TYPES } from '../native44/catalog.js';
import { native44ResourceDependencies } from '../native44/adapters.js';
import { native44Usage } from '../native44/recipes.js';
import { componentFileRef } from './io.js';
import type { ExecutionAdapterDeclaration } from './types.js';

export const NATIVE44_ADAPTER_SOURCE_PATHS = [
  'src/native44/adapters.ts', 'src/native44/compiler.ts', 'src/native44/settings.ts', 'src/native44/types.ts',
  'src/native44/recipes.ts', 'src/native44/compatibility.ts', 'src/native44/profile.ts',
  'src/native44/catalog-check.ts', 'src/native44/post-check.ts', 'src/native44/interaction-check.ts', 'src/wordpress/editor-serialization.ts',
  'src/native44/local-task.ts', 'src/native44/target-context.ts', 'src/native44/release-lock.ts',
  'src/native44/environment.ts', 'src/wordpress/checkpoint.ts',
  'src/native44/runtime.ts', 'src/native44/lifecycle.ts', 'src/wordpress/client.ts', 'src/wordpress/canvas-shell.ts',
  'src/native44/current-state.ts', 'src/native44/css-handoff.ts', 'src/native44/consolidate-css.ts',
  'src/native44/requirements.ts', 'src/native44/validate.ts', 'src/native44/source.ts', 'src/native44/source-captures.ts',
  'src/native44/css-model.ts', 'src/native44/revision-snapshot.ts', 'src/native44/revision.ts', 'src/native44/revision-cli.ts',
  'src/native44/image-box-caption-proof.ts',
  'src/native44/compare.ts', 'src/native44/compare-cli.ts', 'src/native44/review-workflow.ts', 'src/planning/plan.ts',
  'src/replica-v2/component-plan.ts', 'src/replica-v2/source.ts', 'src/replica-v2/capture-transaction.ts',
  'src/replica-v2/browser-diagnostics.ts', 'src/replica-v2/browser-preflight-cli.ts', 'src/replica-v2/browser-recovery.ts', 'src/assets/media-transformation.ts',
  'src/core/draft-guards.ts', 'src/core/project-path.ts', 'src/wordpress/preview-session.ts',
  'src/assets/validation.ts', 'src/assets/import-attempt.ts', 'src/core/raw-input.ts', 'src/wordpress/catalog-contract.ts', 'src/verification/carousel-runtime.ts',
  'src/core/verified-evidence.ts', 'src/native44/delivery-summary.ts', 'src/native44/delivery-summary-cli.ts',
  'src/verification/layout-stable-screenshot.ts', 'src/native44/capture-media-session.ts',
  'src/native44/current-capture-binding.ts',
  'src/verification/catalog-browser.ts',
  'src/wordpress/posts-contract.ts', 'src/wordpress/posts.ts',
  'src/native44/current-review.ts', 'src/native44/current-review-contract.ts', 'src/native44/current-review-source.ts', 'src/native44/current-review-cli.ts',
  'src/native44/current-css-patch.ts', 'src/native44/current-css-revision.ts', 'src/native44/current-css-revision-cli.ts',
  'src/native44/current-native-patch.ts', 'src/native44/current-native-revision.ts', 'src/native44/current-native-revision-cli.ts',
  'src/native44/current-native-model.ts', 'src/native44/current-native-v2.ts', 'src/native44/current-native-review-evidence.ts', 'src/native44/pending-form.ts',
  'src/native44/navigation-composite.ts', 'src/native44/disclosure-check.ts', 'src/native44/tabs-check.ts',
  'src/native44/behaviors/carousel-playback.ts', 'src/native44/behaviors/playback-package.ts',
  'src/native44/behaviors/wordpress/clonewp-carousel-playback.php',
  'src/context/loader.ts',
  'src/native44/publication.ts', 'src/native44/publication-cli.ts', 'src/wordpress/publication-contract.ts',
  'src/core/delivery-policy.ts', 'src/core/config.ts',
  'src/replica-full/json.ts', 'src/replica-full/body-prepare.ts',
  'src/native44/native-categories.ts','src/wordpress/categories-contract.ts','src/wordpress/categories.ts',
  'src/native44/native-related-products.ts','src/native44/related-product-extension.ts','src/wordpress/related-products.ts',
  'src/native44/current-product.ts','src/native44/product-extension.ts','src/wordpress/current-product-runtime.ts','src/wordpress/native-product-preview.ts','src/wordpress/native-product-request.ts','src/wordpress/product-contract.ts','src/wordpress/product.ts',
  'src/native44/style-resolution-v2.ts', 'src/replica-responsive/style-settings.ts', 'src/replica-responsive/body.ts',
] as const;

export async function componentAdapterDeclarations(root: string, extension?:FileRef|null): Promise<ExecutionAdapterDeclaration[]> {
  const ref=extension===null?undefined:extension??await currentProductExtension(root);const extra=ref?await readProductExtension(ref,root):undefined;const types=[...NATIVE44_ALL_TYPES,...(extra?.index.types??[])];
  const unavailableDependencies = Object.fromEntries(NATIVE44_ALL_TYPES.flatMap(type => {
    const dependencies = native44ResourceDependencies(type);
    return dependencies.length && type !== 'wd_blog' && type !== 'wd_product_categories' ? [[type, dependencies]] : [];
  }));
  const implemented = [...new Set(NATIVE44_ALL_TYPES.map(type => native44Usage(type).contentModel))].filter(value => value !== 'resource-query') as ExecutionAdapterDeclaration['implemented'];
  return [{
    id: 'native44-desktop-v1', executionStrategy: 'native44-css-handoff', replicationProfile: 'desktop-browser-v1',
    widgetTypes: types, implemented, resourceAdapters: ['target-woocommerce-products', 'target-wordpress-posts','target-woocommerce-product-categories',...(extra?['target-woocommerce-current-product','woodmart-native-single-product-template']:[]),...(extra?.relatedQualification?['target-woocommerce-related-products']:[])],
    unavailableDependencies, writeBoundary: 'owned-draft-page-only',
    sourceRefs: await Promise.all(NATIVE44_ADAPTER_SOURCE_PATHS.map(name => componentFileRef(root, name))),
  }];
}

export function componentCapabilitySummary(adapters: ExecutionAdapterDeclaration[]): {
  adapterId: string; enabledComponentCount: number; writeBoundary: string;
  implementedModels: string[]; resourceAdapters: string[];
  conditionalComponents: Array<{ widgetType: string; dependencies: string[]; status: 'unverified'; reason: string }>;
}[] {
  return adapters.map(adapter => ({
    adapterId: adapter.id, enabledComponentCount: adapter.widgetTypes.length, writeBoundary: adapter.writeBoundary,
    implementedModels: [...adapter.implemented], resourceAdapters: [...adapter.resourceAdapters],
    conditionalComponents: Object.entries(adapter.unavailableDependencies).map(([widgetType, dependencies]) => ({ widgetType, dependencies: [...dependencies], status: 'unverified', reason: 'The current desktop writer has no verified target resource/context adapter; this does not mean widget incompatibility.' })),
  }));
}
