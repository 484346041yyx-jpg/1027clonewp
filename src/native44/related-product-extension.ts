import { createHash } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { CORE_SINGLE_PRODUCT_TYPES, NATIVE44_CATALOG_HASH } from './catalog.js';
import { NATIVE_PRODUCT_EXTENSION_HASH, readProductExtension } from './product-extension.js';
import type { Native44ComponentKnowledge } from './knowledge.js';
import type { FileRef } from '../replica-v2/types.js';

export const NATIVE_RELATED_PRODUCT_TYPE = 'woocommerce-product-related' as const;
export const NATIVE_RELATED_PRODUCT_CLASS = 'ElementorPro\\Modules\\Woocommerce\\Widgets\\Product_Related' as const;
export const RELATED_SINGLE_PRODUCT_TYPES = [...CORE_SINGLE_PRODUCT_TYPES, NATIVE_RELATED_PRODUCT_TYPE] as const;
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const ref = z.object({ path: z.string().min(1).max(4096), sha256: hash }).strict();
const positive = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const indexSchema = z.object({
  version: z.literal(2), kind: z.literal('native-component-extension'), id: z.literal('core-single-product-related-v1'),
  baseCatalogHash: z.literal(NATIVE44_CATALOG_HASH), parent: ref,
  types: z.array(z.string()).length(13),
  components: z.object({ 'woocommerce-product-related': ref }).strict(), qualification: ref,
}).strict();
const qualificationSchema = z.object({
  version: z.literal(1), kind: z.literal('related-product-component-qualification'), status: z.literal('qualified'),
  targetOrigin: z.string().url(), existingPagesModified: z.literal(false),
  widgetType: z.literal(NATIVE_RELATED_PRODUCT_TYPE), widgetClass: z.literal(NATIVE_RELATED_PRODUCT_CLASS),
  registered: z.literal(true), saved: z.literal(true), readbackMatched: z.literal(true),
  runtimeDocumentType: z.literal('woodmart_layout'), runtimeLayoutType: z.literal('single_product'),
  registration: ref, source: ref, readback: ref,
  renders: z.array(z.object({ productId: positive, rendered: z.literal(true), observedProductIds: z.array(positive).min(1).max(24), evidence: ref, screenshots: z.array(ref).min(1).max(8) }).strict()).min(2).max(8),
}).strict();
export type NativeRelatedProductExtension = z.infer<typeof indexSchema>;
export type NativeRelatedProductQualificationEvidence = z.infer<typeof qualificationSchema>;
export interface NativeRelatedProductQualification {
  readonly widgetType: typeof NATIVE_RELATED_PRODUCT_TYPE;
  readonly widgetClass: typeof NATIVE_RELATED_PRODUCT_CLASS;
  readonly extensionSha256: string; readonly targetOrigin: string; readonly sourceSha256: string;
}
const qualifications = new WeakMap<NativeRelatedProductQualification, { index: NativeRelatedProductExtension; sourceSha256: string; component: Native44ComponentKnowledge }>();
const sha = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');

async function verified(root: string, reference: FileRef): Promise<Buffer> {
  ref.parse(reference);
  const actualRoot = await realpath(root), filename = await realpath(path.resolve(actualRoot, reference.path)), relative = path.relative(actualRoot, filename);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw Error('native_related_extension_path');
  const info = await stat(filename);
  if (!info.isFile() || info.size > 16 * 1024 * 1024) throw Error('native_related_extension_file_unbounded');
  const bytes = await readFile(filename);
  if (sha(bytes) !== reference.sha256) throw Error('native_related_extension_bytes_changed');
  return bytes;
}

/**
 * Explicit additive extension only. The activation hash must be frozen in the
 * executable caller after actual qualification, never taken from this index or
 * from a task's self-authored qualification JSON. No current pointer is changed.
 */
export async function readRelatedProductExtension(reference: FileRef, root: string, codeQualifiedSha256: string) {
  if (!hash.safeParse(codeQualifiedSha256).success || reference.sha256 !== codeQualifiedSha256 || reference.sha256 === NATIVE_PRODUCT_EXTENSION_HASH) throw Error('native_related_extension_not_qualified');
  const index = indexSchema.parse(JSON.parse((await verified(root, reference)).toString('utf8')));
  if (index.parent.sha256 !== NATIVE_PRODUCT_EXTENSION_HASH || JSON.stringify(index.types) !== JSON.stringify(RELATED_SINGLE_PRODUCT_TYPES)) throw Error('native_related_extension_parent_identity');
  const base = await readProductExtension(index.parent, root);
  const qualification = qualificationSchema.parse(JSON.parse((await verified(root, index.qualification)).toString('utf8')));
  if (new URL(qualification.targetOrigin).origin !== qualification.targetOrigin || new Set(qualification.renders.map(r => r.productId)).size !== qualification.renders.length) throw Error('native_related_extension_runtime_identity');
  for (const render of qualification.renders) if (render.observedProductIds.includes(render.productId) || new Set(render.observedProductIds).size !== render.observedProductIds.length) throw Error('native_related_extension_render_scope');
  const source = (await verified(root, qualification.source)).toString('utf8');
  if (!/class\s+Product_Related\s+extends\s+Products_Base/.test(source) || !/return\s+['"]woocommerce-product-related['"]\s*;/.test(source) || !/wc_get_related_products\s*\(\s*\$product->get_id\s*\(/.test(source) || !/wc_get_template\s*\(\s*['"]single-product\/related\.php['"]/.test(source)) throw Error('native_related_extension_source_owner');
  const registration = JSON.parse((await verified(root, qualification.registration)).toString('utf8'));
  const registered = registration.widgets?.find((row: { name?: string; class?: string }) => row.name === NATIVE_RELATED_PRODUCT_TYPE && row.class === NATIVE_RELATED_PRODUCT_CLASS);
  const declared = registration.sources?.[NATIVE_RELATED_PRODUCT_TYPE];
  if (!registered || typeof declared?.source !== 'string' || sha(declared.source) !== qualification.source.sha256 || !declared.file?.endsWith('/elementor-pro/modules/woocommerce/widgets/product-related.php') || !declared.controls || typeof declared.controls !== 'object') throw Error('native_related_extension_registration_identity');
  const component = JSON.parse((await verified(root, index.components[NATIVE_RELATED_PRODUCT_TYPE])).toString('utf8')) as Native44ComponentKnowledge;
  if (component.componentType !== NATIVE_RELATED_PRODUCT_TYPE || !Array.isArray(component.controls) || new Set(component.controls.map(c => c.id)).size !== component.controls.length || component.controls.some(c => !c.id || !declared.controls[c.id])) throw Error('native_related_extension_component');
  for (const name of ['posts_per_page', 'columns', 'orderby', 'order']) if (!component.controls.some(c => c.id === name) || !declared.controls[name]) throw Error('native_related_extension_query_controls_missing');
  await verified(root, qualification.readback);
  for (const render of qualification.renders) { await verified(root, render.evidence); for (const screenshot of render.screenshots) await verified(root, screenshot); }
  const handle: NativeRelatedProductQualification = Object.freeze({ widgetType: NATIVE_RELATED_PRODUCT_TYPE, widgetClass: NATIVE_RELATED_PRODUCT_CLASS, extensionSha256: reference.sha256, targetOrigin: qualification.targetOrigin, sourceSha256: qualification.source.sha256 });
  qualifications.set(handle, { index: structuredClone(index), sourceSha256: qualification.source.sha256, component: structuredClone(component) });
  return { index, components: { ...base.components, [NATIVE_RELATED_PRODUCT_TYPE]: component }, qualification: handle };
}

export function assertNativeRelatedProductQualification(handle: NativeRelatedProductQualification, origin: string): Native44ComponentKnowledge {
  const proof = qualifications.get(handle);
  if (!proof || handle.widgetType !== NATIVE_RELATED_PRODUCT_TYPE || handle.widgetClass !== NATIVE_RELATED_PRODUCT_CLASS || handle.targetOrigin !== new URL(origin).origin || handle.sourceSha256 !== proof.sourceSha256) throw Error('native_related_extension_qualification_handle');
  return structuredClone(proof.component);
}
