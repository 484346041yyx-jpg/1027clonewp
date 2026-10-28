import { normalizeTargetCategoriesQuery, assertTargetCategoriesEvidence, type TargetCategoriesEvidence, type TargetCategoriesQueryInput } from './categories-contract.js';

/** Fixed read-only PHP: public taxonomy and term links, no settings or metadata writes. */
export function targetCategoriesReadPHP(input: TargetCategoriesQueryInput): string {
  const q = normalizeTargetCategoriesQuery(input);
  return `$query=json_decode(base64_decode('${Buffer.from(JSON.stringify(q)).toString('base64')}'),true);
if(!taxonomy_exists('product_cat'))throw new RuntimeException('product_categories_missing');
$all=get_terms(['taxonomy'=>'product_cat','hide_empty'=>false,'orderby'=>'menu_order','order'=>'ASC','number'=>1001]);
if(is_wp_error($all)||count($all)>1000)throw new RuntimeException('product_categories_query_unbounded');
$by=[];foreach($all as $term)$by[(int)$term->term_id]=$term;
foreach($query['rootIds'] as $root)if(!isset($by[$root])||(int)$by[$root]->parent!==0)throw new RuntimeException('product_categories_root_missing');
$rows=[];foreach($all as $position=>$term){$current=$term;$seen=[];while((int)$current->parent){if(isset($seen[(int)$current->term_id])||!isset($by[(int)$current->parent]))throw new RuntimeException('product_categories_tree_invalid');$seen[(int)$current->term_id]=true;$current=$by[(int)$current->parent];}
if(!in_array((int)$current->term_id,$query['rootIds'],true))continue;
$url=get_term_link($term);if(is_wp_error($url))throw new RuntimeException('product_categories_link_missing');
$rows[]=['id'=>(int)$term->term_id,'parent'=>(int)$term->parent,'name'=>(string)$term->name,'slug'=>(string)$term->slug,'permalink'=>(string)$url,'count'=>(int)$term->count,'order'=>(int)$position];}
return $rows;`;
}
export function parseTargetCategoriesObservation(terms: unknown, input: TargetCategoriesQueryInput, targetOrigin: string): TargetCategoriesEvidence {
  const out = { version: 1, targetOrigin, readAt: new Date().toISOString(), evidence: [], taxonomy: 'product_cat', query: normalizeTargetCategoriesQuery(input), terms };
  assertTargetCategoriesEvidence(out, targetOrigin, input); return out;
}
