import { z } from 'zod';
import { targetProductId } from './product-contract.js';

const id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const ids = z.array(id).max(100).refine(values => new Set(values).size === values.length);
const publicURL = z.string().url().refine(value => { const u = new URL(value); return ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password; });
export const relatedProductsQuerySchema = z.object({
  source: z.literal('related'),
  contextKey: z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,100}$/),
  limit: z.number().int().min(1).max(24),
  excludeIds: ids.default([]),
}).strict();
export type RelatedProductsQueryInput = z.input<typeof relatedProductsQuerySchema>;
export type RelatedProductsQuery = z.output<typeof relatedProductsQuerySchema>;
export function normalizeRelatedProductsQuery(value: RelatedProductsQueryInput): RelatedProductsQuery {
  const query = relatedProductsQuerySchema.parse(value);
  return { ...query, excludeIds: [...query.excludeIds].sort((a, b) => a - b) };
}
export const relatedProductsQueryKey = (value: RelatedProductsQueryInput) => JSON.stringify(normalizeRelatedProductsQuery(value));

/** Observation of native related candidates, never template include IDs. */
export const relatedProductsSnapshotSchema = z.object({
  version: z.literal(1), provider: z.literal('target-woocommerce-related-v1'),
  targetOrigin: publicURL, readAt: z.string().datetime(), currentProductId: id,
  query: relatedProductsQuerySchema, categoryIds: ids, tagIds: ids, upsellIds: ids.default([]),
  queryEngine: z.literal('woocommerce-product-data-store-related-v1'),
  candidateCount: z.number().int().min(0).max(34),
  products: z.array(z.object({ id, name: z.string().min(1).max(10000), permalink: publicURL, imageUrl: publicURL.optional() }).strict()).max(24),
}).strict();
export type RelatedProductsSnapshot = z.infer<typeof relatedProductsSnapshotSchema>;

export function parseRelatedProductsSnapshot(value: unknown, origin: string, productId: number, queryInput: RelatedProductsQueryInput): RelatedProductsSnapshot {
  const result = relatedProductsSnapshotSchema.parse(value), query = normalizeRelatedProductsQuery(queryInput);
  if (result.targetOrigin !== new URL(origin).origin || new URL(result.targetOrigin).origin !== result.targetOrigin || result.currentProductId !== targetProductId(productId) || relatedProductsQueryKey(result.query) !== relatedProductsQueryKey(query)) throw Error('related_products_identity_mismatch');
  if (result.products.length > query.limit || result.candidateCount < result.products.length || result.candidateCount > query.limit + 10 || new Set(result.products.map(p => p.id)).size !== result.products.length) throw Error('related_products_query_mismatch');
  for (const product of result.products) if (product.id === productId || query.excludeIds.includes(product.id) || result.upsellIds.includes(product.id) || new URL(product.permalink).origin !== result.targetOrigin) throw Error('related_products_result_scope_mismatch');
  return result;
}

/**
 * Uses WooCommerce's native related-products data store and taxonomy filters.
 * Calling wc_get_related_products here would set wc_related_* transients on a
 * cache miss. This fixed observation deliberately uses its cache-free read
 * branch; the qualified native widget remains the runtime query owner.
 */
export function targetRelatedProductsReadPHP(productInput: number, queryInput: RelatedProductsQueryInput): string {
  const productId = targetProductId(productInput), query = normalizeRelatedProductsQuery(queryInput);
  return `
$clonewpRelatedRead=true;$id=${productId};$limit=${query.limit};$explicitExclude=${JSON.stringify(query.excludeIds)};
if(!function_exists('wc_get_product')||!function_exists('wc_get_product_term_ids')||!class_exists('WC_Data_Store')){throw new RuntimeException('related_products_provider_missing');}
$current=wc_get_product($id);
if(!$current||$current->get_status()!=='publish'||!$current->is_visible()||get_post_field('post_password',$id)!==''){throw new RuntimeException('related_products_current_not_public');}
$cleanIds=static function($values){if(!is_array($values)||count($values)>100){throw new RuntimeException('related_products_taxonomy_limit');}$out=[];foreach($values as $value){if(!is_numeric($value)||(int)$value<1){throw new RuntimeException('related_products_taxonomy_id');}$out[]=(int)$value;}return array_values(array_unique($out));};
$cats=apply_filters('woocommerce_product_related_posts_relate_by_category',true,$id)?$cleanIds(apply_filters('woocommerce_get_related_product_cat_terms',wc_get_product_term_ids($id,'product_cat'),$id)):[];
$tags=apply_filters('woocommerce_product_related_posts_relate_by_tag',true,$id)?$cleanIds(apply_filters('woocommerce_get_related_product_tag_terms',wc_get_product_term_ids($id,'product_tag'),$id)):[];
$upsellIds=$cleanIds($current->get_upsell_ids());$exclude=array_values(array_unique(array_merge([0,$id],$upsellIds,$explicitExclude)));$candidates=[];
if($cats||$tags||apply_filters('woocommerce_product_related_posts_force_display',false,$id)){$store=WC_Data_Store::load('product');if(!is_callable([$store,'get_related_products'])){throw new RuntimeException('related_products_data_store_missing');}$candidates=$store->get_related_products($cats,$tags,$exclude,$limit+10,$id);}
if(!is_array($candidates)||count($candidates)>$limit+10){throw new RuntimeException('related_products_candidate_limit');}
$candidates=apply_filters('woocommerce_related_products',$candidates,$id,['limit'=>$limit,'excluded_ids'=>$exclude]);
if(!is_array($candidates)||count($candidates)>$limit+10){throw new RuntimeException('related_products_filtered_candidate_limit');}
$products=[];$seen=[];foreach($candidates as $candidate){$candidate=(int)$candidate;if($candidate<1||in_array($candidate,$exclude,true)||isset($seen[$candidate])){continue;}$seen[$candidate]=true;$p=wc_get_product($candidate);if(!$p||$p->get_status()!=='publish'||!$p->is_visible()||get_post_field('post_password',$candidate)!==''){continue;}$row=['id'=>(int)$p->get_id(),'name'=>(string)$p->get_name(),'permalink'=>(string)$p->get_permalink()];$imageId=(int)$p->get_image_id();$image=$imageId?wp_get_attachment_image_url($imageId,'full'):false;if(is_string($image)&&$image!==''){$row['imageUrl']=$image;}$products[]=$row;if(count($products)>=$limit){break;}}
return ['currentProductId'=>$id,'categoryIds'=>$cats,'tagIds'=>$tags,'upsellIds'=>$upsellIds,'queryEngine'=>'woocommerce-product-data-store-related-v1','candidateCount'=>count($candidates),'products'=>$products];`;
}
