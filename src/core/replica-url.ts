/** Replica routes are derived from the source URL, never from a brand or title. */
export function replicaTargetURL(sourceUrl: string, targetOrigin: string): string {
  const source = new URL(sourceUrl), target = new URL(targetOrigin);
  if (![source,target].every(url => ['http:','https:'].includes(url.protocol) && !url.username && !url.password)) throw Error('replica_url_invalid');
  if (target.pathname !== '/' || target.search || target.hash) throw Error('replica_url_target_origin_required');
  return target.origin + source.pathname + source.search + source.hash;
}

/** Same-site navigation retains the full path, query and fragment; assets are separate. */
export function replicaNavigationURL(href: string, sourceUrl: string, targetOrigin: string): string {
  if (!href || href.startsWith('#') || /^(?:mailto:|tel:|javascript:|data:)/i.test(href)) return href;
  const source = new URL(sourceUrl), resolved = new URL(href, source);
  return resolved.origin === source.origin ? replicaTargetURL(resolved.href, targetOrigin) : href;
}

/** The current page creator is flat: reject unsupported routes instead of flattening them. */
export function assertReplicaSourceSlug(input: {sourceUrl: string; slug: string; pageScope?: string; sourcePartition?: {selection?: {targetSlug?: string}}}): void {
  const source = new URL(input.sourceUrl);
  if (!['http:','https:'].includes(source.protocol) || source.username || source.password) throw Error('replica_url_invalid');
  const explicit = input.sourcePartition?.selection?.targetSlug;
  if (explicit !== undefined) {
    if (input.pageScope !== 'body-only' || !/^[a-z0-9][a-z0-9-]{0,119}$/.test(explicit) || input.slug !== explicit) throw Error('replica_url_selected_path_mismatch');
    return;
  }
  const route = source.pathname.replace(/^\//,'').replace(/\/$/,'');
  if (!route) throw Error('replica_url_homepage_requires_explicit_ownership');
  if (route.includes('/')) throw Error('replica_url_parent_route_required');
  if (input.slug !== route) throw Error('replica_url_source_path_mismatch');
}

/** A trusted WordPress allocation may normalize hyphens and append a numeric suffix. */
export function isNativeReplicaSlug(requested: string, actual: string): boolean {
  const base = requested.replace(/-+/g,'-').replace(/^-|-$/g,'');
  if (actual === base) return true;
  if (!actual.startsWith(base + '-')) return false;
  const suffix = actual.slice(base.length + 1);
  return /^[1-9]\d*$/.test(suffix) && BigInt(suffix) >= 2n;
}

export function replicaURLNotice(sourceUrl: string, actualUrl: string, explicitSlug?: string) {
  const requestedPath = explicitSlug ? '/' + explicitSlug + '/' : new URL(sourceUrl).pathname, actualPath = new URL(actualUrl).pathname;
  return requestedPath.replace(/\/$/,'') === actualPath.replace(/\/$/,'') ? null : {requestedPath, actualPath, actualUrl, reason:'wordpress-native-slug' as const};
}
