// Included inside wordpress-full.php's exact owned module boundary.
$jsonHash=static fn($v)=>hash('sha256',json_encode($documentNormalize($v),JSON_UNESCAPED_SLASHES|JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_LINE_TERMINATORS|JSON_THROW_ON_ERROR));
$styleDiagnostics=static function($p)use($hid){
 $defaults=[];$reflection=new ReflectionProperty('Elementor\Core\Frontend\Performance','is_frontend');$reflection->setAccessible(true);$previous=$reflection->getValue();$reflection->setValue(null,false);\Elementor\Plugin::$instance->controls_manager->clear_stack_cache();
 try{$doc=\Elementor\Plugin::$instance->documents->get($p['pageId'],false);$stack=$doc->get_stack();foreach(array_merge($stack['controls']??[],$stack['style_controls']??[])as $key=>$c)if(array_key_exists('default',$c))$defaults[$key]=$c['default'];}finally{$reflection->setValue(null,$previous);\Elementor\Plugin::$instance->controls_manager->clear_stack_cache();}
 $files=[ini_get('error_log')];if(defined('WP_DEBUG_LOG')&&WP_DEBUG_LOG)$files[]=is_string(WP_DEBUG_LOG)?WP_DEBUG_LOG:WP_CONTENT_DIR.'/debug.log';$fatal=[];
 foreach(array_unique($files)as $file){if(!is_string($file)||!is_file($file)||!is_readable($file))continue;$h=fopen($file,'rb');if(!$h)continue;fseek($h,max(0,filesize($file)-65536));$tail=stream_get_contents($h,65536);fclose($h);foreach(explode("\n",$tail)as $line)if(preg_match('/^\[([^\]]+)\].*Maximum execution time of ([0-9]+) seconds exceeded/i',$line,$m)){$at=strtotime($m[1]);if($at!==false)$fatal[]=['sha256'=>hash('sha256',$line),'at'=>gmdate('c',$at)];}}
 return ['defaults'=>(object)$defaults,'fatal'=>array_slice($fatal,-8),'lock'=>get_option('clonewp_header_module_lock_'.hash('sha256',$hid),null)];
};
if(($input['action']??'')==='style-diagnostics'){$s=$inspect();if(!$s['page']||$s['page']['status']!=='draft')throw new RuntimeException('full_style_diagnostic_identity');return ['ok'=>true,'value'=>$styleDiagnostics($s['page'])];}
if(($input['action']??'')==='confirm-interrupted-style'){
 $payload=$input['payload']??[];$original=$payload['originalOperationId']??'';$expected=$input['expectedHash']??'';$newOperation=$input['operationId']??'';
 if(!preg_match('/^[a-f0-9-]{36}$/',$original)||!preg_match('/^[a-f0-9-]{36}$/',$newOperation)||$original===$newOperation||!preg_match('/^[a-f0-9]{64}$/',$expected))throw new RuntimeException('full_style_recovery_intent');
 $recoveryLock='clonewp_header_recovery_lock_'.hash('sha256',$hid);$recoveryValue=['operationId'=>$newOperation,'owner'=>$ownerToken];if(!add_option($recoveryLock,$recoveryValue,'','no'))throw new RuntimeException('full_locked');
 try{
  $before=$inspect();$p=$before['page'];$record=get_option($option,null);if($before['hash']!==$expected||!$p||$p['status']!=='draft'||$p['headerId']!==null||$p['pageId']!==($payload['pageId']??null)||($record['identity']??null)!==$identity)throw new RuntimeException('full_style_recovery_precondition');
  if(!function_exists('wp_check_post_lock'))require_once ABSPATH.'wp-admin/includes/post.php';if(wp_check_post_lock($p['pageId']))throw new RuntimeException('full_edit_lock');
  $receipt=$record['fullReceipts'][$original]??null;$originalHash=$jsonHash(['pageId'=>$p['pageId'],'css'=>$payload['css']??null]);if(($receipt['action']??null)!=='style'||($receipt['state']??null)!=='started'||isset($receipt['result'])||($receipt['payloadHash']??null)!==$originalHash||$originalHash!==($payload['originalPayloadHash']??null))throw new RuntimeException('full_style_recovery_receipt');
  foreach($record['fullReceipts']??[]as $key=>$r)if($key!==$original&&($r['state']??null)!=='complete')throw new RuntimeException('full_reconcile_required');
  if($documentDigest($p['elements'])!==$documentDigest($payload['elements']??null)||$documentDigest($p['settings'])!==$documentDigest($payload['settings']??null)||($p['settings']['custom_css']??null)!==($payload['css']??null))throw new RuntimeException('full_style_recovery_content');
  $diagnostic=$styleDiagnostics($p);$fatal=$payload['fatal']??null;$start=strtotime($payload['startedAt']??'');$fatalTime=is_array($fatal)?strtotime($fatal['at']??''):false;$foundFatal=false;foreach($diagnostic['fatal']as $entry)if($documentDigest($entry)===$documentDigest($fatal))$foundFatal=true;if(!$start||!$fatalTime||$fatalTime<$start||$fatalTime>time()||!$foundFatal)throw new RuntimeException('full_style_recovery_fatal_unproven');
  $oldLock=$diagnostic['lock'];if(!is_array($oldLock)||($oldLock['operationId']??null)!==$original||($oldLock['owner']??null)!==$ownerToken)throw new RuntimeException('full_style_recovery_lock');
  $result=['pageId'=>$p['pageId']];$record['fullReceipts'][$original]=['action'=>'style','payloadHash'=>$originalHash,'state'=>'complete','result'=>$result];update_option($option,$record,false);
  $oldKey='clonewp_header_module_lock_'.hash('sha256',$hid);if(get_option($oldKey)!==$oldLock)throw new RuntimeException('full_style_recovery_lock_changed');delete_option($oldKey);
  $after=$inspect();$otherBefore=(array)$before['receipts'];$otherAfter=(array)$after['receipts'];unset($otherBefore[$original],$otherAfter[$original]);if($digest($after['page'])!==$digest($p)||$digest($after['header'])!==$digest($before['header'])||$documentDigest($otherBefore)!==$documentDigest($otherAfter))throw new RuntimeException('full_style_recovery_readback');
  return ['ok'=>true,'value'=>['snapshot'=>$after,'result'=>$result]];
 }finally{if(get_option($recoveryLock)===$recoveryValue)delete_option($recoveryLock);}
}
