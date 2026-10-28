<?php
// Run the production server validator against local in-memory WordPress menu fixtures.
$source=file_get_contents(dirname(__DIR__,2).'/src/woodmart-header/generic/wordpress.php');
token_get_all("<?php\n".$source,TOKEN_PARSE);
$start=strpos($source,'$verify=function($node)');
$end=strpos($source,"\$verify(\$raw['structure']);",$start);
if($start===false||$end===false)throw new RuntimeException('validator_not_found');
function wp_get_nav_menu_object($id){return match($id){910=>(object)['slug'=>'main-menu'],909=>(object)['slug'=>'%e8%af%ad%e8%a8%80'],default=>false};}
$styleFound=0;$record=['menus'=>['main'=>910,'language'=>909],'styleId'=>501];
$types=['mainmenu'=>true,'menu'=>true];$styleType='HTMLBlock';$origin='https://target.example';$elementPrefix='cw-fixture-';$strictMenus=true;
$native=['elements'=>array_map(fn($type)=>['type'=>$type,'schema'=>(object)['menu_id'=>['resource'=>'menu','type'=>'select']]],['mainmenu','menu'])];
eval(substr($source,$start,$end-$start));
$root=['id'=>'root','type'=>'root','content'=>[
  ['id'=>'cw-fixture-desktop','type'=>'mainmenu','params'=>['menu_id'=>['id'=>'menu_id','type'=>'select','value'=>'main-menu']]],
  ['id'=>'cw-fixture-phone','type'=>'menu','params'=>['menu_id'=>['id'=>'menu_id','type'=>'select','value'=>'%e8%af%ad%e8%a8%80']]],
]];
$verify($root);
foreach(['options','numeric','missing','foreign','wrong-id'] as $case){
  $bad=$root;
  switch($case){
    case 'options':$bad['content'][1]['params']['menu_id']['type']='options';break;
    case 'numeric':$bad['content'][1]['params']['menu_id']['value']='909';break;
    case 'missing':unset($bad['content'][1]['params']['menu_id']);break;
    case 'foreign':$bad['content'][1]['params']['menu_id']['value']='not-owned';break;
    case 'wrong-id':$bad['content'][1]['params']['menu_id']['id']='menu';break;
  }
  $rejected=false;try{$verify($bad);}catch(RuntimeException $e){$rejected=true;}
  if(!$rejected)throw new RuntimeException('invalid_menu_accepted_'.$case);
}
echo "native menu server validation passed\n";
