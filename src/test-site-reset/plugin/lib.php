<?php
namespace CloneWPReset;

final class Files {
    public static function directory(string $path): string {
        if (is_link($path)) throw new \RuntimeException('拒绝符号链接目录。');
        if (!is_dir($path) && !mkdir($path, 0700, true)) throw new \RuntimeException('无法建立备份目录。');
        $real = realpath($path); if ($real === false) throw new \RuntimeException('目录无法解析。');
        // Inspect every existing ancestor as well as the final path.
        for ($p = $path; dirname($p) !== $p; $p = dirname($p)) if (is_link($p)) throw new \RuntimeException('目录包含符号链接。');
        return $real;
    }
    public static function inside(string $path, string $root): bool {
        $normalize = static fn ($p) => rtrim(str_replace('\\', '/', $p), '/') . '/';
        return str_starts_with($normalize($path), $normalize($root));
    }
    public static function inventory(string $root): array {
        $out = []; if (!is_dir($root)) return $out;
        $root = self::directory($root);
        $iterator = new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator($root, \FilesystemIterator::SKIP_DOTS), \RecursiveIteratorIterator::SELF_FIRST);
        foreach ($iterator as $file) {
            if ($file->isLink() || !self::inside($file->getRealPath(), $root)) throw new \RuntimeException('文件树含链接或越界路径。');
            $relative = str_replace('\\', '/', substr($file->getPathname(), strlen($root) + 1));
            $out[$relative] = $file->isDir() ? ['dir' => true] : ['size' => $file->getSize(), 'sha256' => hash_file('sha256', $file->getPathname())];
        }
        ksort($out); return $out;
    }
    public static function copyTree(string $from, string $to): array {
        $inventory = self::inventory($from); self::directory($to);
        foreach ($inventory as $relative => $entry) {
            $destination = $to . '/' . $relative;
            if (!empty($entry['dir'])) { self::directory($destination); chmod($destination, 0755); continue; }
            self::directory(dirname($destination));
            if (!copy($from . '/' . $relative, $destination) || hash_file('sha256', $destination) !== $entry['sha256']) throw new \RuntimeException('复制文件读回不一致。');
            chmod($destination, 0644);
        }
        chmod($to, 0755);
        if (self::inventory($from) !== $inventory || self::inventory($to) !== $inventory) throw new \RuntimeException('复制期间源文件发生改变。');
        return $inventory;
    }
    public static function atomic(string $path, string $bytes): void {
        $tmp = $path . '.' . bin2hex(random_bytes(6)) . '.tmp';
        if (file_put_contents($tmp, $bytes, LOCK_EX) !== strlen($bytes)) throw new \RuntimeException('备份写入失败。');
        chmod($tmp, 0600);
        if (!rename($tmp, $path)) throw new \RuntimeException('无法提交备份记录。');
    }
}

/** Authenticated streaming encryption; reordered, truncated and appended frames fail. */
final class Stream {
    public static function write(string $path, string $key, iterable $records): void {
        [$state, $header] = sodium_crypto_secretstream_xchacha20poly1305_init_push($key);
        $handle = fopen($path, 'xb'); if (!$handle) throw new \RuntimeException('无法建立加密备份。');
        try {
            self::bytes($handle, "CWR1" . $header);
            foreach ($records as $record) {
                $plain = json_encode($record, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE);
                $cipher = sodium_crypto_secretstream_xchacha20poly1305_push($state, $plain);
                self::bytes($handle, pack('N', strlen($cipher)) . $cipher);
            }
            $cipher = sodium_crypto_secretstream_xchacha20poly1305_push($state, '', '', SODIUM_CRYPTO_SECRETSTREAM_XCHACHA20POLY1305_TAG_FINAL);
            self::bytes($handle, pack('N', strlen($cipher)) . $cipher); fflush($handle);
        } finally { fclose($handle); chmod($path, 0600); }
    }
    private static function bytes($handle, string $bytes): void {
        for ($offset = 0; $offset < strlen($bytes);) {
            $written = fwrite($handle, substr($bytes, $offset)); if (!$written) throw new \RuntimeException('磁盘写入失败。'); $offset += $written;
        }
    }
    private static function readBytes($handle, int $length): string {
        $bytes = ''; while (strlen($bytes) < $length && !feof($handle)) {
            $chunk = fread($handle, $length - strlen($bytes)); if ($chunk === false) throw new \RuntimeException('备份读取失败。'); $bytes .= $chunk;
        }
        if (strlen($bytes) !== $length) throw new \RuntimeException('加密备份被截断。'); return $bytes;
    }
    public static function read(string $path, string $key): \Generator {
        $handle = fopen($path, 'rb'); if (!$handle) throw new \RuntimeException('找不到加密备份。');
        try {
            if (self::readBytes($handle, 4) !== 'CWR1') throw new \RuntimeException('备份格式不匹配。');
            $state = sodium_crypto_secretstream_xchacha20poly1305_init_pull(self::readBytes($handle, SODIUM_CRYPTO_SECRETSTREAM_XCHACHA20POLY1305_HEADERBYTES), $key);
            while (true) {
                $length = unpack('N', self::readBytes($handle, 4))[1];
                if ($length < 17 || $length > 64 * 1024 * 1024) throw new \RuntimeException('备份帧长度无效。');
                $record = sodium_crypto_secretstream_xchacha20poly1305_pull($state, self::readBytes($handle, $length));
                if ($record === false) throw new \RuntimeException('备份认证失败。');
                [$plain, $tag] = $record;
                if ($tag === SODIUM_CRYPTO_SECRETSTREAM_XCHACHA20POLY1305_TAG_FINAL) {
                    if ($plain !== '' || fread($handle, 1) !== '') throw new \RuntimeException('备份尾部无效。'); break;
                }
                yield json_decode($plain, true, 512, JSON_THROW_ON_ERROR);
            }
        } finally { fclose($handle); }
    }
}

final class Database {
    public function __construct(private $db) {}
    public function query(string $sql) {
        $result = $this->db->query($sql); if ($result === false) throw new \RuntimeException('数据库操作失败，已保留恢复记录。'); return $result;
    }
    public static function identifier(string $name): string {
        if (!preg_match('/^[A-Za-z0-9_]{1,64}$/D', $name)) throw new \RuntimeException('数据库标识符无效。'); return '`' . $name . '`';
    }
    public function tables(): array {
        $rows = $this->db->get_results('SHOW FULL TABLES', ARRAY_N); if ($this->db->last_error) throw new \RuntimeException('数据库清单读取失败。');
        $tables = [];
        foreach ($rows as $row) if (str_starts_with($row[0], $this->db->prefix) && !in_array($row[0], [$this->db->users, $this->db->usermeta], true)) {
            if ($row[1] !== 'BASE TABLE') throw new \RuntimeException('暂不支持含数据库视图的站点。');
            self::identifier($row[0]); $tables[] = $row[0];
        }
        sort($tables); return $tables;
    }
    public function records(): \Generator {
        $tables = $this->tables(); yield ['type' => 'tables', 'tables' => $tables];
        foreach ($tables as $table) {
            $id = self::identifier($table);
            $create = $this->db->get_row('SHOW CREATE TABLE ' . $id, ARRAY_N);
            if (!$create || !preg_match('/ENGINE=InnoDB\b/i', $create[1]) || preg_match('/FOREIGN KEY|GENERATED ALWAYS|\bREFERENCES\b/i', $create[1])) throw new \RuntimeException('仅支持无外键和生成列的 InnoDB 表。');
            $triggers = $this->db->get_results($this->db->prepare('SHOW TRIGGERS WHERE `Table` = %s', $table), ARRAY_N);
            if ($triggers || $this->db->last_error) throw new \RuntimeException('不支持含触发器的表。');
            yield ['type' => 'schema', 'table' => $table, 'sql' => $create[1]];
            $count = 0;
            do {
                $rows = $this->db->get_results('SELECT * FROM ' . $id . ' LIMIT 100 OFFSET ' . $count, ARRAY_A);
                if ($this->db->last_error) throw new \RuntimeException('备份行读取失败。');
                foreach ($rows as $row) { foreach ($row as &$value) if ($value !== null) $value = base64_encode((string) $value); unset($value); yield ['type' => 'row', 'table' => $table, 'row' => $row]; $count++; }
            } while (count($rows) === 100);
            yield ['type' => 'end', 'table' => $table, 'count' => $count];
        }
        if ($tables !== $this->tables()) throw new \RuntimeException('备份期间表清单发生变化。');
    }
    public function stage(iterable $records, string $operation): array {
        $map = []; $counts = []; $expected = null; $finished = [];
        foreach ($records as $record) {
            $type = $record['type'] ?? '';
            if ($type === 'tables') { if ($expected !== null) throw new \RuntimeException('重复表清单。'); $expected = $record['tables']; continue; }
            $table = $record['table'] ?? ''; self::identifier($table);
            if ($expected === null || !in_array($table, $expected, true) || !str_starts_with($table, $this->db->prefix)
                || in_array($table, [$this->db->users, $this->db->usermeta], true)) throw new \RuntimeException('备份表归属无效。');
            if ($type === 'schema') {
                if (isset($map[$table])) throw new \RuntimeException('重复表结构。');
                $stage = 'cwr_' . $operation . '_' . count($map); self::identifier($stage);
                $prefix = 'CREATE TABLE ' . self::identifier($table);
                if (!str_starts_with($record['sql'], $prefix . ' ')) throw new \RuntimeException('表结构名称不匹配。');
                $this->query('CREATE TABLE ' . self::identifier($stage) . substr($record['sql'], strlen($prefix)));
                $map[$table] = $stage; $counts[$table] = 0;
            } elseif ($type === 'row' && isset($map[$table]) && !isset($finished[$table])) {
                $columns = []; $values = [];
                foreach ($record['row'] as $column => $value) {
                    $columns[] = self::identifier($column);
                    if ($value === null) $values[] = 'NULL'; else {
                        $plain = base64_decode($value, true); if ($plain === false) throw new \RuntimeException('备份字段编码无效。');
                        $values[] = "X'" . bin2hex($plain) . "'";
                    }
                }
                $this->query('INSERT INTO ' . self::identifier($map[$table]) . ' (' . implode(',', $columns) . ') VALUES (' . implode(',', $values) . ')'); $counts[$table]++;
            } elseif ($type === 'end' && isset($map[$table]) && !isset($finished[$table])) {
                $count = (int) $this->db->get_var('SELECT COUNT(*) FROM ' . self::identifier($map[$table]));
                if ($this->db->last_error || $count !== $record['count'] || $count !== $counts[$table]) throw new \RuntimeException('暂存表行数不一致。'); $finished[$table] = true;
            } else throw new \RuntimeException('备份记录次序无效。');
        }
        if (!$expected || array_keys($map) !== $expected || count($finished) !== count($expected)) throw new \RuntimeException('备份数据库不完整。');
        return $map;
    }
    public function swap(array $map, string $operation): array {
        $rename = []; $old = [];
        foreach ($this->tables() as $table) {
            $quarantine = 'cwr_old_' . $operation . '_' . count($old);
            $rename[] = self::identifier($table) . ' TO ' . self::identifier($quarantine); $old[$table] = $quarantine;
        }
        foreach ($map as $table => $stage) $rename[] = self::identifier($stage) . ' TO ' . self::identifier($table);
        $this->query('RENAME TABLE ' . implode(', ', $rename)); return $old;
    }
}

final class Service {
    private string $vault; private Database $database;
    private const ROOTS = ['uploads', 'themes', 'plugins', 'mu-plugins'];
    public function __construct(private $db, private string $root, private string $content, string $vault, private string $key, private array $identity) {
        if (!function_exists('sodium_crypto_secretstream_xchacha20poly1305_init_push')) throw new \RuntimeException('服务器必须启用 PHP sodium。');
        if (strlen($key) !== 32) throw new \RuntimeException('备份密钥无效。');
        $this->root = Files::directory($root); $this->content = Files::directory($content);
        $this->vault = Files::directory($vault);
        foreach ([$this->root, $this->content, $_SERVER['DOCUMENT_ROOT'] ?? $this->root] as $public) {
            $public = realpath($public); if ($public && Files::inside($this->vault, $public)) throw new \RuntimeException('备份目录必须位于网站公开目录之外。');
        }
        if (stat($this->vault)['dev'] !== stat($this->content)['dev']) throw new \RuntimeException('备份目录和 wp-content 必须位于同一文件系统。');
        if (file_exists($this->content . '/object-cache.php') || file_exists($this->content . '/db.php') || file_exists($this->content . '/advanced-cache.php')) throw new \RuntimeException('请先为缓存或数据库 drop-in 配置专用恢复适配器。');
        $this->database = new Database($db);
    }
    public function installGate(string $source): void {
        $dir = Files::directory($this->content . '/mu-plugins'); chmod($dir, 0755); $destination = $dir . '/clonewp-test-reset-gate.php';
        if (is_file($destination) && hash_file('sha256', $destination) !== hash_file('sha256', $source)) throw new \RuntimeException('现有恢复网关不匹配，未覆盖。');
        if (!is_file($destination)) Files::atomic($destination, file_get_contents($source));
    }
    private function writeRecord(string $path, array $data): void {
        $json = json_encode($data, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        Files::atomic($path, json_encode(['data' => $data, 'mac' => hash_hmac('sha256', $json, $this->key)], JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
    }
    private function readRecord(string $path): array {
        $record = json_decode(file_get_contents($path), true, 512, JSON_THROW_ON_ERROR);
        $json = json_encode($record['data'], JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        if (!hash_equals(hash_hmac('sha256', $json, $this->key), $record['mac'] ?? '')) throw new \RuntimeException('备份记录签名不匹配。'); return $record['data'];
    }
    public function status(): array {
        $state = is_file($this->vault . '/state.json') ? $this->readRecord($this->vault . '/state.json') : ['baseline' => null, 'epoch' => 'uninitialized'];
        return $state + ['pending' => is_file($this->vault . '/pending.json') || is_file($this->content . '/.clonewp-reset-busy')];
    }
    private function snapshot(string $id): array {
        $directory = $this->vault . '/snapshots/' . $id; Files::directory($directory);
        $manifest = ['id' => $id, 'identity' => $this->identity, 'createdAt' => gmdate('c'), 'roots' => []];
        foreach (self::ROOTS as $name) {
            $source = $this->content . '/' . $name;
            $manifest['roots'][$name] = is_dir($source) ? Files::copyTree($source, $directory . '/' . $name) : null;
        }
        Stream::write($directory . '/database.cwr', $this->key, $this->database->records());
        $manifest['databaseHash'] = hash_file('sha256', $directory . '/database.cwr');
        $this->writeRecord($directory . '/manifest.json', $manifest); return $manifest;
    }
    private function validate(string $id): array {
        if (!preg_match('/^[a-z0-9-]{1,80}$/D', $id)) throw new \RuntimeException('备份 ID 无效。');
        $directory = $this->vault . '/snapshots/' . $id; Files::directory($directory);
        $manifest = $this->readRecord($directory . '/manifest.json');
        if ($manifest['id'] !== $id || $manifest['identity'] !== $this->identity || $manifest['databaseHash'] !== hash_file('sha256', $directory . '/database.cwr')) throw new \RuntimeException('备份身份或数据库哈希不匹配。');
        foreach (self::ROOTS as $name) if ($manifest['roots'][$name] !== null && Files::inventory($directory . '/' . $name) !== $manifest['roots'][$name]) throw new \RuntimeException('备份文件哈希不匹配。');
        // Authenticate the complete stream before creating staging tables or moving files.
        foreach (Stream::read($directory . '/database.cwr', $this->key) as $_) {}
        return $manifest;
    }
    private function apply(string $id, string $operation): void {
        $manifest = $this->validate($id); $directory = $this->vault . '/snapshots/' . $id;
        // Keep the recovery code and request gate continuously present, even if
        // PHP stops between two directory renames. An upgrade needs a new baseline.
        foreach (['plugins/clonewp-test-reset', 'mu-plugins/clonewp-test-reset-gate.php'] as $protected) {
            $live = $this->content . '/' . $protected; $saved = $directory . '/' . $protected;
            if (is_dir($saved)) {
                if (!is_dir($live) || Files::inventory($live) !== Files::inventory($saved)) throw new \RuntimeException('恢复插件已变化，不能使用旧基准。');
            } elseif (is_file($saved) && (!is_file($live) || is_link($live) || hash_file('sha256', $live) !== hash_file('sha256', $saved))) {
                throw new \RuntimeException('恢复网关已变化，不能使用旧基准。');
            }
        }
        $stage = Files::directory($this->vault . '/operations/' . $operation);
        foreach (self::ROOTS as $name) if ($manifest['roots'][$name] !== null) Files::copyTree($directory . '/' . $name, $stage . '/new-' . $name);
        $map = $this->database->stage(Stream::read($directory . '/database.cwr', $this->key), $operation);
        // Keep every displaced directory and table. Nothing is permanently deleted by recovery.
        foreach (self::ROOTS as $name) {
            $current = $this->content . '/' . $name;
            if (is_link($current)) throw new \RuntimeException('拒绝替换链接目录。');
            if ($name === 'plugins' || $name === 'mu-plugins') {
                Files::directory($current); Files::directory($stage . '/old-' . $name);
                $protected = $name === 'plugins' ? 'clonewp-test-reset' : 'clonewp-test-reset-gate.php';
                foreach (scandir($current) as $child) if (!in_array($child, ['.', '..', $protected], true)) {
                    if (!rename($current . '/' . $child, $stage . '/old-' . $name . '/' . $child)) throw new \RuntimeException('无法隔离插件文件。');
                }
                if ($manifest['roots'][$name] !== null) foreach (scandir($stage . '/new-' . $name) as $child) if (!in_array($child, ['.', '..', $protected], true)) {
                    if (!rename($stage . '/new-' . $name . '/' . $child, $current . '/' . $child)) throw new \RuntimeException('无法恢复插件文件。');
                }
                continue;
            }
            if (is_dir($current) && !rename($current, $stage . '/old-' . $name)) throw new \RuntimeException('无法隔离当前文件目录。');
            if ($manifest['roots'][$name] !== null && !rename($stage . '/new-' . $name, $current)) throw new \RuntimeException('无法切换基准文件目录。');
        }
        $old = $this->database->swap($map, $operation); $this->writeRecord($stage . '/database-quarantine.json', $old);
        foreach (self::ROOTS as $name) {
            $actual = is_dir($this->content . '/' . $name) ? Files::inventory($this->content . '/' . $name) : null;
            if ($actual !== $manifest['roots'][$name]) throw new \RuntimeException('恢复文件实际读回失败。');
        }
    }
    public function run(string $action, string $expectedBaseline, string $expectedEpoch, bool $confirmOverwrite = false): void {
        if (!in_array($action, ['capture', 'restore', 'recover'], true)) throw new \RuntimeException('操作无效。');
        $mutex = fopen($this->vault . '/operation.lock', 'c+'); if (!$mutex || !flock($mutex, LOCK_EX | LOCK_NB)) throw new \RuntimeException('已有恢复操作正在进行。');
        $requestLock = $GLOBALS['clonewp_reset_request_lock'] ?? null; $locked = false; $mutating = false;
        try {
            $status = $this->status();
            if (($status['baseline'] ?? '') !== $expectedBaseline || $status['epoch'] !== $expectedEpoch) throw new \RuntimeException('页面状态已经变化，请刷新后重试。');
            if (($action === 'recover') !== $status['pending']) throw new \RuntimeException('存在未决操作，必须先对账或恢复。');
            if ($action === 'capture' && $status['baseline'] && !$confirmOverwrite) throw new \RuntimeException('覆盖初始基准前必须明确确认。');
            if ($action === 'restore' && !$status['baseline']) throw new \RuntimeException('尚无初始基准。');
            if (!is_resource($requestLock)) throw new \RuntimeException('请激活插件后刷新页面，确认 MU 请求网关已加载。');
            if (disk_free_space($this->vault) < 512 * 1024 * 1024) throw new \RuntimeException('可用磁盘空间不足 512 MiB。');
            Files::atomic($this->content . '/.clonewp-reset-busy', 'maintenance');
            flock($requestLock, LOCK_UN); $deadline = microtime(true) + 15;
            do { $locked = flock($requestLock, LOCK_EX | LOCK_NB); if (!$locked) usleep(50000); } while (!$locked && microtime(true) < $deadline);
            if (!$locked) throw new \RuntimeException('仍有请求正在写入，请稍后重试。');
            if ($action === 'recover' && !is_file($this->vault . '/pending.json')) {
                // No live replacement can start before pending.json is committed.
                // This is a capture/preparation crash or an already committed restore.
                if (!unlink($this->content . '/.clonewp-reset-busy')) throw new \RuntimeException('维护标记无法移除。');
                return;
            }
            @set_time_limit(300); $id = gmdate('YmdHis') . '-' . bin2hex(random_bytes(6));
            if ($action === 'capture') {
                $this->snapshot('baseline-' . $id); $this->validate('baseline-' . $id);
                $this->writeRecord($this->vault . '/state.json', ['baseline' => 'baseline-' . $id, 'epoch' => bin2hex(random_bytes(16)), 'previousBaseline' => $status['baseline'], 'lastOperation' => 'capture', 'lastCompletedAt' => gmdate('c')]);
            } else {
                $pending = $action === 'recover' ? $this->readRecord($this->vault . '/pending.json') : ['operation' => $id, 'before' => 'before-' . $id];
                if ($action === 'restore') {
                    $this->validate($status['baseline']); $this->snapshot($pending['before']); $this->validate($pending['before']);
                    $this->writeRecord($this->vault . '/pending.json', $pending);
                }
                $mutating = true;
                $this->apply($action === 'restore' ? $status['baseline'] : $pending['before'], str_replace('-', '', $id));
                if (function_exists('wp_cache_flush')) wp_cache_flush();
                $epoch = bin2hex(random_bytes(16));
                $this->writeRecord($this->vault . '/state.json', ['baseline' => $status['baseline'], 'epoch' => $epoch, 'lastOperation' => $action, 'lastCompletedAt' => gmdate('c'), 'before' => $pending['before']]);
                if (!unlink($this->vault . '/pending.json')) throw new \RuntimeException('恢复已执行，但未决记录无法关闭。');
                $mutating = false;
            }
            if (!unlink($this->content . '/.clonewp-reset-busy')) throw new \RuntimeException('维护标记无法移除。');
        } catch (\Throwable $e) {
            if (!$mutating && !is_file($this->vault . '/pending.json') && is_file($this->content . '/.clonewp-reset-busy')) unlink($this->content . '/.clonewp-reset-busy');
            throw $e;
        } finally {
            if ($locked) flock($requestLock, LOCK_UN);
            flock($mutex, LOCK_UN); fclose($mutex);
        }
    }
}
