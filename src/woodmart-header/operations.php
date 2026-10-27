// Independent opt-in workflow. $input is decoded by the local runner, never PHP-interpolated source content.
if (!current_user_can('edit_theme_options') || !current_user_can('edit_pages')) throw new RuntimeException('header_permission_missing');
if (!function_exists('wp_check_post_lock')) require_once ABSPATH.'wp-admin/includes/post.php';
global $wpdb;
$hash=static fn($v)=>hash('sha256',serialize($v));
$run=$input['runId'];$id=$input['headerId'];$backup=$input['backupId'];
if (!preg_match('/^header_[0-9]+$/',$id)||!preg_match('/^header_[0-9]+$/',$backup)||!preg_match('/^[a-zA-Z0-9_-]+$/',$run)) throw new RuntimeException('header_identity_invalid');
$protected=static function()use($wpdb,$hash,$id,$backup){
  $p=get_post(15769);$meta=get_post_meta(15769);foreach(['_edit_lock','_edit_last','_elementor_element_cache'] as $k)unset($meta[$k]);
  $menus=[];foreach(wp_get_nav_menus() as $m){if($m->name==='test')continue;$rows=[];foreach(wp_get_nav_menu_items($m->term_id)?:[] as $i)$rows[]=[$i->ID,$i->menu_item_parent,$i->title,$i->url,$i->menu_order,get_post_meta($i->ID)];$menus[$m->term_id]=[$m->name,$m->slug,$rows];}
  $headers=[];foreach(get_option('whb_saved_headers',[]) as $k=>$h)if($k!==$id&&$k!==$backup)$headers[$k]=get_option('whb_'.$k);
  return ['oldPage'=>$hash([$p->post_title,$p->post_content,$p->post_status,$meta]),'oldMenus'=>$hash($menus),'themeMods'=>$hash(get_theme_mods()),'otherHeaders'=>$hash($headers),'activePlugins'=>$hash(get_option('active_plugins'))];
};
$state=static function()use($hash,$protected,$id,$backup,$run,$wpdb){
  $opts=get_option('xts-woodmart-options',[]);$unbound=$opts;$paths=[];$pointerValues=[];$testRefs=[];
  $walk=function(&$v,$path)use(&$walk,&$paths,&$pointerValues,&$testRefs,$id,$backup){if(is_array($v))foreach($v as $k=>&$child)$walk($child,array_merge($path,[$k]));elseif($v===$id||$v===$backup){$p=implode('.',$path);$paths[]=$p;$pointerValues[$p]=$v;if($v===$id)$testRefs[]=$p;$v='__preserved_header_pointer__';}};$walk($unbound,[]);
  $test=wp_get_nav_menu_object('test');$menu=null;if($test){$rows=[];foreach(wp_get_nav_menu_items($test->term_id)?:[] as $i)$rows[]=['id'=>$i->ID,'parent'=>(int)$i->menu_item_parent,'title'=>$i->title,'url'=>$i->url,'order'=>$i->menu_order];$menu=['id'=>$test->term_id,'slug'=>$test->slug,'owner'=>get_term_meta($test->term_id,'_clonewp_header_run',true),'items'=>$rows];}
  $pages=get_posts(['post_type'=>'page','post_status'=>'any','posts_per_page'=>3,'meta_key'=>'_clonewp_header_test_run','meta_value'=>$run]);$page=null;if(count($pages)>1)throw new RuntimeException('duplicate_test_pages');if($pages){$p=$pages[0];$page=['id'=>$p->ID,'status'=>$p->post_status,'url'=>get_permalink($p->ID),'header'=>get_post_meta($p->ID,'_woodmart_whb_header',true),'template'=>get_post_meta($p->ID,'_wp_page_template',true),'hash'=>$hash([$p->post_title,$p->post_content,$p->post_status,get_post_meta($p->ID)])];}
  $refs=$wpdb->get_results($wpdb->prepare("SELECT m.post_id,m.meta_key,p.post_type,p.post_parent FROM {$wpdb->postmeta} m LEFT JOIN {$wpdb->posts} p ON p.ID=m.post_id WHERE m.meta_value LIKE %s",'%'.$wpdb->esc_like($id).'%'),ARRAY_A);$otherRefs=array_values(array_filter($refs,static fn($r)=>!$page||((int)$r['post_id']!==$page['id']&&!(($r['post_type']??null)==='revision'&&(int)$r['post_parent']===$page['id']))));
  return ['header'=>get_option('whb_'.$id),'headerHash'=>$hash(get_option('whb_'.$id)),'backup'=>get_option('whb_'.$backup),'mainHeader'=>get_option('whb_main_header'),'themeHeader'=>$opts['default_header']??null,'themeOptionsHash'=>$hash($opts),'themeOptionsExceptHeaderPointersHash'=>$hash($unbound),'headerPointerPaths'=>$paths,'pointerValues'=>$pointerValues,'themeTestReferences'=>$testRefs,'otherExplicitReferences'=>$otherRefs,'protected'=>$protected(),'menuLocations'=>get_nav_menu_locations(),'menu'=>$menu,'page'=>$page,'savedHeaders'=>get_option('whb_saved_headers')];
};
$current=$state();if($input['action']==='read')return ['state'=>$current,'stateHash'=>$hash($current)];
if (!isset($input['expectedStateHash'])||$hash($current)!==$input['expectedStateHash'])throw new RuntimeException('header_state_changed');
$lock='clonewp_header_test_lock';if(!add_option($lock,['run'=>$run,'time'=>time()],'','no'))throw new RuntimeException('header_write_locked');
try {
  $current=$state();if($hash($current)!==$input['expectedStateHash'])throw new RuntimeException('header_state_changed_after_lock');
  $builder=\XTS\Modules\Header_Builder::get_instance();
  if($input['action']==='isolate'){
    if($current['mainHeader']!==$id||$current['themeHeader']!==$id||$current['backup'])throw new RuntimeException('isolation_precondition_changed');
    $refs=$wpdb->get_var($wpdb->prepare("SELECT COUNT(*) FROM {$wpdb->postmeta} WHERE meta_value LIKE %s",'%'.$wpdb->esc_like($id).'%'));if($refs)throw new RuntimeException('header_has_explicit_references');
    $opts=get_option('xts-woodmart-options',[]);$changed=[];$replace=function(&$v,$path)use(&$replace,&$changed,$id,$backup){if(is_array($v))foreach($v as $k=>&$child)$replace($child,array_merge($path,[$k]));elseif($v===$id){if(end($path)!=='default_header')throw new RuntimeException('unexpected_header_reference');$changed[]=implode('.',$path);$v=$backup;}};$replace($opts,[]);
    if($changed!==$input['pointerPaths'])throw new RuntimeException('header_pointer_paths_changed');
    $relative=$input['baselineCssRelativePath']??'';if(!preg_match('~^[0-9]{4}/[0-9]{2}/xts-'.preg_quote($id,'~').'-[0-9]+\\.css$~',$relative))throw new RuntimeException('baseline_css_path_invalid');
    $uploads=wp_upload_dir();$oldCss=$uploads['basedir'].'/'.$relative;if(!is_file($oldCss))throw new RuntimeException('baseline_css_missing');
    $raw=get_option('whb_'.$id);$base=$builder->factory->get_header($id)->get_data();
    $copy=$builder->factory->create_new($backup,'原默认页眉保护副本',$raw['structure'],$raw['settings']);
    $copied=$copy->get_data();if($hash([$base['structure'],$base['settings']])!==$hash([$copied['structure'],$copied['settings']]))throw new RuntimeException('backup_structure_mismatch');
    $builder->list->add_header($backup,'原默认页眉保护副本');
    $stored=maybe_unserialize($wpdb->get_var($wpdb->prepare("SELECT option_value FROM {$wpdb->options} WHERE option_name=%s",'whb_'.$backup)));
    $storedList=maybe_unserialize($wpdb->get_var($wpdb->prepare("SELECT option_value FROM {$wpdb->options} WHERE option_name=%s",'whb_saved_headers')));
    if($hash($stored)!==$hash($copy->get_raw_data())||($storedList[$backup]['id']??null)!==$backup)throw new RuntimeException('backup_database_readback_failed');
    $newCss=glob($uploads['basedir'].'/*/*/xts-'.$backup.'-*.css');
    if(!is_file($oldCss)||count($newCss)!==1||hash_file('sha256',$oldCss)!==hash_file('sha256',$newCss[0]))throw new RuntimeException('backup_saved_css_mismatch');
    update_option('xts-woodmart-options',$opts);update_option('whb_main_header',$backup);
    if(get_option('whb_main_header')!==$backup||get_option('xts-woodmart-options')!==$opts)throw new RuntimeException('isolation_readback_failed');
  } elseif($input['action']==='create') {
    if($current['mainHeader']===$id||$current['themeTestReferences']||$current['otherExplicitReferences']||!$current['backup']||$current['menu']||$current['page'])throw new RuntimeException('creation_precondition_changed');
    $slug=$input['slug'];if(get_page_by_path($slug))throw new RuntimeException('test_slug_occupied');
    $pid=wp_insert_post(['post_type'=>'page','post_status'=>'draft','post_title'=>'Furry’s Kitchen — WoodMart Header Test','post_name'=>$slug,'post_content'=>$input['body'],'meta_input'=>['_clonewp_header_test_run'=>$run,'_woodmart_whb_header'=>$id,'_wp_page_template'=>'default','_yoast_wpseo_meta-robots-noindex'=>'1','rank_math_robots'=>['noindex','nofollow']]],true);if(is_wp_error($pid))throw new RuntimeException('test_page_create_failed');
    $menu=wp_create_nav_menu('test');if(is_wp_error($menu))throw new RuntimeException('test_menu_create_failed');update_term_meta($menu,'_clonewp_header_run',$run);
    $created=[];$order=0;foreach($input['items'] as $i){$parent=$i['parentKey']===null?0:($created[$i['parentKey']]??null);if($parent===null)throw new RuntimeException('menu_parent_not_created');$url=$i['key']==='nav-0'?get_permalink($pid):$i['url'];$item=wp_update_nav_menu_item($menu,0,['menu-item-title'=>$i['title'],'menu-item-url'=>$url,'menu-item-status'=>'publish','menu-item-type'=>'custom','menu-item-parent-id'=>$parent,'menu-item-position'=>++$order]);if(is_wp_error($item))throw new RuntimeException('menu_item_create_failed');$created[$i['key']]=$item;}
  } elseif($input['action']==='save') {
    if($current['mainHeader']===$id||$current['themeTestReferences']||$current['otherExplicitReferences']||!$current['menu']||$current['menu']['owner']!==$run||!$current['page']||$current['page']['status']!=='draft')throw new RuntimeException('save_not_isolated_or_owned');
    $pid=$current['page']['id'];if(wp_check_post_lock($pid))throw new RuntimeException('test_page_edit_locked');
    $r=$input['raw'];if($r['id']!==$id||$r['name']!=='test')throw new RuntimeException('header_plan_identity_changed');
    $plugin=\Elementor\Plugin::$instance;$doc=$plugin->documents->get($pid);if(!$doc)throw new RuntimeException('test_document_missing');
    $front=new ReflectionProperty('Elementor\Core\Frontend\Performance','is_frontend');$front->setAccessible(true);$wasFront=$front->getValue();$front->setValue(null,false);$plugin->controls_manager->clear_stack_cache();
    $stack=$doc->get_stack();$controls=array_merge($stack['controls']??[],$stack['style_controls']??[]);if(($controls['custom_css']['type']??'')!=='code')throw new RuntimeException('test_custom_css_control_missing');
    $builder->factory->update_header($id,'test',$r['structure'],$r['settings']);
    try {
      $doc->set_is_built_with_elementor(true);$settings=$doc->get_settings();$settings['custom_css']=$input['css'];
      if(!$doc->save(['elements'=>$input['elements'],'settings'=>$settings]))throw new RuntimeException('test_document_save_failed');
      update_post_meta($pid,'_wp_page_template','elementor_header_footer');
      if(class_exists('\\Elementor\\Core\\Files\\CSS\\Post')){ $css=new \Elementor\Core\Files\CSS\Post($pid);$css->update(); }
      if(get_post_meta($pid,'_elementor_page_settings',true)['custom_css']!==$input['css'])throw new RuntimeException('test_css_readback_failed');
    } finally {$front->setValue(null,$wasFront);$plugin->controls_manager->clear_stack_cache();}
  } elseif($input['action']==='publish') {
    if(!$current['page']||$current['page']['status']!=='draft'||$current['mainHeader']===$id||$current['themeTestReferences']||$current['otherExplicitReferences']||$current['menu']['owner']!==$run)throw new RuntimeException('publication_precondition_changed');
    $pid=$current['page']['id'];if(wp_check_post_lock($pid))throw new RuntimeException('test_page_edit_locked');
    $result=wp_update_post(['ID'=>$pid,'post_status'=>'publish'],true);if(is_wp_error($result))throw new RuntimeException('publication_failed');
  } else throw new RuntimeException('unknown_header_action');
  $after=$state();if($after['protected']!==$current['protected']||$after['menuLocations']!==$current['menuLocations']||$after['themeOptionsExceptHeaderPointersHash']!==$current['themeOptionsExceptHeaderPointersHash'])throw new RuntimeException('protected_resources_changed');
  if(in_array($input['action'],['create','save','publish'],true)&&(!$after['page']||$after['page']['header']!==$id||!$after['menu']||$after['menu']['owner']!==$run||count($after['menu']['items'])!==27))throw new RuntimeException('test_binding_readback_failed');
  if($input['action']==='save'&&($after['page']['template']!=='elementor_header_footer'||$hash($after['header'])!==$hash($input['raw'])))throw new RuntimeException('test_plan_readback_failed');
  if($input['action']==='publish'&&$after['page']['status']!=='publish')throw new RuntimeException('publication_readback_failed');
  return ['state'=>$after,'stateHash'=>$hash($after),'protectionUnchanged'=>true];
} finally {if((get_option($lock)['run']??null)===$run)delete_option($lock);}
