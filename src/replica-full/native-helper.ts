import { readFile } from 'node:fs/promises';

const pageClosure = '$pageObservation=static function($pid)use($digest){';
const ownPageExclusions = "foreach(['_edit_lock','_edit_last','_elementor_element_cache','_elementor_css','_elementor_page_assets','wd_page_css_files','wd_page_css_files_mobile'] as $key)unset($meta[$key]);";
const normalizedClosure = '$pageObservation=static function($pid)use($digest,$ownerToken,$owner){';
const derivedExclusions = "if(get_post_meta($pid,'_clonewp_header_module_owner',true)===$ownerToken&&get_post_meta($pid,'_clonewp_run_id',true)===($owner['runId']??null))foreach(['_elementor_controls_usage'] as $key)unset($meta[$key]);";

/** Full replicas additionally ignore the owned page's derived controls cache.
 * All other native header guards remain unchanged. */
export function normalizeFullReplicaHeaderHelper(source: string,nativeProduct=false): string {
  if (source.split(pageClosure).length !== 2 || source.split(ownPageExclusions).length !== 2) throw Error('replica_full_native_helper_contract_changed');
  const start = source.indexOf(pageClosure), end = source.indexOf('$snapshot=static function()', start), exclusions = source.indexOf(ownPageExclusions);
  if (end < 0 || exclusions < start || exclusions > end) throw Error('replica_full_native_helper_scope_changed');
  const normalized=source.replace(pageClosure, normalizedClosure).replace(ownPageExclusions, `${ownPageExclusions}\n    ${derivedExclusions}`);return nativeProduct?normalized.replaceAll("$p['postType']!=='page'", "($p['postType']!=='page'&& !($p['postType']==='woodmart_layout'&&get_post_meta($pageId,'wd_layout_type',true)==='single_product'&&get_post_meta($pageId,'_clonewp_header_module_owner',true)===$ownerToken))"):normalized;
}

export async function loadFullReplicaHeaderHelper(nativeProduct=false): Promise<string> {
  return normalizeFullReplicaHeaderHelper(await readFile(new URL('../woodmart-header/generic/wordpress.php', import.meta.url), 'utf8'),nativeProduct);
}
