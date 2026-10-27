// Contextual page metadata is stored outside _elementor_page_settings.
// This is a comparison adapter only; it never writes or fills document content.
$settingsEqual=static function($a,$b,$stack)use($same,$default,$doc,$template){
  if(!is_array($a)||!is_array($b))return false;
  $emptyMedia=static function($v){if(!is_array($v))return false;$keys=array_keys($v);sort($keys);return $keys===['id','size','url']&&$v['url']===''&&$v['size']===''&&in_array($v['id'],[0,false],true);};
  $mediaSame=static fn($x,$y)=>$same($x,$y)||($emptyMedia($x)&&$emptyMedia($y));
  foreach(array_unique(array_merge(array_keys($a),array_keys($b)))as$k){
    $ha=array_key_exists($k,$a);$hb=array_key_exists($k,$b);
    if($stack===$doc&&$k==='template'){
      if(($ha&&!$same($a[$k],$template))||($hb&&!$same($b[$k],$template)))return false;
      continue;
    }
    $c=$stack->get_controls($k);$equal=is_array($c)&&($c['type']??'')==='media'?$mediaSame:$same;
    if($ha&&$hb){if(!$equal($a[$k],$b[$k]))return false;}
    elseif(!is_array($c)||!$equal($ha?$a[$k]:$b[$k],$default($c)))return false;
  }
  return true;
};
