<?php
// Installed as a must-use plugin. No credentials, endpoints or tokens are stored here.
defined('ABSPATH') || exit;
$clonewp_gate_marker = WP_CONTENT_DIR . '/.clonewp-reset-busy';
$clonewp_gate_recovery = (defined('WP_CLI') && WP_CLI)
    || basename((string) ($_SERVER['SCRIPT_NAME'] ?? '')) === 'wp-login.php'
    || (basename((string) ($_SERVER['SCRIPT_NAME'] ?? '')) === 'admin-post.php'
        && ($_POST['action'] ?? '') === 'clonewp_test_reset' && ($_POST['operation'] ?? '') === 'recover')
    || (basename((string) ($_SERVER['SCRIPT_NAME'] ?? '')) === 'tools.php' && ($_GET['page'] ?? '') === 'clonewp-test-reset');
$clonewp_gate_lock = fopen(WP_CONTENT_DIR . '/.clonewp-reset-request-lock', 'c+');
if (!$clonewp_gate_lock || !flock($clonewp_gate_lock, LOCK_SH | LOCK_NB)
    || (is_file($clonewp_gate_marker) && !$clonewp_gate_recovery)) {
    http_response_code(503); header('Retry-After: 30'); header('Cache-Control: no-store');
    exit('测试站正在恢复。管理员可从 工具 → 测试站恢复 检查和恢复操作前备份。');
}
$GLOBALS['clonewp_reset_request_lock'] = $clonewp_gate_lock;
register_shutdown_function(static function () use ($clonewp_gate_lock) { flock($clonewp_gate_lock, LOCK_UN); fclose($clonewp_gate_lock); });
