import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import type { FileRef } from '../replica-v2/types.js';
import type { Native44ComponentKnowledge } from './knowledge.js';
import { NATIVE44_CATALOG_HASH, NATIVE44_ALL_TYPES, EXTENDED_NATIVE_TYPES, RELATED_EXTENDED_NATIVE_TYPES, CORE_SINGLE_PRODUCT_TYPES, assertAllowedWidget, assertKnownNativeWidget } from './catalog.js';
import type { NativeRelatedProductExtension, NativeRelatedProductQualification } from './related-product-extension.js';

// Frozen after qualification, independent of the original 44 catalog/index.
export const NATIVE_PRODUCT_EXTENSION_HASH = "e3e037e64334189b577e7503ca6a9189673db5778c42d212afbad8a9ea28c280";
/** Set only after actual isolated registration/save/readback/two-product qualification. */
export const NATIVE_RELATED_PRODUCT_EXTENSION_HASH: string | undefined = '28d41f9b75cc79aca7a14311ccdb9152fddb8944b90adadb90a91a14677b6491';
export const isRelatedProductExtension = (ref: FileRef | undefined): boolean => Boolean(ref && NATIVE_RELATED_PRODUCT_EXTENSION_HASH && ref.sha256 === NATIVE_RELATED_PRODUCT_EXTENSION_HASH);
export interface NativeProductExtension {
  version: 1; kind: 'native-component-extension'; id: 'core-single-product-v1';
  baseCatalogHash: string; types: string[]; components: Record<string, { path: string; sha256: string }>;
  sharedControls: FileRef;
  qualification: FileRef;
}
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
export function assertProductExtensionReference(ref: FileRef | undefined): asserts ref is FileRef {
  if (!ref || ref.sha256 !== NATIVE_PRODUCT_EXTENSION_HASH && !isRelatedProductExtension(ref) || !/^[a-f0-9]{64}$/.test(ref.sha256)) throw Error('native_product_extension_not_qualified');
}
export function productExtensionWidgetTypes(ref?: FileRef): readonly string[] {
  if (!ref) return NATIVE44_ALL_TYPES;
  assertProductExtensionReference(ref); return isRelatedProductExtension(ref) ? RELATED_EXTENDED_NATIVE_TYPES : EXTENDED_NATIVE_TYPES;
}
async function verified(root: string, ref: FileRef) {
  const filename = await realpath(path.resolve(root, ref.path)), relative = path.relative(await realpath(root), filename);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw Error('native_product_extension_path');
  const bytes = await readFile(filename); if (hash(bytes) !== ref.sha256) throw Error('native_product_extension_bytes_changed'); return bytes;
}
export function assertProgramNativeWidget(type: string, ref?: FileRef): void {
  if (!ref) return assertAllowedWidget(type);
  assertProductExtensionReference(ref);
  if (type === 'woocommerce-product-related' && !isRelatedProductExtension(ref)) throw Error(`native44_component_not_allowed: ${type}`);
  assertKnownNativeWidget(type);
}
export interface NativeProductExtensionRead { index: { version: number; kind: 'native-component-extension'; id: string; baseCatalogHash: string; types: string[]; components: Record<string, FileRef>; qualification: FileRef; sharedControls?: FileRef; parent?: FileRef }; components: Record<string, Native44ComponentKnowledge>; relatedQualification?: NativeRelatedProductQualification }
export async function readProductExtension(ref: FileRef, root = 'D:/cloneWP'): Promise<NativeProductExtensionRead> {
  assertProductExtensionReference(ref);
  if (isRelatedProductExtension(ref)) {
    const result = await (await import('./related-product-extension.js')).readRelatedProductExtension(ref, root, NATIVE_RELATED_PRODUCT_EXTENSION_HASH!);
    const parent = await readProductExtension(result.index.parent, root);
    return { index: { ...result.index, components: { ...parent.index.components, ...result.index.components } }, components: result.components, relatedQualification: result.qualification };
  }
  const index = JSON.parse((await verified(root, ref)).toString('utf8')) as NativeProductExtension;
  if (index.baseCatalogHash!==NATIVE44_CATALOG_HASH || index.version !== 1 || index.kind !== 'native-component-extension' || index.id !== 'core-single-product-v1' || JSON.stringify(index.types) !== JSON.stringify(CORE_SINGLE_PRODUCT_TYPES) || Object.keys(index.components).length !== 12) throw Error('native_product_extension_identity');
  const qualification = JSON.parse((await verified(root, index.qualification)).toString('utf8'));
  if (qualification.kind !== 'core-product-qualification' || qualification.status !== 'qualified' || qualification.existingPagesModified !== false || !CORE_SINGLE_PRODUCT_TYPES.every(type => qualification.components?.[type]?.registered && qualification.components[type].saved && qualification.components[type].rendered)) throw Error('native_product_extension_qualification');
  if(!Array.isArray(qualification.evidence)||!qualification.evidence.length)throw Error('native_product_extension_evidence_missing');
  for(const evidence of qualification.evidence)await verified(root,evidence);
  const components: Record<string, Native44ComponentKnowledge> = {};
  const shared=JSON.parse((await verified(root,index.sharedControls)).toString('utf8'));
  for (const type of CORE_SINGLE_PRODUCT_TYPES) { const component = JSON.parse((await verified(root, index.components[type])).toString('utf8')); if (component.componentType !== type || !Array.isArray(component.controls)) throw Error('native_product_extension_component'); component.controls=component.controls.map((control:{sharedControl?:string})=>{if(!control.sharedControl)return control;const resolved=shared[control.sharedControl];if(!resolved)throw Error('native_product_extension_shared_control');return resolved;});components[type] = component; }
  return { index, components };
}
export async function currentProductExtension(root = 'D:/cloneWP'): Promise<FileRef | undefined> {
  let pointer: { extension: FileRef };
  try { pointer = JSON.parse(await readFile(path.join(root, 'data/system/component-extension-current.json'), 'utf8')); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
  await readProductExtension(pointer.extension, root); return pointer.extension;
}
