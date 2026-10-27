<?php
/**
 * Plugin Name: cloneWP 测试站恢复
 * Description: yaoxuxuan.com 专用的加密基准备份、恢复及恢复前备份。管理员账号和认证保持当前状态。
 * Version: 0.1.1
 * Requires PHP: 8.1
 */
defined('ABSPATH') || exit;
require_once __DIR__ . '/lib.php';

function clonewp_reset_service(): \CloneWPReset\Service {
    global $wpdb;
    if (is_multisite() || strtolower((string) wp_parse_url(home_url(), PHP_URL_HOST)) !== 'yaoxuxuan.com'
        || strtolower((string) wp_parse_url(site_url(), PHP_URL_HOST)) !== 'yaoxuxuan.com') {
        throw new RuntimeException('仅允许 yaoxuxuan.com 单站运行。');
    }
    $root = realpath(ABSPATH);
    $vault = defined('CLONEWP_RESET_VAULT') ? CLONEWP_RESET_VAULT : dirname($root) . '/.clonewp-yaoxuxuan-vault';
    $key = hash('sha256', wp_salt('auth') . wp_salt('secure_auth'), true);
    return new \CloneWPReset\Service($wpdb, $root, WP_CONTENT_DIR, $vault, $key,
        ['origin' => 'https://yaoxuxuan.com', 'wordpress' => get_bloginfo('version'), 'prefix' => $wpdb->prefix]);
}

register_activation_hook(__FILE__, function () {
    clonewp_reset_service()->installGate(__DIR__ . '/request-gate.php');
});
add_action('admin_menu', function () {
    add_management_page('测试站恢复初始状态', '测试站恢复', 'manage_options', 'clonewp-test-reset', 'clonewp_reset_screen');
});
function clonewp_reset_screen(): void {
    current_user_can('manage_options') || wp_die('无权限。', '', ['response' => 403]);
    echo '<div class="wrap"><h1>测试站恢复初始状态</h1>';
    try {
        $service = clonewp_reset_service(); $status = $service->status();
        echo '<p>专用站点：<strong>yaoxuxuan.com</strong>。恢复页面、文章、商品、分类、菜单、页眉、模板、插件/主题和上传文件到基准；当前用户账号、密码、会话及应用密码保留。</p>';
        echo '<p>基准：' . esc_html($status['baseline'] ?? '尚未建立') . '；恢复代次：' . esc_html($status['epoch']) . '</p>';
        echo '<p>每次恢复前都会保存当前状态。只有点击保存或覆盖保存才会更新初始基准，恢复始终回到最后一次保存的基准；旧备份会保留。插件升级后须重新验证并保存基准。</p>';
        if ($status['pending']) echo '<div class="notice notice-error"><p>发现未完成操作，站点保持维护状态。请先执行下方“恢复操作前备份”。</p></div>';
        $actions = $status['pending'] ? ['recover' => '恢复操作前备份'] : ['capture' => $status['baseline'] ? '覆盖保存当前状态为初始基准' : '保存当前状态为初始基准'];
        if (!$status['pending'] && $status['baseline']) $actions['restore'] = '恢复初始状态';
        foreach ($actions as $action => $label) {
            echo '<form method="post" action="' . esc_url(admin_url('admin-post.php')) . '">';
            wp_nonce_field('clonewp_test_reset_' . $action);
            echo '<input type="hidden" name="action" value="clonewp_test_reset"><input type="hidden" name="operation" value="' . esc_attr($action) . '">';
            echo '<input type="hidden" name="expected_baseline" value="' . esc_attr($status['baseline'] ?? '') . '">';
            echo '<input type="hidden" name="expected_epoch" value="' . esc_attr($status['epoch']) . '">';
            if ($action === 'capture' && $status['baseline']) echo '<p><label><input type="checkbox" name="confirm_overwrite" value="yes" required> 我确认把当前网站保存为新的初始基准，以后恢复将回到本次保存的状态。旧备份保留。</label></p>';
            if ($action !== 'capture') echo '<p><label><input type="checkbox" name="confirm" value="yes" required> 我确认本测试站当前复刻内容将被替换，先备份再恢复。</label></p>';
            submit_button($label, $action === 'capture' ? 'secondary' : 'primary'); echo '</form>';
        }
        echo '<p>备份存放于网站公开目录外，并加密数据库。不要移动或删除服务器上的 vault 目录，也不要更换 WordPress AUTH salts 后再尝试读取旧备份。</p>';
    } catch (Throwable $e) { echo '<div class="notice notice-error"><p>' . esc_html($e->getMessage()) . '</p></div>'; }
    echo '</div>';
}
add_action('admin_post_clonewp_test_reset', function () {
    current_user_can('manage_options') || wp_die('无权限。', '', ['response' => 403]);
    $operation = sanitize_key($_POST['operation'] ?? '');
    in_array($operation, ['capture', 'restore', 'recover'], true) || wp_die('无效操作。');
    check_admin_referer('clonewp_test_reset_' . $operation);
    if ($operation !== 'capture' && ($_POST['confirm'] ?? '') !== 'yes') wp_die('缺少恢复确认。');
    try {
        $service = clonewp_reset_service();
        $service->run($operation, sanitize_text_field($_POST['expected_baseline'] ?? ''), sanitize_text_field($_POST['expected_epoch'] ?? ''), ($_POST['confirm_overwrite'] ?? '') === 'yes');
        // Do not run unrelated plugin shutdown callbacks against a restored database.
        if ($operation !== 'capture') remove_all_actions('shutdown');
        wp_cache_flush();
        wp_safe_redirect(admin_url('tools.php?page=clonewp-test-reset')); exit;
    } catch (Throwable $e) { wp_die(esc_html($e->getMessage()), '测试站恢复未完成', ['back_link' => true]); }
});
add_action('rest_api_init', function () {
    register_rest_route('clonewp-test-reset/v1', '/status', [
        'methods' => 'GET', 'permission_callback' => fn () => current_user_can('manage_options'),
        'callback' => function () { try { return clonewp_reset_service()->status(); } catch (Throwable $e) { return new WP_Error('reset_unavailable', $e->getMessage(), ['status' => 503]); } }
    ]);
});
