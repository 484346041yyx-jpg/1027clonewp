/** Read-only, fixed helpers for the independent WoodMart header workflow. */
export const inspectHeaderPHP = `
if (!current_user_can('edit_theme_options')) { throw new RuntimeException('header_permission_missing'); }
global $wpdb;
$id='header_193941'; $raw=get_option('whb_'.$id); $opts=get_option('xts-woodmart-options',[]);
$refs=$wpdb->get_results($wpdb->prepare("SELECT post_id,meta_key FROM {$wpdb->postmeta} WHERE meta_value LIKE %s",'%'.$wpdb->esc_like($id).'%'),ARRAY_A);
$optionRefs=$wpdb->get_results($wpdb->prepare("SELECT option_name,option_value FROM {$wpdb->options} WHERE option_value LIKE %s",'%'.$wpdb->esc_like($id).'%'),ARRAY_A);
$optionAudit=[];foreach($optionRefs as $r){$optionAudit[]=['name'=>$r['option_name'],'sha256'=>hash('sha256',$r['option_value']),'cssIdReference'=>str_contains($r['option_value'],'whb-'.$id)];}
$menus=[];foreach(wp_get_nav_menus() as $m){$items=wp_get_nav_menu_items($m->term_id)?:[];$rows=[];foreach($items as $i){$rows[]=['id'=>$i->ID,'parent'=>$i->menu_item_parent,'title'=>$i->title,'url'=>$i->url,'order'=>$i->menu_order,'metaHash'=>hash('sha256',serialize(get_post_meta($i->ID)))];}$menus[]=['id'=>$m->term_id,'name'=>$m->name,'slug'=>$m->slug,'items'=>$rows];}
$headerOpts=[];foreach($opts as $k=>$v){if(str_contains($k,'header')&& !is_array($v)&& !is_object($v))$headerOpts[$k]=$v;}
$files=[];$base=get_template_directory().'/inc/modules/header-builder/';foreach(['class-manager.php','class-factory.php','class-header.php','class-frontend.php','elements/Logo.php','elements/Mainmenu.php','elements/Account.php','elements/Cart.php'] as $f){if(is_file($base.$f))$files[$f]=file_get_contents($base.$f);}
$callbacks=[];foreach(['woodmart_get_current_header_id','woodmart_header_builder_header_class'] as $tag){$callbacks[$tag]=[];if(isset($GLOBALS['wp_filter'][$tag])){foreach($GLOBALS['wp_filter'][$tag]->callbacks as $pri=>$cbs)foreach($cbs as $cb){$f=$cb['function'];$callbacks[$tag][]=['priority'=>$pri,'callback'=>is_string($f)?$f:(is_array($f)?(is_object($f[0])?get_class($f[0]):$f[0]).'::'.$f[1]:'closure')];}}}
$old=get_post(15769);$pageHash=hash('sha256',serialize([$old->post_title,$old->post_content,$old->post_status,get_post_meta(15769)]));
$theme=wp_get_theme(get_template());
return ['theme'=>['name'=>$theme->get('Name'),'version'=>$theme->get('Version')],'header'=>$raw,'headerHash'=>hash('sha256',serialize($raw)),'savedHeaders'=>get_option('whb_saved_headers'),'mainHeader'=>get_option('whb_main_header'),'themeHeaderOptions'=>$headerOpts,'themeOptionsHash'=>hash('sha256',serialize($opts)),'menuLocations'=>get_nav_menu_locations(),'menus'=>$menus,'postReferences'=>$refs,'optionReferences'=>$optionAudit,'headerFilters'=>$callbacks,'sourceFiles'=>$files,'oldPageHash'=>$pageHash,'themeModsHash'=>hash('sha256',serialize(get_theme_mods()))];
`;
