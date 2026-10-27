import {assertProductExtensionReference} from '../native44/product-extension.js';
import {CORE_SINGLE_PRODUCT_TYPES} from '../native44/catalog.js';
import type {FileRef} from '../replica-v2/types.js';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { NATIVE44_ALL_TYPES } from '../native44/catalog.js';
import { analyzeComponentModel } from '../native44/component-model.js';
import type { Native44Program } from '../native44/types.js';
import type { PreparationJobResult } from './types.js';

export const COMPONENT_LEARNING_ARCHIVE = 'references/four-product-page-learning-20261026/observations.json';
const settingsRow = z.object({ widgetType: z.string().min(1), initialSettings: z.record(z.string(), z.unknown()).optional(), expandedSettings: z.record(z.string(), z.unknown()).optional() }).passthrough();
const archiveSchema = z.object({
  version: z.literal(1), kind: z.literal('four-product-page-session-observation-summary'),
  provenance: z.object({ evidenceLevel: z.literal('session-observation-summary'), qualificationGranted: z.literal(false) }).passthrough(),
  policy: z.object({ instanceValuesAreDefaults: z.literal(false), grantsComponentPermission: z.literal(false) }).passthrough(),
  sources: z.array(z.object({ key: z.string(), settings: z.array(settingsRow), collections: z.array(z.object({ widgetType: z.string() }).passthrough()) }).passthrough()).min(1),
  unverified: z.array(z.string()),
}).passthrough();
const patterns = [
  { key: 'static-service-group', widgets: ['image-box', 'wd_infobox'], data: 'static', combination: 'Common container owns the row/grid; complete service cards own image, title and explanation.', phone: 'Inspect parent visibility before child device widths.' },
  { key: 'record-summary', widgets: ['wd_single_product_gallery', 'wd_single_product_title', 'wd_single_product_price', 'wd_single_product_add_to_cart'], data: 'current-record', combination: 'Gallery and summary have one current-record context; layout remains ordinary native containers.', phone: 'Shared record/action owners; native device layout, label and button fields.' },
  { key: 'record-content-disclosure', widgets: ['wd_text_block', 'wd_button'], data: 'current-record', combination: 'Dynamic content provider and actual content container/controller belong together.', phone: 'Content reachability and collapse behavior must be observed on both phone widths.' },
  { key: 'record-detail-panels', widgets: ['wd_single_product_tabs'], data: 'current-record-and-shared-resource', combination: 'Panels distinguish record content, attributes, reviews and referenced resources.', phone: 'Tabs and accordion are explicit native modes; never infer automatic conversion.' },
  { key: 'record-feedback', widgets: ['wd_single_product_rating', 'wd_single_product_reviews'], data: 'current-record', combination: 'Actual rating/reviews use one record and one review form owner.', phone: 'Keep review form unique while native layout stacks.' },
  { key: 'record-collections', widgets: ['wd_products'], data: 'collection', combination: 'Section title and card layout are separate from the declared query provider.', phone: 'Declare actual visible item count, navigation reachability and native carousel settings.' },
];

/** Read instance aliases as hints only. No instance values/IDs/URLs become settings. */
export function createComponentLearning(bytes: Uint8Array, source: { path: string; sha256: string }, extension?:FileRef) {
  if (bytes.byteLength > 2 * 1024 * 1024 || createHash('sha256').update(bytes).digest('hex') !== source.sha256) throw Error('component_learning_source_hash');
  const archive = archiveSchema.parse(JSON.parse(Buffer.from(bytes).toString('utf8')));
  const hints = new Map<string, Set<string>>(), allowed = new Set<string>(NATIVE44_ALL_TYPES);if(extension){assertProductExtensionReference(extension);CORE_SINGLE_PRODUCT_TYPES.forEach(type=>allowed.add(type));}
  for (const site of archive.sources) for (const row of [...site.settings, ...site.collections]) {
    const fields = hints.get(row.widgetType) ?? new Set<string>();
    for (const name of Object.keys({ ...(row.initialSettings as object ?? {}), ...(row.expandedSettings as object ?? {}) })) fields.add(name);
    hints.set(row.widgetType, fields);
  }
  return { version: 1 as const, kind: 'component-learning-hints' as const, source,
    ...(extension?{componentExtension:extension}:{}),evidenceLevel: archive.provenance.evidenceLevel, sourceCount: archive.sources.length,
    policy: { defaults: false, sourceEvidence: false, grantsComponentPermission: false, installedSchema: false },
    components: [...hints].sort(([a], [b]) => a.localeCompare(b)).map(([widgetType, fields]) => ({ widgetType, enabledIdentity: allowed.has(widgetType), settingHints: [...fields].sort(), fieldMeaning: 'instance-alias-not-registered-control', providerMustBeAdapted: widgetType.startsWith('wd_single_product_')&&!allowed.has(widgetType) })),
    patterns, unverified: archive.unverified,
    instructions: 'Use these deduplicated role patterns with the current source, actual native settings and phone plan. Values, product/resource IDs and URLs remain in the on-demand archive and are never defaults. Instance aliases are not schema control IDs. Describe data and actions in each component.model using static/current-record/collection/shared-resource plus actual sourceFactIds. One current record and one purchase/review owner must be shared across device presentations. Existing native-products/native-posts keep their typed query adapters. Unknown providers/components remain explicit gaps; never synthesize product prices, reviews or purchase controls. Return actual widgetSettings/nativeStyleSettings and responsive fields, not prose-only settings.',
  };
}
export type ComponentLearning = ReturnType<typeof createComponentLearning>;

export function componentLearningApplication(learning: ComponentLearning, result: PreparationJobResult,context?:Partial<Pick<Native44Program,'currentRecord'|'componentExtension'>>) {
  const program = { ...context,blocks: result.sections?.flatMap(section => section.blocks) ?? [] };
  const model = analyzeComponentModel(program, result.sections?.flatMap(section => section.responsive ? [section.responsive] : []) ?? []);
  const applications = learning.patterns.map(pattern => ({ key: pattern.key, relevance: 'candidate-only' as const, componentKeys: model.components.filter(component => pattern.widgets.includes(component.widgetType) && (pattern.data === component.data.source || pattern.data === 'current-record-and-shared-resource' && ['current-record', 'shared-resource'].includes(component.data.source))).map(component => component.componentKey) })).filter(row => row.componentKeys.length);
  return { source: learning.source, applications, model };
}
