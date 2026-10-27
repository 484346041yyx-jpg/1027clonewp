// Fixed capability: inspect/synchronize autosaves of exactly one task-owned page.
// Never use update_post_meta on a revision: WordPress redirects it to its parent.
try {
  global $wpdb;
  $scope=$input['scope'];$id=(int)$scope['pageId'];$run=$scope['runId'];$expected=$input['expected'];$previous=$input['previous']??[];
  $p=get_post($id);if(!$p||$p->post_type!=='page'||!in_array($p->post_status,['draft','publish'],true)||get_post_meta($id,'_clonewp_run_id',true)!==$run||!current_user_can('edit_post',$id))throw new RuntimeException('editor_completion_unowned_page');
  if(!function_exists('wp_check_post_lock'))require_once ABSPATH.'wp-admin/includes/post.php';
  $editing=wp_check_post_lock($id);if($editing&&(int)$editing!==get_current_user_id())throw new RuntimeException('editor_completion_foreign_editor_lock');
  $norm=function($v)use(&$norm){if(is_object($v))$v=get_object_vars($v);if(!is_array($v))return $v;if(!array_is_list($v))ksort($v,SORT_STRING);foreach($v as $k=>$x)$v[$k]=$norm($x);return $v;};
  $same=static fn($a,$b)=>serialize($norm($a))===serialize($norm($b));$hash=static fn($v)=>hash('sha256',serialize($norm($v)));
  $read=static function($pid){$e=get_post_meta($pid,'_elementor_data',true);return ['elements'=>is_string($e)?json_decode($e,true,512,JSON_THROW_ON_ERROR):$e,'settings'=>get_post_meta($pid,'_elementor_page_settings',true)?:[]];};
  $plugin=\Elementor\Plugin::$instance;
  $ref=new ReflectionProperty('Elementor\Core\Frontend\Performance','is_frontend');$ref->setAccessible(true);$was=$ref->getValue();$ref->setValue(null,false);
  $mode=$plugin->breakpoints->get_responsive_control_duplication_mode();$plugin->breakpoints->set_responsive_control_duplication_mode('on');$plugin->controls_manager->clear_stack_cache();
  try {
    $doc=$plugin->documents->get($id,false);if(!$doc)throw new RuntimeException('editor_completion_document_missing');
    $default=static function($control)use($plugin){if(array_key_exists('default',$control))return $control['default'];$type=$plugin->controls_manager->get_control($control['type']??'');if(!$type||!method_exists($type,'get_default_value'))throw new RuntimeException('editor_completion_default_adapter_missing');return $type->get_default_value();};
    // Only defaults from the actually registered native control may be omitted.
    $template=get_post_meta($id,'_wp_page_template',true)?:'default';
    /* native-settings-equivalence */
    $elementsEqual=function($a,$b)use(&$elementsEqual,$plugin,$same,$settingsEqual){if(!is_array($a)||!is_array($b)||count($a)!==count($b))return false;foreach($a as $i=>$n){$m=$b[$i]??null;if(!is_array($m))return false;$x=$n;$y=$m;unset($x['settings'],$x['elements'],$y['settings'],$y['elements']);if(!$same($x,$y))return false;$instance=$plugin->elements_manager->create_element_instance($n);if(!$instance||!$settingsEqual($n['settings']??[],$m['settings']??[],$instance)||!$elementsEqual($n['elements']??[],$m['elements']??[]))return false;}return true;};
    $matches=static fn($a,$b)=>$elementsEqual($a['elements'],$b['elements'])&&$settingsEqual($a['settings'],$b['settings'],$doc);
    $mainValue=static function()use($id,$read){$p=get_post($id);return [$p->post_title,$p->post_content,$p->post_excerpt,$p->post_status,$p->post_name,$read($id),get_post_meta($id,'_wp_page_template',true),get_post_meta($id,'_woodmart_whb_header',true),get_post_meta($id,'_clonewp_run_id',true)];};
    $snapshot=static function()use($id,$run,$expected,$previous,$read,$hash,$matches,$mainValue,$wpdb){
      $main=$read($id);$rows=$wpdb->get_col($wpdb->prepare("SELECT ID FROM {$wpdb->posts} WHERE post_parent=%d AND post_type='revision' AND post_name LIKE %s ORDER BY ID LIMIT 101",$id,$wpdb->esc_like($id.'-autosave').'%'));
      if(count($rows)>100)throw new RuntimeException('editor_completion_autosave_limit');$autos=[];
      foreach($rows as $aid){$r=get_post($aid);if(!wp_is_post_autosave($r)||(int)$r->post_parent!==$id)throw new RuntimeException('editor_completion_autosave_parent');$v=$read($aid);$state='conflict';if((int)$r->post_author!==get_current_user_id())$state='foreign';elseif($matches($v,$expected))$state='current';else foreach($previous as $old)if($matches($v,$old)){$state='known-stale';break;}$autos[]=['id'=>(int)$aid,'parent'=>$id,'hash'=>$hash([$r->post_title,$r->post_content,$r->post_excerpt,$r->post_modified_gmt,$v]),'state'=>$state];}
      return ['pageId'=>$id,'runId'=>$run,'mainHash'=>$hash($mainValue()),'approvedMatches'=>$matches($main,$expected),'autosaves'=>$autos];
    };
    $before=$snapshot();if(($input['action']??'inspect')==='inspect')return ['ok'=>true,'value'=>$before];
    if(($input['action']??'')!=='align'||!$same($before,$input['before'])||!$before['approvedMatches'])throw new RuntimeException('editor_completion_compare_and_swap');
    foreach($before['autosaves'] as $a)if(!in_array($a['state'],['current','known-stale'],true))throw new RuntimeException('editor_completion_autosave_conflict');
    $lock='_clonewp_editor_completion_lock';$token=$input['operationId'];if(!is_string($token)||!preg_match('/^[a-zA-Z0-9-]{1,100}$/',$token)||!add_post_meta($id,$lock,$token,true))throw new RuntimeException('editor_completion_page_lock');
    try {
      if(!$same($before,$snapshot()))throw new RuntimeException('editor_completion_compare_and_swap');
      $rawData=get_post_meta($id,'_elementor_data',true);$rawSettings=get_post_meta($id,'_elementor_page_settings',true);
      foreach($before['autosaves'] as $a)if($a['state']==='known-stale'){
        $aid=$a['id'];$r=get_post($aid);if(!$r||(int)$r->post_parent!==$id||(int)$r->post_author!==get_current_user_id()||!wp_is_post_autosave($r))throw new RuntimeException('editor_completion_autosave_parent');
        update_metadata('post',$aid,'_elementor_data',wp_slash($rawData));
        update_metadata('post',$aid,'_elementor_page_settings',wp_slash($rawSettings));
      }
      $after=$snapshot();if($after['mainHash']!==$before['mainHash']||!$after['approvedMatches'])throw new RuntimeException('editor_completion_parent_changed');foreach($after['autosaves'] as $a)if($a['state']!=='current')throw new RuntimeException('editor_completion_alignment_unconfirmed');
      return ['ok'=>true,'value'=>$after];
    }finally{if(get_post_meta($id,$lock,true)===$token)delete_post_meta($id,$lock,$token);}
  }finally{$ref->setValue(null,$was);$plugin->breakpoints->set_responsive_control_duplication_mode($mode);$plugin->controls_manager->clear_stack_cache();}
}catch(\Throwable $e){$code=$e->getMessage();return ['ok'=>false,'code'=>preg_match('/^editor_completion_[a-z_]+$/',$code)?$code:'editor_completion_server_failed'];}
