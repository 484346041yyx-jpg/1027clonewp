import { z } from 'zod';

const id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const text = z.string().max(500000);
const publicURL = z.string().url().refine(value => { const u = new URL(value); return ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password; });
const amount = z.string().max(40).regex(/^(?:|\d+(?:\.\d+)?)$/);
const price = z.object({ current: amount, regular: amount, sale: amount, html: text, onSale: z.boolean() }).strict();
const stock = z.object({ status: z.enum(['instock', 'outofstock', 'onbackorder']), managed: z.boolean(), quantity: z.number().finite().nullable(), purchasable: z.boolean(), inStock: z.boolean(), backordersAllowed: z.boolean() }).strict();
const media = z.object({ id, url: publicURL, alt: z.string().max(10000) }).strict();
const attribute = z.object({ key: z.string().min(1).max(500), name: z.string().min(1).max(500), label: z.string().max(1000), options: z.array(z.string().max(1000)).max(500), visible: z.boolean(), variation: z.boolean() }).strict();
const term = z.object({ id, name: z.string().max(1000), slug: z.string().max(500) }).strict();
export const targetProductSchema = z.object({
  id, status: z.literal('publish'), type: z.enum(['simple', 'variable']), name: z.string().min(1).max(10000), permalink: publicURL,
  sku: z.string().max(1000), description: text, shortDescription: text,
  price, stock, soldIndividually: z.boolean(), media: z.array(media).max(200), attributes: z.array(attribute).max(100),
  defaultAttributes: z.record(z.string().max(500), z.string().max(1000)),
  variations: z.array(z.object({ id, parentId: id, attributes: z.record(z.string().max(500), z.string().max(1000)), price, stock, image: media.nullable() }).strict()).max(200),
  /** Includes excluded children; variations contains only published, native-visible children. No silent truncation. */
  variationChildrenCount: z.number().int().min(0).max(200),
  categories: z.array(term).max(200), tags: z.array(term).max(200),
  reviews: z.object({ enabled: z.boolean(), average: z.number().min(0).max(5), ratingCount: z.number().int().nonnegative(), reviewCount: z.number().int().nonnegative() }).strict(),
}).strict();
export const targetProductSnapshotSchema = z.object({
  version: z.literal(1), provider: z.literal('target-woocommerce-product-v1'), targetOrigin: publicURL,
  readAt: z.string().datetime(), woocommerceVersion: z.string().min(1).max(100), currency: z.string().regex(/^[A-Z]{3}$/),
  /** No source IDs or untrusted URLs become native defaults. Evidence is an observation, not render approval. */
  product: targetProductSchema,
}).strict();
export type TargetProductSnapshot = z.infer<typeof targetProductSnapshotSchema>;
export type TargetProduct = TargetProductSnapshot['product'];
export function targetProductId(value: unknown): number { return id.parse(value); }
export function parseTargetProductSnapshot(value: unknown, origin: string, productId: number): TargetProductSnapshot {
  const result = targetProductSnapshotSchema.parse(value), product = result.product;
  if (result.targetOrigin !== new URL(origin).origin || new URL(result.targetOrigin).origin !== result.targetOrigin || new URL(product.permalink).origin !== result.targetOrigin || product.id !== targetProductId(productId)) throw Error('target_product_identity_mismatch');
  const unique = (ids: number[]) => new Set(ids).size === ids.length;
  if (!unique(product.media.map(row => row.id)) || !unique(product.categories.map(row => row.id)) || !unique(product.tags.map(row => row.id)) || !unique(product.variations.map(row => row.id))) throw Error('target_product_duplicate_identity');
  if (product.type === 'simple' && (product.variations.length || product.variationChildrenCount || Object.keys(product.defaultAttributes).length) || product.variations.length > product.variationChildrenCount) throw Error('target_product_variation_type_mismatch');
  const names = product.attributes.map(row => row.key);
  if (new Set(names).size !== names.length) throw Error('target_product_duplicate_attribute');
  const variationNames = new Set(product.attributes.filter(row => row.variation).map(row => row.key));
  for (const name of Object.keys(product.defaultAttributes)) if (!variationNames.has(name)) throw Error('target_product_unknown_default_attribute');
  for (const variation of product.variations) if (variation.parentId !== product.id || variation.id === product.id || Object.keys(variation.attributes).some(name => !variationNames.has(name))) throw Error('target_product_variation_owner_mismatch');
  return result;
}
