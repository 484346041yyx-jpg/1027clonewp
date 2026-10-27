<?php
// Offline WordPress stand-ins exercise the actual resource guard without site writes.
$GLOBALS['fixtureOptions'] = [
    'whb_header_123' => json_encode(['id' => 'header_123', 'name' => 'Existing header']),
    'xts-woodmart-options' => ['footer_content_type' => 'html_block', 'footer_html_block' => '41', 'footer_text_color' => 'light', 'disable_footer' => '1'],
];
$makePost = static fn(int $id, string $type, string $content) => (object)[
    'ID' => $id, 'post_type' => $type, 'post_status' => 'publish',
    'post_title' => 'Block '.$id, 'post_name' => 'block-'.$id,
    'post_parent' => 0, 'post_content' => $content, 'post_excerpt' => '',
    'menu_order' => 0, 'post_password' => '',
];
$GLOBALS['fixturePosts'] = [41 => $makePost(41, 'cms_block', 'Visible footer'), 42 => $makePost(42, 'cms_block', 'Another footer'), 999 => $makePost(999, 'woodmart_layout', 'Unrelated layout')];
$GLOBALS['fixtureMeta'] = [41 => ['_elementor_data' => '[{"id":"footer","settings":{"title":"Footer"}}]', '_edit_lock' => '1:admin', '_elementor_css' => 'cached'], 42 => ['_elementor_data' => '[]'], 999 => ['_elementor_data' => 'other']];
function current_user_can(...$args) { return true; }
function get_template() { return 'woodmart'; }
function home_url($path) { return 'https://target.example'.$path; }
function untrailingslashit($value) { return rtrim($value, '/'); }
function get_option($key) { return $GLOBALS['fixtureOptions'][$key] ?? false; }
function get_post($id) { return $GLOBALS['fixturePosts'][$id] ?? null; }
function get_post_meta($id, $key = null, $single = false) {
    $meta = $GLOBALS['fixtureMeta'][$id] ?? [];
    if ($key !== null) return $meta[$key] ?? ($single ? '' : []);
    return array_map(static fn($value) => [$value], $meta);
}
function get_posts() { throw new RuntimeException('Unrelated posts must not be queried'); }
function wp_get_nav_menu_object($id) { $menu = $GLOBALS['fixtureMenu'] ?? null; return $menu && ($id === $menu->slug || (int)$id === $menu->term_id) ? $menu : false; }
function wp_get_nav_menu_items($id, $args) { return $GLOBALS['fixtureMenuItems'] ?? []; }
function wp_get_nav_menus() { return []; }
function get_stylesheet() { return 'woodmart'; }
function snapshot() {
    $input = ['action' => 'resources', 'targetOrigin' => 'https://target.example', 'headerId' => 'header_123', 'pageScope' => 'body-only', 'mobileMaxWidth' => 768];
    $result = eval(file_get_contents(dirname(__DIR__, 2).'/src/replica-full/reused-driver.php'));
    if (!$result['ok']) throw new RuntimeException($result['code']);
    return $result['value'];
}
function requireSame($before, $after, $message) { if ($before !== $after) throw new RuntimeException($message); }
function requireDifferent($before, $after, $message) { if ($before === $after) throw new RuntimeException($message); }
$initial = snapshot();
$GLOBALS['fixturePosts'][999]->post_content = 'Changed unrelated layout';
requireSame($initial, snapshot(), 'Unrelated layout changed reused resources');
$GLOBALS['fixtureMeta'][41]['_edit_lock'] = '2:admin';
$GLOBALS['fixtureMeta'][41]['_elementor_css'] = 'new cache';
requireSame($initial, snapshot(), 'Editor cache changed reused resources');
$GLOBALS['fixtureMeta'][41]['_elementor_data'] = '[{"id":"footer","settings":{"title":"Changed"}}]';
$contentChanged = snapshot();
requireDifferent($initial['footerHash'], $contentChanged['footerHash'], 'Selected footer edit was missed');
$GLOBALS['fixtureOptions']['xts-woodmart-options']['footer_text_color'] = 'dark';
$optionChanged = snapshot();
requireDifferent($contentChanged['footerHash'], $optionChanged['footerHash'], 'Footer option edit was missed');
$GLOBALS['fixtureOptions']['xts-woodmart-options']['footer_html_block'] = '42';
$otherSelected = snapshot();
requireDifferent($optionChanged['footerHash'], $otherSelected['footerHash'], 'Footer block replacement was missed');
$GLOBALS['fixtureOptions']['xts-woodmart-options']['footer_content_type'] = 'widgets';
$GLOBALS['fixtureOptions']['sidebars_widgets'] = ['footer-1' => ['text-2'], 'sidebar-main' => ['text-3']];
$GLOBALS['fixtureOptions']['widget_text'] = [2 => ['title' => 'Footer widget', 'text' => 'Contact us'], 3 => ['title' => 'Unrelated widget', 'text' => 'Other']];
$widgets = snapshot();
$GLOBALS['fixtureOptions']['widget_text'][3]['text'] = 'Changed unrelated widget';
requireSame($widgets, snapshot(), 'Unrelated widget changed reused resources');
$GLOBALS['fixtureOptions']['widget_text'][2]['text'] = 'Changed footer widget';
requireDifferent($widgets['footerHash'], snapshot()['footerHash'], 'Footer widget edit was missed');
$GLOBALS['fixtureOptions']['xts-woodmart-options']['footer_content_type'] = 'html_block';
$GLOBALS['fixtureMeta'][42]['_elementor_data'] = '[{"widgetType":"nav-menu","settings":{"menu":"footer-links"}}]';
$GLOBALS['fixtureMenu'] = (object)['term_id' => 7, 'name' => 'Footer links', 'slug' => 'footer-links'];
$GLOBALS['fixtureMenuItems'] = [$makePost(77, 'nav_menu_item', 'Menu item')];
$GLOBALS['fixtureMeta'][77] = ['_menu_item_url' => 'https://target.example/contact/'];
$menu = snapshot();
$GLOBALS['fixtureMenuItems'][0]->post_title = 'Renamed menu item';
requireDifferent($menu['footerHash'], snapshot()['footerHash'], 'Referenced footer menu edit was missed');
echo "footer hash guard passed\n";
