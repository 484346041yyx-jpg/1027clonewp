import { z } from 'zod';

/** Observations are not an authorization to write a template or a component release. */
export const archiveInspectionRequest = z.object({
  targetOrigin: z.string().url().refine(value => new URL(value).origin === value),
  categoryIds: z.array(z.number().int().positive().safe()).length(2).refine(ids => ids[0] !== ids[1]),
  perPage: z.number().int().min(1).max(24),
}).strict();
export type ArchiveInspectionRequest = z.infer<typeof archiveInspectionRequest>;
const controlNames = ['products_view','product_hover','products_columns','products_spacing','shop_pagination','shop_pagination_margin'] as const;

/** Read-only helper: normal WordPress taxonomy queries; no post, option, or request-global changes. */
export function archiveInspectionPHP(input: ArchiveInspectionRequest): string {
  const request = archiveInspectionRequest.parse(input);
  const encoded = Buffer.from(JSON.stringify(request)).toString('base64');
  return `$i=json_decode(base64_decode('${encoded}'),true);
if(untrailingslashit(home_url('/'))!==$i['targetOrigin']||!class_exists('\\Elementor\\Plugin')||!taxonomy_exists('product_cat'))throw new RuntimeException('archive_inspection_environment');
$widget=\\Elementor\\Plugin::$instance->widgets_manager->get_widget_types('wd_archive_products');
if(!$widget)throw new RuntimeException('archive_widget_missing');$r=new ReflectionClass($widget);$all=$widget->get_controls();$controls=[];
foreach(${JSON.stringify(controlNames)} as $name){if(isset($all[$name])){$c=$all[$name];$controls[$name]=['type'=>$c['type']??null,'default'=>$c['default']??null,'options'=>$c['options']??null];}}
$categories=[];foreach($i['categoryIds'] as $id){$term=get_term((int)$id,'product_cat');if(!$term||is_wp_error($term))throw new RuntimeException('archive_category_missing');$pages=[];foreach([1,2] as $page){$q=new WP_Query(['post_type'=>'product','post_status'=>'publish','posts_per_page'=>(int)$i['perPage'],'paged'=>$page,'fields'=>'ids','tax_query'=>[['taxonomy'=>'product_cat','field'=>'term_id','terms'=>[(int)$id],'include_children'=>true]]]);$pages[]=['page'=>$page,'ids'=>array_map('intval',$q->posts),'found'=>(int)$q->found_posts,'maxPages'=>(int)$q->max_num_pages];}$categories[]=['id'=>(int)$id,'name'=>$term->name,'url'=>get_term_link($term),'pages'=>$pages];}
return ['widget'=>['name'=>'wd_archive_products','class'=>$r->getName(),'sourceSha256'=>hash_file('sha256',$r->getFileName()),'controls'=>$controls],'categories'=>$categories,'perPage'=>(int)$i['perPage'],'evidenceScope'=>'read-only WP_Query and registered controls; not template save or frontend qualification'];`;
}

const page = z.object({page:z.number().int().positive(),ids:z.array(z.number().int().positive()),found:z.number().int().nonnegative(),maxPages:z.number().int().nonnegative()}).strict();
const response = z.object({widget:z.object({name:z.literal('wd_archive_products'),class:z.string().min(1),sourceSha256:z.string().regex(/^[a-f0-9]{64}$/),controls:z.record(z.string(),z.unknown())}).strict(),categories:z.array(z.object({id:z.number().int().positive(),name:z.string(),url:z.string().url(),pages:z.array(page).length(2)}).strict()).length(2),perPage:z.number().int().positive(),evidenceScope:z.string()}).strict();
export function validateArchiveInspection(input: ArchiveInspectionRequest, raw: unknown) {
  const request=archiveInspectionRequest.parse(input), result=response.parse(raw);
  if(result.perPage!==request.perPage || result.categories.some((c,i)=>c.id!==request.categoryIds[i] || new URL(c.url).origin!==request.targetOrigin)) throw Error('archive_inspection_identity_changed');
  for(const category of result.categories){const [first,second]=category.pages;const beyondEnd=first.maxPages<2&&second.ids.length===0&&second.found===0&&second.maxPages===0;const consistent=first.found===second.found&&first.maxPages===second.maxPages;if(first.page!==1||second.page!==2||!(beyondEnd||consistent)||first.ids.length>request.perPage||second.ids.length>request.perPage||new Set([...first.ids,...second.ids]).size!==first.ids.length+second.ids.length) throw Error('archive_inspection_pagination_invalid');}
  return result;
}
