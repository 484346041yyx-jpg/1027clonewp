$containerTreePatch=static function($inputElements,$plan){
  if(!is_array($inputElements)||!is_array($plan)||($plan['version']??null)!==1||($plan['kind']??null)!=='clonewp-container-tree-plan'||!is_array($plan['operations']??null)||count($plan['operations'])<1||count($plan['operations'])>80)throw new RuntimeException('full_layout_plan');
  $allowed=array_fill_keys(['container_type','content_width','boxed_width','width','width_mobile','flex_direction','flex_direction_mobile','flex_justify_content','flex_justify_content_mobile','flex_align_items','flex_align_items_mobile','flex_wrap','flex_wrap_mobile','flex_gap','flex_gap_mobile','padding','padding_mobile','margin','margin_mobile','overflow'],true);
  $tree=$inputElements;$touched=[];
  $validateControls=static function($controls)use($allowed){
    if(!is_array($controls)||count($controls)<1||count($controls)>18)throw new RuntimeException('full_layout_controls');
    foreach($controls as $key=>$value){
      if(!isset($allowed[$key]))throw new RuntimeException('full_layout_control_name');
      if(is_string($value)){if(strlen($value)>100||!preg_match('/^[A-Za-z0-9_ %-]*$/D',$value))throw new RuntimeException('full_layout_control_value');}
      elseif(is_array($value)){
        foreach($value as $field=>$item){if(!in_array($field,['unit','size','sizes','column','row','isLinked','top','right','bottom','left'],true)||!is_scalar($item)&&$item!==null&&$item!==[])throw new RuntimeException('full_layout_control_value');}
      }else throw new RuntimeException('full_layout_control_value');
      if($key==='container_type'&&$value!=='flex'||$key==='content_width'&&!in_array($value,['boxed','full'],true)||$key==='overflow'&&!in_array($value,['','hidden','auto'],true))throw new RuntimeException('full_layout_control_value');
    }
  };
  $ids=static function($nodes)use(&$ids){$found=[];foreach($nodes as $node){if(!is_array($node)||!is_string($node['id']??null)||isset($found[$node['id']]))throw new RuntimeException('full_layout_tree');$found[$node['id']]=true;foreach($ids($node['elements']??[]) as $child=>$unused){if(isset($found[$child]))throw new RuntimeException('full_layout_tree');$found[$child]=true;}}return $found;};
  $find=static function &(&$nodes,$id)use(&$find){foreach($nodes as &$node){if(($node['id']??null)===$id)return $node;if(!empty($node['elements'])){$found=&$find($node['elements'],$id);if($found!==null)return $found;}}unset($node);$none=null;return $none;};
  foreach($plan['operations'] as $operation){
    if(!is_array($operation)||!in_array($operation['kind']??null,['group-siblings','set-controls'],true))throw new RuntimeException('full_layout_operation');
    $validateControls($operation['controls']??null);
    if($operation['kind']==='set-controls'){
      if(!preg_match('/^[A-Za-z0-9_-]{4,12}$/D',$operation['elementId']??'')||isset($touched[$operation['elementId']]))throw new RuntimeException('full_layout_owner');
      $node=&$find($tree,$operation['elementId']);if($node===null||($node['elType']??null)!=='container'||!is_array($node['settings']??null))throw new RuntimeException('full_layout_owner');
      $node['settings']=array_merge($node['settings'],$operation['controls']);$touched[$operation['elementId']]=true;unset($node);continue;
    }
    $members=$operation['memberIds']??null;$groupId=$operation['groupId']??null;$parentId=$operation['parentId']??null;
    if(!is_array($members)||count($members)<2||count($members)>20||count(array_unique($members))!==count($members)||!is_string($groupId)||!preg_match('/^[A-Za-z0-9_-]{4,12}$/D',$groupId)||isset($ids($tree)[$groupId]))throw new RuntimeException('full_layout_group_identity');
    if($parentId===null)$siblings=&$tree;else{if(!is_string($parentId)||!preg_match('/^[A-Za-z0-9_-]{4,12}$/D',$parentId))throw new RuntimeException('full_layout_parent');$parent=&$find($tree,$parentId);if($parent===null||($parent['elType']??null)!=='container'||!is_array($parent['elements']??null))throw new RuntimeException('full_layout_parent');$siblings=&$parent['elements'];}
    $start=null;foreach($siblings as $index=>$node)if(($node['id']??null)===$members[0]){$start=$index;break;}
    if($start===null)throw new RuntimeException('full_layout_members');foreach($members as $offset=>$id)if(($siblings[$start+$offset]['id']??null)!==$id)throw new RuntimeException('full_layout_members');
    $children=array_splice($siblings,$start,count($members));foreach($children as &$child)if(($child['elType']??null)==='container')$child['isInner']=true;unset($child);
    array_splice($siblings,$start,0,[['id'=>$groupId,'elType'=>'container','isInner'=>$parentId!==null,'settings'=>$operation['controls'],'elements'=>$children]]);unset($siblings,$parent);
  }
  $ids($tree);return $tree;
};
