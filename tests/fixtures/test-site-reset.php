<?php
require $argv[1] . '/src/test-site-reset/plugin/lib.php';
define('ARRAY_N', 'ARRAY_N'); define('ARRAY_A', 'ARRAY_A');
use CloneWPReset\Files;
use CloneWPReset\Stream;
use CloneWPReset\Database;
use CloneWPReset\Service;
function verify($condition, $message) { if (!$condition) throw new RuntimeException($message); }
function rejects(callable $fn) { try { $fn(); } catch (Throwable $e) { return; } throw new RuntimeException('Expected rejection'); }

// A small SQL-shape fixture exercises the real orchestration and file operations.
// It does not substitute for the required live MySQL/WordPress restore drill.
final class FixtureDB {
    public string $prefix = 'wp_'; public string $users = 'wp_users'; public string $usermeta = 'wp_usermeta';
    public string $last_error = ''; public bool $failSwap = false; public bool $failDump = false;
    public array $tables = ['wp_posts' => [['ID' => '1', 'post_title' => '基准商品']], 'wp_options' => [['option_name' => 'home', 'option_value' => 'https://yaoxuxuan.com']], 'wp_users' => [['ID' => '1', 'password' => 'current-password']], 'wp_usermeta' => [['user_id' => '1', 'session' => 'current-session']]];
    public function prepare($sql, $value) { return str_replace('%s', "'" . $value . "'", $sql); }
    public function get_results($sql, $mode) {
        if ($this->failDump && str_starts_with($sql, 'SELECT *')) throw new RuntimeException('Injected snapshot failure');
        if ($sql === 'SHOW FULL TABLES') return array_map(fn($x) => [$x, 'BASE TABLE'], array_keys($this->tables));
        if (str_starts_with($sql, 'SHOW TRIGGERS')) return [];
        if (preg_match('/SELECT \* FROM `([^`]+)` LIMIT 100 OFFSET (\d+)/', $sql, $m)) return array_slice($this->tables[$m[1]], (int) $m[2], 100);
        throw new RuntimeException('Unknown read');
    }
    public function get_row($sql, $mode) { preg_match('/SHOW CREATE TABLE `([^`]+)`/', $sql, $m); return [$m[1], 'CREATE TABLE `' . $m[1] . '` (`value` text) ENGINE=InnoDB']; }
    public function get_var($sql) { preg_match('/SELECT COUNT\(\*\) FROM `([^`]+)`/', $sql, $m); return count($this->tables[$m[1]]); }
    public function query($sql) {
        if (preg_match('/^CREATE TABLE `([^`]+)`/', $sql, $m)) { if (isset($this->tables[$m[1]])) return false; $this->tables[$m[1]] = []; return 0; }
        if (preg_match('/^INSERT INTO `([^`]+)` \((.+)\) VALUES \((.*)\)$/', $sql, $m)) {
            preg_match_all('/`([^`]+)`/', $m[2], $columns); $values = explode(',', $m[3]); $row = [];
            foreach ($columns[1] as $i => $column) $row[$column] = $values[$i] === 'NULL' ? null : hex2bin(substr($values[$i], 2, -1));
            $this->tables[$m[1]][] = $row; return 1;
        }
        if (str_starts_with($sql, 'RENAME TABLE ')) {
            if ($this->failSwap) return false;
            preg_match_all('/`([^`]+)` TO `([^`]+)`/', $sql, $pairs, PREG_SET_ORDER);
            $copy = $this->tables;
            foreach ($pairs as $pair) { if (!isset($copy[$pair[1]]) || isset($copy[$pair[2]])) return false; $copy[$pair[2]] = $copy[$pair[1]]; unset($copy[$pair[1]]); }
            $this->tables = $copy; return 0;
        }
        throw new RuntimeException('Unknown write');
    }
}
$root = $argv[2]; Files::directory($root); $key = random_bytes(32);
$stream = $root . '/stream.cwr'; Stream::write($stream, $key, [['copy' => '汉字'], ['copy' => null]]);
verify(iterator_to_array(Stream::read($stream, $key)) === [['copy' => '汉字'], ['copy' => null]], 'stream roundtrip');
rejects(fn() => iterator_to_array(Stream::read($stream, random_bytes(32))));
$bytes = file_get_contents($stream); file_put_contents($root . '/truncated.cwr', substr($bytes, 0, -1));
rejects(fn() => iterator_to_array(Stream::read($root . '/truncated.cwr', $key)));
file_put_contents($root . '/appended.cwr', $bytes . 'junk'); rejects(fn() => iterator_to_array(Stream::read($root . '/appended.cwr', $key)));
$bytes[40] = chr(ord($bytes[40]) ^ 1); file_put_contents($root . '/tampered.cwr', $bytes); rejects(fn() => iterator_to_array(Stream::read($root . '/tampered.cwr', $key)));
rejects(fn() => Database::identifier('wp_posts; DROP TABLE wp_users'));
$site = Files::directory($root . '/public'); $content = Files::directory($site . '/wp-content');
foreach (['uploads', 'themes', 'plugins'] as $name) { Files::directory($content . '/' . $name); file_put_contents($content . '/' . $name . '/initial.txt', 'initial-' . $name); }
$_SERVER['DOCUMENT_ROOT'] = $site;
$db = new FixtureDB(); $identity = ['origin' => 'https://yaoxuxuan.com', 'wordpress' => '7.1.3', 'prefix' => 'wp_'];
rejects(fn() => new Service($db, $site, $content, $content . '/bad-vault', $key, $identity));
$service = new Service($db, $site, $content, $root . '/vault', $key, $identity);
$service->installGate($argv[1] . '/src/test-site-reset/plugin/request-gate.php');
$GLOBALS['clonewp_reset_request_lock'] = fopen($content . '/.clonewp-reset-request-lock', 'c+'); flock($GLOBALS['clonewp_reset_request_lock'], LOCK_SH);
file_put_contents($content . '/.clonewp-reset-busy', 'orphan-before-live-mutation');
verify($service->status()['pending'], 'orphan maintenance is visible');
$service->run('recover', '', 'uninitialized');
verify(!$service->status()['pending'], 'pre-mutation crash can be cleared without touching content');
$service->run('capture', '', 'uninitialized'); $baseline = $service->status();
verify($baseline['baseline'] && !$baseline['pending'], 'baseline created');
rejects(fn() => $service->run('capture', $baseline['baseline'], $baseline['epoch']));
$db->tables['wp_posts'][] = ['ID' => '2', 'post_title' => '复刻内容'];
$db->tables['wp_new_plugin_table'] = [['junk' => 'old']];
$db->tables['wp_users'][0]['password'] = 'new-password';
file_put_contents($content . '/uploads/clone.txt', 'cloned media'); file_put_contents($content . '/themes/initial.txt', 'changed');
rejects(fn() => $service->run('restore', $baseline['baseline'], 'stale-epoch'));
$service->run('restore', $baseline['baseline'], $baseline['epoch']); $restored = $service->status();
verify(count($db->tables['wp_posts']) === 1 && !isset($db->tables['wp_new_plugin_table']), 'database restored and extra table removed from live prefix');
verify($db->tables['wp_users'][0]['password'] === 'new-password', 'current credentials preserved');
verify(!is_file($content . '/uploads/clone.txt') && file_get_contents($content . '/themes/initial.txt') === 'initial-themes', 'files restored');
verify($restored['epoch'] !== $baseline['epoch'] && !$restored['pending'], 'new generation committed');
verify(is_dir($root . '/vault/snapshots/' . $restored['before']), 'before snapshot retained');
verify(!is_file($content . '/.clonewp-reset-busy'), 'maintenance cleared');
// Inject a failure after file switching but before table rename. Recovery uses the exact pre-operation backup.
file_put_contents($content . '/uploads/recover-me.txt', 'pre-operation'); $db->tables['wp_posts'][] = ['ID' => '3', 'post_title' => '保留到恢复前'];
$db->failSwap = true; rejects(fn() => $service->run('restore', $restored['baseline'], $restored['epoch']));
verify($service->status()['pending'] && is_file($content . '/.clonewp-reset-busy'), 'uncertain operation fails closed');
$db->failSwap = false; $service->run('recover', $restored['baseline'], $restored['epoch']);
verify(count($db->tables['wp_posts']) === 2 && file_get_contents($content . '/uploads/recover-me.txt') === 'pre-operation', 'failure recovery returns to before state');
verify(!$service->status()['pending'] && !is_file($content . '/.clonewp-reset-busy'), 'recovery closes pending state');
// Signed manifest corruption is rejected before changing the live site.
$status = $service->status(); $manifest = $root . '/vault/snapshots/' . $status['baseline'] . '/manifest.json';
$json = json_decode(file_get_contents($manifest), true); $json['data']['identity']['origin'] = 'https://other.example'; file_put_contents($manifest, json_encode($json));
rejects(fn() => $service->run('restore', $status['baseline'], $status['epoch']));
verify(count($db->tables['wp_posts']) === 2 && !is_file($content . '/.clonewp-reset-busy'), 'tampered baseline leaves current state intact');
fclose($GLOBALS['clonewp_reset_request_lock']);
// Replacing a baseline is explicit, atomic and leaves both live content and the old backup intact.
$updateSite = Files::directory($root . '/overwrite/public');
$updateContent = Files::directory($updateSite . '/wp-content');
foreach (['uploads', 'themes', 'plugins'] as $name) Files::directory($updateContent . '/' . $name);
$_SERVER['DOCUMENT_ROOT'] = $updateSite;
$updateDb = new FixtureDB();
$update = new Service($updateDb, $updateSite, $updateContent, $root . '/overwrite/vault', $key, $identity);
$update->installGate($argv[1] . '/src/test-site-reset/plugin/request-gate.php');
$GLOBALS['clonewp_reset_request_lock'] = fopen($updateContent . '/.clonewp-reset-request-lock', 'c+');
flock($GLOBALS['clonewp_reset_request_lock'], LOCK_SH);
$update->run('capture', '', 'uninitialized'); $first = $update->status();
$updateDb->tables['wp_posts'][] = ['ID' => '2', 'post_title' => '新基准商品'];
file_put_contents($updateContent . '/uploads/new-baseline.txt', 'new baseline media');
rejects(fn() => $update->run('capture', $first['baseline'], $first['epoch']));
verify($update->status() === $first, 'unconfirmed overwrite leaves baseline unchanged');
rejects(fn() => $update->run('capture', $first['baseline'], 'stale-epoch', true));
$update->run('capture', $first['baseline'], $first['epoch'], true); $second = $update->status();
verify($second['baseline'] !== $first['baseline'] && $second['epoch'] !== $first['epoch'], 'overwrite creates a new baseline generation');
verify($second['previousBaseline'] === $first['baseline'] && is_dir($root . '/overwrite/vault/snapshots/' . $first['baseline']), 'old baseline snapshot is retained');
verify(count($updateDb->tables['wp_posts']) === 2 && file_get_contents($updateContent . '/uploads/new-baseline.txt') === 'new baseline media', 'saving baseline never restores or changes live content');
rejects(fn() => $update->run('capture', $first['baseline'], $first['epoch'], true));
$updateDb->failDump = true;
rejects(fn() => $update->run('capture', $second['baseline'], $second['epoch'], true));
$updateDb->failDump = false;
verify($update->status() === $second && !is_file($updateContent . '/.clonewp-reset-busy'), 'failed capture retains the prior baseline and clears maintenance');
$updateDb->tables['wp_posts'][] = ['ID' => '3', 'post_title' => '下一次复刻内容'];
file_put_contents($updateContent . '/uploads/after-new-baseline.txt', 'discard on restore');
$update->run('restore', $second['baseline'], $second['epoch']);
verify(count($updateDb->tables['wp_posts']) === 2 && is_file($updateContent . '/uploads/new-baseline.txt') && !is_file($updateContent . '/uploads/after-new-baseline.txt'), 'restore uses the latest successful baseline');
fclose($GLOBALS['clonewp_reset_request_lock']);

echo "PASS encryption, baseline replacement, retained history, failed capture keeps baseline, tamper/truncation, identifiers, vault boundary, capture, restore, extra-table isolation, credential preservation, CAS, failure recovery, manifest authentication\n";
