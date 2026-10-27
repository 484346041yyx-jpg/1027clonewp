// Fixed Full Width page adapter. The injected headerRead is trusted local code.
// Only the exact new module/page is mutable; shared state is read and compared.
try {
  if(!current_user_can('edit_pages')||!current_user_can('edit_theme_options'))throw new RuntimeException('full_permission');

  $nativeProduct=isset($input['currentRecord']);$postType=$nativeProduct?'woodmart_layout':'page';
  if($nativeProduct&&(!post_type_exists('woodmart_layout')||!class_exists('XTS\\Modules\\Layouts\\Single_Product')||($input['currentRecord']['recordType']??null)!=='product'))throw new RuntimeException('native_product_template_provider_missing');
  $identity=$input['identity'];$run=$identity['owner']['runId'];$hid=$identity['headerId'];$origin=untrailingslashit(home_url('/'));
  if($identity['targetOrigin']!==$origin)throw new RuntimeException('full_origin');
  $option='clonewp_header_module_'.hash('sha256',$origin.'|'.$identity['moduleKey']);$ownerToken=hash('sha256',serialize($identity));
  $digest=static fn($value)=>hash('sha256',serialize($value));
  // Document values are semantic maps; Elementor may reorder associative keys.
  // Keep the independent snapshot/CAS digest above byte/order sensitive.
  $documentNormalize=function($value)use(&$documentNormalize){if(is_object($value))$value=get_object_vars($value);if(!is_array($value))return $value;$list=array_is_list($value);if(!$list)ksort($value,SORT_STRING);foreach($value as $key=>$child)$value[$key]=$documentNormalize($child);return $value;};
  $documentDigest=static fn($value)=>hash('sha256',serialize($documentNormalize($value)));
  $inspect=static function()use($headerRead,$identity,$option,$run,$ownerToken,$digest,$nativeProduct,$postType){
    $header=$headerRead(['identity'=>$identity,'action'=>'inspect','mediaIds'=>[]]);if(empty($header['ok']))throw new RuntimeException('full_header_inspect_'.preg_replace('/[^a-z0-9_]/','',strtolower((string)($header['code']??'unknown'))));$header=$header['value'];
    if($header['snapshot']['defaultHeaderId']===$identity['headerId']||$header['snapshot']['presetReferences']||$header['snapshot']['otherReferences'])throw new RuntimeException('full_isolation');
    $record=get_option($option,null);$page=null;$pages=$record['pages']??[];
    if(count($pages)>1)throw new RuntimeException('full_multiple_pages');
    if($pages){$id=(int)$pages[0];if($nativeProduct)foreach((array)get_option('wd_layouts_conditions',[]) as $layouts)if(!empty($layouts[$id]))throw new RuntimeException('native_product_template_has_display_conditions');$p=get_post($id);if(!$p||$p->post_type!==$postType||($nativeProduct&&get_post_meta($id,'wd_layout_type',true)!=='single_product')||get_post_meta($id,'_clonewp_run_id',true)!==$run||get_post_meta($id,'_clonewp_header_module_owner',true)!==$ownerToken||!current_user_can('edit_post',$id))throw new RuntimeException('full_page_owner');
      $hadPost=array_key_exists('post',$GLOBALS);$previousPost=$GLOBALS['post']??null;$GLOBALS['post']=$p;
      try{
      // Always bypass the post-save document cache. Empty-CSS documents retain
      // the frontend context used by the existing native body reader. Only a
      // CSS-bearing document needs editor controls without responsive copies.
      $storedSettings=get_post_meta($id,'_elementor_page_settings',true);
      $editorContext=is_array($storedSettings)&&is_string($storedSettings['custom_css']??null)&&$storedSettings['custom_css']!=='';
        $plugin=\Elementor\Plugin::$instance;$responsiveMode=$plugin->breakpoints->get_responsive_control_duplication_mode();
        $frontendProperty=new ReflectionProperty('Elementor\Core\Frontend\Performance','is_frontend');$frontendProperty->setAccessible(true);$frontendMode=$frontendProperty->getValue();
        if($editorContext){$frontendProperty->setValue(null,false);$plugin->breakpoints->set_responsive_control_duplication_mode('off');$plugin->controls_manager->clear_stack_cache();}
        try{$freshMethod=new ReflectionMethod($plugin->documents,'get');if($freshMethod->getNumberOfParameters()<2)throw new RuntimeException('full_document_fresh_api');$doc=$plugin->documents->get($id,false);if(!$doc)throw new RuntimeException('full_document_missing');$elements=$doc->get_elements_data();$settings=$doc->get_settings();}
        finally{if($editorContext){$frontendProperty->setValue(null,$frontendMode);$plugin->breakpoints->set_responsive_control_duplication_mode($responsiveMode);$plugin->controls_manager->clear_stack_cache();}}
      }finally{if($hadPost)$GLOBALS['post']=$previousPost;else unset($GLOBALS['post']);}
      $pageObservations=(array)$header['snapshot']['module']['pages'];
      $page=['pageId'=>$id,'runId'=>$run,'status'=>$p->post_status,'template'=>(string)get_post_meta($id,'_wp_page_template',true),'title'=>$p->post_title,'slug'=>$p->post_name,'headerId'=>get_post_meta($id,'_woodmart_whb_header',true)?:null,'elements'=>$elements,'settings'=>$settings,'bodyHash'=>$pageObservations[(string)$id]['bodyHash'],'built'=>(bool)$doc->is_built_with_elementor(),'publicUrl'=>get_permalink($id),'flags'=>['_woodmart_prefooter_off'=>get_post_meta($id,'_woodmart_prefooter_off',true),'_woodmart_footer_off'=>get_post_meta($id,'_woodmart_footer_off',true),'_woodmart_copyrights_off'=>get_post_meta($id,'_woodmart_copyrights_off',true)]];
    }
    $snapshot=['header'=>$header,'page'=>$page,'receipts'=>(object)($record['fullReceipts']??[])];$snapshot['hash']=$digest($snapshot);return $snapshot;
  };
  if(($input['action']??'')==='inspect')return ['ok'=>true,'value'=>$inspect()];
  $action=$input['action']??'';$operation=$input['operationId']??'';$payload=$input['payload']??[];$payloadHash=$input['payloadHash']??'';
  if(!in_array($action,['create-page','style','shell','motion','layout','navigation-forms','navigation-return','confirm-navigation-forms','publish'],true)||!preg_match('/^[A-Za-z0-9_-]{1,100}$/',$operation)||!preg_match('/^[a-f0-9]{64}$/',$payloadHash))throw new RuntimeException('full_operation');
  $lock='clonewp_header_module_lock_'.hash('sha256',$hid);$lockValue=['operationId'=>$operation,'owner'=>$ownerToken];if(!add_option($lock,$lockValue,'','no'))throw new RuntimeException('full_locked');
  try{
    $before=$inspect();$record=get_option($option,null);
    if($action==='confirm-navigation-forms'){
      $keys=array_keys($payload);sort($keys);if($keys!==['before','forms','originalOperationId','originalPayloadHash','pageId','sourceUrl','taskId']||$before['hash']!==($input['expectedHash']??'')||!is_array($record)||($record['identity']??null)!==$identity)throw new RuntimeException('full_navigation_receipt_precondition');
      $original=$payload['originalOperationId'];$originalHash=$payload['originalPayloadHash'];$p=$before['page'];$prior=$payload['before'];
      if(!is_string($original)||!preg_match('/^[A-Za-z0-9_-]{1,100}$/',$original)||!is_string($originalHash)||!preg_match('/^[a-f0-9]{64}$/',$originalHash)||!$p||$p['pageId']!==$payload['pageId']||$p['status']!=='draft'||$p['headerId']!==null||$p['template']!=='elementor_header_footer'||!is_array($prior)||!is_array($prior['page']??null)||!is_array($prior['header']??null)||!is_array($prior['receipts']??null))throw new RuntimeException('full_navigation_receipt_precondition');
      if(!function_exists('wp_check_post_lock'))require_once ABSPATH.'wp-admin/includes/post.php';if(wp_check_post_lock($p['pageId']))throw new RuntimeException('full_edit_lock');
      $receipt=$record['fullReceipts'][$original]??null;if(!is_array($receipt)||($receipt['action']??null)!=='navigation-forms'||($receipt['state']??null)!=='started'||($receipt['payloadHash']??null)!==$originalHash||isset($receipt['result']))throw new RuntimeException('full_navigation_receipt_not_started');
      foreach($record['fullReceipts']??[] as $key=>$value)if($key!==$original&&($value['state']??null)!=='complete')throw new RuntimeException('full_reconcile_required');
      $originalPayload=['pageId'=>$p['pageId'],'sourceUrl'=>$payload['sourceUrl'],'taskId'=>$payload['taskId'],'forms'=>$payload['forms']];$canonical=json_encode($documentNormalize($originalPayload),JSON_UNESCAPED_SLASHES|JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_LINE_TERMINATORS|JSON_THROW_ON_ERROR);if(hash('sha256',$canonical)!==$originalHash)throw new RuntimeException('full_navigation_receipt_payload');
      $patch=$navigationFormPatch($prior['page']['elements']??null,$payload['forms'],$payload['sourceUrl'],$payload['taskId']);
      if($documentDigest($patch['elements'])!==$documentDigest($p['elements']))throw new RuntimeException('full_navigation_receipt_elements');
      $pageBefore=$prior['page'];$pageAfter=$p;unset($pageBefore['elements'],$pageBefore['bodyHash'],$pageAfter['elements'],$pageAfter['bodyHash']);if($documentDigest($pageBefore)!==$documentDigest($pageAfter))throw new RuntimeException('full_navigation_receipt_page');
      if($documentDigest($prior['header']['contract']??null)!==$documentDigest($before['header']['contract'])||$documentDigest($prior['header']['resources']??null)!==$documentDigest($before['header']['resources']))throw new RuntimeException('full_navigation_receipt_header');
      $a=$prior['header']['snapshot']??null;$b=$before['header']['snapshot'];$pageKey=(string)$p['pageId'];if(!is_array($a))throw new RuntimeException('full_navigation_receipt_header');
      // Native inspection exposes pages as stdClass; normalize only these local comparison copies.
      $a['module']['pages']=(array)($a['module']['pages']??[]);$b['module']['pages']=(array)($b['module']['pages']??[]);
      if(!isset($a['module']['pages'][$pageKey])||!isset($b['module']['pages'][$pageKey])||($a['globalHash']??null)!==$b['globalHash'])throw new RuntimeException('full_navigation_receipt_header');
      $a['module']['pages'][$pageKey]['bodyHash']=$b['module']['pages'][$pageKey]['bodyHash'];$a['module']['pages'][$pageKey]['snapshotHash']=$b['module']['pages'][$pageKey]['snapshotHash'];if($documentDigest($a)!==$documentDigest($b))throw new RuntimeException('full_navigation_receipt_header');
      $otherReceipts=(array)$before['receipts'];unset($otherReceipts[$original]);if(array_key_exists($original,$prior['receipts'])||$documentDigest($otherReceipts)!==$documentDigest($prior['receipts']))throw new RuntimeException('full_navigation_receipt_boundary');
      $result=['pageId'=>$p['pageId'],'widgetIds'=>$patch['widgetIds']];$record['fullReceipts'][$original]=['action'=>'navigation-forms','payloadHash'=>$originalHash,'state'=>'complete','result'=>$result];update_option($option,$record,false);
      $after=$inspect();$confirmed=(array)$after['receipts'];$confirmedReceipt=$confirmed[$original]??null;unset($confirmed[$original]);if(($confirmedReceipt['state']??null)!=='complete'||($confirmedReceipt['payloadHash']??null)!==$originalHash||$digest($confirmedReceipt['result']??null)!==$digest($result)||$digest($after['header'])!==$digest($before['header'])||$digest($after['page'])!==$digest($before['page'])||$documentDigest($confirmed)!==$documentDigest($otherReceipts))throw new RuntimeException('full_navigation_receipt_readback');
      return ['ok'=>true,'value'=>['snapshot'=>$after,'result'=>$result,'originalOperationId'=>$original]];
    }
    $prior=$record['fullReceipts'][$operation]??null;
    if($prior){if($prior['action']!==$action||$prior['payloadHash']!==$payloadHash||$prior['state']!=='complete')throw new RuntimeException('full_operation_unconfirmed');return ['ok'=>true,'value'=>['snapshot'=>$before,'result'=>$prior['result']]];}
    foreach($record['fullReceipts']??[] as $receipt)if($receipt['state']!=='complete')throw new RuntimeException('full_reconcile_required');
    if($before['hash']!==($input['expectedHash']??''))throw new RuntimeException('full_snapshot_changed');
    if($record!==null&&$record['identity']!==$identity)throw new RuntimeException('full_owner_changed');
    $p=$before['page'];if($action!=='create-page'){
      if(!$p||$p['pageId']!==($payload['pageId']??null)||$p['status']!=='draft'||$p['template']!=='elementor_header_footer')throw new RuntimeException('full_owned_draft');
      if(!function_exists('wp_check_post_lock'))require_once ABSPATH.'wp-admin/includes/post.php';if(wp_check_post_lock($p['pageId']))throw new RuntimeException('full_edit_lock');
    }
    if($action==='create-page'){
      if($p||!preg_match('/^[a-z0-9][a-z0-9-]{0,119}$/',$payload['slug']??'')||!is_string($payload['title']??null)||trim($payload['title'])==='')throw new RuntimeException('full_page_occupied');$nativeSlug=wp_unique_post_slug(sanitize_title($payload['slug']),0,'publish',$postType,0);
      if(isset($payload['menuContent'])){if($payload['menuContent']!==true)throw new RuntimeException('full_menu_content_input');$contract=$headerRead(['identity'=>$identity,'action'=>'inspect-menu-content']);if(empty($contract['ok']))throw new RuntimeException('full_menu_content_contract');}
      if(get_posts(['post_type'=>$postType,'post_status'=>'any','fields'=>'ids','numberposts'=>1,'meta_key'=>'_clonewp_run_id','meta_value'=>$run]))throw new RuntimeException('full_run_occupied');
    }elseif($action==='style'){
      if(!is_string($payload['css']??null)||strlen($payload['css'])>1048576||str_contains($payload['css'],'<')||str_contains($payload['css'],"\0")||!$p['built'])throw new RuntimeException('full_style');
    }elseif($action==='motion'){
      if(array_keys($payload)!==['pageId']||!$p['built'])throw new RuntimeException('full_motion_payload');
      $widget=\Elementor\Plugin::$instance->widgets_manager->get_widget_types('nested-carousel');$control=$widget?$widget->get_controls('speed'):null;
      if(!is_array($control)||($control['type']??'')!=='number'||empty($control['frontend_available'])||isset($control['min'])&&$control['min']>0)throw new RuntimeException('full_motion_control');
      $motionIds=[];$patchMotion=function($nodes)use(&$patchMotion,&$motionIds){foreach($nodes as &$node){if(($node['elType']??'')==='widget'&&($node['widgetType']??'')==='nested-carousel'){if(!is_string($node['id']??null)||!is_array($node['settings']??null))throw new RuntimeException('full_motion_node');$motionIds[]=$node['id'];$node['settings']['speed']=0;}if(!empty($node['elements']))$node['elements']=$patchMotion($node['elements']);}unset($node);return $nodes;};$motionElements=$patchMotion($p['elements']);if(!$motionIds||count($motionIds)>30)throw new RuntimeException('full_motion_count');
    }elseif($action==='layout'){
      $keys=array_keys($payload);sort($keys);if($keys!==['pageId','plan']||!$p['built']||$p['headerId']!==$hid)throw new RuntimeException('full_layout_payload');
      $container=\Elementor\Plugin::$instance->elements_manager->get_element_types('container');$registered=$container?$container->get_controls():null;if(!is_array($registered))throw new RuntimeException('full_layout_registry');
      foreach($payload['plan']['operations']??[] as $change)foreach(array_keys($change['controls']??[]) as $control){
        if(isset($registered[$control]))continue;
        if(preg_match('/^(.+)_(tablet|mobile)$/D',$control,$match)&&isset($registered[$match[1]])&&array_key_exists('responsive',$registered[$match[1]]))continue;
        throw new RuntimeException('full_layout_unregistered_control');
      }
      $layoutElements=$containerTreePatch($p['elements'],$payload['plan']);
    }elseif($action==='navigation-forms'){
      $keys=array_keys($payload);sort($keys);if($keys!==['forms','pageId','sourceUrl','taskId']||!$p['built']||$p['headerId']!==null)throw new RuntimeException('full_navigation_form_payload');
      $widget=\Elementor\Plugin::$instance->widgets_manager->get_widget_types('html');$control=$widget?$widget->get_controls('html'):null;
      if(!is_array($control)||($control['type']??'')!=='code')throw new RuntimeException('full_navigation_form_control');
      $navigationPatch=$navigationFormPatch($p['elements'],$payload['forms'],$payload['sourceUrl'],$payload['taskId']);
    }elseif($action==='navigation-return'){
      $keys=array_keys($payload);sort($keys);if($keys!==['forms','pageId','sourceUrl','taskId']||!$p['built']||$p['headerId']!==null&&$p['headerId']!==$hid)throw new RuntimeException('full_navigation_return_payload');
      $widget=\Elementor\Plugin::$instance->widgets_manager->get_widget_types('html');$control=$widget?$widget->get_controls('html'):null;if(!is_array($control)||($control['type']??'')!=='code')throw new RuntimeException('full_navigation_return_control');
      $navigationReturn=$navigationReturnPatch($p['elements'],$payload['forms'],$payload['sourceUrl'],$payload['taskId']);if(!$navigationReturn['changedWidgetIds'])throw new RuntimeException('full_navigation_return_already_applied');
    }elseif($action==='shell'){
      if(array_keys($payload)!==['pageId'])throw new RuntimeException('full_shell_payload');
    }elseif($action==='publish'){
      if($p['headerId']!==$hid||!$p['built']||!preg_match('/^[a-f0-9]{64}$/',$payload['reviewHash']??''))throw new RuntimeException('full_publish_precondition');
    }
    if($record===null){$record=['identity'=>$identity,'name'=>$payload['headerName'],'menus'=>[],'styleId'=>null,'pages'=>[],'receipts'=>[]];if(($payload['menuContent']??false)===true)$record['menuContent']=[];if(!add_option($option,$record,'','no'))throw new RuntimeException('full_reserve_conflict');}
    $record['fullReceipts'][$operation]=['action'=>$action,'payloadHash'=>$payloadHash,'state'=>'started'];update_option($option,$record,false);
    $beforeGlobal=$before['header']['snapshot']['globalHash'];$result=[];
    if($action==='create-page'){
      $id=wp_insert_post(['post_type'=>$postType,'post_status'=>'draft','post_title'=>$payload['title'],'post_name'=>$nativeSlug,'post_content'=>'','meta_input'=>['_clonewp_run_id'=>$run,'_clonewp_header_module_owner'=>$ownerToken,'_wp_page_template'=>'elementor_header_footer','_woodmart_title_off'=>'1','_woodmart_main_layout'=>'full-width','_woodmart_prefooter_off'=>'1','_woodmart_footer_off'=>'1','_woodmart_copyrights_off'=>'1','rank_math_robots'=>['noindex','nofollow']]],true);if(is_wp_error($id))throw new RuntimeException('full_page_create');
      if($nativeProduct)update_post_meta($id,'wd_layout_type','single_product');
      $record['pages'][]=(int)$id;update_option($option,$record,false);
      $doc=\Elementor\Plugin::$instance->documents->get($id);if(!$doc)throw new RuntimeException('full_document_create');$doc->set_is_built_with_elementor(true);
      if(!$doc->save(['elements'=>[],'settings'=>['template'=>'elementor_header_footer','hide_title'=>'yes']]))throw new RuntimeException('full_empty_save');update_post_meta($id,'_wp_page_template','elementor_header_footer');
      $result=['pageId'=>(int)$id];
    }elseif(in_array($action,['style','motion','layout','navigation-forms','navigation-return'],true)){
      $id=$p['pageId'];$hadPost=array_key_exists('post',$GLOBALS);$previousPost=$GLOBALS['post']??null;$GLOBALS['post']=get_post($id);
      $settings=$p['settings'];if($action==='style'){$settings['custom_css']=$payload['css'];$settings['wd__woodmart_whb_header']=$hid;}if(!in_array($action,['navigation-forms','navigation-return','layout'],true)){$settings['hide_title']='yes';$settings['template']='elementor_header_footer';}$targetElements=$action==='motion'?$motionElements:($action==='layout'?$layoutElements:($action==='navigation-forms'?$navigationPatch['elements']:($action==='navigation-return'?$navigationReturn['elements']:$p['elements'])));
      $reflection=new ReflectionProperty('Elementor\Core\Frontend\Performance','is_frontend');$reflection->setAccessible(true);$old=$reflection->getValue();$reflection->setValue(null,false);\Elementor\Plugin::$instance->controls_manager->clear_stack_cache();
      try{ $doc=\Elementor\Plugin::$instance->documents->get($id,false);$stack=$doc->get_stack();$controls=array_merge($stack['controls']??[],$stack['style_controls']??[]);if(($controls['custom_css']['type']??'')!=='code')throw new RuntimeException('full_css_control');
        // CSS-only changes use the native settings save without rendering every
        // product tree again; all other actions retain their exact element save.
        $saveInput=$action==='style'?['settings'=>$settings]:['elements'=>$targetElements,'settings'=>$settings];
        if(!$doc->save($saveInput))throw new RuntimeException('full_css_save');
        // Document.save persists settings but the instance's parsed settings can
        // remain cached. Elementor Pro's CSS hook reads the manager's document.
        $doc=\Elementor\Plugin::$instance->documents->get($id,false);
        if(!$doc||($doc->get_settings('custom_css')??'')!==($settings['custom_css']??''))throw new RuntimeException('full_css_fresh_document');
        if(class_exists('\Elementor\Core\Files\CSS\Post'))(new \Elementor\Core\Files\CSS\Post($id))->update();
      }finally{$reflection->setValue(null,$old);\Elementor\Plugin::$instance->controls_manager->clear_stack_cache();if($hadPost)$GLOBALS['post']=$previousPost;else unset($GLOBALS['post']);}
      $check=$inspect();if(($check['page']['settings']['custom_css']??'')!==($settings['custom_css']??'')||$documentDigest($check['page']['elements'])!==$documentDigest($targetElements))throw new RuntimeException('full_css_readback');if($action==='style'&&(($check['page']['settings']['wd__woodmart_whb_header']??null)!==$hid||!function_exists('woodmart_get_post_meta_value')||woodmart_get_post_meta_value($id,'_woodmart_whb_header')!==$hid))throw new RuntimeException('full_header_setting_readback');if(in_array($action,['motion','layout','navigation-forms','navigation-return'],true)&&$documentDigest($check['page']['settings'])!==$documentDigest($p['settings']))throw new RuntimeException('full_motion_settings_changed');$result=$action==='motion'?['pageId'=>$id,'widgetIds'=>$motionIds]:($action==='navigation-forms'?['pageId'=>$id,'widgetIds'=>$navigationPatch['widgetIds']]:($action==='navigation-return'?['pageId'=>$id,'widgetIds'=>$navigationReturn['widgetIds']]:['pageId'=>$id]));
    }elseif($action==='shell'){
      $id=$p['pageId'];update_post_meta($id,'_woodmart_title_off','1');update_post_meta($id,'_woodmart_main_layout','full-width');
      $check=$inspect();if($check['page']['bodyHash']!==$p['bodyHash']||get_post_meta($id,'_woodmart_title_off',true)!=='1'||get_post_meta($id,'_woodmart_main_layout',true)!=='full-width')throw new RuntimeException('full_shell_readback');$result=['pageId'=>$id,'titleDisabled'=>true,'sidebarDisabled'=>true];
    }elseif($action==='publish'){
      $id=$p['pageId'];$updated=wp_update_post(['ID'=>$id,'post_status'=>'publish'],true);if(is_wp_error($updated))throw new RuntimeException('full_publish');$result=['pageId'=>$id,'publicUrl'=>get_permalink($id)];
    }
    $after=$inspect();if($after['header']['snapshot']['globalHash']!==$beforeGlobal)throw new RuntimeException('full_protected_changed');
    if($action!=='create-page'&&($after['page']['template']!=='elementor_header_footer'||$after['page']['flags']!==$p['flags']||$after['page']['headerId']!==$p['headerId']))throw new RuntimeException('full_page_boundary_changed');
    $record=get_option($option);$record['fullReceipts'][$operation]=['action'=>$action,'payloadHash'=>$payloadHash,'state'=>'complete','result'=>$result];update_option($option,$record,false);
    return ['ok'=>true,'value'=>['snapshot'=>$inspect(),'result'=>$result]];
  }finally{if(get_option($lock)===$lockValue)delete_option($lock);}
}catch(\Throwable $error){$message=$error->getMessage();return ['ok'=>false,'code'=>preg_match('/^full_[a-z0-9_]{1,100}$/',$message)?$message:'full_server_failed'];}
