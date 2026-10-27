import { NATIVE44_REQUEST_GENERATED_SYNC_CONTRACTS } from '../native44/selection.js';

const syncContractsBase64 = Buffer.from(JSON.stringify(NATIVE44_REQUEST_GENERATED_SYNC_CONTRACTS)).toString('base64');
/** Fixed read-only native/environment proof. No source-page text is interpolated as PHP. */
export const nativeCheckpointPHP = (typesExpression: string): string => `
$checkpointProof=(static function($types){
  if(!defined('ELEMENTOR_VERSION')||!class_exists('Elementor\\Plugin')){throw new RuntimeException('elementor_missing');}
  $p=\\Elementor\\Plugin::$instance;$proof=['versions'=>['elementor'=>ELEMENTOR_VERSION,'wordpress'=>get_bloginfo('version'),'php'=>PHP_VERSION],'widgets'=>[],'files'=>[]];
  if(defined('ELEMENTOR_PRO_VERSION')){$proof['versions']['elementorPro']=ELEMENTOR_PRO_VERSION;}if(defined('NOVAMIRA_VERSION')){$proof['versions']['novamira']=NOVAMIRA_VERSION;}
  $proof['atomicActive']=isset($p->experiments)&&$p->experiments->is_feature_active('e_atomic_elements');
  $originalMode=$p->breakpoints->get_responsive_control_duplication_mode();$proof['responsive']=['active'=>$p->breakpoints->get_active_devices_list(['reverse'=>true,'desktop_first'=>true]),'originalDuplicationMode'=>$originalMode,'breakpoints'=>[]];
  foreach($p->breakpoints->get_active_breakpoints()as$name=>$point){$proof['responsive']['breakpoints'][$name]=['value'=>$point->get_value(),'direction'=>$point->get_direction()];}
  $frontend=null;$originalFrontend=null;if(class_exists('Elementor\\Core\\Frontend\\Performance')){$frontend=new ReflectionProperty('Elementor\\Core\\Frontend\\Performance','is_frontend');$frontend->setAccessible(true);$originalFrontend=$frontend->getValue();$frontend->setValue(null,false);}
  $p->breakpoints->set_responsive_control_duplication_mode('on');$p->controls_manager->clear_stack_cache();
  $knownSyncContracts=json_decode(base64_decode('${syncContractsBase64}'),true);
  try{foreach($types as$type){
    $obj=$p->widgets_manager->get_widget_types($type);if(!$obj){$all=$p->elements_manager->get_element_types();$obj=$all[$type]??null;}if(!$obj||!method_exists($obj,'get_controls')){throw new RuntimeException('checkpoint_widget_missing');}
    $stack=$obj->get_stack();$allControls=array_merge($stack['controls']??[],$stack['style_controls']??[]);$controls=[];
    foreach($allControls as$key=>$control){$item=[];foreach(['type','label','default','options','condition','conditions','selectors','responsive','fields','min','max','step','range','size_units','separator','frontend_available','render_type','save_default']as$field){if(array_key_exists($field,$control)){$item[$field]=$control[$field];}}$controls[$key]=$item;}
    // Exclude only the proved per-request value under the exact class/control condition contract.
    $generatedSyncDefaultNormalized=false;$sync=$controls['sync_parent_id']??null;$syncContract=$knownSyncContracts[$type]??null;$exactSyncCondition=false;
    if($syncContract&&is_array($sync['condition']??null)&&count($sync['condition'])===count($syncContract['condition'])){$exactSyncCondition=true;foreach($syncContract['condition']as$key=>$expectedValue){if(!array_key_exists($key,$sync['condition'])||$sync['condition'][$key]!==$expectedValue){$exactSyncCondition=false;break;}}}
    if($syncContract&&get_class($obj)===$syncContract['class']&&($sync['type']??'')==='text'&&is_string($sync['default']??null)&&preg_match('/^wd_[a-f0-9]{13}$/',$sync['default'])&&$exactSyncCondition&&!array_key_exists('conditions',$sync)){unset($controls['sync_parent_id']['default']);$generatedSyncDefaultNormalized=true;}
    $proof['widgets'][$type]=['class'=>get_class($obj),'controls'=>$controls,'requestGeneratedSyncDefaultNormalized'=>$generatedSyncDefaultNormalized];
    for($class=new ReflectionClass($obj);$class;$class=$class->getParentClass()){$file=$class->getFileName();if($file){$proof['files'][$class->getName()]=hash_file('sha256',$file);}}
  }}finally{$p->breakpoints->set_responsive_control_duplication_mode($originalMode);if($frontend){$frontend->setValue(null,$originalFrontend);}$p->controls_manager->clear_stack_cache();}
  foreach([['Elementor\\Core\\Base\\Document','save'],['Elementor\\Core\\Base\\Document','get_elements_data'],['Elementor\\Controls_Stack','add_responsive_control'],['Elementor\\Core\\Files\\CSS\\Base','parse_content']]as$entry){$method=new ReflectionMethod($entry[0],$entry[1]);$proof['files'][$entry[0].'::'.$entry[1]]=hash_file('sha256',$method->getFileName());}
  $kit=(int)get_option('elementor_active_kit');$theme=wp_get_theme();$proof['globalPresentation']=['kit'=>$kit,'kitSettings'=>get_post_meta($kit,'_elementor_page_settings',true),'theme'=>$theme->get_stylesheet(),'template'=>$theme->get_template(),'themeVersion'=>$theme->get('Version'),'themeMods'=>get_theme_mods(),'customCSS'=>wp_get_custom_css(),'woodmartOptions'=>get_option('xts-woodmart-options'), 'legacyWoodmartOptions'=>get_option('woodmart_options'),'plugins'=>get_option('active_plugins')];
  foreach(array_unique([get_stylesheet_directory().'/style.css',get_template_directory().'/style.css'])as$file){if(is_file($file)){$proof['files']['theme:'.basename(dirname($file))]=hash_file('sha256',$file);}}
  $normalize=function($value)use(&$normalize){if(!is_array($value)){return$value;}$keys=array_keys($value);if($keys!==range(0,count($value)-1)){ksort($value,SORT_STRING);}foreach($value as$key=>$child){$value[$key]=$normalize($child);}return$value;};
  $types=array_values(array_unique($types));sort($types,SORT_STRING);return['version'=>1,'sha256'=>hash('sha256',json_encode($normalize($proof))),'types'=>$types];
})(${typesExpression});
`;
