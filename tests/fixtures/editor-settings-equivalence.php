$runTests=static function($comparison){
  $norm=function($v)use(&$norm){if(is_object($v))$v=get_object_vars($v);if(!is_array($v))return$v;if(!array_is_list($v))ksort($v);foreach($v as$k=>$x)$v[$k]=$norm($x);return$v;};
  $same=static fn($a,$b)=>serialize($norm($a))===serialize($norm($b));
  $default=static fn($c)=>$c['default']??null;
  $make=static fn()=>new class{function get_controls($k){return ['template'=>['type'=>'select','default'=>'default'],'image'=>['type'=>'media','default'=>['url'=>'','id'=>false,'size'=>'']],'columns'=>['type'=>'number','default'=>2]][$k]??null;}};
  $doc=$make();$widget=$make();$template='elementor_header_footer';
  eval($comparison);
  return [
    'contextualTemplate'=>$settingsEqual([],['template'=>$template],$doc),
    'changedTemplateRejected'=>!$settingsEqual([],['template'=>'default'],$doc),
    'savedTemplateConflictRejected'=>!$settingsEqual(['template'=>'other'],['template'=>$template],$doc),
    'widgetTemplateNotContextual'=>!$settingsEqual([],['template'=>$template],$widget),
    'emptyMediaIdRepresentations'=>$settingsEqual(['image'=>['id'=>false,'url'=>'','size'=>'']],['image'=>['id'=>0,'url'=>'','size'=>'']],$widget),
    'omittedEmptyMediaDefault'=>$settingsEqual([],['image'=>['id'=>0,'url'=>'','size'=>'']],$widget),
    'realMediaChangeRejected'=>!$settingsEqual(['image'=>['id'=>1,'url'=>'https://example.test/a.png','size'=>'']],['image'=>['id'=>2,'url'=>'https://example.test/b.png','size'=>'']],$widget),
    'mediaExtraFieldsPreserved'=>!$settingsEqual([],['image'=>['id'=>0,'url'=>'','size'=>'','extra'=>'keep']],$widget),
    'nativeNondefaultChangeRejected'=>!$settingsEqual(['columns'=>1],['columns'=>2],$widget),
    'registeredDefaultOmission'=>$settingsEqual([],['columns'=>2],$widget),
  ];
};
return $runTests($comparison);
