// Scoped post-save patch for one cloneWP-owned draft. $input is supplied by driver.ts.
try {
    $fail = static function(string $code): never { throw new RuntimeException('configurator_'.$code); };
    $origin = untrailingslashit(home_url('/'));
    $run = $input['runId'] ?? null;
    $pageId = $input['pageId'] ?? null;
    $contract = $input['contractHash'] ?? null;
    $operation = $input['operationId'] ?? null;
    $action = $input['action'] ?? 'inspect';
    if ($origin !== ($input['targetOrigin'] ?? null) || !is_string($run) || !preg_match('/^[a-z][a-z0-9-]{1,79}$/D', $run) ||
        !is_int($pageId) || $pageId < 1 || !is_string($contract) || !preg_match('/^[a-f0-9]{64}$/D', $contract) ||
        !in_array($action, ['inspect','apply','reconcile','revise-catalog','reconcile-revision'], true)) $fail('identity');
    if (!current_user_can('edit_pages') || !class_exists('Elementor\\Plugin')) $fail('permission');
    if (!function_exists('wp_check_post_lock')) require_once ABSPATH.'wp-admin/includes/post.php';
    $post = get_post($pageId);
    $matches = get_posts(['post_type'=>'page','post_status'=>'any','fields'=>'ids','numberposts'=>2,'meta_key'=>'_clonewp_run_id','meta_value'=>$run]);
    if (!$post || $post->post_type !== 'page' || $post->post_status !== 'draft' || count($matches) !== 1 || (int)$matches[0] !== $pageId ||
        get_post_meta($pageId, '_clonewp_run_id', true) !== $run ||
        get_post_meta($pageId, '_clonewp_reused_header_contract', true) !== $contract || !current_user_can('edit_post', $pageId)) $fail('owner');
    $plugin = Elementor\Plugin::$instance;
    $widget = $plugin->widgets_manager->get_widget_types('clonewp_bottle_configurator');
    $controls = $widget ? $widget->get_controls() : [];
    $requiredControls = ['title','form_widget','summary_field','upload_field','options','decorations','overlays','fonts','filter_groups_json','logo_colors','logo_x','logo_y','logo_width','logo_height','preview_layout_mode','preview_mobile_breakpoint'];
    if (!$widget || get_class($widget) !== 'CloneWP_Bottle_Configurator' || array_diff($requiredControls, array_keys($controls))) $fail('registration');
    $encode = static fn($value) => json_encode($value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
    $digest = static fn($value) => hash('sha256', $encode($value));
    $path = WP_PLUGIN_DIR.'/clonewp-bottle-configurator/';
    $files = [];
    foreach (['clonewp-bottle-configurator.php','runtime.js','style.css'] as $name) {
        $file = $path.$name;
        if (!is_file($file) || is_link($file)) $fail('plugin_file');
        $files[$name] = hash_file('sha256', $file);
    }
    $controlsHash = $digest($controls);
    $doc = $plugin->documents->get($pageId, false);
    if (!$doc || !$doc->is_editable_by_current_user() || !$doc->is_built_with_elementor()) $fail('document');
    $read = static function() use ($pageId, $digest, $files, $controlsHash, $controls) {
        $raw = get_post_meta($pageId, '_elementor_data', true);
        $elements = is_string($raw) ? json_decode($raw, true) : $raw;
        if (!is_array($elements) || !array_is_list($elements)) throw new RuntimeException('configurator_document_data');
        $settings = get_post_meta($pageId, '_elementor_page_settings', true);
        if (!is_array($settings)) $settings = [];
        return ['pageId'=>$pageId,'status'=>get_post_status($pageId),'elements'=>$elements,
            'elementsHash'=>$digest($elements),'settingsHash'=>$digest($settings),
            'pluginFiles'=>$files,'controlsHash'=>$controlsHash,'controls'=>$controls];
    };
    $option = 'clonewp_configurator_patch_'.hash('sha256', $run);
    $receipt = get_option($option, null);
    if ($receipt !== null && (!is_array($receipt) || ($receipt['pageId'] ?? null) !== $pageId || ($receipt['contractHash'] ?? null) !== $contract)) $fail('receipt_owner');
    $snapshot = $read();
    if ($action === 'inspect') return ['ok'=>true,'value'=>['snapshot'=>$snapshot,'receipt'=>$receipt]];
    if (!is_string($operation) || !preg_match('/^[A-Za-z0-9_-]{4,100}$/D', $operation)) $fail('operation');
    if (wp_check_post_lock($pageId)) $fail('post_locked');
    $lock = $option.'_lock';
    if (!add_option($lock, $operation, '', 'no')) $fail('remote_lock');
    try {
        if ($read()['elementsHash'] !== $snapshot['elementsHash'] || get_option($option, null) !== $receipt) $fail('cas_conflict');
        if ($action === 'reconcile' || $action === 'reconcile-revision') {
            if (!$receipt || $receipt['state'] !== 'started' || $receipt['operationId'] !== $operation ||
                $receipt['baseHash'] !== ($input['baseHash'] ?? null) || $receipt['patchedHash'] !== ($input['patchedHash'] ?? null) ||
                ($action === 'reconcile-revision' && ($receipt['kind'] ?? null) !== 'catalog-revision') ||
                ($action === 'reconcile' && isset($receipt['kind']))) $fail('reconcile_identity');
            $expected = $input['expectedElements'] ?? null;
            if ($snapshot['settingsHash']!==$receipt['settingsHash']) $fail('reconcile_settings_conflict');
            if ($snapshot['elementsHash'] === $receipt['patchedHash'] ||
                is_array($expected) && array_is_list($expected) && $digest($expected) === $receipt['patchedHash'] &&
                $snapshot['elements'] == $expected && $snapshot['settingsHash'] === $receipt['settingsHash']) $receipt['state'] = 'complete';
            elseif ($snapshot['elementsHash'] === $receipt['baseHash']) $receipt['state'] = 'not-applied';
            else $fail('reconcile_conflict');
            update_option($option, $receipt, false);
            return ['ok'=>true,'value'=>['snapshot'=>$read(),'receipt'=>$receipt]];
        }
        if ($action === 'revise-catalog') {
            if (!$receipt || $receipt['state'] !== 'complete' || $receipt['operationId'] !== ($input['priorOperationId'] ?? null) ||
                $receipt['operationId'] === $operation) $fail('revision_prior_receipt');
        } elseif ($receipt && $receipt['state'] !== 'not-applied') $fail('reconcile_required');
        if ($snapshot['elementsHash'] !== ($input['baseHash'] ?? null) ||
            $snapshot['settingsHash'] !== ($input['settingsHash'] ?? null) ||
            $files !== ($input['packageFiles'] ?? null) || $controlsHash !== ($input['controlsHash'] ?? null)) $fail('precondition');
        $slotId = $input['slotId'] ?? null; $widgetId = $input['widgetId'] ?? null; $formId = $input['formWidgetId'] ?? null;
        if (!is_string($slotId) || !is_string($widgetId) || !is_string($formId) ||
            !preg_match('/^[a-f0-9]{7}$/D', $slotId) || !preg_match('/^[a-f0-9]{7}$/D', $widgetId) ||
            !preg_match('/^[a-f0-9]{7}$/D', $formId) || count(array_unique([$slotId,$widgetId,$formId])) !== 3) $fail('native_identity');
        $catalog = $input['catalog'] ?? null;
        if (!is_array($catalog) || ($catalog['version'] ?? null) !== 1 ||
            !is_array($catalog['form'] ?? null) || ($catalog['form']['widgetId'] ?? null) !== $formId ||
            !is_string($catalog['title'] ?? null) || trim($catalog['title']) === '' || strlen($catalog['title']) > 640) $fail('catalog');
        $summaryId = $catalog['form']['summaryField'] ?? null; $uploadId = $catalog['form']['uploadField'] ?? null;
        foreach ([$summaryId,$uploadId] as $fieldId) if (!is_string($fieldId) || !preg_match('/^[A-Za-z0-9_-]{1,80}$/D', $fieldId)) $fail('field_identity');
        if ($summaryId === $uploadId) $fail('field_identity');
        $ledger = $input['assets'] ?? null; if (!is_array($ledger) || !array_is_list($ledger) || count($ledger) > 1000) $fail('asset_ledger');
        $owned = []; $used = [];
        foreach ($ledger as $asset) {
            $id = $asset['id'] ?? null; $hash = $asset['sha256'] ?? null; $url = $asset['url'] ?? null;
            if (!is_int($id) || $id < 1 || isset($owned[$id]) || !is_string($hash) || !preg_match('/^[a-f0-9]{64}$/D', $hash) || !is_string($url)) $fail('asset_ledger');
            $media = get_post($id); $file = function_exists('wp_get_original_image_path') ? wp_get_original_image_path($id) : get_attached_file($id);
            $real = $file ? realpath($file) : false;
            if (!$media || $media->post_type !== 'attachment' || (int)$media->post_parent !== $pageId ||
                get_post_meta($id, '_clonewp_run_id', true) !== $run || get_post_meta($id, '_clonewp_sha256', true) !== $hash ||
                wp_get_attachment_url($id) !== $url || strpos($url, 'https://') !== 0 ||
                strpos((string)get_post_mime_type($id), 'image/') !== 0 || !$real || is_link($file) || hash_file('sha256', $real) !== $hash) $fail('asset_owner');
            $owned[$id] = $url;
        }
        $idPattern = '/^[A-Za-z0-9_-]{1,80}$/D';
        $checkId = static function($value) use ($idPattern, $fail) { if (!is_string($value) || !preg_match($idPattern, $value)) $fail('option_id'); return $value; };
        $checkLabel = static function($value) use ($fail) { if (!is_string($value) || trim($value) === '' || strlen($value) > 640) $fail('option_label'); return $value; };
        $number = static function($value, $low, $high) use ($fail) { if (!is_int($value) && !is_float($value) || $value < $low || $value > $high || !is_finite((float)$value)) $fail('number'); return $value; };
        $rectangle = static function($value) use ($number, $fail) { if (!is_array($value) || array_keys($value) !== ['x','y','width','height']) $fail('rectangle'); $out=[]; foreach (['x','y','width','height'] as $key) $out[$key]=$number($value[$key], 0, 100); if ($out['width']<=0 || $out['height']<=0 || $out['x']+$out['width']>100 || $out['y']+$out['height']>100) $fail('rectangle'); return $out; };
        $mediaRef = static function($value) use ($owned, &$used, $fail) { $id=$value['id']??null; $url=$value['url']??null; if (!is_int($id) || !isset($owned[$id]) || $owned[$id]!==$url || count($value)!==2) $fail('media_ref'); $used[$id]=true; return ['id'=>$id,'url'=>$url]; };
        $rowId = static fn($namespace,$identity) => substr(hash('sha256', $namespace."\0".$identity),0,7);
        $settings = ['title'=>$checkLabel($catalog['title']),'form_widget'=>$formId,'summary_field'=>$summaryId,'upload_field'=>$uploadId];
        $settings['options']=[]; $optionIds=[]; $fitsByPart=[];
        foreach (['bottles','pumps','caps'] as $part) {
            $rows=$catalog[$part]??null; if (!is_array($rows) || !array_is_list($rows) || count($rows)<1 || count($rows)>500) $fail('options');
            foreach ($rows as $row) {
                $id=$checkId($row['id']??null); if (isset($optionIds[$part][$id])) $fail('option_duplicate'); $optionIds[$part][$id]=true;
                $attributes=$row['attributes']??null; $fit=$row['fit']??null;
                if (!is_array($attributes) || array_is_list($attributes) && count($attributes)>0 || !is_array($fit) || !array_is_list($fit) || count($fit)<1 || count($fit)>100) $fail('option_attrs');
                foreach ($attributes as $key=>$value) { if (!preg_match('/^[a-z][a-z0-9_-]*$/D',(string)$key)) $fail('option_attrs'); $checkLabel($value); }
                foreach ($fit as $group) $checkId($group);
                foreach ($fit as $group) $fitsByPart[$part][$group]=true;
                $position=$rectangle($row['position']??null);
                $settings['options'][]=['_id'=>$rowId('option:'.$part,$id),'option_id'=>$id,'part'=>$part,'label'=>$checkLabel($row['label']??null),
                    'image'=>$mediaRef($row['image']??null),'preview'=>$mediaRef($row['preview']??null),
                    'x'=>$position['x'],'y'=>$position['y'],'width'=>$position['width'],'height'=>$position['height'],
                    'attributes'=>$encode((object)$attributes),'fit'=>implode(',', $fit)];
            }
        }
        if (!array_intersect(array_keys($fitsByPart['bottles']??[]),array_keys($fitsByPart['pumps']??[]),array_keys($fitsByPart['caps']??[]))) $fail('no_compatible_combination');
        $settings['decorations']=[]; $settings['overlays']=[]; $decorations=$catalog['decorations']??null;
        if (!is_array($decorations) || !array_is_list($decorations) || count($decorations)>500) $fail('decorations');
        $decIds=[];
        foreach ($decorations as $row) {
            $id=$checkId($row['id']??null); if (isset($decIds[$id])) $fail('decoration_duplicate'); $decIds[$id]=true;
            $settings['decorations'][]=['_id'=>$rowId('decoration',$id),'option_id'=>$id,'label'=>$checkLabel($row['label']??null),
                'image'=>$mediaRef($row['image']??null),'category'=>$checkLabel($row['category']??null),'finish'=>$checkLabel($row['finish']??null)];
            $overlays=$row['overlays']??null; if (!is_array($overlays) || !array_is_list($overlays) || count($overlays)>500) $fail('overlays');
            $overlayIds=[];
            foreach ($overlays as $overlay) { $bottleId=$checkId($overlay['bottleId']??null); if (!isset($optionIds['bottles'][$bottleId]) || isset($overlayIds[$bottleId])) $fail('overlay_bottle'); $overlayIds[$bottleId]=true;
                $settings['overlays'][]=['_id'=>$rowId('overlay:'.$id,$bottleId),'decoration_id'=>$id,'bottle_id'=>$bottleId,'image'=>$mediaRef($overlay['image']??null)]; }
        }
        $settings['fonts']=[]; $fonts=$catalog['fonts']??null;
        if (!is_array($fonts) || !array_is_list($fonts) || count($fonts)<1 || count($fonts)>20) $fail('fonts');
        $fontIds=[];
        foreach ($fonts as $row) { $id=$checkId($row['id']??null); if (isset($fontIds[$id])) $fail('font_duplicate'); $fontIds[$id]=true;
            $settings['fonts'][]=['_id'=>$rowId('font',$id),'option_id'=>$id,'label'=>$checkLabel($row['label']??null),'family'=>$checkLabel($row['family']??null)]; }
        $groups=$catalog['filterGroups']??[];
        if (!is_array($groups) || array_diff(array_keys($groups), ['bottles','pumps','caps'])) $fail('filter_groups');
        foreach ($groups as $part=>$attributes) {
            if (!is_array($attributes)) $fail('filter_groups');
            foreach ($attributes as $attribute=>$group) {
                if (!is_string($attribute) || !preg_match('/^[A-Za-z0-9_-]{1,80}$/D',$attribute) || !is_array($group) ||
                    array_diff(array_keys($group), ['defaultValue','choices']) || !is_array($group['choices']??null) ||
                    !array_is_list($group['choices']) || count($group['choices'])<1 || count($group['choices'])>100) $fail('filter_groups');
                $actual=[]; foreach ($catalog[$part] as $catalogOption) if (isset($catalogOption['attributes'][$attribute])) $actual[$catalogOption['attributes'][$attribute]]=true;
                if (!$actual) $fail('filter_groups');
                $values=[];
                foreach ($group['choices'] as $choice) {
                    if (!is_array($choice) || array_keys($choice)!==['value','label','matches']) $fail('filter_groups');
                    $value=$checkId($choice['value']); $checkLabel($choice['label']);
                    if (isset($values[$value]) || !is_array($choice['matches']) || !array_is_list($choice['matches']) ||
                        count($choice['matches'])<1 || count($choice['matches'])>100) $fail('filter_groups');
                    $values[$value]=true;
                    foreach ($choice['matches'] as $match) if (!is_string($match) || !isset($actual[$match])) $fail('filter_groups');
                }
                if (isset($group['defaultValue']) && !isset($values[$group['defaultValue']])) $fail('filter_groups');
            }
        }
        $encodedGroups=[]; foreach ($groups as $part=>$attributes) $encodedGroups[$part]=(object)$attributes;
        $settings['filter_groups_json']=$encode((object)$encodedGroups);
        $settings['logo_colors']=[]; $colors=$catalog['logoColors']??[];
        if (!is_array($colors) || !array_is_list($colors) || count($colors)>100) $fail('logo_colors');
        $colorIds=[];
        foreach ($colors as $color) {
            $value=$color['value']??null;
            if (!is_string($value) || !preg_match('/^#[a-fA-F0-9]{6}$/D',$value)) $fail('logo_color');
            $normalized=strtolower($value); if (isset($colorIds[$normalized])) $fail('logo_color_duplicate'); $colorIds[$normalized]=true;
            $settings['logo_colors'][]=['_id'=>$rowId('logo-color',$normalized),'label'=>$checkLabel($color['label']??null),'value'=>$value];
        }
        if (isset($catalog['placeholders'])) { if (!is_array($catalog['placeholders'])) $fail('placeholders');
            foreach (['bottles','pumps','caps'] as $part) { $value=$catalog['placeholders'][$part]??null; if (!is_array($value)) $fail('placeholders');
                $settings['placeholder_'.$part]=$mediaRef($value['image']??null); foreach($rectangle($value['position']??null) as $key=>$value2) $settings['placeholder_'.$part.'_'.$key]=$value2; }
        }
        foreach ($rectangle($catalog['logoArea']??null) as $key=>$value) $settings['logo_'.$key]=$value;
        if (isset($catalog['previewLayout'])) {
            $layout=$catalog['previewLayout']; if (!is_array($layout) || ($layout['mode']??null)!=='natural-stack' || ($layout['capAndPumpAnchor']??null)!=='bottom:100%') $fail('layout');
            $settings['preview_layout_mode']='natural-stack';
            foreach (['width'=>'preview_layout_width','minHeight'=>'preview_layout_min_height','outerPaddingTop'=>'preview_layout_padding_top','bottleOffsetY'=>'preview_layout_bottle_offset_y'] as $key=>$setting) $settings[$setting]=$number($layout[$key]??null, $key==='bottleOffsetY'?-500:0,1000);
            if (isset($layout['mobile'])) { $mobile=$layout['mobile']; if (!is_array($mobile)) $fail('mobile_layout');
                foreach (['breakpoint'=>'preview_mobile_breakpoint','minHeight'=>'preview_mobile_min_height','outerPaddingTop'=>'preview_mobile_padding_top','bottleOffsetY'=>'preview_mobile_bottle_offset_y'] as $key=>$setting) $settings[$setting]=$number($mobile[$key]??null,$key==='bottleOffsetY'?-500:0,1200);
                $settings['preview_mobile_label']=$checkLabel($mobile['previewLabel']??null);
            }
        }
        if (count($used)!==count($owned)) $fail('asset_unused');
        if ($action === 'revise-catalog') {
            $oldSettings=$input['expectedOldSettings']??null;
            $oldCanonical=$input['expectedOldCanonicalSettings']??null;
            if (!is_array($oldCanonical) || array_is_list($oldCanonical)) $fail('revision_settings');
            $sortMaps=static function($value) use (&$sortMaps) {
                if (!is_array($value)) return $value;
                if (!array_is_list($value)) ksort($value);
                foreach ($value as $key=>$child) $value[$key]=$sortMaps($child);
                return $value;
            };
            $oldLegacy=$oldCanonical; unset($oldLegacy['filter_groups_json']);
            $oldCompatible=$sortMaps($oldSettings)===$sortMaps($oldCanonical) ||
                is_array($oldSettings) && ($oldCanonical['filter_groups_json']??null)==='{}' &&
                !array_key_exists('filter_groups_json',$oldSettings) && $sortMaps($oldSettings)===$sortMaps($oldLegacy);
            if (!is_array($oldSettings) || array_is_list($oldSettings) || !$oldCompatible || $digest($oldSettings)!==($input['oldWidgetHash']??null) ||
                $digest($settings)!==($input['newWidgetHash']??null) || ($input['newWidgetHash']??null)===($input['oldWidgetHash']??null)) $fail('revision_settings');
            $oldMedia=[];
            $collectMedia=static function($value) use (&$collectMedia,&$oldMedia,$fail) {
                if (!is_array($value)) return;
                if (array_keys($value)===['id','url'] && is_int($value['id']) && is_string($value['url'])) {
                    if (isset($oldMedia[$value['id']]) && $oldMedia[$value['id']]!==$value['url']) $fail('revision_media');
                    $oldMedia[$value['id']]=$value['url']; return;
                }
                foreach ($value as $child) $collectMedia($child);
            };
            $collectMedia($oldSettings);
            ksort($oldMedia); ksort($owned);
            if ($oldMedia!==$owned) $fail('revision_media');
            $elements=$snapshot['elements']; $slotCount=0; $formCount=0; $widgetCount=0;
            $visit=static function(&$nodes) use (&$visit,$slotId,$formId,$widgetId,$oldSettings,$settings,$summaryId,$uploadId,&$slotCount,&$formCount,&$widgetCount,$sortMaps,$fail) {
                foreach ($nodes as &$node) {
                    if (($node['id']??null)===$slotId) {
                        $slotCount++;
                        if (($node['elType']??null)!=='container' || !is_array($node['elements']??null) || !array_is_list($node['elements']) ||
                            count($node['elements'])<2 || ($node['elements'][count($node['elements'])-1]['id']??null)!==$widgetId) $fail('revision_slot');
                    }
                    if (($node['id']??null)===$formId) {
                        $formCount++;
                        $fields=$node['settings']['form_fields']??null;
                        if (($node['elType']??null)!=='widget' || ($node['widgetType']??null)!=='form' || !is_array($fields) || count($fields)<3 ||
                            ($node['settings']['submit_actions']??null)!==['save-to-database','email'] ||
                            ($fields[count($fields)-2]['custom_id']??null)!==$summaryId ||
                            ($fields[count($fields)-1]['custom_id']??null)!==$uploadId) $fail('revision_form');
                    }
                    if (($node['id']??null)===$widgetId || ($node['widgetType']??null)==='clonewp_bottle_configurator') {
                        $widgetCount++;
                        if (($node['id']??null)!==$widgetId || ($node['elType']??null)!=='widget' ||
                            ($node['widgetType']??null)!=='clonewp_bottle_configurator' || ($node['elements']??null)!==[] ||
                            $sortMaps($node['settings']??null)!==$sortMaps($oldSettings)) $fail('revision_widget');
                        $node['settings']=$settings;
                    }
                    if (!empty($node['elements'])) $visit($node['elements']);
                }
                unset($node);
            };
            $visit($elements);
            if ($slotCount!==1 || $formCount!==1 || $widgetCount!==1) $fail('revision_tree_boundary');
            $patchedHash=$digest($elements);
            if ($patchedHash!==($input['patchedHash']??null)) $fail('revision_patch_hash');
            $receipt=['pageId'=>$pageId,'contractHash'=>$contract,'operationId'=>$operation,'state'=>'started',
                'kind'=>'catalog-revision','priorOperationId'=>$input['priorOperationId'],'baseHash'=>$snapshot['elementsHash'],
                'patchedHash'=>$patchedHash,'settingsHash'=>$snapshot['settingsHash']];
            update_option($option,$receipt,false);
            $mode=$plugin->breakpoints->get_responsive_control_duplication_mode();
            $fp=null;$frontend=null;
            if (class_exists('Elementor\\Core\\Frontend\\Performance')) { $fp=new ReflectionProperty('Elementor\\Core\\Frontend\\Performance','is_frontend');$fp->setAccessible(true);$frontend=$fp->getValue();$fp->setValue(null,false); }
            try { $plugin->breakpoints->set_responsive_control_duplication_mode('off');$plugin->controls_manager->clear_stack_cache();
                if (!$doc->save(['elements'=>$elements,'settings'=>get_post_meta($pageId,'_elementor_page_settings',true)?:[]])) $fail('save_unknown');
            } finally { $plugin->breakpoints->set_responsive_control_duplication_mode($mode);if($fp)$fp->setValue(null,$frontend);$plugin->controls_manager->clear_stack_cache(); }
            $after=$read();
            if ($after['elements']!=$elements || $after['settingsHash']!==$snapshot['settingsHash']) $fail('revision_readback');
            $receipt['state']='complete';update_option($option,$receipt,false);
            return ['ok'=>true,'value'=>['snapshot'=>$after,'receipt'=>$receipt]];
        }
        $elements=$snapshot['elements']; $slotCount=0; $formCount=0; $existingWidget=0;
        $walk = static function(&$nodes) use (&$walk,$slotId,$formId,$widgetId,&$slotCount,&$formCount,&$existingWidget,$settings,$summaryId,$uploadId,$rowId,$fail) {
            foreach ($nodes as &$node) {
                if (($node['id']??null)===$widgetId || ($node['widgetType']??null)==='clonewp_bottle_configurator') $existingWidget++;
                if (($node['id']??null)===$slotId) { if (($node['elType']??null)!=='container' || !is_array($node['elements']??null) || !array_is_list($node['elements']) || count($node['elements'])<1) $fail('slot');
                    foreach ($node['elements'] as $child) if (!is_array($child) || !preg_match('/^[a-f0-9]{7}$/D', $child['id']??'') ||
                        !in_array($child['elType']??null,['container','widget'],true) || ($child['elType']??null)==='widget' && empty($child['widgetType'])) $fail('slot');
                    $slotCount++;
                    $walk($node['elements']);
                    $node['elements'][]=['id'=>$widgetId,'elType'=>'widget','widgetType'=>'clonewp_bottle_configurator','settings'=>$settings,'elements'=>[]]; }
                if (($node['id']??null)===$formId) { if (($node['elType']??null)!=='widget' || ($node['widgetType']??null)!=='form') $fail('form'); $formCount++;
                    $formSettings=&$node['settings']; $fields=&$formSettings['form_fields'];
                    if (!is_array($fields) || !array_is_list($fields) || !$fields || ($formSettings['submit_actions']??null)!==['save-to-database','email']) $fail('form_actions');
                    foreach ($fields as $field) if (($field['custom_id']??null)===$summaryId || ($field['custom_id']??null)===$uploadId) $fail('form_field_collision');
                    $fields[]=['_id'=>$rowId('native-form-field',$formId.':'.$summaryId),'custom_id'=>$summaryId,'field_type'=>'hidden','field_label'=>'Bottle configuration','required'=>'','width'=>'100'];
                    $fields[]=['_id'=>$rowId('native-form-field',$formId.':'.$uploadId),'custom_id'=>$uploadId,'field_type'=>'upload','field_label'=>'Logo','required'=>'','width'=>'100',
                        'file_types'=>'png,jpg,jpeg,webp','file_sizes'=>5,'allow_multiple_upload'=>'','attachment_type'=>'link']; }
                // The newly inserted widget is not part of the base tree being checked.
                if (($node['id']??null)!==$slotId && !empty($node['elements'])) $walk($node['elements']);
            }
            unset($node);
        };
        $walk($elements);
        if ($slotCount!==1 || $formCount!==1 || $existingWidget!==0) $fail('tree_boundary');
        $patchedHash=$digest($elements);
        if ($patchedHash!==($input['patchedHash']??null)) $fail('patch_hash');
        $receipt=['pageId'=>$pageId,'contractHash'=>$contract,'operationId'=>$operation,'state'=>'started','baseHash'=>$snapshot['elementsHash'],'patchedHash'=>$patchedHash,'settingsHash'=>$snapshot['settingsHash']];
        update_option($option,$receipt,false);
        $mode=$plugin->breakpoints->get_responsive_control_duplication_mode();
        $fp=null;$frontend=null;
        if (class_exists('Elementor\\Core\\Frontend\\Performance')) { $fp=new ReflectionProperty('Elementor\\Core\\Frontend\\Performance','is_frontend');$fp->setAccessible(true);$frontend=$fp->getValue();$fp->setValue(null,false); }
        try { $plugin->breakpoints->set_responsive_control_duplication_mode('off');$plugin->controls_manager->clear_stack_cache();
            if (!$doc->save(['elements'=>$elements,'settings'=>get_post_meta($pageId,'_elementor_page_settings',true)?:[]])) $fail('save_unknown');
        } finally { $plugin->breakpoints->set_responsive_control_duplication_mode($mode);if($fp)$fp->setValue(null,$frontend);$plugin->controls_manager->clear_stack_cache(); }
        $after=$read();
        if ($after['elements']!=$elements || $after['settingsHash']!==$snapshot['settingsHash']) $fail('readback');
        $receipt['state']='complete';update_option($option,$receipt,false);
        return ['ok'=>true,'value'=>['snapshot'=>$after,'receipt'=>$receipt]];
    } finally { if (get_option($lock)===$operation) delete_option($lock); }
} catch (Throwable $error) {
    $message=$error->getMessage();
    return ['ok'=>false,'code'=>preg_match('/^configurator_[a-z0-9_]{1,100}$/D',$message)?$message:'configurator_server_failed'];
}
