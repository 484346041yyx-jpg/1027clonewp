// Fixed native popup adapter. Existing records, theme options and shared templates are read-only.
try {
  $origin=untrailingslashit(home_url('/'));$run=$input['runId']??'';$contract=$input['contractHash']??'';
  if($origin!==($input['targetOrigin']??null)||!preg_match('/^[a-z][a-z0-9-]{1,79}$/D',$run)||!preg_match('/^[a-f0-9]{64}$/D',$contract))throw new RuntimeException('popup_identity');
  if(!current_user_can('edit_pages')||!current_user_can('upload_files')||!current_user_can('unfiltered_html')||!post_type_exists('wd_popup')||!class_exists('Elementor\\Plugin'))throw new RuntimeException('popup_permission');
  if(!function_exists('wp_check_post_lock'))require_once ABSPATH.'wp-admin/includes/post.php';
  $normalize=static function($v)use(&$normalize){if(is_object($v))$v=get_object_vars($v);if(!is_array($v))return $v;$list=array_is_list($v);foreach($v as $k=>$x)$v[$k]=$normalize($x);if(!$list)ksort($v,SORT_STRING);return $v;};
  $digest=static fn($v)=>hash('sha256',json_encode($normalize($v),JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES));
  $key='clonewp_popup_'.hash('sha256',$run);$record=get_option($key,null);
  if($record!==null&&(!is_array($record)||($record['contractHash']??null)!==$contract))throw new RuntimeException('popup_contract_conflict');
  $read=static function($role)use($run,$contract){$posts=get_posts(['post_type'=>$role==='popup'?'wd_popup':'page','post_status'=>'any','numberposts'=>2,'meta_query'=>[['key'=>'_clonewp_popup_run','value'=>$run],['key'=>'_clonewp_popup_role','value'=>$role]]]);if(count($posts)>1)throw new RuntimeException('popup_duplicate_owner');if(!$posts)return null;$p=$posts[0];if(!current_user_can('edit_post',$p->ID)||get_post_meta($p->ID,'_clonewp_popup_contract',true)!==$contract||!in_array($p->post_status,['draft','publish'],true))throw new RuntimeException('popup_owner_changed');return ['id'=>(int)$p->ID,'status'=>$p->post_status,'title'=>$p->post_title,'content'=>$p->post_content,'elements'=>json_decode(get_post_meta($p->ID,'_elementor_data',true)?:'[]',true),'settings'=>get_post_meta($p->ID,'_elementor_page_settings',true)?:[]];};
  $global=static function()use($digest){$theme=get_option('woodmart_options',[]);$whb=get_option('whb_headers',[]);return $digest([$theme,$whb,get_option('whb_main_header'),get_option('page_on_front'),get_option('show_on_front'),get_theme_mods()]);};
  $snapshot=static function()use($read,&$record){return ['popup'=>$read('popup'),'preview'=>$read('preview'),'assets'=>$record['assets']??[],'receipts'=>$record['receipts']??[]];};
  $before=$snapshot();$beforeHash=$digest($before);$action=$input['action']??'inspect';
  if($action==='inspect')return ['ok'=>true,'value'=>['snapshot'=>$before,'hash'=>$beforeHash]];
  if(($input['expectedHash']??null)!==$beforeHash)throw new RuntimeException('popup_cas_conflict');
  $op=$input['operationId']??'';$payload=$input['payload']??[];
  if(!preg_match('/^[a-f0-9-]{36}$/D',$op)||!in_array($action,['create-popup','create-preview','asset','save','style','behavior','preview','activate','reconcile-before'],true))throw new RuntimeException('popup_action');
  foreach($before['receipts'] as $receiptId=>$r)if(($r['state']??null)!=='complete'&&($action!=='reconcile-before'||$receiptId!==($payload['operationId']??null)))throw new RuntimeException('popup_reconcile_required');
  $lock=$key.'_lock';if(!add_option($lock,$op,'','no'))throw new RuntimeException('popup_remote_lock_busy');
  try {
    $fresh=get_option($key,null);if($fresh!==$record||$digest($snapshot())!==$beforeHash)throw new RuntimeException('popup_cas_conflict');
    $record??=['contractHash'=>$contract,'assets'=>[],'receipts'=>[]];$record['receipts'][$op]=['action'=>$action,'state'=>'started','payloadHash'=>$digest($payload)];update_option($key,$record,false);
    if($action==='reconcile-before'){
      $target=$payload['operationId']??'';$check=$before;
      if(($check['receipts'][$target]['state']??null)!=='started')throw new RuntimeException('popup_reconcile_identity');
      unset($check['receipts'][$target]);if($digest($check)!==($payload['expectedBeforeHash']??null))throw new RuntimeException('popup_reconcile_effect_changed');
      $record['receipts'][$target]['state']='complete';$record['receipts'][$target]['result']=['reconciled'=>'confirmed-no-effect'];$result=['reconciledOperation'=>$target,'effect'=>'none'];
    }elseif($action==='create-popup'||$action==='create-preview'){
      $role=$action==='create-popup'?'popup':'preview';if($before[$role])throw new RuntimeException('popup_already_created');
      $id=wp_insert_post(['post_type'=>$role==='popup'?'wd_popup':'page','post_status'=>'draft','post_title'=>$payload['title'],'post_name'=>sanitize_title($payload['title']),'post_content'=>$role==='preview'?'<p><button type="button" class="cwp-open-popup-'.$before['popup']['id'].'">Open popup</button></p>':'','meta_input'=>['_clonewp_popup_run'=>$run,'_clonewp_popup_role'=>$role,'_clonewp_popup_contract'=>$contract]],true);if(is_wp_error($id)||!$id)throw new RuntimeException('popup_create_unknown');
      if($role==='popup'){update_post_meta($id,'_elementor_edit_mode','builder');update_post_meta($id,'_elementor_template_type','wd_popup');update_post_meta($id,'_elementor_version',ELEMENTOR_VERSION);}
      $result=['id'=>(int)$id];
    }elseif($action==='asset'){
      $assetKey=$payload['key']??'';if(!in_array($assetKey,['pouch','regular-font','semibold-font'],true)||isset($record['assets'][$assetKey])||!$before['popup'])throw new RuntimeException('popup_asset_identity');
      $bytes=base64_decode($payload['bytes']??'',true);$mime=$payload['mime']??'';$name=$payload['name']??'';
      if(!$bytes||strlen($bytes)>1600000||hash('sha256',$bytes)!==($payload['sha256']??null)||!preg_match('/^[a-z0-9-]+\\.(webp|woff2)$/D',$name))throw new RuntimeException('popup_asset_bytes');
      if(($assetKey==='pouch'&&($mime!=='image/webp'||substr($bytes,0,4)!=='RIFF'||substr($bytes,8,4)!=='WEBP'))||($assetKey!=='pouch'&&($mime!=='font/woff2'||substr($bytes,0,4)!=='wOF2')))throw new RuntimeException('popup_asset_type');
      $mime_filter=static function($mimes){$mimes['woff2']='font/woff2';return $mimes;};add_filter('upload_mimes',$mime_filter);
      try{$upload=wp_upload_bits($name,null,$bytes);}finally{remove_filter('upload_mimes',$mime_filter);}
      if(!empty($upload['error'])||!is_file($upload['file'])||hash_file('sha256',$upload['file'])!==$payload['sha256'])throw new RuntimeException('popup_upload_unknown');
      $id=wp_insert_attachment(['post_mime_type'=>$mime,'post_title'=>pathinfo($name,PATHINFO_FILENAME),'post_status'=>'inherit','post_parent'=>$before['popup']['id'],'meta_input'=>['_clonewp_popup_run'=>$run,'_clonewp_popup_contract'=>$contract,'_clonewp_popup_asset'=>$assetKey]],$upload['file'],$before['popup']['id'],true);if(is_wp_error($id)||!$id)throw new RuntimeException('popup_attachment_unknown');
      if($assetKey==='pouch'){require_once ABSPATH.'wp-admin/includes/image.php';$metadata=wp_generate_attachment_metadata($id,$upload['file']);if($metadata)wp_update_attachment_metadata($id,$metadata);}
      $result=['key'=>$assetKey,'attachmentId'=>(int)$id,'url'=>wp_get_attachment_url($id),'sha256'=>hash_file('sha256',get_attached_file($id)),'mimeType'=>$mime];$record['assets'][$assetKey]=$result;
    }else{
      $p=$before['popup'];if(!$p||wp_check_post_lock($p['id']))throw new RuntimeException('popup_not_editable');$id=$p['id'];
      $doc=Elementor\Plugin::$instance->documents->get($id,false);if(!$doc||$doc->get_name()!=='wd_popup'||!$doc->is_editable_by_current_user())throw new RuntimeException('popup_document');
      if($action==='save'){
        $elements=$payload['elements']??[];$settings=$payload['settings']??[];$forms=0;
        $walk=static function($nodes)use(&$walk,&$forms){foreach($nodes as $n){if(!preg_match('/^[a-f0-9]{7}$/D',$n['id']??''))throw new RuntimeException('popup_node');if(($n['elType']??'')==='widget'){if(!in_array($n['widgetType']??'',['wd_image_or_svg','heading','text-editor','form'],true))throw new RuntimeException('popup_widget');if($n['widgetType']==='form'){$forms++;$s=$n['settings'];if(($s['submit_actions']??null)!==['save-to-database']||count($s['form_fields']??[])!==1||($s['form_fields'][0]['field_type']??null)!=='email')throw new RuntimeException('popup_form_actions');foreach(array_keys($s)as $k)if(preg_match('/^(email|webhook|redirect|mailchimp|mailerlite|activecampaign|convertkit|drip|getresponse|slack|discord|popup)(_|$)/i',$k))throw new RuntimeException('popup_form_business');}}elseif(($n['elType']??'')!=='container')throw new RuntimeException('popup_node_type');$walk($n['elements']??[]);}};$walk($elements);if($forms!==1||!$elements||!is_array($settings)||!empty($settings['wd_popup_conditions']))throw new RuntimeException('popup_save_scope');
      }else{
        if(!count($p['elements']??[]))throw new RuntimeException('popup_empty');$elements=$p['elements'];$settings=$p['settings'];
        if($action==='behavior'){if(array_keys($payload)!==['wd_popup_persistent_close']||!in_array($payload['wd_popup_persistent_close'],['0','1'],true)||!isset($doc->get_controls()['wd_popup_persistent_close']))throw new RuntimeException('popup_behavior_scope');$settings['wd_popup_persistent_close']=$payload['wd_popup_persistent_close'];}
        elseif($action==='style'){$settings['custom_css']=$payload['css'];}
        elseif($action==='preview'){if(!$before['preview'])throw new RuntimeException('popup_preview_missing');$settings['wd_popup_conditions']=[['_id'=>'cwpview','comparison'=>'include','type'=>'post_id','query_post_id'=>(string)$before['preview']['id']]];}
        else{$settings['wd_popup_conditions']=[['_id'=>'cwpall','comparison'=>'include','type'=>'all']];}
      }
      $plugin=Elementor\Plugin::$instance;$mode=$plugin->breakpoints->get_responsive_control_duplication_mode();
      $fp=null;$frontend=null;if(class_exists('Elementor\\Core\\Frontend\\Performance')){$fp=new ReflectionProperty('Elementor\\Core\\Frontend\\Performance','is_frontend');$fp->setAccessible(true);$frontend=$fp->getValue();$fp->setValue(null,false);}
      try{$plugin->breakpoints->set_responsive_control_duplication_mode('off');$plugin->controls_manager->clear_stack_cache();$doc->set_is_built_with_elementor(true);if(!$doc->save(['elements'=>$elements,'settings'=>$settings]))throw new RuntimeException('popup_save_unknown');}
      finally{$plugin->breakpoints->set_responsive_control_duplication_mode($mode);if($fp)$fp->setValue(null,$frontend);$plugin->controls_manager->clear_stack_cache();}
      if(in_array($action,['preview','activate'],true)){if(!current_user_can('publish_pages'))throw new RuntimeException('popup_publish_permission');$r=wp_update_post(['ID'=>$id,'post_status'=>'publish'],true);if(is_wp_error($r))throw new RuntimeException('popup_publish_unknown');}
      delete_post_meta($id,'_elementor_element_cache');if(class_exists('Elementor\\Core\\Files\\CSS\\Post'))(new Elementor\Core\Files\CSS\Post($id))->update();
      $after=$read('popup');if($digest($after['elements'])!==$digest($elements))throw new RuntimeException('popup_native_readback');$checkDoc=$plugin->documents->get($id,false);foreach($settings as $k=>$v)if($digest($after['settings'][$k]??null)!==$digest($v)&&$digest($checkDoc->get_settings($k))!==$digest($v))throw new RuntimeException('popup_setting_readback');
      $result=['id'=>$id,'status'=>$after['status']];
    }
    $record['receipts'][$op]=['action'=>$action,'state'=>'complete','payloadHash'=>$digest($payload),'result'=>$result];update_option($key,$record,false);$after=$snapshot();return ['ok'=>true,'value'=>['snapshot'=>$after,'hash'=>$digest($after),'result'=>$result]];
  }finally{if(get_option($lock)===$op)delete_option($lock);}
}catch(\Throwable $error){$message=$error->getMessage();return ['ok'=>false,'code'=>preg_match('/^popup_[a-z0-9_]{1,100}$/D',$message)?$message:'popup_server_failed'];}
