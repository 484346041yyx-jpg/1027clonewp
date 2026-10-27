// Fixed public-resource adapter. It never writes theme options or existing resources.
try {
  $origin=untrailingslashit(home_url('/'));$run=$input['runId']??'';$contract=$input['contractHash']??'';
  if($origin!==($input['targetOrigin']??null)||!preg_match('/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/D',$run)||!preg_match('/^[a-f0-9]{64}$/D',$contract))throw new RuntimeException('public_identity');
  if(!current_user_can('edit_pages')||!current_user_can('edit_theme_options')||!current_user_can('unfiltered_html')||get_template()!=='woodmart'||!post_type_exists('cms_block')||!class_exists('Elementor\\Plugin'))throw new RuntimeException('public_permission');
  if(!function_exists('wp_check_post_lock'))require_once ABSPATH.'wp-admin/includes/post.php';
  $normalize=static function($v)use(&$normalize){if(is_object($v))$v=get_object_vars($v);if(!is_array($v))return $v;$list=array_is_list($v);foreach($v as $k=>$x)$v[$k]=$normalize($x);if(!$list)ksort($v,SORT_STRING);return $v;};
  $digest=static fn($v)=>hash('sha256',json_encode($normalize($v),JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES));
  $option='clonewp_public_'.hash('sha256',$run);$record=get_option($option,null);
  if($record!==null&&(!is_array($record)||($record['contractHash']??null)!==$contract))throw new RuntimeException('public_run_conflict');
  $readOwned=static function($role)use($run,$contract){
    $posts=get_posts(['post_type'=>$role==='footer'?'cms_block':'page','post_status'=>'any','numberposts'=>2,'meta_query'=>[['key'=>'_clonewp_run_id','value'=>$run],['key'=>'_clonewp_public_contract','value'=>$contract],['key'=>'_clonewp_public_role','value'=>$role]]]);
    if(count($posts)>1)throw new RuntimeException('public_duplicate_owner');if(!$posts)return null;$p=$posts[0];
    if($p->post_status!=='draft'||!current_user_can('edit_post',$p->ID))throw new RuntimeException('public_owner_changed');
    return ['id'=>(int)$p->ID,'title'=>$p->post_title,'status'=>$p->post_status,'slug'=>$p->post_name,'content'=>$p->post_content,'elements'=>json_decode(get_post_meta($p->ID,'_elementor_data',true)?:'[]',true),'settings'=>get_post_meta($p->ID,'_elementor_page_settings',true)?:[],'template'=>get_post_meta($p->ID,'_wp_page_template',true),'headerId'=>get_post_meta($p->ID,'_woodmart_whb_header',true)?:null,'editUrl'=>home_url('/wp-admin/post.php?post='.$p->ID.'&action='.($role==='footer'?'elementor':'edit')),'previewUrl'=>home_url('/?page_id='.$p->ID.'&preview=true')];
  };
  $global=static function()use($digest){$theme=get_option('xts-woodmart-options');$footerId=(int)($theme['footer_html_block']??0);$p=$footerId?get_post($footerId):null;return $digest([$theme,get_option('woodmart_options'),get_option('whb_main_header'),get_option('whb_saved_headers'),$p?[$p->ID,$p->post_content,get_post_meta($p->ID,'_elementor_data',true),get_post_meta($p->ID,'_elementor_page_settings',true)]:null]);};
  $snapshot=static function()use($readOwned,$global,&$record){return ['preview'=>$readOwned('preview'),'footer'=>$readOwned('footer'),'globalHash'=>$global(),'receipts'=>$record['receipts']??[]];};
  $action=$input['action']??'';if($action==='inspect'){$s=$snapshot();return ['ok'=>true,'value'=>['snapshot'=>$s,'hash'=>$digest($s)]];}
  $operation=$input['operationId']??'';$payload=$input['payload']??null;
  if(!in_array($action,['create-preview','adopt-preview','create-footer','save-footer','save-preview'],true)||!preg_match('/^[A-Za-z0-9_-]{1,100}$/D',$operation)||!is_array($payload))throw new RuntimeException('public_operation');
  $lock=$option.'_lock';if(!add_option($lock,$operation,'','no'))throw new RuntimeException('public_busy');
  try{
    $record=get_option($option,null);if($record!==null&&($record['contractHash']??null)!==$contract)throw new RuntimeException('public_run_conflict');
    $before=$snapshot();if($digest($before)!==($input['expectedHash']??null))throw new RuntimeException('public_snapshot_changed');
    foreach($before['receipts'] as $receipt)if(($receipt['state']??null)!=='complete')throw new RuntimeException('public_reconcile_required');
    if(isset($before['receipts'][$operation]))throw new RuntimeException('public_operation_reused');
    $record??=['contractHash'=>$contract,'receipts'=>[]];$record['receipts'][$operation]=['action'=>$action,'payloadHash'=>$digest($payload),'state'=>'started'];update_option($option,$record,false);
    if($action==='create-preview'||$action==='create-footer'){
      $role=$action==='create-footer'?'footer':'preview';if($before[$role]!==null)throw new RuntimeException('public_already_created');
      $title=$payload['title']??'';$slug=$payload['slug']??'';if(!is_string($title)||!trim($title)||strlen($title)>600||!is_string($slug)||!preg_match('/^[a-z0-9][a-z0-9-]{0,119}$/D',$slug))throw new RuntimeException('public_create_input');
      $type=$role==='footer'?'cms_block':'page';$slug=wp_unique_post_slug(sanitize_title($slug),0,'publish',$type,0);
      $id=wp_insert_post(['post_type'=>$type,'post_status'=>'draft','post_title'=>$title,'post_name'=>$slug,'post_content'=>'','meta_input'=>['_clonewp_run_id'=>$run,'_clonewp_public_contract'=>$contract,'_clonewp_public_role'=>$role]],true);if(is_wp_error($id))throw new RuntimeException('public_create_failed');
      if($role==='preview'){update_post_meta($id,'_wp_page_template','elementor_header_footer');foreach(['_woodmart_title_off','_woodmart_prefooter_off','_woodmart_footer_off','_woodmart_copyrights_off'] as $key)update_post_meta($id,$key,'1');update_post_meta($id,'_woodmart_main_layout','full-width');}
      else{update_post_meta($id,'_elementor_edit_mode','builder');update_post_meta($id,'_elementor_template_type','wp-post');}
      $result=['id'=>(int)$id];
    }elseif($action==='adopt-preview'){
      if($before['preview'])throw new RuntimeException('public_already_created');$id=$payload['pageId']??0;$identity=$payload['headerIdentity']??[];$module=get_option('clonewp_header_module_'.hash('sha256',$origin.'|'.($identity['moduleKey']??'')),null);$p=get_post($id);
      if(!is_int($id)||!$p||$p->post_type!=='page'||$p->post_status!=='draft'||get_post_meta($id,'_clonewp_run_id',true)!==$run||($identity['owner']['runId']??null)!==$run||!is_array($module)||($module['identity']??null)!==$identity||!in_array($id,$module['pages']??[],true)||get_post_meta($id,'_clonewp_header_module_owner',true)!==hash('sha256',serialize($identity))||wp_check_post_lock($id))throw new RuntimeException('public_preview_adoption');
      update_post_meta($id,'_clonewp_public_contract',$contract);update_post_meta($id,'_clonewp_public_role','preview');foreach(['_woodmart_title_off','_woodmart_prefooter_off','_woodmart_footer_off','_woodmart_copyrights_off'] as $key)update_post_meta($id,$key,'1');$result=['id'=>$id];
    }elseif($action==='save-footer'){
      $p=$before['footer'];$id=$p['id']??0;if(!$id||wp_check_post_lock($id))throw new RuntimeException('public_footer_not_editable');
      $elements=$payload['elements']??null;$settings=$payload['settings']??null;if(!is_array($elements)||!count($elements)||!is_array($settings))throw new RuntimeException('public_document_input');
      $walk=static function($nodes,$depth=0)use(&$walk){if($depth>30)throw new RuntimeException('public_document_depth');foreach($nodes as $n){if(!is_array($n)||!preg_match('/^[a-f0-9]{7}$/D',$n['id']??''))throw new RuntimeException('public_element_identity');if(($n['elType']??null)==='widget'&&!Elementor\Plugin::$instance->widgets_manager->get_widget_types($n['widgetType']??''))throw new RuntimeException('public_widget_missing');if(!in_array($n['elType']??null,['container','widget'],true))throw new RuntimeException('public_element_type');$walk($n['elements']??[],$depth+1);}};$walk($elements);
      $plugin=Elementor\Plugin::$instance;$mode=$plugin->breakpoints->get_responsive_control_duplication_mode();$fp=null;$frontend=null;
      if(class_exists('Elementor\\Core\\Frontend\\Performance')){$fp=new ReflectionProperty('Elementor\\Core\\Frontend\\Performance','is_frontend');$fp->setAccessible(true);$frontend=$fp->getValue();$fp->setValue(null,false);}
      try{$plugin->breakpoints->set_responsive_control_duplication_mode('off');$plugin->controls_manager->clear_stack_cache();$doc=$plugin->documents->get($id,false);if(!$doc||!$doc->is_editable_by_current_user())throw new RuntimeException('public_document_unavailable');$doc->set_is_built_with_elementor(true);if(!$doc->save(['elements'=>$elements,'settings'=>$settings]))throw new RuntimeException('public_save_unknown');}
      finally{$plugin->breakpoints->set_responsive_control_duplication_mode($mode);if($fp)$fp->setValue(null,$frontend);$plugin->controls_manager->clear_stack_cache();}
      delete_post_meta($id,'_elementor_element_cache');if(class_exists('Elementor\\Core\\Files\\CSS\\Post'))(new Elementor\Core\Files\CSS\Post($id))->update();
      $saved=$readOwned('footer');if($digest($saved['elements'])!==$digest($elements)||$digest($saved['settings']['custom_css']??'')!==$digest($settings['custom_css']??''))throw new RuntimeException('public_document_readback');$result=['id'=>$id];
    }else{
      $p=$before['preview'];$footer=$before['footer'];if(!$p||!$footer||!count($footer['elements'])||wp_check_post_lock($p['id']))throw new RuntimeException('public_preview_not_ready');
      $content='[html_block id="'.$footer['id'].'"]';$saved=wp_update_post(['ID'=>$p['id'],'post_content'=>$content],true);if(is_wp_error($saved)||get_post($p['id'])->post_content!==$content)throw new RuntimeException('public_preview_readback');$result=['id'=>$p['id']];
    }
    if($global()!==$before['globalHash'])throw new RuntimeException('public_global_changed');
    $record['receipts'][$operation]=['action'=>$action,'payloadHash'=>$digest($payload),'state'=>'complete','result'=>$result];update_option($option,$record,false);$after=$snapshot();return ['ok'=>true,'value'=>['snapshot'=>$after,'hash'=>$digest($after),'result'=>$result]];
  }finally{if(get_option($lock)===$operation)delete_option($lock);}
}catch(\Throwable $error){$message=$error->getMessage();return ['ok'=>false,'code'=>preg_match('/^public_[a-z0-9_]{1,100}$/D',$message)?$message:'public_server_failed'];}
