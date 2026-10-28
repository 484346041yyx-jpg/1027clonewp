try {
  if(!current_user_can('edit_pages')||!current_user_can('edit_theme_options')||get_template()!=='woodmart')throw new RuntimeException('reuse_permission');
  $origin=untrailingslashit(home_url('/'));$hid=$input['headerId'];
  if(isset($input['pageScope'])&&$input['pageScope']!=='body-only')throw new RuntimeException('reuse_page_scope');
  $bodyOnly=($input['pageScope']??null)==='body-only';$footerOff=$bodyOnly?'':'1';
  if($origin!==$input['targetOrigin']||!preg_match('/^header_[1-9][0-9]{0,17}$/D',$hid))throw new RuntimeException('reuse_identity');
  $normalize=static function($value)use(&$normalize){if(is_object($value))$value=get_object_vars($value);if(!is_array($value))return $value;$list=array_is_list($value);foreach($value as $key=>$child)$value[$key]=$normalize($child);if(!$list)ksort($value,SORT_STRING);return $value;};
  $digest=static fn($value)=>hash('sha256',json_encode($normalize($value),JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES));
  $resources=static function()use($hid,$origin,$digest,$input,$bodyOnly){
    $raw=get_option('whb_'.$hid);$decoded=is_string($raw)?json_decode($raw,true):$raw;if(!is_array($decoded)||($decoded['id']??null)!==$hid||!is_string($decoded['name']??null))throw new RuntimeException('reuse_header_missing');
    $menus=[];$blocks=[];$hasSubmenus=false;
    $walk=null;$addBlock=static function($id)use(&$blocks,&$walk,$origin){$id=(int)$id;if(isset($blocks[(string)$id]))return;if(count($blocks)>=100)throw new RuntimeException('reuse_block_limit');$block=get_post($id);if(!$block||$block->post_type!=='cms_block')throw new RuntimeException('reuse_block_missing');$meta=get_post_meta($block->ID);$blocks[(string)$block->ID]=['id'=>(int)$block->ID,'name'=>$block->post_title,'editUrl'=>$origin.'/wp-admin/post.php?post='.$block->ID.'&action=edit','proof'=>[$block,$meta]];if($walk){$walk($block->post_content);$walk($meta);}};
    $walk=static function($node)use(&$walk,$addBlock,&$menus,&$hasSubmenus,$origin){if(is_string($node)){if(preg_match_all('~\[(?:html_block|woodmart_html_block)\b[^\]]*\bid=["\x27]?([0-9]+)~i',$node,$matches))foreach($matches[1] as $id)$addBlock($id);return;}if(!is_array($node))return;foreach($node['params']??[] as $key=>$param){$value=$param['value']??null;if($key==='menu_id'&&$value){$menu=wp_get_nav_menu_object($value);if(!$menu)throw new RuntimeException('reuse_menu_missing');$items=wp_get_nav_menu_items($menu->term_id,['post_status'=>'any'])?:[];$data=[];foreach($items as $item){$data[]=[$item,get_post_meta($item->ID)];$blockId=(int)get_post_meta($item->ID,'_menu_item_block',true);if($blockId)$addBlock($blockId);if((int)$item->menu_item_parent>0)$hasSubmenus=true;}$menus[(string)$menu->term_id]=['id'=>(int)$menu->term_id,'name'=>$menu->name,'editUrl'=>$origin.'/wp-admin/nav-menus.php?menu='.$menu->term_id,'key'=>'menu_'.$menu->term_id,'proof'=>[$menu,$data]];}if(($key==='block_id'||$key==='search_extra_content'&&strtolower((string)($node['type']??''))==='search')&&$value)$addBlock($value);}foreach($node as $child)$walk($child);};$walk($decoded);ksort($menus);ksort($blocks);
    $headerHash=$digest($raw);$menuHash=$digest($menus);$styleHash=$digest($blocks);$sharedHash=$digest([$raw,$menus,$blocks,get_option('whb_main_header'),get_option('whb_saved_headers'),get_option('xts-woodmart-options'),get_option('woodmart_options'),get_option('xts-'.$hid.'-file-data'),get_option('xts-'.$hid.'-css-data')]);
    $footer=[];
    if($bodyOnly){
      $theme=get_option('xts-woodmart-options');if(!is_array($theme))throw new RuntimeException('reuse_footer_settings_missing');
      // WoodMart's footer.php selects one HTML block or footer-1..7 widgets.
      // Track that selection and its transitive dependencies, not every site layout.
      $footerOptions=[];foreach($theme as $key=>$value)if(preg_match('/^(?:disable_footer|footer(?:[-_]|$)|sticky_footer|collapse_footer_widgets|disable_copyrights|copyrights(?:[-_]|$)|prefooter(?:[-_]|$))/i',(string)$key))$footerOptions[$key]=$value;
      $stablePost=static fn($post)=>[(int)$post->ID,$post->post_type,$post->post_status,$post->post_title,$post->post_name,(int)$post->post_parent,$post->post_content,$post->post_excerpt,(int)$post->menu_order,$post->post_password];
      $stableMeta=static function($meta){$out=[];foreach($meta as $key=>$value)if(!str_starts_with((string)$key,'_clonewp_')&&!in_array($key,['_edit_lock','_edit_last','_elementor_css','_elementor_element_cache','_elementor_page_assets','_elementor_migrations_state','_elementor_version','_elementor_pro_version'],true))$out[$key]=$value;return $out;};
      $footerBlocks=[];$footerMenus=[];$footerWidgets=[];$scanFooter=null;$addFooterBlock=null;
      $addFooterMenu=static function($id)use(&$footerMenus,&$addFooterBlock,$stablePost,$stableMeta){$menu=wp_get_nav_menu_object($id);if(!$menu)throw new RuntimeException('reuse_footer_menu_missing');$id=(int)$menu->term_id;if(array_key_exists((string)$id,$footerMenus))return;if(count($footerMenus)>=100)throw new RuntimeException('reuse_footer_menu_limit');$footerMenus[(string)$id]=null;$items=wp_get_nav_menu_items($id,['post_status'=>'any'])?:[];$rows=[];foreach($items as $item){$rows[]=[$stablePost($item),$stableMeta(get_post_meta($item->ID))];$blockId=(int)get_post_meta($item->ID,'_menu_item_block',true);if($blockId)$addFooterBlock($blockId);}$footerMenus[(string)$id]=[[$id,$menu->name,$menu->slug],$rows];};
      $scanFooter=static function($node)use(&$scanFooter,&$addFooterBlock,$addFooterMenu){if(is_string($node)){if(preg_match_all('~\[(?:html_block|woodmart_html_block)\b[^\]]*\bid=["\x27]?([0-9]+)~i',$node,$matches))foreach($matches[1] as $id)$addFooterBlock($id);if($node!==''&&($node[0]==='['||$node[0]==='{')){$decoded=json_decode($node,true);if(is_array($decoded))$scanFooter($decoded);}return;}if(!is_array($node))return;$widget=$node['widgetType']??$node['widget_type']??'';if(in_array($widget,['wp-widget-nav_menu','nav-menu','wd_menu'],true)){ $menu=$node['settings']['menu']??$node['settings']['menu_id']??null;if(is_scalar($menu)&&(string)$menu!=='')$addFooterMenu($menu); }foreach($node as $key=>$child){if(in_array($key,['block_id','html_block_id'],true)&&is_scalar($child)&&ctype_digit((string)$child)&&(int)$child>0)$addFooterBlock($child);if(in_array($key,['menu_id','nav_menu'],true)&&is_scalar($child)&&(string)$child!=='')$addFooterMenu($child);$scanFooter($child);}};
      $addFooterBlock=static function($id)use(&$footerBlocks,&$scanFooter,$stablePost,$stableMeta){$id=(int)$id;if(isset($footerBlocks[(string)$id]))return;if(count($footerBlocks)>=100)throw new RuntimeException('reuse_footer_block_limit');$block=get_post($id);if(!$block||$block->post_type!=='cms_block')throw new RuntimeException('reuse_footer_block_missing');$footerBlocks[(string)$id]=[$stablePost($block),$stableMeta(get_post_meta($id))];$scanFooter($block->post_content);$scanFooter(get_post_meta($id,'_elementor_data',true));};
      $blockId=static function($value,$required)use($addFooterBlock){if($value===null||$value===''){if($required)throw new RuntimeException('reuse_footer_block_unselected');return;}if(!is_scalar($value)||!ctype_digit((string)$value)||(int)$value<=0)throw new RuntimeException('reuse_footer_block_invalid');$addFooterBlock($value);};
      $contentMode=$theme['footer_content_type']??'widgets';
      if($contentMode==='html_block')$blockId($theme['footer_html_block']??null,!empty($theme['disable_footer']));
      elseif($contentMode==='widgets'){
        if(!empty($theme['disable_footer'])){$sidebars=get_option('sidebars_widgets');if(!is_array($sidebars))throw new RuntimeException('reuse_footer_widgets_missing');for($index=1;$index<=7;$index++){ $sidebar='footer-'.$index;$ids=$sidebars[$sidebar]??[];if(!is_array($ids))throw new RuntimeException('reuse_footer_widgets_invalid');$rows=[];foreach($ids as $widgetId){if(!is_string($widgetId)||!preg_match('/^(.+)-([0-9]+)$/D',$widgetId,$parts))throw new RuntimeException('reuse_footer_widget_invalid');$instances=get_option('widget_'.$parts[1]);if(!is_array($instances)||!array_key_exists((int)$parts[2],$instances))throw new RuntimeException('reuse_footer_widget_missing');$instance=$instances[(int)$parts[2]];$rows[]=[$widgetId,$instance];$scanFooter($instance);if($parts[1]==='nav_menu'&&is_array($instance)&&isset($instance['nav_menu']))$addFooterMenu($instance['nav_menu']);}$footerWidgets[$sidebar]=$rows;}}
      }else throw new RuntimeException('reuse_footer_mode_unsupported');
      $prefooterMode=$theme['prefooter_content_type']??'text';
      if($prefooterMode==='html_block')$blockId($theme['prefooter_html_block']??null,false);
      elseif($prefooterMode==='text')$scanFooter($theme['prefooter_area']??'');
      else throw new RuntimeException('reuse_prefooter_mode_unsupported');
      foreach(['copyrights','copyrights2'] as $key)$scanFooter($theme[$key]??'');
      ksort($footerBlocks);ksort($footerMenus);ksort($footerWidgets);
      $footer=['footerHash'=>$digest([$footerOptions,$footerBlocks,$footerMenus,$footerWidgets])];
      $sharedHash=$digest([$sharedHash,$footer]);
    }
    foreach($menus as &$row)unset($row['proof']);unset($row);foreach($blocks as &$row)unset($row['proof']);unset($row);
    return ['headerId'=>$hid,'name'=>$decoded['name'],'editUrl'=>$origin.'/wp-admin/admin.php?page=xts_header_builder#/builder/'.$hid,'sharedHash'=>$sharedHash,'headerHash'=>$headerHash,'menuHash'=>$menuHash,'styleHash'=>$styleHash,'menus'=>array_values($menus),'blocks'=>array_values($blocks),'mobileMaxWidth'=>$input['mobileMaxWidth'],'hasSubmenus'=>$hasSubmenus]+$footer;
  };
  if($input['action']==='resources')return ['ok'=>true,'value'=>$resources()];
  $plugin=\Elementor\Plugin::$instance;$responsiveMode=$plugin->breakpoints->get_responsive_control_duplication_mode();$frontendProperty=new ReflectionProperty('Elementor\Core\Frontend\Performance','is_frontend');$frontendProperty->setAccessible(true);$frontendMode=$frontendProperty->getValue();$hadPost=array_key_exists('post',$GLOBALS);$previousPost=$GLOBALS['post']??null;
  try{

  $nativeProduct=isset($input['currentRecord']);$postType=$nativeProduct?'woodmart_layout':'page';
  if($nativeProduct&&(!post_type_exists('woodmart_layout')||!class_exists('XTS\\Modules\\Layouts\\Single_Product')||($input['currentRecord']['recordType']??null)!=='product'))throw new RuntimeException('native_product_template_provider_missing');
  $run=$input['runId'];$contract=$input['contractHash'];if(!preg_match('/^[A-Za-z0-9_-]{4,100}$/D',$run)||!preg_match('/^[a-f0-9]{64}$/D',$contract))throw new RuntimeException('reuse_task_identity');$option='clonewp_reused_body_'.hash('sha256',$origin.'|'.$run);
  $inspect=static function()use($run,$contract,$resources,$option,$digest,$plugin,$frontendProperty,$nativeProduct,$postType){
    $resource=$resources();$pages=get_posts(['post_type'=>$postType,'post_status'=>'any','fields'=>'ids','numberposts'=>2,'meta_key'=>'_clonewp_run_id','meta_value'=>$run]);if(count($pages)>1)throw new RuntimeException('reuse_ambiguous_page');$page=null;
    if($pages){
      $id=(int)$pages[0];if($nativeProduct)foreach((array)get_option('wd_layouts_conditions',[]) as $layouts)if(!empty($layouts[$id]))throw new RuntimeException('native_product_template_has_display_conditions');if(get_post_meta($id,'_clonewp_reused_header_contract',true)!==$contract||!current_user_can('edit_post',$id))throw new RuntimeException('reuse_page_owner');if($nativeProduct&&get_post_meta($id,'wd_layout_type',true)!=='single_product')throw new RuntimeException('native_product_template_owner');$post=get_post($id);$GLOBALS['post']=$post;
      $stored=get_post_meta($id,'_elementor_page_settings',true);$editorContext=is_array($stored)&&is_string($stored['custom_css']??null)&&$stored['custom_css']!=='';$priorFrontend=$frontendProperty->getValue();$priorResponsive=$plugin->breakpoints->get_responsive_control_duplication_mode();
      if($editorContext){$frontendProperty->setValue(null,false);$plugin->breakpoints->set_responsive_control_duplication_mode('off');$plugin->controls_manager->clear_stack_cache();}
      try{$doc=$plugin->documents->get($id,false);if(!$doc||!$doc->is_built_with_elementor())throw new RuntimeException('reuse_document');$elements=$doc->get_elements_data();$settings=$doc->get_settings();}
      finally{if($editorContext){$frontendProperty->setValue(null,$priorFrontend);$plugin->breakpoints->set_responsive_control_duplication_mode($priorResponsive);$plugin->controls_manager->clear_stack_cache();}}
      $bodySettings=$settings;if($post->post_status==='publish'&&($bodySettings['post_status']??null)==='publish')$bodySettings['post_status']='draft';$header=get_post_meta($id,'_woodmart_whb_header',true)?:null;$flags=[];foreach(['_woodmart_title_off','_woodmart_prefooter_off','_woodmart_footer_off','_woodmart_copyrights_off','_woodmart_main_layout'] as $key)$flags[$key]=(string)get_post_meta($id,$key,true);$page=['pageId'=>$id,'runId'=>$run,'status'=>$post->post_status,'title'=>$post->post_title,'slug'=>$post->post_name,'template'=>(string)get_post_meta($id,'_wp_page_template',true),'headerId'=>$header,'elements'=>$elements,'settings'=>$settings,'bodyHash'=>$digest([$post->post_title,$post->post_content,$post->post_excerpt,$post->post_name,$elements,$bodySettings]),'documentHash'=>$digest([$elements,$settings]),'publicUrl'=>get_permalink($id),'metaHash'=>$digest(get_post_meta($id)),'flags'=>$flags];
    }
    $value=['resources'=>$resource,'page'=>$page,'receipts'=>(object)(get_option($option,[])?:[])];$value['hash']=$digest($value);return $value;
  };
  $before=$inspect();if($input['action']==='inspect')return ['ok'=>true,'value'=>$before];
  if(!hash_equals($input['expectedHash'],$before['hash'])||$before['resources']!==$input['resources'])throw new RuntimeException('reuse_snapshot_changed');
  if($input['action']==='recover-style-before'){
    $payload=$input['payload'];$receiptId=$payload['receiptId']??'';$receipt=$before['receipts']->$receiptId??null;$page=$before['page'];
    if(!is_string($receiptId)||!preg_match('/^[a-f0-9-]{36}$/D',$receiptId)||!$page||$page['status']!=='draft'||$page['headerId']!==null||$page['bodyHash']!==($payload['bodyHash']??null)||($page['settings']['custom_css']??'')!==''||!is_array($receipt)||($receipt['action']??null)!=='style'||($receipt['state']??null)!=='started'||($receipt['payloadHash']??null)!==($payload['payloadHash']??null))throw new RuntimeException('reuse_recovery_boundary');
    foreach((array)$before['receipts'] as $key=>$row)if($key!==$receiptId&&($row['state']??null)!=='complete')throw new RuntimeException('reuse_recovery_other_pending');
    $lock='clonewp_reused_body_lock_'.hash('sha256',$run);if(!add_option($lock,$input['operationId'],'','no'))throw new RuntimeException('reuse_locked');
    try{$fresh=$inspect();if($fresh['hash']!==$before['hash'])throw new RuntimeException('reuse_snapshot_changed');$receipts=(array)$before['receipts'];unset($receipts[$receiptId]);update_option($option,$receipts,false);return ['ok'=>true,'value'=>['snapshot'=>$inspect(),'result'=>['pageId'=>$page['pageId']]]];}
    finally{if(get_option($lock)===$input['operationId'])delete_option($lock);}
  }
  if($input['action']==='recover-style-after'){
    $payload=$input['payload'];$receiptId=$payload['receiptId']??'';$receipt=$before['receipts']->$receiptId??null;$page=$before['page'];
    if(!is_string($receiptId)||!preg_match('/^[a-f0-9-]{36}$/D',$receiptId)||!$page||$page['status']!=='draft'||$page['headerId']!==$hid||$page['bodyHash']!==($payload['bodyHash']??null)||$page['documentHash']!==($payload['documentHash']??null)||hash('sha256',(string)($page['settings']['custom_css']??''))!==($payload['cssHash']??null)||!is_array($receipt)||($receipt['action']??null)!=='style'||($receipt['state']??null)!=='started'||($receipt['payloadHash']??null)!==($payload['payloadHash']??null))throw new RuntimeException('reuse_recovery_boundary');
    foreach((array)$before['receipts'] as $key=>$row)if($key!==$receiptId&&($row['state']??null)!=='complete')throw new RuntimeException('reuse_recovery_other_pending');
    $lock='clonewp_reused_body_lock_'.hash('sha256',$run);if(get_option($lock,false)===$receiptId)delete_option($lock);if(!add_option($lock,$input['operationId'],'','no'))throw new RuntimeException('reuse_locked');
    try{$fresh=$inspect();if($fresh['hash']!==$before['hash'])throw new RuntimeException('reuse_snapshot_changed');$receipts=(array)$before['receipts'];$receipts[$receiptId]=['action'=>'style','payloadHash'=>$receipt['payloadHash'],'state'=>'complete','result'=>['pageId'=>$page['pageId']]];update_option($option,$receipts,false);return ['ok'=>true,'value'=>['snapshot'=>$inspect(),'result'=>['pageId'=>$page['pageId']]]];}
    finally{if(get_option($lock)===$input['operationId'])delete_option($lock);}
  }
  $action=$input['action'];$operation=$input['operationId'];$payload=$input['payload'];if(isset($before['receipts']->$operation))throw new RuntimeException('reuse_operation_exists');
  foreach((array)$before['receipts'] as $receipt)if(!is_array($receipt)||($receipt['state']??null)!=='complete')throw new RuntimeException('reuse_reconcile_required');
  $lock='clonewp_reused_body_lock_'.hash('sha256',$run);if(!add_option($lock,$operation,'','no'))throw new RuntimeException('reuse_locked');
  try{
    $fresh=$inspect();if($fresh['hash']!==$before['hash'])throw new RuntimeException('reuse_snapshot_changed');$page=$before['page'];
    if($action==='create-page'){
      if($page||!preg_match('/^[a-z0-9][a-z0-9-]{0,119}$/D',$payload['slug'])||trim($payload['title'])==='')throw new RuntimeException('reuse_page_occupied');$nativeSlug=wp_unique_post_slug(sanitize_title($payload['slug']),0,'publish',$postType,0);
    }else{
      if(!$page||$page['pageId']!==$payload['pageId']||$page['status']!=='draft')throw new RuntimeException('reuse_owned_draft');if(!function_exists('wp_check_post_lock'))require_once ABSPATH.'wp-admin/includes/post.php';if(wp_check_post_lock($page['pageId']))throw new RuntimeException('reuse_edit_lock');
      if($action==='style'&&(!is_string($payload['css']??null)||strlen($payload['css'])>1048576||str_contains($payload['css'],'<')||str_contains($payload['css'],"\0")))throw new RuntimeException('reuse_css_invalid');
      if($action==='publish'&&!current_user_can('publish_pages'))throw new RuntimeException('reuse_publish_permission');
      if($action==='bind'&&$page['headerId']!==null||$action==='publish'&&($page['headerId']!==$hid||!(isset($input['publicationAuthorizationHash']) ? ((($run==='huaqi-about-20261023-body'||$run==='huaqi-perfume-20261024-body'||$run==='huaqi-cosmetic-20261024-body')&&$hid==='header_39589520821341414'&&$origin==='https://vapeversse.com'||$run==='huaqi-product-layout-jiangubottle-20261028'&&$hid==='header_196552'&&$origin==='https://jiangubottle.com')&&preg_match('/^[a-f0-9]{64}$/D',$input['publicationAuthorizationHash'])&&($payload['publicationAuthorizationHash']??null)===$input['publicationAuthorizationHash']) : preg_match('/^[a-f0-9]{64}$/D',$payload['reviewHash']??''))))throw new RuntimeException('reuse_binding_precondition');
    }
    $receipts=(array)$before['receipts'];$receipts[$operation]=['action'=>$action,'payloadHash'=>$digest($payload),'state'=>'started'];update_option($option,$receipts,false);
    if($action==='create-page'){
      $id=wp_insert_post(['post_type'=>$postType,'post_status'=>'draft','post_title'=>$payload['title'],'post_name'=>$nativeSlug,'post_content'=>'','meta_input'=>['_clonewp_run_id'=>$run,'_clonewp_reused_header_contract'=>$contract,'_wp_page_template'=>'elementor_header_footer','_woodmart_title_off'=>'1','_woodmart_main_layout'=>'full-width','_woodmart_prefooter_off'=>$footerOff,'_woodmart_footer_off'=>$footerOff,'_woodmart_copyrights_off'=>$footerOff,'rank_math_robots'=>['noindex','nofollow']]],true);if(is_wp_error($id))throw new RuntimeException('reuse_create_unknown');if($nativeProduct)update_post_meta($id,'wd_layout_type','single_product');$doc=\Elementor\Plugin::$instance->documents->get($id);$doc->set_is_built_with_elementor(true);if(!$doc->save(['elements'=>[],'settings'=>['template'=>'elementor_header_footer','hide_title'=>'yes']]))throw new RuntimeException('reuse_create_unknown');$result=['pageId'=>(int)$id];
    }elseif(in_array($action,['style','bind'],true)){
      $id=$page['pageId'];$frontendProperty->setValue(null,false);$plugin->breakpoints->set_responsive_control_duplication_mode('off');$plugin->controls_manager->clear_stack_cache();$doc=\Elementor\Plugin::$instance->documents->get($id,false);$settings=$page['settings'];$settings['template']='elementor_header_footer';$settings['hide_title']='yes';
      if($action==='style')$settings['custom_css']=$payload['css'];
      if(in_array($action,['style','bind'],true)){
        $stack=$doc->get_stack();$controls=array_merge($stack['controls']??[],$stack['style_controls']??[]);$switcher=\Elementor\Plugin::$instance->controls_manager->get_control('switcher');
        if(!$nativeProduct){
          foreach(['wd__woodmart_title_off','wd__woodmart_footer_off','wd__woodmart_prefooter_off','wd__woodmart_copyrights_off'] as $key){$control=$controls[$key]??null;$enabled=$control['return_value']??($switcher?$switcher->get_settings('return_value'):null);if(($control['type']??'')!=='switcher'||!is_string($enabled)||$enabled==='')throw new RuntimeException('reuse_shell_control');$settings[$key]=$bodyOnly&&$key!=='wd__woodmart_title_off'?'':$enabled;}
          if(($controls['wd__woodmart_main_layout']['type']??'')!=='select'||!array_key_exists('full-width',$controls['wd__woodmart_main_layout']['options']??[]))throw new RuntimeException('reuse_shell_layout');$settings['wd__woodmart_main_layout']='full-width';$settings['wd__woodmart_whb_header']=$hid;
        }
        if($action==='style'&&($controls['custom_css']['type']??'')!=='code')throw new RuntimeException('reuse_css_control');
      }
      $expectedElements=$page['elements'];
      if($action==='style'&&$nativeProduct)delete_post_meta($id,'_elementor_element_cache');
      if(!$doc->save(['elements'=>$expectedElements,'settings'=>$settings]))throw new RuntimeException('reuse_save_unknown');
      update_post_meta($id,'_wp_page_template','elementor_header_footer');if($action==='bind')update_post_meta($id,'_woodmart_whb_header',$hid);
      // Elementor Pro's CSS hook reads the document manager; the saved instance
      // may still hold parsed settings from before this settings-only save.
      $doc=$plugin->documents->get($id,false);
      if(!$doc||($doc->get_settings('custom_css')??'')!==($settings['custom_css']??''))throw new RuntimeException('reuse_css_fresh_document');
      if(class_exists('\Elementor\Core\Files\CSS\Post'))(new \Elementor\Core\Files\CSS\Post($id))->update();
      $check=$inspect();if($digest($check['page']['elements'])!==$digest($expectedElements)||$digest($check['page']['settings'])!==$digest($settings))throw new RuntimeException('reuse_document_readback');
      if($action==='bind'){
        $shell=['_woodmart_whb_header'=>$hid];
        if(!$nativeProduct)$shell+=['_woodmart_title_off'=>$settings['wd__woodmart_title_off'],'_woodmart_main_layout'=>'full-width','_woodmart_prefooter_off'=>$settings['wd__woodmart_prefooter_off'],'_woodmart_footer_off'=>$settings['wd__woodmart_footer_off'],'_woodmart_copyrights_off'=>$settings['wd__woodmart_copyrights_off']];
        foreach($shell as $key=>$wanted)if(!function_exists('woodmart_get_post_meta_value')||woodmart_get_post_meta_value($id,$key)!==$wanted)throw new RuntimeException('reuse_effective_shell');
      }
      $result=['pageId'=>$id];
    }elseif($action==='publish'){$id=$page['pageId'];$updated=wp_update_post(['ID'=>$id,'post_status'=>'publish'],true);if(is_wp_error($updated))throw new RuntimeException('reuse_publish_unknown');$result=['pageId'=>$id,'publicUrl'=>get_permalink($id)];}
    else throw new RuntimeException('reuse_action');
    $after=$inspect();if($after['resources']!==$before['resources'])throw new RuntimeException('reuse_shared_changed');if($action!=='create-page'&&$action!=='bind'&&$after['page']['headerId']!==$page['headerId'])throw new RuntimeException('reuse_header_changed');
    $receipts[$operation]=['action'=>$action,'payloadHash'=>$digest($payload),'state'=>'complete','result'=>$result];update_option($option,$receipts,false);return ['ok'=>true,'value'=>['snapshot'=>$inspect(),'result'=>$result]];
  }finally{if(get_option($lock)===$operation)delete_option($lock);}
  }finally{$frontendProperty->setValue(null,$frontendMode);$plugin->breakpoints->set_responsive_control_duplication_mode($responsiveMode);$plugin->controls_manager->clear_stack_cache();if($hadPost)$GLOBALS['post']=$previousPost;else unset($GLOBALS['post']);}
}catch(\Throwable $error){$message=$error->getMessage();return ['ok'=>false,'code'=>preg_match('/^reuse_[a-z0-9_]{1,100}$/D',$message)?$message:'reuse_server_failed'];}
