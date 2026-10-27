import { createHash, randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { WordPressClient, WordPressError } from './client.js';

export interface InstallationReceipt {
  targetUrl: string;
  plugin: 'novamira/novamira';
  version: string;
  releaseUrl: string;
  sha256: string;
  installed: boolean;
  active: boolean;
  aiAbilitiesEnabled: boolean;
  temporarySnippetDeleted: boolean;
  temporaryRouteRemoved: boolean;
}

/** Read the ZIP central directory without executing or extracting any package content. */
export function zipEntries(bytes: Buffer): string[] {
  if (bytes.length < 22) throw new WordPressError('invalid_release_zip', 'Official download is not a ZIP archive.');
  const result: string[] = [];
  let offset = bytes.length - 22;
  const minimum = Math.max(0, bytes.length - 65557);
  while (offset >= minimum && bytes.readUInt32LE(offset) !== 0x06054b50) offset--;
  if (offset < minimum) throw new WordPressError('invalid_release_zip', 'Official download is not a ZIP archive.');
  let directory = bytes.readUInt32LE(offset + 16);
  const count = bytes.readUInt16LE(offset + 10);
  for (let i = 0; i < count; i++) {
    if (directory + 46 > bytes.length || bytes.readUInt32LE(directory) !== 0x02014b50) throw new WordPressError('invalid_release_zip', 'ZIP directory is invalid.');
    const nameLength = bytes.readUInt16LE(directory + 28);
    const extraLength = bytes.readUInt16LE(directory + 30);
    const commentLength = bytes.readUInt16LE(directory + 32);
    const name = bytes.subarray(directory + 46, directory + 46 + nameLength).toString('utf8');
    if (name.startsWith('/') || name.split('/').includes('..') || name.includes('\\')) throw new WordPressError('unsafe_release_zip', 'Release ZIP contains an unsafe path.');
    result.push(name);
    directory += 46 + nameLength + extraLength + commentLength;
  }
  return result;
}

/** Explicit installation command only. Daily cloning never invokes this bootstrap. */
export async function installOfficialNovamira(client: WordPressClient, receiptDirectory: string): Promise<InstallationReceipt> {
  if (client.origin !== 'https://primevapeoutlet.com') throw new WordPressError('installation_target_mismatch', 'This authorized bootstrap is restricted to the configured test site.');
  const before = await client.preflight();
  if (before.novamiraInstalled) throw new WordPressError('plugin_already_installed', 'The bootstrap will not overwrite an existing Novamira installation.');
  if (!before.namespaces.includes('code-snippets/v1')) throw new WordPressError('installer_channel_missing', 'The approved temporary bootstrap channel is unavailable.');
  const releaseResponse = await fetch('https://api.github.com/repos/use-novamira/novamira/releases/latest', { headers: { Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(30_000) });
  if (!releaseResponse.ok) throw new WordPressError('official_release_unavailable', 'Could not read the official Novamira release.');
  const release = await releaseResponse.json() as { tag_name: string; assets: Array<{ name: string; browser_download_url: string; digest: string; size: number }> };
  const version = release.tag_name.replace(/^v/, '');
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new WordPressError('invalid_release_version', 'Official release version is invalid.');
  const asset = release.assets.find(x => x.name === `novamira-${version}.zip`);
  if (!asset || !/^sha256:[a-f0-9]{64}$/.test(asset.digest) || asset.size > 10 * 1024 * 1024 || !asset.browser_download_url.startsWith(`https://github.com/use-novamira/novamira/releases/download/v${version}/`)) throw new WordPressError('invalid_release_asset', 'Official release archive and published SHA-256 are required.');
  const archiveResponse = await fetch(asset.browser_download_url, { signal: AbortSignal.timeout(60_000) });
  if (!archiveResponse.ok) throw new WordPressError('official_download_failed', 'Could not download the official Novamira release archive.');
  const archive = Buffer.from(await archiveResponse.arrayBuffer());
  const digest = createHash('sha256').update(archive).digest('hex');
  if (`sha256:${digest}` !== asset.digest || archive.length !== asset.size) throw new WordPressError('release_hash_mismatch', 'Official release archive does not match its published digest.');
  const entries = zipEntries(archive);
  for (const required of ['novamira/novamira.php', 'novamira/vendor/autoload_packages.php', 'novamira/vendor/novamira/mcp-adapter/autoload.php']) {
    if (!entries.includes(required)) throw new WordPressError('release_dependency_missing', 'Official plugin archive is missing required bundled dependencies.');
  }
  await mkdir(receiptDirectory, { recursive: true });
  await writeFile(join(receiptDirectory, asset.name), archive);
  const installId = randomBytes(12).toString('hex');
  const token = randomBytes(32).toString('hex');
  const namespace = `clonewp-bootstrap-${installId}/v1`;
  const encode = (x: string) => `'${x.replace(/'/g, "\\'")}'`;
  const code = `
add_action('rest_api_init', function() {
 register_rest_route(${encode(namespace)}, '/install', [
 'methods'=>'POST',
 'permission_callback'=>function($r){return current_user_can('install_plugins') && current_user_can('activate_plugins') && hash_equals(${encode(token)},(string)$r->get_param('token'));},
 'callback'=>function($r){
  if ((string)wp_parse_url(get_option('home'),PHP_URL_HOST)!=='primevapeoutlet.com') {return new WP_Error('target_mismatch','Target mismatch',['status'=>403]);}
  require_once ABSPATH.'wp-admin/includes/plugin.php';require_once ABSPATH.'wp-admin/includes/file.php';require_once ABSPATH.'wp-admin/includes/class-wp-upgrader.php';
  if(file_exists(WP_PLUGIN_DIR.'/novamira/novamira.php')){return new WP_Error('already_exists','Novamira already exists',['status'=>409]);}
  $tmp=download_url(${encode(asset.browser_download_url)},60);if(is_wp_error($tmp)){return new WP_Error('download_failed','Official download failed',['status'=>502]);}
  try {
   if(hash_file('sha256',$tmp)!==${encode(digest)}){return new WP_Error('hash_mismatch','SHA256 mismatch',['status'=>400]);}
   ob_start();try{$skin=new Automatic_Upgrader_Skin();$upgrader=new Plugin_Upgrader($skin);$result=$upgrader->install($tmp);}finally{ob_end_clean();}
   if(is_wp_error($result)||!$result){return new WP_Error('install_failed','Official plugin installation failed',['status'=>500]);}
   $plugin='novamira/novamira.php';$activated=activate_plugin($plugin);if(is_wp_error($activated)){return new WP_Error('activation_failed','Plugin activation failed',['status'=>500]);}
   update_option('novamira_ai_abilities_domain','primevapeoutlet.com',false);update_option('novamira_ai_abilities_enabled','1',false);
   $data=get_plugin_data(WP_PLUGIN_DIR.'/'.$plugin,false,false);
   return ['installed'=>true,'active'=>is_plugin_active($plugin),'version'=>$data['Version'],'aiAbilitiesEnabled'=>true];
  } finally {if(is_file($tmp)){unlink($tmp);}}
 }]);
});`;
  let snippetId: number | undefined;
  let result: { installed: boolean; active: boolean; version: string; aiAbilitiesEnabled: boolean } | undefined;
  let deleted = false; let routeRemoved = false;
  try {
    const snippet = await client.rest<{ id: number; code_error?: unknown }>('/wp-json/code-snippets/v1/snippets', 'POST', { name: `cloneWP temporary official Novamira installer ${installId}`, desc: 'Owned one-use bootstrap; remove immediately after installation.', code, scope: 'global', active: false, tags: ['clonewp-bootstrap', installId] });
    if (!Number.isInteger(snippet.id)) throw new WordPressError('bootstrap_create_failed', 'Code Snippets did not return a new installer ID.');
    snippetId = snippet.id;
    await client.rest(`/wp-json/code-snippets/v1/snippets/${snippetId}/activate`, 'POST');
    result = await client.rest(`/wp-json/${namespace}/install`, 'POST', { token });
    if (!result?.installed || !result.active || result.version !== version) throw new WordPressError('installation_receipt_mismatch', 'The installed plugin did not match the verified release.');
  } finally {
    if (snippetId !== undefined) {
      await client.rest(`/wp-json/code-snippets/v1/snippets/${snippetId}/deactivate`, 'POST').catch(() => undefined);
      await client.rest(`/wp-json/code-snippets/v1/snippets/${snippetId}`, 'DELETE');
      try { await client.rest(`/wp-json/code-snippets/v1/snippets/${snippetId}`); }
      catch (error) { deleted = error instanceof WordPressError && error.status === 404; }
      if (!deleted) {
        // Some Code Snippets builds acknowledge DELETE with 204 yet retain an inactive row.
        // After Novamira is available, use that plugin's verified deletion API with ownership guards.
        deleted = await client.cleanupOwnedInstallerSnippet(snippetId);
        const remaining = await client.rest<Array<{ id: number }>>('/wp-json/code-snippets/v1/snippets');
        deleted = deleted && !remaining.some(item => item.id === snippetId);
      }
      const index = await client.rest<{ routes: Record<string, unknown> }>('/wp-json/');
      routeRemoved = !Object.keys(index.routes).some(path => path.startsWith(`/${namespace}/`));
      if (!deleted || !routeRemoved) throw new WordPressError('bootstrap_cleanup_failed', 'The temporary installer was not completely removed.');
    }
  }
  const receipt: InstallationReceipt = { targetUrl: client.targetUrl, plugin: 'novamira/novamira', version, releaseUrl: asset.browser_download_url, sha256: digest, installed: result!.installed, active: result!.active, aiAbilitiesEnabled: result!.aiAbilitiesEnabled, temporarySnippetDeleted: deleted, temporaryRouteRemoved: routeRemoved };
  await writeFile(join(receiptDirectory, 'novamira-installation-receipt.json'), JSON.stringify(receipt, null, 2));
  return receipt;
}
