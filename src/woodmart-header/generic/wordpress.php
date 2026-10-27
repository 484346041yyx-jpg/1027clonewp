// Fixed independent native-header adapter. Caller content is base64 JSON data.
// This helper never changes theme defaults, menu locations or an existing page.
try {
  if (!current_user_can('edit_theme_options') || !current_user_can('edit_pages')) throw new RuntimeException('hmod_permission_missing');
  if (!function_exists('woodmart_get_config') || !class_exists('\XTS\Modules\Header_Builder')) throw new RuntimeException('hmod_native_unavailable');
  if(!post_type_exists('cms_block')||!current_user_can('unfiltered_html')||!function_exists('woodmart_get_html_block'))throw new RuntimeException('hmod_native_style_unavailable');
  global $wpdb;
  $digest=static fn($value)=>hash('sha256',serialize($value));
  $identity=$input['identity']??[];$moduleKey=$identity['moduleKey']??'';$owner=$identity['owner']??[];$headerId=$identity['headerId']??'';
  $origin=untrailingslashit(home_url('/'));
  if (!preg_match('/^[a-z][a-z0-9_-]{0,63}$/',$moduleKey)||!preg_match('/^header_[A-Za-z0-9_-]{1,89}$/',$headerId)||!preg_match('/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/',$owner['ownerId']??'')||!preg_match('/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/',$owner['runId']??'')||($identity['targetOrigin']??'')!==$origin||wp_parse_url($origin,PHP_URL_SCHEME)!=='https') throw new RuntimeException('hmod_identity_invalid');
  $moduleOption='clonewp_header_module_'.hash('sha256',$origin.'|'.$moduleKey);
  $ownerToken=hash('sha256',serialize($identity));
  $record=get_option($moduleOption,null);
  $assertRecord=static function($value)use($identity){if(!is_array($value)||($value['identity']??null)!==$identity)throw new RuntimeException('hmod_ownership_changed');};
  if($record!==null)$assertRecord($record);
  $dropdownFields=['_menu_item_design','_menu_item_width','_menu_item_height','_menu_item_padding','_menu_item_colorscheme','_menu_item_event','_menu_item_dropdown-ajax'];
  // Optional native Elementor menu blocks use the installed theme's own walker.
  $menuContentContract=static function()use($digest){
    if(!class_exists('\Elementor\Plugin')||!function_exists('woodmart_html_block_shortcode'))throw new RuntimeException('hmod_menu_content_native_unavailable');
    $file=get_template_directory().'/inc/modules/mega-menu-walker/class-mega-menu-walker.php';
    $source=is_readable($file)?file_get_contents($file):false;
    if(!is_string($source)||!str_contains($source,"'_menu_item_block'")||!str_contains($source,"'_menu_item_image-type'")||!str_contains($source,'get_post_thumbnail_id')||!str_contains($source,'woodmart_html_block_shortcode')||!str_contains($source,'wd-nav-fs')||!str_contains($source,'wd-mob-nav-html-block')||!preg_match('/\$block\s*&&\s*!\s*\$args->walker->has_children/',$source))throw new RuntimeException('hmod_menu_content_walker_unsupported');
    return ['fingerprint'=>$digest([hash('sha256',$source),wp_get_theme(get_template())->get('Version'),'native-elementor-leaf-menu-v1'])];
  };
  $menuContentObservation=static function($binding)use($digest,$ownerToken,$owner){
    $id=(int)($binding['id']??0);$post=get_post($id);
    if(!$post||$post->post_type!=='cms_block'||$post->post_status!=='publish'||get_post_meta($id,'_clonewp_header_module_owner',true)!==$ownerToken||get_post_meta($id,'_clonewp_run_id',true)!==$owner['runId'])throw new RuntimeException('hmod_menu_content_ownership_changed');
    $raw=get_post_meta($id,'_elementor_data',true);$elements=$raw===''?[]:json_decode($raw,true);$settings=get_post_meta($id,'_elementor_page_settings',true);if($settings==='')$settings=[];
    if(!is_array($elements)||!is_array($settings))throw new RuntimeException('hmod_menu_content_document_missing');
    $meta=get_post_meta($id);foreach(['_edit_lock','_edit_last','_elementor_element_cache','_elementor_css','_elementor_page_assets','_elementor_controls_usage','wd_page_css_files','wd_page_css_files_mobile'] as $cacheKey)unset($meta[$cacheKey]);
    return ['id'=>$id,'name'=>$post->post_title,'menuKey'=>$binding['menuKey'],'itemKey'=>$binding['itemKey'],'programHash'=>$binding['programHash'],'elements'=>$elements,'settings'=>(object)$settings,'documentHash'=>$digest([$post->post_title,$post->post_content,$post->post_status,$post->post_name,$meta])];
  };
  $pageObservation=static function($pid)use($digest){
    $p=get_post($pid);if(!$p)return null;
    // Native cms_block saves clear these two derived caches; front-end QA rebuilds them.
    $meta=get_post_meta($pid);foreach(['_edit_lock','_edit_last','_elementor_element_cache','_elementor_css','_elementor_page_assets','wd_page_css_files','wd_page_css_files_mobile'] as $key)unset($meta[$key]);
    $body=[$p->post_title,$p->post_content,$p->post_excerpt,get_post_meta($pid,'_elementor_data',true),get_post_meta($pid,'_elementor_page_settings',true)];
    return ['pageId'=>(int)$pid,'postType'=>$p->post_type,'status'=>$p->post_status,'template'=>(string)get_post_meta($pid,'_wp_page_template',true),'runId'=>(string)get_post_meta($pid,'_clonewp_run_id',true),'bodyHash'=>$digest($body),'headerId'=>get_post_meta($pid,'_woodmart_whb_header',true)?:null,'snapshotHash'=>$digest([$p->post_title,$p->post_content,$p->post_excerpt,$p->post_status,$p->post_name,$meta])];
  };
  $snapshot=static function()use($wpdb,$digest,$identity,$headerId,$moduleOption,$assertRecord,$pageObservation,$ownerToken,$menuContentObservation,$menuContentContract,$dropdownFields,&$nativeContract){
    $r=get_option($moduleOption,null);if($r!==null)$assertRecord($r);
    $ownMenuIds=[];$menus=[];$ownPages=$r['pages']??[];$ownedPostIds=$ownPages;if(!empty($r['styleId']))$ownedPostIds[]=(int)$r['styleId'];
    $menuContent=[];$contentById=[];foreach($r['menuContent']??[] as $key=>$binding){$ob=$menuContentObservation($binding);$menuContent[$key]=$ob;$contentById[$ob['id']]=$ob;$ownedPostIds[]=$ob['id'];}
    foreach($r['menus']??[] as $key=>$id){
      $m=wp_get_nav_menu_object($id);if(!$m||get_term_meta($id,'_clonewp_header_module_owner',true)!==$ownerToken)throw new RuntimeException('hmod_menu_ownership_changed');
      $ownMenuIds[]=(int)$id;$items=[];$native=wp_get_nav_menu_items($id,['post_status'=>'any'])?:[];$keys=[];
      foreach($native as $item){if(get_post_meta($item->ID,'_clonewp_header_module_owner',true)!==$ownerToken)throw new RuntimeException('hmod_menu_item_ownership_changed');$keys[$item->ID]=(string)get_post_meta($item->ID,'_clonewp_header_module_item_key',true);$ownedPostIds[]=(int)$item->ID;}
      foreach($native as $item)$items[]=['id'=>(int)$item->ID,'key'=>$keys[$item->ID],'parentKey'=>$item->menu_item_parent?($keys[$item->menu_item_parent]??'__foreign_parent__'):null,'title'=>$item->title,'url'=>$item->url,'order'=>(int)$item->menu_order];
      if(isset($r['menuContent']))foreach($items as &$entry){$block=(int)get_post_meta($entry['id'],'_menu_item_block',true);$meta=get_post_meta($entry['id']);foreach(['_edit_lock','_edit_last'] as $field)unset($meta[$field]);$entry['content']=['blockId'=>$block,'documentHash'=>$contentById[$block]['documentHash']??'','metaHash'=>$digest($meta)];$entry['imageId']=(int)get_post_thumbnail_id($entry['id']);}unset($entry);
      foreach($r['menuContent']??[] as $binding)if(($binding['version']??1)===2&&$binding['menuKey']===$key)foreach($items as &$entry){if($entry['key']===$binding['itemKey']){$entry['content']['dropdown']=[];foreach($dropdownFields as $field)$entry['content']['dropdown'][$field]=(string)get_post_meta($entry['id'],$field,true);}}unset($entry);
      $menus[$key]=['id'=>(int)$m->term_id,'slug'=>$m->slug,'name'=>html_entity_decode($m->name,ENT_QUOTES|ENT_HTML5,'UTF-8'),'items'=>$items];
    }
    $pages=[];foreach($ownPages as $pid){if(get_post_meta($pid,'_clonewp_header_module_owner',true)!==$ownerToken)throw new RuntimeException('hmod_page_ownership_changed');$ob=$pageObservation($pid);if(!$ob)throw new RuntimeException('hmod_page_missing');$pages[(string)$pid]=$ob;}
    $style=null;if(!empty($r['styleId'])){$p=get_post($r['styleId']);if(!$p||$p->post_type!=='cms_block'||get_post_meta($p->ID,'_clonewp_header_module_owner',true)!==$ownerToken)throw new RuntimeException('hmod_style_ownership_changed');$prefix='<style data-clonewp-header-module="'.esc_attr($identity['moduleKey']).'">';$content=$p->post_content;$css=str_starts_with($content,$prefix)&&str_ends_with($content,'</style>')?substr($content,strlen($prefix),-8):$content;$style=['id'=>(int)$p->ID,'css'=>$css];}
    $opts=get_option('xts-woodmart-options',[]);$presets=get_option('xts-options-presets',[]);$presetRefs=[];
    $walk=function($v,$path)use(&$walk,&$presetRefs,$headerId){if(is_array($v))foreach($v as $k=>$child)$walk($child,$path.'.'.$k);elseif(is_string($v)&&str_contains($v,$headerId))$presetRefs[]=$path;};$walk($opts,'theme');$walk($presets,'presets');
    $refs=[];$rows=$wpdb->get_results($wpdb->prepare("SELECT m.post_id,m.meta_key,p.post_type,p.post_parent FROM {$wpdb->postmeta} m LEFT JOIN {$wpdb->posts} p ON p.ID=m.post_id WHERE m.meta_value LIKE %s",'%'.$wpdb->esc_like($headerId).'%'),ARRAY_A);
    foreach($rows as $ref)if(!in_array((int)$ref['post_id'],$ownedPostIds,true)&&!(($ref['post_type']??'')==='revision'&&in_array((int)$ref['post_parent'],$ownedPostIds,true)))$refs[]=['kind'=>'postmeta','id'=>(string)$ref['post_id'],'field'=>$ref['meta_key']];
    $optionRows=$wpdb->get_results($wpdb->prepare("SELECT option_name FROM {$wpdb->options} WHERE option_value LIKE %s",'%'.$wpdb->esc_like($headerId).'%'),ARRAY_A);
    foreach($optionRows as $ref){$key=$ref['option_name'];if(in_array($key,[$moduleOption,'whb_'.$headerId,'xts-'.$headerId.'-file-data','xts-'.$headerId.'-css-data','whb_saved_headers','whb_main_header','xts-woodmart-options','xts-options-presets'],true)||str_starts_with($key,'_transient_')||str_starts_with($key,'_site_transient_'))continue;$refs[]=['kind'=>'option','id'=>$key,'field'=>'option_value'];}
    $oldMenus=[];foreach(wp_get_nav_menus() as $m){if(in_array((int)$m->term_id,$ownMenuIds,true))continue;$items=[];foreach(wp_get_nav_menu_items($m->term_id,['post_status'=>'any'])?:[] as $i)$items[]=[$i->ID,$i->title,$i->url,$i->menu_item_parent,$i->menu_order,get_post_meta($i->ID)];$oldMenus[$m->term_id]=[$m->name,$m->slug,$items];}
    $otherHeaders=[];$saved=\XTS\Modules\Header_Builder::get_instance()->list->get_all();foreach($saved as $key=>$value)if($key!==$headerId)$otherHeaders[$key]=[$value,get_option('whb_'.$key)];
    // Module-owned dependencies are not shared resources. Reject references
    // from other native headers, widgets, page data and supported shortcodes.
    $referenceNodes=0;
    $scan=function($value,$kind,$id,$field='', $depth=0)use(&$scan,&$refs,&$referenceNodes,$menus,$r,$contentById){
      if(++$referenceNodes>1000000||$depth>64)throw new RuntimeException('hmod_reference_audit_limit');
      if(is_array($value)||is_object($value)){if(is_array($value)&&array_key_exists('value',$value))$scan($value['value'],$kind,$id,$field,$depth+1);foreach((array)$value as $key=>$child)$scan($child,$kind,$id,(string)$key,$depth+1);return;}
      if(!is_scalar($value))return;
      foreach($menus as $menu)if(in_array($field,['menu_id','nav_menu','menu'],true)&&((string)$value===(string)$menu['id']||(string)$value===$menu['slug']))$refs[]=['kind'=>$kind,'id'=>(string)$id,'field'=>$field];
      if(!empty($r['styleId'])&&preg_match('/(?:html_?block|block_id)/i',$field)&&(string)$value===(string)$r['styleId'])$refs[]=['kind'=>$kind,'id'=>(string)$id,'field'=>$field];
      if($contentById&&preg_match('/(?:html_?block|block_id|_menu_item_block)/i',$field)&&is_scalar($value)&&isset($contentById[(int)$value]))$refs[]=['kind'=>$kind,'id'=>(string)$id,'field'=>$field];
      if(is_string($value)){
        $trim=ltrim($value);if(strlen($trim)>10485760)throw new RuntimeException('hmod_reference_audit_limit');
        if($trim!==''&&in_array($trim[0],['{','['],true)){$json=json_decode($trim,true);if(is_array($json)){$scan($json,$kind,$id,$field,$depth+1);return;}}
        if(preg_match_all('~\[(?:html_block|woodmart_html_block|nav_menu|menu)\b([^\]]*)\]~i',$value,$matches)){
          foreach($matches[1] as $attributes){
            foreach($menus as $menu)if(preg_match('~\b(?:id|menu|menu_id|nav_menu)\s*=\s*["\x27]?(?:'.preg_quote((string)$menu['id'],'~').'|'.preg_quote($menu['slug'],'~').')(?=["\x27\s]|$)~',$attributes))$refs[]=['kind'=>$kind,'id'=>(string)$id,'field'=>'menu-shortcode'];
            if(!empty($r['styleId'])&&preg_match('~\bid\s*=\s*["\x27]?'.preg_quote((string)$r['styleId'],'~').'(?=["\x27\s]|$)~',$attributes))$refs[]=['kind'=>$kind,'id'=>(string)$id,'field'=>'style-shortcode'];
            foreach($contentById as $blockId=>$unused)if(preg_match('~\bid\s*=\s*["\x27]?'.preg_quote((string)$blockId,'~').'(?=["\x27\s]|$)~',$attributes))$refs[]=['kind'=>$kind,'id'=>(string)$id,'field'=>'menu-content-shortcode'];
          }
        }
      }
      if(count($refs)>1000)throw new RuntimeException('hmod_reference_audit_limit');
    };
    foreach(get_nav_menu_locations() as $location=>$menuId)if(in_array((int)$menuId,$ownMenuIds,true))$refs[]=['kind'=>'menu-location','id'=>(string)$location,'field'=>'menu'];
    foreach($oldMenus as $menuId=>$oldMenu)foreach($oldMenu[2] as $oldItem)if(isset($contentById[(int)get_post_meta($oldItem[0],'_menu_item_block',true)]))$refs[]=['kind'=>'menu-item','id'=>(string)$oldItem[0],'field'=>'_menu_item_block'];
    foreach($otherHeaders as $key=>$definition)$scan($definition[1],'header',$key);
    $scan($opts,'theme-option','xts-woodmart-options');$scan($presets,'preset-option','xts-options-presets');
    $widgets=$wpdb->get_results("SELECT option_name,option_value FROM {$wpdb->options} WHERE option_name LIKE 'widget\\_%' LIMIT 1001",ARRAY_A);if(count($widgets)>1000)throw new RuntimeException('hmod_widget_audit_limit');
    foreach($widgets as $widget)$scan(maybe_unserialize($widget['option_value']),'widget-option',$widget['option_name']);
    // Stream hashes rather than returning protected page contents. The bound
    // page set is omitted only because those exact pages are owned by this module.
    $pageHash=hash_init('sha256');$lastId=0;$pageCount=0;
    do{
      $batch=$wpdb->get_results($wpdb->prepare("SELECT ID,post_title,post_content,post_excerpt,post_status,post_name,post_parent FROM {$wpdb->posts} WHERE post_type='page' AND ID>%d ORDER BY ID ASC LIMIT 200",$lastId),ARRAY_A);
      foreach($batch as $page){$pid=(int)$page['ID'];$lastId=$pid;if(in_array($pid,$ownPages,true))continue;if(++$pageCount>10000)throw new RuntimeException('hmod_page_audit_limit');$meta=get_post_meta($pid);foreach(['_edit_lock','_edit_last','_elementor_css','_elementor_element_cache','_elementor_page_assets','_elementor_controls_usage','wd_page_css_files','wd_page_css_files_mobile'] as $key)unset($meta[$key]);$serialized=serialize([$page,$meta]);if(strlen($serialized)>10485760)throw new RuntimeException('hmod_page_audit_limit');hash_update($pageHash,$serialized);$scan($page['post_content'],'page-content',$pid);$scan($meta,'page-meta',$pid);}
    }while(count($batch)===200);
    // A dependency can be referenced through another shared block/template too.
    $shared=$wpdb->get_results("SELECT ID,post_type,post_title,post_content,post_excerpt,post_status,post_name,post_parent FROM {$wpdb->posts} WHERE post_type IN ('cms_block','elementor_library','woodmart_layout','wp_block','wp_navigation') ORDER BY ID ASC LIMIT 2001",ARRAY_A);if(count($shared)>2000)throw new RuntimeException('hmod_reference_audit_limit');
    foreach($shared as $post){$pid=(int)$post['ID'];if(in_array($pid,$ownedPostIds,true))continue;$meta=get_post_meta($pid);foreach(['_edit_lock','_edit_last','_elementor_css','_elementor_element_cache','_elementor_page_assets','_elementor_controls_usage','wd_page_css_files','wd_page_css_files_mobile'] as $key)unset($meta[$key]);$serialized=serialize(['shared',$post,$meta]);if(strlen($serialized)>10485760)throw new RuntimeException('hmod_page_audit_limit');hash_update($pageHash,$serialized);$scan($post['post_content'],'shared-content',$pid);$scan($meta,'shared-meta',$pid);}
    $global=$digest([get_option('whb_main_header'),$opts,$presets,get_theme_mods(),get_nav_menu_locations(),$otherHeaders,$oldMenus,get_option('active_plugins'),$nativeContract()['fingerprint'],hash_final($pageHash)]);
    $module=$r===null?null:['identity'=>$r['identity'],'name'=>$r['name'],'menus'=>(object)$menus,'style'=>$style,'header'=>get_option('whb_'.$headerId,null),'pages'=>(object)$pages,'receipts'=>(object)($r['receipts']??[])];
    if($module!==null&&isset($r['menuContent'])){$module['menuContent']=(object)$menuContent;if($menuContent)$menuContentContract();}
    if($module!==null&&!empty($r['conflicts']))$module['conflicts']=(object)$r['conflicts'];
    return ['module'=>$module,'globalHash'=>$global,'defaultHeaderId'=>(string)get_option('whb_main_header'),'presetReferences'=>$presetRefs,'otherReferences'=>$refs];
  };
  $nativeContract=static function()use($origin,$digest){
    $builder=\XTS\Modules\Header_Builder::get_instance();$args=[];
    foreach($builder->elements->elements_classes as $name=>$object)$args[strtolower($name)]=$object->get_args();
    $schema=static function($fields,$element=''){
      $result=[];foreach($fields as $key=>$f){$type=$f['type']??'';if(in_array($type,['notice','title','divider'],true)||!isset($f['id']))continue;
        // These two select fields are actual native cms_block lookups. Their
        // live options are resources, not part of a frozen control contract.
        $htmlBlockSelect=($element==='htmlblock'&&$key==='block_id')||($element==='search'&&$key==='search_extra_content');
        if($htmlBlockSelect&&$type!=='select')throw new RuntimeException('hmod_html_block_resource_contract_changed');
        $resource=$type==='image'?'image':(($element==='mainmenu'&&$key==='menu_id')?'menu':($htmlBlockSelect?'html-block':null));
        if(isset($f['callback'])&&$resource===null)continue;
        $valueType=$type==='switcher'?'boolean':($type==='slider'?'number':($type==='image'?'image':(in_array($type,['bg','border','color'],true)?'json':'string')));
        $entry=['type'=>$type,'valueType'=>$valueType];if($resource!==null)$entry['resource']=$resource;
        if(array_key_exists('value',$f)&&$resource===null){$v=$f['value'];if($valueType==='number'&&is_numeric($v))$v=0+$v;elseif($valueType==='boolean')$v=(bool)$v;elseif($valueType==='string'&&!is_string($v)){if(is_scalar($v))$v=(string)$v;else continue;}$entry['default']=$v;}
        if(isset($f['from'])&&is_numeric($f['from']))$entry['min']=0+$f['from'];if(isset($f['to'])&&is_numeric($f['to']))$entry['max']=0+$f['to'];
        if(isset($f['options'])&&is_array($f['options'])&&$resource===null){$options=[];foreach($f['options'] as $option){if(is_array($option)&&array_key_exists('value',$option))$options[]=$option['value'];}if($options)$entry['options']=$options;}
        $result[$key]=$entry;
      }return (object)$result;
    };
    $structure=woodmart_get_config('header-sceleton');$normal=function($n)use(&$normal){if(isset($n['content']))$n['content']=array_values(array_map($normal,$n['content']));if(isset($n['params'])&&!$n['params'])$n['params']=(object)[];return $n;};$structure=$normal($structure);
    $columns=[];foreach($structure['content']??[] as $row){$desktop=[];foreach($row['content']??[] as $column){if(empty($column['desktop_only'])||!empty($column['mobile_only']))continue;$classes=preg_split('/\s+/',$column['class']??'');foreach(['left','center','right'] as $position)if(in_array('whb-col-'.$position,$classes,true))$desktop[$position]=$column['id'];}if(count($desktop)!==3)throw new RuntimeException('hmod_skeleton_columns_unsupported');$columns[$row['id']]=$desktop;}
    $elements=[];foreach(['logo','mainmenu','account','cart','search','space'] as $type){if(!isset($args[$type]))throw new RuntimeException('hmod_element_contract_missing');$elements[$type]=['type'=>$args[$type]['type'],'schema'=>$schema($args[$type]['params']??[],$type)];}
    $settingsFields=woodmart_get_config('header-builder-settings');$settings=[];foreach($settingsFields as $key=>$f){if(isset($f['id'],$f['type'])&&array_key_exists('value',$f))$settings[$key]=['id'=>$f['id'],'type'=>$f['type'],'value'=>$f['value']];}
    if(!isset($args['htmlblock']['params']['block_id']))throw new RuntimeException('hmod_style_element_unavailable');
    $contract=['kind'=>'clonewp-whb-native-contract','version'=>1,'targetOrigin'=>$origin,'structure'=>$structure,'settings'=>(object)$settings,'rowColumns'=>$columns,'rowSchema'=>$schema($args['row']['params']??[],'row'),'settingsSchema'=>$schema($settingsFields,'settings'),'elements'=>$elements,'styleElement'=>['type'=>$args['htmlblock']['type'],'field'=>'block_id','schema'=>$schema($args['htmlblock']['params'],'htmlblock')]];
    $contract['fingerprint']=$digest([$contract,wp_get_theme(get_template())->get('Version')]);
    return $contract;
  };
  if(($input['action']??'')==='inspect-menu-content')return ['ok'=>true,'value'=>$menuContentContract()];
  $current=$snapshot();$currentHash=$digest($current);
  if(($input['action']??'')==='inspect'){
    $resources=['targetOrigin'=>$origin,'menus'=>(object)[],'media'=>(object)[],'styleBlockId'=>(int)($record['styleId']??0)];
    foreach($record['menus']??[] as $key=>$id){$m=wp_get_nav_menu_object($id);$resources['menus']->$key=['id'=>(int)$id,'slug'=>$m->slug];}
    foreach($input['mediaIds']??[] as $key=>$id){if(!is_int($id)||$id<1||get_post_type($id)!=='attachment')throw new RuntimeException('hmod_media_missing');$image=wp_get_attachment_image_src($id,'full');if(!$image||strpos($image[0],$origin.'/')!==0)throw new RuntimeException('hmod_media_origin_changed');$resources['media']->$key=['id'=>$id,'url'=>$image[0],'width'=>(int)$image[1],'height'=>(int)$image[2]];}
    if(isset($input['pageId'])){$ob=$pageObservation((int)$input['pageId']);if($ob)$current['candidatePage']=$ob;}
    return ['ok'=>true,'value'=>['contract'=>$nativeContract(),'resources'=>$resources,'snapshot'=>$current,'hash'=>$currentHash]];
  }
  $action=$input['action']??'';$operationId=$input['operationId']??'';$payload=$input['payload']??[];$requestHash=$input['requestHash']??'';
  if(!in_array($action,['reserve','menu','menu-content','style','header','create-page','bind'],true)||!preg_match('/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/',$operationId)||!preg_match('/^[a-f0-9]{64}$/',$requestHash))throw new RuntimeException('hmod_operation_invalid');
  $lock='clonewp_header_module_lock_'.hash('sha256',$headerId);$lockValue=['operationId'=>$operationId,'owner'=>$ownerToken];if(!add_option($lock,$lockValue,'','no'))throw new RuntimeException('hmod_write_locked');
  try {
    $record=get_option($moduleOption,null);if($record!==null)$assertRecord($record);
    if(isset($record['conflicts'][$operationId]))throw new RuntimeException('hmod_operation_already_resolved');
    $prior=$record['receipts'][$operationId]??null;
    if($prior){if($prior['action']!==$action||$prior['payloadHash']!==$requestHash)throw new RuntimeException('hmod_operation_identity_changed');if(($prior['state']??'')!=='complete')throw new RuntimeException('hmod_previous_operation_unconfirmed');$after=$snapshot();return ['ok'=>true,'value'=>['snapshot'=>$after,'hash'=>$digest($after),'result'=>$prior['result']??null]];}
    foreach($record['receipts']??[] as $receipt)if(($receipt['state']??'')!=='complete')throw new RuntimeException('hmod_previous_operation_unconfirmed');
    $current=$snapshot();if($digest($current)!==($input['expectedHash']??''))throw new RuntimeException('hmod_snapshot_changed');
    if($current['defaultHeaderId']===$headerId||$current['presetReferences']||$current['otherReferences'])throw new RuntimeException('hmod_header_not_isolated');
    foreach((array)($current['module']['pages']??[]) as $p)if($p['status']!=='draft'){
      $revision=$input['publishedRevision']??null;
      if(!in_array($action,['header','style','menu','menu-content'],true)||!is_array($revision)||count($revision)!==3||$p['status']!=='publish'||$p['pageId']!==($revision['pageId']??null)||$p['bodyHash']!==($revision['bodyHash']??null)||$p['snapshotHash']!==($revision['snapshotHash']??null)||$p['runId']!==$owner['runId']||$p['headerId']!==$headerId)throw new RuntimeException('hmod_bound_page_not_draft');
    }
    $beforeGlobal=$current['globalHash'];
    // Deterministic rejections happen before the first recorded mutation.
    if($action==='menu'){
      $key=$payload['key']??'';$name=$payload['name']??'';$items=$payload['items']??[];
      if(!preg_match('/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/',$key)||!is_string($name)||trim($name)===''||strlen($name)>400||!is_array($items)||!$items||count($items)>200)throw new RuntimeException('hmod_menu_input_invalid');
      if(!isset($record['menus'][$key])&&wp_get_nav_menu_object($name))throw new RuntimeException('hmod_menu_name_occupied');
      $seen=[];foreach($items as $item){$itemKey=$item['key']??'';$parent=$item['parentKey']??null;$url=$item['url']??'';$title=$item['title']??'';if(!preg_match('/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/',$itemKey)||isset($seen[$itemKey])||($parent!==null&&!isset($seen[$parent]))||!is_string($title)||trim($title)===''||!is_string($url)||!preg_match('~^https://[^/@]+(?:/|$)~',$url)||!empty(wp_parse_url($url,PHP_URL_USER))||!empty(wp_parse_url($url,PHP_URL_PASS)))throw new RuntimeException('hmod_menu_item_invalid');$seen[$itemKey]=true;}
      foreach($record['menuContent']??[] as $binding)if($binding['menuKey']===$key){if(!isset($seen[$binding['itemKey']]))throw new RuntimeException('hmod_menu_content_binding_in_use');foreach($items as $item)if(($item['parentKey']??null)===$binding['itemKey'])throw new RuntimeException('hmod_menu_content_leaf_required');}
      if(isset($payload['images'])){if(!isset($record['menuContent'])||!is_array($payload['images'])||count($payload['images'])>100)throw new RuntimeException('hmod_menu_media_invalid');$imageKeys=[];foreach($payload['images'] as $image){$mediaId=$image['mediaId']??0;$itemKey=$image['itemKey']??'';if(!isset($seen[$itemKey])||isset($imageKeys[$itemKey])||!is_int($mediaId)||$mediaId<1||get_post_type($mediaId)!=='attachment'||!wp_attachment_is_image($mediaId))throw new RuntimeException('hmod_menu_media_invalid');$url=wp_get_attachment_url($mediaId);if(!is_string($url)||!str_starts_with($url,$origin.'/'))throw new RuntimeException('hmod_menu_media_origin_changed');$imageKeys[$itemKey]=$mediaId;}}
    }elseif($action==='menu-content'){
      $mega=($payload['version']??1)===2;
      if(!isset($record['menuContent'])||($menuContentContract()['fingerprint']??'')!==($payload['contractFingerprint']??''))throw new RuntimeException('hmod_menu_content_contract_changed');
      $key=$payload['key']??'';$menuKey=$payload['menuKey']??'';$itemKey=$payload['itemKey']??'';
      if(!preg_match('/^[A-Za-z][A-Za-z0-9_-]{0,79}$/',$key)||!is_string($payload['name']??null)||trim($payload['name'])===''||strlen($payload['name'])>800||!preg_match('/^[a-f0-9]{64}$/',$payload['programHash']??'')||!isset($record['menus'][$menuKey])||!is_array($payload['elements']??null)||!$payload['elements']||!is_array($payload['settings']??null)||!is_array($payload['queries']??null)||(!$mega&&empty($payload['queries'])))throw new RuntimeException('hmod_menu_content_input_invalid');
      $menu=wp_get_nav_menu_items($record['menus'][$menuKey],['post_status'=>'any'])?:[];$itemId=0;foreach($menu as $item)if(get_post_meta($item->ID,'_clonewp_header_module_item_key',true)===$itemKey)$itemId=(int)$item->ID;
      if(!$itemId||get_post_meta($itemId,'_clonewp_header_module_owner',true)!==$ownerToken)throw new RuntimeException('hmod_menu_content_item_missing');
      $changedFields=$mega?array_merge(['_menu_item_block','_edit_lock','_edit_last'],$dropdownFields):['_menu_item_block','_menu_item_design','_menu_item_dropdown-ajax','_edit_lock','_edit_last'];
      $itemProtectedMeta=get_post_meta($itemId);foreach($changedFields as $field)unset($itemProtectedMeta[$field]);
      $retired=[];$descendants=[$itemId];do{$changed=false;foreach($menu as $item)if(in_array((int)$item->menu_item_parent,$descendants,true)&&!in_array((int)$item->ID,$descendants,true)){$descendants[]=(int)$item->ID;$retired[(string)get_post_meta($item->ID,'_clonewp_header_module_item_key',true)]=(int)$item->ID;$changed=true;}}while($changed);
      $retireKeys=$mega?($payload['retireChildren']??[]):[];$actualKeys=array_keys($retired);sort($retireKeys);sort($actualKeys);
      if($actualKeys!==$retireKeys||count(array_unique($retireKeys))!==count($retireKeys))throw new RuntimeException('hmod_menu_content_leaf_required');
      if($retired&&(!defined('EMPTY_TRASH_DAYS')||EMPTY_TRASH_DAYS<1))throw new RuntimeException('hmod_menu_content_recoverable_trash_required');
      foreach($retired as $retiredId)if(get_post_meta($retiredId,'_clonewp_header_module_owner',true)!==$ownerToken||!current_user_can('delete_post',$retiredId))throw new RuntimeException('hmod_menu_content_retirement_not_owned');
      if($mega){
        $d=$payload['dropdown']??null;$dk=is_array($d)?array_keys($d):[];$df=$dropdownFields;sort($dk);sort($df);
        if($dk!==$df||!in_array($d['_menu_item_design'],['default','full-width','sized'],true)||!in_array($d['_menu_item_colorscheme'],['','light','dark'],true)||!in_array($d['_menu_item_event'],['hover','click'],true)||$d['_menu_item_dropdown-ajax']!=='no')throw new RuntimeException('hmod_dropdown_settings_invalid');
        if(!is_string($d['_menu_item_padding'])||($d['_menu_item_padding']!==''&&(!ctype_digit($d['_menu_item_padding'])||(int)$d['_menu_item_padding']>200)))throw new RuntimeException('hmod_dropdown_padding_invalid');
        foreach(['_menu_item_width'=>[200,2560],'_menu_item_height'=>[100,1600]] as $field=>$bounds){$v=$d[$field];if(!is_string($v)||($v!==''&&(!ctype_digit($v)||(int)$v<$bounds[0]||(int)$v>$bounds[1]))||($d['_menu_item_design']!=='sized'&&$v!=='')||($field==='_menu_item_width'&&$d['_menu_item_design']==='sized'&&$v===''))throw new RuntimeException('hmod_dropdown_dimensions_invalid');}
        $walker=file_get_contents(get_template_directory().'/inc/modules/mega-menu-walker/class-mega-menu-walker.php');foreach($dropdownFields as $field)if(!str_contains($walker,"'".$field."'"))throw new RuntimeException('hmod_dropdown_native_unsupported');
      }
      foreach($record['menuContent'] as $otherKey=>$binding)if($otherKey!==$key&&$binding['menuKey']===$menuKey&&$binding['itemKey']===$itemKey)throw new RuntimeException('hmod_menu_content_binding_occupied');
      $binding=$record['menuContent'][$key]??null;$bound=(int)get_post_meta($itemId,'_menu_item_block',true);
      if(($binding&&($binding['menuKey']!==$menuKey||$binding['itemKey']!==$itemKey))||($bound&&(!$binding||$bound!==(int)$binding['id'])))throw new RuntimeException('hmod_menu_content_binding_changed');
      if(!function_exists('wp_check_post_lock'))require_once ABSPATH.'wp-admin/includes/post.php';
      if($binding&&wp_check_post_lock($binding['id']))throw new RuntimeException('hmod_menu_content_editor_locked');
      if($binding&&!current_user_can('edit_post',$binding['id']))throw new RuntimeException('hmod_menu_content_permission_missing');
      $mediaById=[];if($mega){
        if(!is_array($payload['media']??null)||count($payload['media'])>100)throw new RuntimeException('hmod_menu_content_media_invalid');
        foreach($payload['media'] as $asset){$id=$asset['attachmentId']??0;$post=get_post($id);$file=function_exists('wp_get_original_image_path')?wp_get_original_image_path($id):get_attached_file($id);$real=$file?realpath($file):false;$upload=realpath(wp_get_upload_dir()['basedir']);
          if(!is_int($id)||isset($mediaById[$id])||!$post||$post->post_type!=='attachment'||!wp_attachment_is_image($id)||get_post_meta($id,'_clonewp_run_id',true)!==$owner['runId']||!in_array((int)$post->post_parent,$record['pages'],true)||wp_get_attachment_url($id)!==($asset['url']??null)||!str_starts_with($asset['url'],$origin.'/')||!preg_match('/^[a-f0-9]{64}$/',$asset['sha256']??'')||!$real||!$upload||!str_starts_with($real,$upload.DIRECTORY_SEPARATOR)||hash_file('sha256',$real)!==$asset['sha256'])throw new RuntimeException('hmod_menu_content_media_changed');$mediaById[$id]=$asset['url'];
        }
      }
      $usedMedia=[];$checkMedia=function($v)use(&$checkMedia,&$usedMedia,$mediaById){if(!is_array($v))return;if(array_key_exists('id',$v)&&array_key_exists('url',$v)&&$v['url']!==''){if(!is_numeric($v['id'])||($mediaById[(int)$v['id']]??null)!==$v['url'])throw new RuntimeException('hmod_menu_content_media_binding_invalid');$usedMedia[(int)$v['id']]=true;}foreach($v as $child)$checkMedia($child);};
      $productNodes=[];$walk=function($nodes)use(&$walk,&$productNodes,$mega,$checkMedia){foreach($nodes as $node){$type=($node['elType']??'')==='container'?'container':($node['widgetType']??'');$allowed=['container','heading','text-editor','wd_list','button','wd_button','wd_products'];if($mega)$allowed=array_merge($allowed,['wd_image_or_svg','image-box','divider']);if(!in_array($type,$allowed,true)||!preg_match('/^[a-f0-9]{7}$/',$node['id']??'')||!is_array($node['settings']??null))throw new RuntimeException('hmod_menu_content_element_invalid');if(!empty($node['settings']['custom_css']))throw new RuntimeException('hmod_menu_content_css_forbidden');if($mega)$checkMedia($node['settings']);if($type==='wd_products')$productNodes[$node['id']]=$node['settings'];$walk($node['elements']??[]);}};$walk($payload['elements']);
      if($mega&&count($usedMedia)!==count($mediaById))throw new RuntimeException('hmod_menu_content_media_unused');
      if(count($productNodes)!==count($payload['queries']))throw new RuntimeException('hmod_menu_content_queries_invalid');
      $queryIds=[];foreach($payload['queries'] as $query){$elementId=$query['elementId']??'';$settings=$productNodes[$elementId]??null;$ids=$query['productIds']??[];if(isset($queryIds[$elementId])||!$settings||($query['targetOrigin']??'')!==$origin||($query['provider']??'')!=='target-woocommerce'||($settings['post_type']??'')!=='ids'||($settings['include']??null)!==$ids||(int)($settings['items_per_page']??0)!==count($ids)||count($ids)<1||count($ids)>8)throw new RuntimeException('hmod_menu_content_query_binding_changed');$queryIds[$elementId]=true;foreach($ids as $id){$product=wc_get_product($id);if(!$product||$product->get_status()!=='publish'||!$product->is_visible())throw new RuntimeException('hmod_menu_content_product_changed');}}
    }elseif($action==='style'){
      $css=$payload['css']??null;if(!is_string($css)||strlen($css)>1048576||str_contains($css,'<')||str_contains($css,"\0"))throw new RuntimeException('hmod_style_invalid');
    }elseif($action==='header'){
      $raw=$payload['raw']??null;if(!is_array($raw)||($raw['id']??'')!==$headerId||!is_string($raw['name']??null)||trim($raw['name'])===''||strlen($raw['name'])>800||preg_match('/[\x00-\x1f\x7f]/',$raw['name'])||!is_array($raw['structure']??null)||!is_array($raw['settings']??null)||empty($record['styleId']))throw new RuntimeException('hmod_header_input_invalid');
    }elseif($action==='create-page'){
      $title=$payload['title']??'';$slug=$payload['slug']??'';if(!is_string($title)||trim($title)===''||strlen($title)>800||!preg_match('/^[a-z0-9][a-z0-9-]{0,159}$/',$slug)||get_page_by_path($slug))throw new RuntimeException('hmod_page_identity_occupied');
    }elseif($action==='bind'){
      $pageId=$payload['pageId']??0;if(!is_int($pageId)||!in_array($pageId,$record['pages']??[],true)||get_post_meta($pageId,'_clonewp_header_module_owner',true)!==$ownerToken)throw new RuntimeException('hmod_page_not_owned');
      if(!function_exists('wp_check_post_lock'))require_once ABSPATH.'wp-admin/includes/post.php';$p=$pageObservation($pageId);if(!$p||$p['postType']!=='page'||$p['status']!=='draft'||$p['template']!=='elementor_header_footer'||$p['runId']!==$owner['runId']||($p['headerId']!==null&&$p['headerId']!==$headerId)||$p['bodyHash']!==($payload['expectedBodyHash']??'')||wp_check_post_lock($pageId)||!get_option('whb_'.$headerId))throw new RuntimeException('hmod_page_binding_precondition_changed');
    }
    if($action==='reserve'){
      if($record!==null||get_option('whb_'.$headerId,null)!==null||isset(get_option('whb_saved_headers',[])[$headerId]))throw new RuntimeException('hmod_resource_exists');
      $name=$payload['name']??'';if(!is_string($name)||trim($name)===''||strlen($name)>800)throw new RuntimeException('hmod_name_invalid');
      if(($payload['menuContent']??false)===true)$menuContentContract();
      $record=['identity'=>$identity,'name'=>$name,'menus'=>[],'styleId'=>null,'pages'=>[],'receipts'=>[]];if(!add_option($moduleOption,$record,'','no'))throw new RuntimeException('hmod_reservation_conflict');
      if(($payload['menuContent']??false)===true){$record['menuContent']=[];update_option($moduleOption,$record,false);}
    }elseif($record===null)throw new RuntimeException('hmod_reservation_missing');
    $record['receipts'][$operationId]=['action'=>$action,'payloadHash'=>$requestHash,'state'=>'started'];update_option($moduleOption,$record,false);
    $persist=static function()use(&$record,$moduleOption){update_option($moduleOption,$record,false);};
    $result=null;
    if($action==='reserve')$result=['reserved'=>true];
    elseif($action==='menu'){
      $key=$payload['key']??'';$name=$payload['name']??'';$items=$payload['items']??[];if(!preg_match('/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/',$key)||!is_string($name)||trim($name)===''||strlen($name)>400||!is_array($items)||!$items||count($items)>200)throw new RuntimeException('hmod_menu_input_invalid');
      $menuId=$record['menus'][$key]??null;if($menuId===null){if(wp_get_nav_menu_object($name))throw new RuntimeException('hmod_menu_name_occupied');$menuId=wp_create_nav_menu($name);if(is_wp_error($menuId))throw new RuntimeException('hmod_menu_create_failed');update_term_meta($menuId,'_clonewp_header_module_owner',$ownerToken);$record['menus'][$key]=(int)$menuId;$persist();}
      if(get_term_meta($menuId,'_clonewp_header_module_owner',true)!==$ownerToken)throw new RuntimeException('hmod_menu_ownership_changed');
      $renamed=wp_update_nav_menu_object($menuId,['menu-name'=>$name]);if(is_wp_error($renamed))throw new RuntimeException('hmod_menu_update_failed');
      $existing=[];foreach(wp_get_nav_menu_items($menuId,['post_status'=>'any'])?:[] as $item){if(get_post_meta($item->ID,'_clonewp_header_module_owner',true)!==$ownerToken)throw new RuntimeException('hmod_menu_item_ownership_changed');$existing[(string)get_post_meta($item->ID,'_clonewp_header_module_item_key',true)]=$item->ID;}
      $created=[];$position=0;foreach($items as $item){$itemKey=$item['key']??'';$parent=$item['parentKey']??null;$url=$item['url']??'';$title=$item['title']??'';if(!preg_match('/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/',$itemKey)||isset($created[$itemKey])||($parent!==null&&!isset($created[$parent]))||!is_string($title)||trim($title)===''||!is_string($url)||!preg_match('~^https://[^/@]+(?:/|$)~',$url)||!empty(wp_parse_url($url,PHP_URL_USER))||!empty(wp_parse_url($url,PHP_URL_PASS)))throw new RuntimeException('hmod_menu_item_invalid');
        $itemId=wp_update_nav_menu_item($menuId,$existing[$itemKey]??0,['menu-item-title'=>$title,'menu-item-url'=>$url,'menu-item-status'=>'publish','menu-item-type'=>'custom','menu-item-parent-id'=>$parent===null?0:$created[$parent],'menu-item-position'=>++$position]);if(is_wp_error($itemId))throw new RuntimeException('hmod_menu_item_write_failed');update_post_meta($itemId,'_clonewp_header_module_owner',$ownerToken);update_post_meta($itemId,'_clonewp_header_module_item_key',$itemKey);$created[$itemKey]=$itemId;
      }
      if(isset($payload['images']))foreach($created as $itemKey=>$itemId){if(isset($imageKeys[$itemKey])){set_post_thumbnail($itemId,$imageKeys[$itemKey]);update_post_meta($itemId,'_menu_item_image-type','image');}else{delete_post_thumbnail($itemId);delete_post_meta($itemId,'_menu_item_image-type');}if((int)get_post_thumbnail_id($itemId)!==($imageKeys[$itemKey]??0))throw new RuntimeException('hmod_menu_media_readback_failed');}
      foreach($existing as $itemKey=>$itemId)if(!isset($created[$itemKey]))wp_delete_post($itemId,true);
      $result=['menuId'=>(int)$menuId,'count'=>count($created)];
    }elseif($action==='menu-content'){
      $key=$payload['key'];$binding=$record['menuContent'][$key]??null;
      if(!$binding){$blockId=wp_insert_post(['post_type'=>'cms_block','post_status'=>'publish','post_title'=>$payload['name'],'post_content'=>'','meta_input'=>['_clonewp_header_module_owner'=>$ownerToken,'_clonewp_run_id'=>$owner['runId'],'_elementor_edit_mode'=>'builder','_elementor_template_type'=>'wp-post']],true);if(is_wp_error($blockId))throw new RuntimeException('hmod_menu_content_create_failed');$binding=['id'=>(int)$blockId,'menuKey'=>$payload['menuKey'],'itemKey'=>$payload['itemKey'],'programHash'=>$payload['programHash']];$record['menuContent'][$key]=$binding;$persist();}
      $blockId=$binding['id'];if(get_post_meta($blockId,'_clonewp_header_module_owner',true)!==$ownerToken||get_post_type($blockId)!=='cms_block')throw new RuntimeException('hmod_menu_content_ownership_changed');
      $saved=wp_update_post(['ID'=>$blockId,'post_title'=>$payload['name']],true);if(is_wp_error($saved))throw new RuntimeException('hmod_menu_content_save_failed');
      $document=\Elementor\Plugin::$instance->documents->get($blockId,false);if(!$document)throw new RuntimeException('hmod_menu_content_document_unavailable');
      $saved=$document->save(['elements'=>$payload['elements'],'settings'=>$payload['settings']]);if(!$saved)throw new RuntimeException('hmod_menu_content_save_failed');
      $record['menuContent'][$key]['programHash']=$payload['programHash'];$persist();
      update_post_meta($itemId,'_menu_item_block',(string)$blockId);
      if($mega){foreach($payload['dropdown'] as $field=>$value){update_post_meta($itemId,$field,$value);if((string)get_post_meta($itemId,$field,true)!==$value)throw new RuntimeException('hmod_dropdown_readback_failed');}$record['menuContent'][$key]['version']=2;$persist();}
      else{update_post_meta($itemId,'_menu_item_design','full-width');update_post_meta($itemId,'_menu_item_dropdown-ajax','no');}
      $itemAfterMeta=get_post_meta($itemId);foreach($changedFields as $field)unset($itemAfterMeta[$field]);if($itemAfterMeta!==$itemProtectedMeta)throw new RuntimeException('hmod_menu_content_item_changed');
      $actual=$menuContentObservation($record['menuContent'][$key]);
      $canonical=function($value)use(&$canonical){if(is_array($value)){if(!array_is_list($value))ksort($value,SORT_STRING);foreach($value as $k=>$v)$value[$k]=$canonical($v);}elseif(is_object($value))return $canonical((array)$value);return $value;};
      if($canonical($actual['elements'])!==$canonical($payload['elements'])||$canonical($actual['settings'])!==$canonical($payload['settings'])||(int)get_post_meta($itemId,'_menu_item_block',true)!==$blockId)throw new RuntimeException('hmod_menu_content_readback_failed');
      if(!str_contains(woodmart_html_block_shortcode(['id'=>$blockId]),'data-elementor-id="'.$blockId.'"'))throw new RuntimeException('hmod_menu_content_render_unconfirmed');
      foreach(array_reverse($retired) as $retiredId){if(!wp_trash_post($retiredId)||get_post_status($retiredId)!=='trash')throw new RuntimeException('hmod_menu_content_retirement_unconfirmed');}
      $result=['contentBlockId'=>$blockId,'menuItemId'=>$itemId];if($mega)$result['retiredItemIds']=array_values($retired);
    }elseif($action==='style'){
      if(!post_type_exists('cms_block')||!current_user_can('unfiltered_html')||!function_exists('woodmart_get_html_block'))throw new RuntimeException('hmod_native_style_unavailable');
      $css=$payload['css']??null;if(!is_string($css)||strlen($css)>1048576||str_contains($css,'<')||str_contains($css,"\0"))throw new RuntimeException('hmod_style_invalid');
      $content='<style data-clonewp-header-module="'.esc_attr($moduleKey).'">'.$css.'</style>';
      $styleId=$record['styleId']??null;if($styleId===null){$styleId=wp_insert_post(['post_type'=>'cms_block','post_status'=>'publish','post_title'=>$record['name'].' styles','post_content'=>wp_slash($content),'meta_input'=>['_clonewp_header_module_owner'=>$ownerToken]],true);if(is_wp_error($styleId))throw new RuntimeException('hmod_style_create_failed');$record['styleId']=(int)$styleId;$persist();}
      else{if(get_post_meta($styleId,'_clonewp_header_module_owner',true)!==$ownerToken||get_post_type($styleId)!=='cms_block')throw new RuntimeException('hmod_style_ownership_changed');$saved=wp_update_post(['ID'=>$styleId,'post_content'=>wp_slash($content)],true);if(is_wp_error($saved))throw new RuntimeException('hmod_style_update_failed');}
      if(get_post_field('post_content',$styleId)!==$content||!str_contains(woodmart_get_html_block($styleId),'data-clonewp-header-module="'.$moduleKey.'"'))throw new RuntimeException('hmod_style_render_unconfirmed');$result=['styleBlockId'=>(int)$styleId];
    }elseif($action==='header'){
      $raw=$payload['raw']??null;if(!is_array($raw)||($raw['id']??'')!==$headerId||!is_string($raw['name']??null)||trim($raw['name'])===''||strlen($raw['name'])>800||preg_match('/[\x00-\x1f\x7f]/',$raw['name'])||!is_array($raw['structure']??null)||!is_array($raw['settings']??null)||empty($record['styleId']))throw new RuntimeException('hmod_header_input_invalid');
      $styleFound=0;$native=$nativeContract();$types=[];foreach($native['elements'] as $definition)$types[$definition['type']]=true;$styleType=$native['styleElement']['type'];
      $elementPrefix='cw-'.substr(hash('sha256',$moduleKey),0,12).'-';
      $verify=function($node)use(&$verify,&$styleFound,$record,$types,$styleType,$origin,$elementPrefix){$type=$node['type']??'';if(in_array($type,['root','row','column'],true)){foreach($node['content']??[] as $child)$verify($child);return;}if(!str_starts_with($node['id']??'',$elementPrefix))throw new RuntimeException('hmod_element_identity_changed');if($type===$styleType){if((string)($node['params']['block_id']['value']??'')!==(string)$record['styleId'])throw new RuntimeException('hmod_style_binding_changed');$styleFound++;return;}if(!isset($types[$type]))throw new RuntimeException('hmod_header_element_unsupported');foreach($node['params']??[] as $key=>$param){if($key==='menu_id'){$found=false;foreach($record['menus'] as $menuId){$m=wp_get_nav_menu_object($menuId);if($m&&$m->slug===($param['value']??null))$found=true;}if(!$found)throw new RuntimeException('hmod_menu_binding_changed');}if(($param['type']??'')==='image'&&!empty($param['value'])){$id=$param['value']['id']??0;$image=wp_get_attachment_image_src($id,'full');if(!$image||$image[0]!==($param['value']['url']??null)||(int)$image[1]!==($param['value']['width']??null)||(int)$image[2]!==($param['value']['height']??null)||strpos($image[0],$origin.'/')!==0)throw new RuntimeException('hmod_image_binding_changed');}}};$verify($raw['structure']);if($styleFound!==1)throw new RuntimeException('hmod_style_binding_missing');
      $record['name']=$raw['name'];$persist();$builder=\XTS\Modules\Header_Builder::get_instance();if(get_option('whb_'.$headerId,null)===null)$builder->factory->create_new($headerId,$record['name'],$raw['structure'],$raw['settings']);else $builder->factory->update_header($headerId,$record['name'],$raw['structure'],$raw['settings']);
      $builder->list->add_header($headerId,$record['name']);
      // Native save and canonical JSON use different object-key insertion order.
      // Normalize this header readback only; protected-state hashes stay unchanged.
      $headerReadbackValue=function($value)use(&$headerReadbackValue){
        if(is_array($value)){if(!array_is_list($value))ksort($value,SORT_STRING);foreach($value as $key=>$child)$value[$key]=$headerReadbackValue($child);}
        elseif(is_object($value)){$properties=get_object_vars($value);ksort($properties,SORT_STRING);$sorted=clone $value;foreach(array_keys($properties) as $key)unset($sorted->$key);foreach($properties as $key=>$child)$sorted->$key=$headerReadbackValue($child);return $sorted;}
        return $value;
      };
      if($digest($headerReadbackValue(get_option('whb_'.$headerId)))!==$digest($headerReadbackValue($raw)))throw new RuntimeException('hmod_header_readback_failed');$result=['headerId'=>$headerId];
    }elseif($action==='create-page'){
      $title=$payload['title']??'';$slug=$payload['slug']??'';if(!is_string($title)||trim($title)===''||strlen($title)>800||!preg_match('/^[a-z0-9][a-z0-9-]{0,159}$/',$slug)||get_page_by_path($slug))throw new RuntimeException('hmod_page_identity_occupied');
      $pageId=wp_insert_post(['post_type'=>'page','post_status'=>'draft','post_title'=>$title,'post_name'=>$slug,'post_content'=>'','meta_input'=>['_clonewp_run_id'=>$owner['runId'],'_clonewp_header_module_owner'=>$ownerToken,'_wp_page_template'=>'elementor_header_footer']],true);if(is_wp_error($pageId))throw new RuntimeException('hmod_page_create_failed');$record['pages'][]=(int)$pageId;$persist();$result=['pageId'=>(int)$pageId];
    }elseif($action==='bind'){
      $pageId=$payload['pageId']??0;if(!is_int($pageId)||!in_array($pageId,$record['pages'],true)||get_post_meta($pageId,'_clonewp_header_module_owner',true)!==$ownerToken)throw new RuntimeException('hmod_page_not_owned');
      if(!function_exists('wp_check_post_lock'))require_once ABSPATH.'wp-admin/includes/post.php';$p=$pageObservation($pageId);if(!$p||$p['postType']!=='page'||$p['status']!=='draft'||$p['template']!=='elementor_header_footer'||$p['runId']!==$owner['runId']||($p['headerId']!==null&&$p['headerId']!==$headerId)||$p['bodyHash']!==($payload['expectedBodyHash']??'')||wp_check_post_lock($pageId)||!get_option('whb_'.$headerId))throw new RuntimeException('hmod_page_binding_precondition_changed');
      update_post_meta($pageId,'_woodmart_whb_header',$headerId);$afterPage=$pageObservation($pageId);if($afterPage['bodyHash']!==$p['bodyHash']||$afterPage['headerId']!==$headerId)throw new RuntimeException('hmod_page_binding_readback_failed');$result=['pageId'=>$pageId,'headerId'=>$headerId,'bodyHash'=>$p['bodyHash']];
    }
    $after=$snapshot();if($after['globalHash']!==$beforeGlobal)throw new RuntimeException('hmod_protected_resources_changed');
    $record['receipts'][$operationId]=['action'=>$action,'payloadHash'=>$requestHash,'state'=>'complete','result'=>$result];$persist();$after=$snapshot();
    return ['ok'=>true,'value'=>['snapshot'=>$after,'hash'=>$digest($after),'result'=>$result]];
  }finally{if(get_option($lock)===$lockValue)delete_option($lock);}
}catch(\Throwable $error){$message=$error->getMessage();return ['ok'=>false,'code'=>preg_match('/^hmod_[a-z0-9_]{1,100}$/',$message)?substr($message,5):'server_operation_failed'];}
