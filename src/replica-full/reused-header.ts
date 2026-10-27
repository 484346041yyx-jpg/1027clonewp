import { createHash } from 'node:crypto';

export interface ReusedHeaderIdentity { pageId: number; runId: string; headerId: string }
export interface ReusedHeaderSnapshot {
  pageId: number; runId: string; headerId: string; hash: string; sharedHash: string; documentHash: string;
  bound: boolean; template: string;
}
export interface ReusedHeaderTransport { php(code: string): Promise<unknown> }
export interface ReusedHeaderIntent {
  operationId: string; identity: ReusedHeaderIdentity; expectedHash: string; sharedHash: string; codeHash: string;
}

function identity(value: ReusedHeaderIdentity) {
  if (!Number.isSafeInteger(value.pageId) || value.pageId < 1 || !/^[A-Za-z0-9_-]{4,100}$/.test(value.runId) || !/^header_[1-9]\d{0,17}$/.test(value.headerId) || Object.keys(value).sort().join(',') !== 'headerId,pageId,runId') throw Error('reused_header_identity');
}

export function reusedHeaderPHP(value: ReusedHeaderIdentity, expected?: ReusedHeaderSnapshot): string {
  identity(value);
  if (expected) validateSnapshot(expected, value);
  const packet = Buffer.from(JSON.stringify({ ...value, expected: expected?.hash ?? null })).toString('base64');
  return `$input=json_decode(base64_decode('${packet}'),true);
$id=$input['pageId'];$run=$input['runId'];$hid=$input['headerId'];
if(!function_exists('wp_check_post_lock'))require_once ABSPATH.'wp-admin/includes/post.php';
$normalize=static function($value)use(&$normalize){if(!is_array($value))return $value;$list=array_is_list($value);foreach($value as $key=>$child)$value[$key]=$normalize($child);if(!$list)ksort($value,SORT_STRING);return $value;};
$digest=static function($value)use($normalize){return hash('sha256',serialize($normalize($value)));};
$documentDigest=static function($value)use($normalize){$encoded=json_encode($normalize($value),JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES);if($encoded===false)throw new RuntimeException('reused_header_document_json');return hash('sha256',$encoded);};
$read=static function()use($id,$run,$hid,$digest,$documentDigest){
  if(get_post_type($id)!=='page'||get_post_status($id)!=='draft'||get_post_meta($id,'_clonewp_run_id',true)!==$run||!current_user_can('edit_post',$id)||wp_check_post_lock($id))throw new RuntimeException('reused_header_owned_draft');
  $pages=get_posts(['post_type'=>'page','post_status'=>'any','fields'=>'ids','numberposts'=>2,'meta_key'=>'_clonewp_run_id','meta_value'=>$run]);if(count($pages)!==1||(int)$pages[0]!==$id)throw new RuntimeException('reused_header_run_ambiguous');
  $raw=get_option('whb_'.$hid);if(!$raw||get_template()!=='woodmart')throw new RuntimeException('reused_header_missing');
  $menus=[];$blocks=[];$walk=static function($node)use(&$walk,&$menus,&$blocks){if(!is_array($node))return;foreach($node['params']??[] as $key=>$param){$value=$param['value']??null;if($key==='menu_id'&&$value){$menu=wp_get_nav_menu_object($value);if(!$menu)throw new RuntimeException('reused_header_menu_missing');$items=wp_get_nav_menu_items($menu->term_id,['post_status'=>'any'])?:[];$data=[];foreach($items as $item)$data[]=[$item,get_post_meta($item->ID)];$menus[(string)$menu->term_id]=[$menu,$data];}if($key==='block_id'&&$value){$block=get_post((int)$value);if(!$block||$block->post_type!=='cms_block')throw new RuntimeException('reused_header_block_missing');$blocks[(string)$block->ID]=[$block,get_post_meta($block->ID)];}}foreach($node as $key=>$child)if(is_array($child))$walk($child);};
  $decoded=is_string($raw)?json_decode($raw,true):$raw;if(!is_array($decoded))throw new RuntimeException('reused_header_layout_invalid');$walk($decoded);ksort($menus);ksort($blocks);
  $doc=\\Elementor\\Plugin::$instance->documents->get($id,false);if(!$doc||!$doc->is_built_with_elementor())throw new RuntimeException('reused_header_document');
  $elements=$doc->get_elements_data();$settings=$doc->get_settings();$meta=get_post_meta($id);$post=get_post($id);$header=get_post_meta($id,'_woodmart_whb_header',true);if($header&&$header!==$hid)throw new RuntimeException('reused_header_conflicting_binding');
  $sharedHash=$digest([$raw,$menus,$blocks,get_option('whb_main_header'),get_option('whb_saved_headers'),get_option('xts-woodmart-options'),get_option('woodmart_options')]);
  return ['pageId'=>$id,'runId'=>$run,'headerId'=>$hid,'hash'=>$digest([$post,$meta,$elements,$settings,$sharedHash]),'sharedHash'=>$sharedHash,'documentHash'=>$documentDigest([$elements,$settings]),'bound'=>$header===$hid&&($settings['wd__woodmart_whb_header']??null)===$hid,'template'=>(string)get_post_meta($id,'_wp_page_template',true)];
};
$before=$read();if($input['expected']===null)return $before;
if(!hash_equals($input['expected'],$before['hash']))throw new RuntimeException('reused_header_snapshot_changed');
$lock='clonewp_reused_header_page_'.$id;$lockValue=$input['expected'];if(!add_option($lock,$lockValue,'','no'))throw new RuntimeException('reused_header_locked');
try{
  $fresh=$read();if($fresh['hash']!==$before['hash'])throw new RuntimeException('reused_header_snapshot_changed');
  $doc=\\Elementor\\Plugin::$instance->documents->get($id,false);$elements=$doc->get_elements_data();$settings=$doc->get_settings();$settings['template']='elementor_header_footer';$settings['hide_title']='yes';$settings['wd__woodmart_whb_header']=$hid;
  $stack=$doc->get_stack();$controls=array_merge($stack['controls']??[],$stack['style_controls']??[]);$switcher=\\Elementor\\Plugin::$instance->controls_manager->get_control('switcher');
  $shellSettings=[];foreach(['wd__woodmart_title_off','wd__woodmart_footer_off','wd__woodmart_prefooter_off','wd__woodmart_copyrights_off'] as $key){$control=$controls[$key]??null;if(!$control||($control['type']??'')!=='switcher'||!$switcher||!method_exists($switcher,'get_settings'))throw new RuntimeException('reused_header_shell_control_missing');$enabled=$control['return_value']??$switcher->get_settings('return_value');if(!is_string($enabled)||$enabled==='')throw new RuntimeException('reused_header_shell_control_value');$shellSettings[$key]=$enabled;}
  if(($controls['wd__woodmart_main_layout']['type']??'')!=='select'||!array_key_exists('full-width',$controls['wd__woodmart_main_layout']['options']??[]))throw new RuntimeException('reused_header_shell_layout_missing');$shellSettings['wd__woodmart_main_layout']='full-width';$settings=array_merge($settings,$shellSettings);
  if(!$doc->save(['settings'=>$settings]))throw new RuntimeException('reused_header_save_unknown');
  foreach(['_wp_page_template'=>'elementor_header_footer','_woodmart_whb_header'=>$hid,'_woodmart_title_off'=>'1','_woodmart_main_layout'=>'full-width','_woodmart_prefooter_off'=>'1','_woodmart_footer_off'=>'1','_woodmart_copyrights_off'=>'1'] as $key=>$value)update_post_meta($id,$key,$value);
  if(class_exists('\\Elementor\\Core\\Files\\CSS\\Post'))(new \\Elementor\\Core\\Files\\CSS\\Post($id))->update();
  $after=$read();$doc=\\Elementor\\Plugin::$instance->documents->get($id,false);
  if($after['sharedHash']!==$before['sharedHash']||!$after['bound']||$after['template']!=='elementor_header_footer'||$documentDigest($doc->get_elements_data())!==$documentDigest($elements)||$documentDigest($doc->get_settings())!==$documentDigest($settings))throw new RuntimeException('reused_header_readback_unknown');
  foreach(['_woodmart_title_off','_woodmart_prefooter_off','_woodmart_footer_off','_woodmart_copyrights_off'] as $key)if(get_post_meta($id,$key,true)!=='1')throw new RuntimeException('reused_header_flags_unknown');
  foreach($shellSettings as $key=>$value)if(!function_exists('woodmart_get_post_meta_value')||woodmart_get_post_meta_value($id,substr($key,3))!==$value)throw new RuntimeException('reused_header_effective_shell_unknown');
  if(get_post_meta($id,'_woodmart_main_layout',true)!=='full-width'||!function_exists('woodmart_get_post_meta_value')||woodmart_get_post_meta_value($id,'_woodmart_whb_header')!==$hid)throw new RuntimeException('reused_header_effective_binding_unknown');
  return $after;
}finally{if(get_option($lock)===$lockValue)delete_option($lock);}`;
}

function validateSnapshot(value: ReusedHeaderSnapshot, wanted: ReusedHeaderIdentity) {
  if (!value || value.pageId !== wanted.pageId || value.runId !== wanted.runId || value.headerId !== wanted.headerId || ![value.hash, value.sharedHash, value.documentHash].every(item => /^[a-f0-9]{64}$/.test(item)) || typeof value.bound !== 'boolean' || typeof value.template !== 'string') throw Error('reused_header_snapshot_invalid');
}

export async function inspectReusedHeader(transport: ReusedHeaderTransport, wanted: ReusedHeaderIdentity): Promise<ReusedHeaderSnapshot> {
  const value = await transport.php(reusedHeaderPHP(wanted)) as ReusedHeaderSnapshot;
  validateSnapshot(value, wanted);
  return value;
}

export async function bindReusedHeader(input: {
  transport: ReusedHeaderTransport; identity: ReusedHeaderIdentity; before: ReusedHeaderSnapshot; operationId: string;
  persistIntent: (intent: ReusedHeaderIntent) => Promise<void>;
  persistReadback: (receipt: { intent: ReusedHeaderIntent; after: ReusedHeaderSnapshot }) => Promise<void>;
}) {
  if (!/^[A-Za-z0-9_-]{4,100}$/.test(input.operationId)) throw Error('reused_header_operation_id');
  const code = reusedHeaderPHP(input.identity, input.before);
  const intent: ReusedHeaderIntent = { operationId: input.operationId, identity: input.identity, expectedHash: input.before.hash, sharedHash: input.before.sharedHash, codeHash: createHash('sha256').update(code).digest('hex') };
  await input.persistIntent(intent);
  const after = await input.transport.php(code) as ReusedHeaderSnapshot;
  validateSnapshot(after, input.identity);
  if (!after.bound || after.template !== 'elementor_header_footer' || after.sharedHash !== input.before.sharedHash) throw Error('reused_header_readback_unknown');
  await input.persistReadback({ intent, after });
  return { intent, after };
}
