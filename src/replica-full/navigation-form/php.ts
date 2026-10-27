/** Trusted pure compiler. The caller owns locking, durable intent, CAS, permission, ownership and readback. */
export const navigationFormPhpHelpers = String.raw`
$navigationFormPatch=static function($elements,$forms,$sourceUrl,$taskId){
  $bad=static function($code){throw new RuntimeException('full_navigation_form_'.$code);};
  $exact=static function($v,$keys)use($bad){if(!is_array($v))$bad('shape');$actual=array_keys($v);sort($actual);sort($keys);if($actual!==$keys)$bad('shape');};
  $key=static function($v)use($bad){if(!is_string($v)||!preg_match('/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/D',$v))$bad('key');};
  $text=static function($v,$empty=false)use($bad){if(!is_string($v))$bad('text');$count=preg_match_all('/./us',$v);$astral=preg_match_all('/[\x{10000}-\x{10ffff}]/u',$v);if($count===false||$astral===false||$count+$astral>300||preg_match('/[\x00-\x1f\x7f]/',$v)||!$empty&&preg_match('/^\s*$/u',$v))$bad('text');};
  $public=static function($v)use($bad){
    if(!is_string($v)||strlen($v)>2048||preg_match('/[\x00-\x20\x7f\\\\]/',$v))$bad('public_url');$u=parse_url($v);
    if(!$u||($u['scheme']??'')!=='https'||isset($u['user'])||isset($u['pass'])||isset($u['port'])||isset($u['query'])||isset($u['fragment'])||!preg_match('/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/D',$u['host']??'')||preg_match('/(?:^|\.)(?:localhost|local|internal|test|invalid|example|onion)$/D',$u['host']??''))$bad('public_url');
    $path=$u['path']??'/';if(preg_match('~(?:^|/)(?:\.|%2e){1,2}(?:/|$)~i',$path)||'https://'.$u['host'].$path!==$v)$bad('url_not_canonical');return 'https://'.$u['host'];
  };
  if(!is_string($taskId)||!preg_match('/^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/D',$taskId))$bad('task_id');
  $sourceOrigin=$public($sourceUrl);if(!is_array($forms)||!array_is_list($forms)||count($forms)<1||count($forms)>4)$bad('forms');
  $ids=[];$slots=[];$widgets=[];$compiled=[];$keys=[];
  $escape=static fn($v)=>strtr($v,['&'=>'&amp;','<'=>'&lt;','>'=>'&gt;','"'=>'&quot;',"'"=>'&#39;']);
  foreach($forms as $form){
    $exact($form,['key','slotComponentKey','sourceUnitIds','sourceFactIds','sourceEvidence','method','action','fields','submitLabel']);$key($form['key']);$key($form['slotComponentKey']);
    if(isset($keys[$form['key']])||$form['method']!=='get'||$public($form['action'])!==$sourceOrigin)$bad('form');$keys[$form['key']]=true;
    foreach(['sourceUnitIds','sourceFactIds'] as $r){if(!is_array($form[$r])||!array_is_list($form[$r])||count($form[$r])<1||count($form[$r])>100)$bad('source_refs');$refs=[];foreach($form[$r] as $ref){if(!is_string($ref)||!preg_match('~^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,239}$~D',$ref)||isset($refs[$ref]))$bad('source_refs');$refs[$ref]=true;}}
    $exact($form['sourceEvidence'],['path','sha256']);if(!is_string($form['sourceEvidence']['path'])||strlen($form['sourceEvidence']['path'])<1||strlen($form['sourceEvidence']['path'])>1000||!is_string($form['sourceEvidence']['sha256'])||!preg_match('/^[a-f0-9]{64}$/D',$form['sourceEvidence']['sha256']))$bad('source_evidence');
    $slot=substr(hash('sha256','clonewp-native44:'.$taskId.':'.$form['slotComponentKey']),0,7);$widget=substr(hash('sha256','clonewp-native44:'.$taskId.':navigation-form:'.$form['key']),0,7);
    if(isset($ids[$slot])||isset($ids[$widget])||$slot===$widget)$bad('identity_collision');$ids[$slot]=true;$ids[$widget]=true;$slots[]=$slot;$widgets[]=$widget;$formId='clonewp-nav-'.$widget;
    if(!is_array($form['fields'])||!array_is_list($form['fields'])||count($form['fields'])<1||count($form['fields'])>8)$bad('fields');$names=[];$html='';
    foreach($form['fields'] as $index=>$field){
      $exact($field,['name','label','options']);if(!is_string($field['name'])||!preg_match('/^[A-Za-z][A-Za-z0-9_]{0,63}$/D',$field['name'])||preg_match('/password|passwd|secret|token|nonce|authorization|cookie|credential|api_?key|access_?key|session/i',$field['name'])||isset($names[$field['name']]))$bad('field_name');$names[$field['name']]=true;$text($field['label']);
      if(!is_array($field['options'])||!array_is_list($field['options'])||count($field['options'])<1||count($field['options'])>100)$bad('options');$values=[];$optionHtml='';
      foreach($field['options'] as $option){$exact($option,['label','value']);$text($option['label']);$text($option['value'],true);if(preg_match('/bearer\s|(?:secret|token|password|authorization)\s*[:=]/i',$option['value'])||in_array($option['value'],$values,true))$bad('option');$values[]=$option['value'];$optionHtml.='<option value="'.$escape($option['value']).'">'.$escape($option['label']).'</option>';}
      $fieldId=$formId.'-'.$index;$html.='<label for="'.$fieldId.'">'.$escape($field['label']).'</label><select id="'.$fieldId.'" name="'.$escape($field['name']).'">'.$optionHtml.'</select>';
    }
    $text($form['submitLabel']);$compiled[$slot]=['id'=>$widget,'elType'=>'widget','widgetType'=>'html','settings'=>['html'=>'<form id="'.$formId.'" class="clonewp-navigation-form" method="get" action="'.$escape($form['action']).'">'.$html.'<button type="submit">'.$escape($form['submitLabel']).'</button></form>'],'elements'=>[]];
  }
  $hasFormContent=function($value)use(&$hasFormContent){if(is_string($value))return (bool)preg_match('/<\s*form\b/i',$value);if(is_array($value))foreach($value as $child)if($hasFormContent($child))return true;return false;};
  $hasFormNode=function($node)use(&$hasFormNode,$hasFormContent){if(($node['elType']??'')==='widget'&&preg_match('/form|cf7/i',$node['widgetType']??'')||$hasFormContent($node['settings']??[]))return true;foreach($node['elements']??[] as $child)if($hasFormNode($child))return true;return false;};
  $seen=[];$found=[];
  $walk=function($nodes)use(&$walk,&$seen,&$found,$compiled,$widgets,$bad,$hasFormNode){if(!is_array($nodes)||!array_is_list($nodes))$bad('tree');foreach($nodes as &$node){if(!is_array($node)||!is_string($node['id']??null)||!preg_match('/^[A-Za-z0-9_-]{1,100}$/D',$node['id'])||isset($seen[$node['id']])||!isset($node['settings'])||!is_array($node['settings'])||!isset($node['elements'])||!is_array($node['elements'])||!array_is_list($node['elements']))$bad('tree');$id=$node['id'];$seen[$id]=true;if(in_array($id,$widgets,true))$bad('widget_exists');if(isset($compiled[$id])){if(($node['elType']??'')!=='container'||!empty($node['widgetType']))$bad('slot');if($hasFormNode($node))$bad('slot_form_exists');$found[$id]=true;}if($node['elements'])$node['elements']=$walk($node['elements']);}unset($node);return $nodes;};
  $elements=$walk($elements);if(count($found)!==count($slots))$bad('slot_missing');
  $insert=function($nodes)use(&$insert,$compiled){foreach($nodes as &$node){if($node['elements'])$node['elements']=$insert($node['elements']);if(isset($compiled[$node['id']]))$node['elements'][]=$compiled[$node['id']];}unset($node);return $nodes;};
  return ['elements'=>$insert($elements),'widgetIds'=>$widgets,'slotIds'=>$slots];
};
`;
