<?php
namespace Elementor {
  class Plugin { public static $instance; }
}
namespace {
  $GLOBALS['options']=['xts-woodmart-options'=>['footer_content_type'=>'html_block','footer_html_block'=>'7'],'whb_main_header'=>'header_9'];
  $GLOBALS['posts']=[7=>(object)['ID'=>7,'post_type'=>'cms_block','post_status'=>'publish','post_title'=>'Original footer','post_name'=>'old','post_content'=>'old footer']];
  $GLOBALS['meta']=[7=>['_elementor_data'=>'[]','_elementor_page_settings'=>['custom_css'=>'old']]];$GLOBALS['nextId']=100;
  function current_user_can(...$args){return true;}
  function get_template(){return 'woodmart';}
  function post_type_exists($type){return true;}
  function home_url($p='/'){return 'https://target.example'.$p;}
  function untrailingslashit($s){return rtrim($s,'/');}
  function wp_check_post_lock($id){return false;}
  function get_option($key,$default=false){return $GLOBALS['options'][$key]??$default;}
  function add_option($key,$value,...$rest){if(array_key_exists($key,$GLOBALS['options']))return false;$GLOBALS['options'][$key]=$value;return true;}
  function update_option($key,$value,...$rest){$GLOBALS['options'][$key]=$value;return true;}
  function delete_option($key){unset($GLOBALS['options'][$key]);return true;}
  function get_post($id){return $GLOBALS['posts'][$id]??null;}
  function get_post_meta($id,$key,$single=true){return $GLOBALS['meta'][$id][$key]??'';}
  function update_post_meta($id,$key,$value){$GLOBALS['meta'][$id][$key]=$value;}
  function delete_post_meta($id,$key){unset($GLOBALS['meta'][$id][$key]);}
  function get_posts($args){return array_values(array_filter($GLOBALS['posts'],static function($p)use($args){if($p->post_type!==$args['post_type'])return false;foreach($args['meta_query']??[] as $q)if(get_post_meta($p->ID,$q['key'],true)!==$q['value'])return false;return true;}));}
  function wp_unique_post_slug($slug,...$rest){return $slug;}
  function sanitize_title($slug){return $slug;}
  function wp_insert_post($args,$error=false){$id=$GLOBALS['nextId']++;$GLOBALS['posts'][$id]=(object)['ID'=>$id,'post_type'=>$args['post_type'],'post_status'=>$args['post_status'],'post_title'=>$args['post_title'],'post_name'=>$args['post_name'],'post_content'=>$args['post_content']];$GLOBALS['meta'][$id]=$args['meta_input'];return $id;}
  function wp_update_post($args,$error=false){foreach($args as $k=>$v)if($k!=='ID')$GLOBALS['posts'][$args['ID']]->$k=$v;return $args['ID'];}
  function is_wp_error($v){return false;}
  class FixtureDocument {
    function __construct(private $id){}
    function is_editable_by_current_user(){return true;}
    function set_is_built_with_elementor($v){}
    function save($data){update_post_meta($this->id,'_elementor_data',json_encode($data['elements']));update_post_meta($this->id,'_elementor_page_settings',$data['settings']);return true;}
  }
  \Elementor\Plugin::$instance=(object)[
    'documents'=>new class {function get($id,$cache=false){return new FixtureDocument($id);}},
    'widgets_manager'=>new class {function get_widget_types($type){return $type==='heading'?(object)[]:null;}},
    'controls_manager'=>new class {function clear_stack_cache(){}},
    'breakpoints'=>new class {private $mode='on';function get_responsive_control_duplication_mode(){return $this->mode;}function set_responsive_control_duplication_mode($v){$this->mode=$v;}},
  ];
  $identity=['targetOrigin'=>'https://target.example','runId'=>'new-footer-run','contractHash'=>str_repeat('a',64)];
  $source=file_get_contents(dirname(__DIR__,2).'/src/replica-full/public-driver.php');token_get_all("<?php\n".$source,TOKEN_PARSE);
  function invoke($action,$payload=[],$before=null,$operation=null){global $identity,$source;$input=$identity+['action'=>$action];if($action!=='inspect')$input+=['payload'=>$payload,'expectedHash'=>$before['hash'],'operationId'=>$operation??uniqid('op_')];return eval($source);}
  function inspect(){return invoke('inspect')['value'];}
  function must($value,$message){if(!$value)throw new \RuntimeException($message);}
  $old=serialize([$GLOBALS['posts'][7],$GLOBALS['meta'][7],get_option('xts-woodmart-options')]);
  $before=inspect();$result=invoke('create-preview',['title'=>'New preview','slug'=>'new-preview'],$before);must($result['ok'],'Preview create failed');$preview=$result['value']['snapshot']['preview']['id'];
  $before=inspect();$result=invoke('create-footer',['title'=>'New footer','slug'=>'new-footer'],$before);must($result['ok'],'Footer create failed');$footer=$result['value']['snapshot']['footer']['id'];must($preview!==$footer,'Footer is a page copy');
  $elements=[['id'=>'abc1234','elType'=>'widget','widgetType'=>'heading','settings'=>['title'=>'New footer'],'elements'=>[]]];
  $result=invoke('save-footer',['elements'=>$elements,'settings'=>['custom_css'=>'.elementor-'.$footer.'{color:white}']],inspect());must($result['ok'],'Native footer save failed');
  $result=invoke('save-preview',[],inspect());must($result['ok'],'Preview bind failed');must(get_post($preview)->post_content==='[html_block id="'.$footer.'"]','Preview did not reference the independent footer');
  must($old===serialize([$GLOBALS['posts'][7],$GLOBALS['meta'][7],get_option('xts-woodmart-options')]),'Old footer or global settings changed');
  $count=count($GLOBALS['posts']);$result=invoke('create-footer',['title'=>'Duplicate','slug'=>'duplicate'],inspect());must(!$result['ok']&&count($GLOBALS['posts'])===$count,'Duplicate footer was created');
  $option='clonewp_public_'.hash('sha256',$identity['runId']);$r=get_option($option);$r['receipts']=[];update_option($option,$r);
  $before=inspect();$result=invoke('save-preview',[],$before);must($result['ok'],'Clean repeat bind failed');
  $result=invoke('save-preview',[],$before);must(!$result['ok']&&$result['code']==='public_snapshot_changed','Stale snapshot was accepted');
  $r=get_option($option);$r['receipts']['unknown']=['state'=>'started'];update_option($option,$r);$result=invoke('save-preview',[],inspect());must(!$result['ok']&&$result['code']==='public_reconcile_required','Unknown write was retried');
  must(\Elementor\Plugin::$instance->breakpoints->get_responsive_control_duplication_mode()==='on','Editor context was not restored');
  echo "public resource ownership, CAS, native save and preview passed\n";
}
