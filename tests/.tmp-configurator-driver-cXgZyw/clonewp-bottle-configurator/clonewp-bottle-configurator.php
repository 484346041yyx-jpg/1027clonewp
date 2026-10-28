<?php
/**
 * Plugin Name: cloneWP Bottle Configurator
 * Description: Native Elementor bottle configuration with an existing native Form submission owner.
 * Version: 0.1.0
 */
if (!defined('ABSPATH')) exit;

function cwp_bc_normalize($settings) {
    $result = ['version'=>1, 'title'=>sanitize_text_field($settings['title'] ?? ''), 'bottles'=>[], 'pumps'=>[], 'caps'=>[], 'decorations'=>[], 'fonts'=>[],
        'logoArea'=>['x'=>20,'y'=>45,'width'=>60,'height'=>35],
        'form'=>['widgetId'=>sanitize_key($settings['form_widget'] ?? ''),'summaryField'=>sanitize_key($settings['summary_field'] ?? ''),'uploadField'=>sanitize_key($settings['upload_field'] ?? '')]];
    foreach (['x','y','width','height'] as $key) if (isset($settings['logo_'.$key])) $result['logoArea'][$key]=(float)$settings['logo_'.$key];
    $asset = static function($a) {
        $id=absint($a['id']??0); $url=$id?wp_get_attachment_url($id):false;
        if (!$id || !$url || strpos($url,'https://')!==0 || strpos((string)get_post_mime_type($id),'image/')!==0) throw new RuntimeException('configurator_local_media_required');
        return ['id'=>$id,'url'=>$url];
    };
    foreach (($settings['options']??[]) as $row) {
        $part=$row['part']??''; if(!in_array($part,['bottles','pumps','caps'],true)) throw new RuntimeException('configurator_part');
        $attrs=json_decode($row['attributes']??'{}',true); if(!is_array($attrs)) throw new RuntimeException('configurator_attributes');
        $image=$asset($row['image']??[]); $preview=$asset(($row['preview']['id']??0)?$row['preview']:($row['image']??[]));
        $result[$part][]=['id'=>sanitize_key($row['option_id']??''),'label'=>sanitize_text_field($row['label']??''),'image'=>$image,'preview'=>$preview,
            'position'=>['x'=>(float)($row['x']??0),'y'=>(float)($row['y']??0),'width'=>(float)($row['width']??100),'height'=>(float)($row['height']??100)],
            'attributes'=>(object)array_map('sanitize_text_field',$attrs), 'fit'=>array_values(array_filter(array_map('sanitize_key',explode(',',$row['fit']??''))))];
    }
    foreach (($settings['decorations']??[]) as $row) {
        $overlays=[]; foreach (($settings['overlays']??[]) as $overlay) if (($overlay['decoration_id']??'')===($row['option_id']??'')) $overlays[]=['bottleId'=>sanitize_key($overlay['bottle_id']??''),'image'=>$asset($overlay['image']??[])];
        $result['decorations'][]=['id'=>sanitize_key($row['option_id']??''),'label'=>sanitize_text_field($row['label']??''),'category'=>sanitize_text_field($row['category']??''),'finish'=>sanitize_text_field($row['finish']??''),'image'=>$asset($row['image']??[]),'overlays'=>$overlays];
    }
    foreach (($settings['fonts']??[]) as $row) $result['fonts'][]=['id'=>sanitize_key($row['option_id']??''),'label'=>sanitize_text_field($row['label']??''),'family'=>sanitize_text_field($row['family']??'')];
    return $result;
}

/** Resolve the submitted IDs against the saved document. Never trust posted names, prices or asset URLs. */
function cwp_bc_quote($catalog,$payload) {
    if(!is_array($payload)||($payload['version']??null)!==1) throw new RuntimeException('configurator_selection');
    $selection=$payload['selection']??null; if(!is_array($selection)||($selection['version']??null)!==1) throw new RuntimeException('configurator_selection');
    $lookup=static function($items,$id) { foreach($items as $item) if($item['id']===$id)return $item; throw new RuntimeException('configurator_unknown_option'); };
    $b=$lookup($catalog['bottles'],$selection['bottle']??'');$p=$lookup($catalog['pumps'],$selection['pump']??'');$c=$lookup($catalog['caps'],$selection['cap']??'');
    if(!array_intersect($b['fit'],$p['fit'],$c['fit'])) throw new RuntimeException('configurator_incompatible_selection');
    $d=($selection['decoration']??null)!==null?$lookup($catalog['decorations'],$selection['decoration']):null;
    $font=$lookup($catalog['fonts'],$selection['font']??''); $color=$selection['color']??'';
    if(!is_string($color)||!preg_match('/^#[a-fA-F0-9]{6}$/D',$color))throw new RuntimeException('configurator_color');
    $text=$selection['text']??''; if(!is_string($text)||preg_match_all('/./us',$text)>160||preg_match('//u',$text)!==1)throw new RuntimeException('configurator_text');
    $logo=$selection['logo']??null;if(!is_array($logo)||!in_array($logo['mode']??null,['none','image','text'],true))throw new RuntimeException('configurator_logo');
    foreach(['x','y','scale']as$key)if(!is_numeric($logo[$key]??null))throw new RuntimeException('configurator_logo');
    if($logo['x']<0||$logo['x']>100||$logo['y']<0||$logo['y']>100||$logo['scale']<.1||$logo['scale']>1||($logo['mode']==='text'&&!trim($text)))throw new RuntimeException('configurator_logo');
    $selection['text']=sanitize_textarea_field($text);
    // Rebuild a small canonical payload; ignore every other customer-supplied property.
    $safe=['version'=>1,'bottle'=>$b['label'],'pump'=>$p['label'],'cap'=>$c['label'],'decoration'=>$d?$d['label']:'None','text'=>$logo['mode']==='text'?$selection['text']:'','font'=>$font['label'],'color'=>$color,
        'logo'=>array_intersect_key($logo,array_flip(['x','y','scale','mode'])),
        'selection'=>array_intersect_key($selection,array_flip(['version','bottle','pump','cap','decoration','text','font','color','logo'])),
        'notice'=>'Non-contractual visual; physical compatibility and decoration must be confirmed.'];
    return $safe;
}

add_action('wp_enqueue_scripts',static function(){
    wp_register_script('cwp-bottle-configurator',plugins_url('runtime.js',__FILE__),[], '0.1.0',true);
    wp_register_style('cwp-bottle-configurator',plugins_url('style.css',__FILE__),[], '0.1.0');
});
add_action('elementor/widgets/register',static function($manager){
    if(!class_exists('Elementor\\Widget_Base'))return;
    class CloneWP_Bottle_Configurator extends \Elementor\Widget_Base {
        public function get_name(){return 'clonewp_bottle_configurator';}
        public function get_title(){return 'Bottle Configurator';}
        public function get_icon(){return 'eicon-product-configurator';}
        public function get_categories(){return ['general'];}
        public function get_script_depends(){return ['cwp-bottle-configurator'];}
        public function get_style_depends(){return ['cwp-bottle-configurator'];}
        protected function register_controls(){
            $c='Elementor\\Controls_Manager';
            $this->start_controls_section('config',['label'=>'Configuration']);
            $this->add_control('title',['label'=>'Title','type'=>$c::TEXT,'default'=>'Use our online tool to create your bottle']);
            $this->add_control('form_widget',['label'=>'Native Form widget ID','type'=>$c::TEXT]);
            $this->add_control('summary_field',['label'=>'Native Form hidden summary field ID','type'=>$c::TEXT,'default'=>'configuration']);
            $this->add_control('upload_field',['label'=>'Native Form upload field ID','type'=>$c::TEXT,'default'=>'logo']);
            $r=new \Elementor\Repeater();
            foreach(['option_id'=>'Stable option ID','label'=>'Name','fit'=>'Compatible fit groups (comma separated)']as$key=>$label)$r->add_control($key,['label'=>$label,'type'=>$c::TEXT]);
            $r->add_control('part',['label'=>'Part','type'=>$c::SELECT,'options'=>['bottles'=>'Bottle','pumps'=>'Pump and collar','caps'=>'Cap'],'default'=>'bottles']);
            $r->add_control('image',['label'=>'Card image','type'=>$c::MEDIA]);$r->add_control('preview',['label'=>'Preview layer image','type'=>$c::MEDIA]);
            $r->add_control('attributes',['label'=>'Filter attributes (JSON object)','type'=>$c::TEXTAREA,'default'=>'{}']);
            foreach(['x'=>0,'y'=>0,'width'=>100,'height'=>100]as$key=>$default)$r->add_control($key,['label'=>'Preview '.ucfirst($key).' (%)','type'=>$c::NUMBER,'min'=>0,'max'=>100,'default'=>$default]);
            $this->add_control('options',['label'=>'Bottles, pumps and caps','type'=>$c::REPEATER,'fields'=>$r->get_controls(),'title_field'=>'{{{ label }}}']);
            $r=new \Elementor\Repeater();foreach(['option_id'=>'Stable ID','label'=>'Name','category'=>'Category','finish'=>'Finish']as$key=>$label)$r->add_control($key,['label'=>$label,'type'=>$c::TEXT]);$r->add_control('image',['label'=>'Finish sample','type'=>$c::MEDIA]);
            $this->add_control('decorations',['label'=>'Decorations','type'=>$c::REPEATER,'fields'=>$r->get_controls(),'title_field'=>'{{{ label }}}']);
            $r=new \Elementor\Repeater();foreach(['decoration_id'=>'Decoration ID','bottle_id'=>'Bottle ID']as$key=>$label)$r->add_control($key,['label'=>$label,'type'=>$c::TEXT]);$r->add_control('image',['label'=>'Authored bottle finish overlay','type'=>$c::MEDIA]);
            $this->add_control('overlays',['label'=>'Bottle-specific finish overlays','type'=>$c::REPEATER,'fields'=>$r->get_controls()]);
            $r=new \Elementor\Repeater();foreach(['option_id'=>'Stable ID','label'=>'Name','family'=>'CSS font family']as$key=>$label)$r->add_control($key,['label'=>$label,'type'=>$c::TEXT]);
            $this->add_control('fonts',['label'=>'Fonts (load matching fonts through the site font controls)','type'=>$c::REPEATER,'fields'=>$r->get_controls(),'title_field'=>'{{{ label }}}','default'=>[['option_id'=>'arial','label'=>'Arial','family'=>'Arial']]]);
            foreach(['x'=>20,'y'=>45,'width'=>60,'height'=>35]as$key=>$default)$this->add_control('logo_'.$key,['label'=>'Logo area '.ucfirst($key).' (%)','type'=>$c::NUMBER,'min'=>0,'max'=>100,'default'=>$default]);
            $this->end_controls_section();
        }
        protected function render(){
            try{$catalog=cwp_bc_normalize($this->get_settings_for_display());}
            catch(\Throwable $e){echo '<p role="status">Configurator media or settings are incomplete.</p>';return;}
            echo '<div class="cwp-bottle-configurator" data-widget-id="'.esc_attr($this->get_id()).'"><script type="application/json">'.wp_json_encode($catalog,JSON_HEX_TAG|JSON_HEX_AMP|JSON_HEX_APOS|JSON_HEX_QUOT).'</script></div>';
        }
    }
    $manager->register(new CloneWP_Bottle_Configurator());
});

add_action('elementor_pro/forms/validation',static function($record,$handler){
    $post=absint($_POST['post_id']??0);$form_id=sanitize_key(wp_unslash($_POST['form_id']??''));
    if(!$post||!$form_id||!class_exists('Elementor\\Plugin'))return;
    $doc=\Elementor\Plugin::$instance->documents->get($post);if(!$doc)return;
    $matches=[];$visit=static function($nodes)use(&$visit,&$matches,$form_id){foreach($nodes as$node){if(($node['widgetType']??'')==='clonewp_bottle_configurator'&&($node['settings']['form_widget']??'')===$form_id)$matches[]=$node; $visit($node['elements']??[]);}};
    $visit($doc->get_elements_data());if(!$matches)return;
    if(count($matches)!==1){$handler->add_error_message('The configurator form binding is ambiguous.');return;}
    $settings=$matches[0]['settings'];$key=sanitize_key($settings['summary_field']??'configuration');
    try{
        $fields=$record->get('fields');$raw=$fields[$key]['value']??'';
        if(!is_string($raw)||strlen($raw)>16384)throw new RuntimeException('payload_size');
        $safe=cwp_bc_quote(cwp_bc_normalize($settings),json_decode($raw,true));
        // The native Upload field owns MIME/size validation and storage. Do not accept URLs as uploads.
        if($safe['logo']['mode']==='image'){
            $upload_key=sanitize_key($settings['upload_field']??'logo');
            $index='field_'.$upload_key;$file=$_FILES['form_fields']??[];
            $error=$file['error'][$upload_key]??($file['error'][$index]??null);
            $errors=is_array($error)?$error:[$error];
            if(!in_array(UPLOAD_ERR_OK,$errors,true))throw new RuntimeException('logo_missing');
        }
        $record->update_field($key,'value',wp_json_encode($safe,JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES));
        $record->update_field($key,'raw_value',wp_json_encode($safe,JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES));
    }catch(\Throwable $e){$handler->add_error($key,'Please review your bottle configuration and logo before submitting.');}
},10,2);
