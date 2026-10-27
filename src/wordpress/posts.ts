import { normalizeTargetPostsQuery, type TargetPostsQueryInput } from './posts-contract.js';

/** Fixed, bounded public post observation. Its query remains dynamic in the editor. */
export function targetPostsReadPHP(input: TargetPostsQueryInput): string {
  const query = normalizeTargetPostsQuery(input);
  const encoded = Buffer.from(JSON.stringify(query)).toString('base64');
  return `
$targetPostsObservation=true;$input=json_decode(base64_decode('${encoded}'),true);
foreach (['categoryIds'=>'category','tagIds'=>'post_tag'] as $field=>$taxonomy) {
  foreach ($input[$field] as $termId) {$term=get_term((int)$termId,$taxonomy);if(!$term||is_wp_error($term)){throw new RuntimeException('target_posts_taxonomy_missing');}}
}
$args=['post_type'=>'post','post_status'=>'publish','paged'=>1,'posts_per_page'=>(int)$input['itemsPerPage'],'orderby'=>'date','order'=>'DESC'];
if($input['offset']){$args['offset']=(int)$input['offset'];}
$selectedTerms=array_merge($input['categoryIds'],$input['tagIds']);
if($selectedTerms){
  $terms=get_terms(get_object_taxonomies('post'),['orderby'=>'name','include'=>$selectedTerms,'hide_empty'=>apply_filters('woodmart_blog_shortcode_hide_empty_terms',true)]);
  if(is_wp_error($terms)||count($terms)!==count($selectedTerms)){throw new RuntimeException('target_posts_empty_taxonomy_filter');}
  $args['tax_query']=['relation'=>'OR'];
  foreach($terms as $term){$args['tax_query'][]=['taxonomy'=>$term->taxonomy,'field'=>'slug','terms'=>[$term->slug],'include_children'=>true,'operator'=>'IN'];}
}
$query=new WP_Query($args);$posts=[];
$publicText=static function($value){return trim(preg_replace('/[\\s\\x{00a0}]+/u',' ',html_entity_decode(wp_strip_all_tags((string)$value),ENT_QUOTES|ENT_HTML5,'UTF-8')));};
foreach($query->posts as $post) {
  if(!($post instanceof WP_Post)||$post->post_type!=='post'||$post->post_status!=='publish'){throw new RuntimeException('target_posts_unpublished_record');}
  $imageId=(int)get_post_thumbnail_id($post);$image=$imageId?wp_get_attachment_image_url($imageId,'full'):false;$variants=[];
  if($imageId){$metadata=wp_get_attachment_metadata($imageId);foreach(array_keys(is_array($metadata)?($metadata['sizes']??[]):[]) as $size){$variant=wp_get_attachment_image_url($imageId,$size);if(is_string($variant)&&$variant!==''){$variants[]=$variant;}}}
  if(is_string($image)&&$image!==''){$variants[]=$image;}
  $categoryIds=wp_get_post_categories($post->ID);$tagIds=wp_get_post_tags($post->ID,['fields'=>'ids']);
  if(is_wp_error($categoryIds)||is_wp_error($tagIds)){throw new RuntimeException('target_posts_taxonomy_read_failed');}
  $bodyText=$publicText(strip_shortcodes((string)$post->post_content));
  $bodyPrefix=function_exists('mb_substr')?mb_substr($bodyText,0,4000,'UTF-8'):substr($bodyText,0,4000);
  $record=['id'=>(int)$post->ID,'status'=>'publish','date'=>(string)get_post_time('c',false,$post),'title'=>$publicText(get_the_title($post)),'excerpt'=>$publicText(get_the_excerpt($post)),'contentText'=>$bodyPrefix,'permalink'=>(string)get_permalink($post),'featuredMediaId'=>$imageId,'imageVariants'=>array_values(array_unique($variants)),'categoryIds'=>array_values(array_map('intval',$categoryIds)),'tagIds'=>array_values(array_map('intval',$tagIds))];
  if(is_string($image)&&$image!==''){$record['imageUrl']=$image;}$posts[]=$record;
}
return $posts;`;
}
