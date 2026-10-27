// Task authoring helper only. Explicitly replayed source ownership, never a text/selector matcher.
import { createHash } from 'node:crypto';

const canonical = value => JSON.stringify(value && typeof value === 'object' ? Array.isArray(value) ? value.map(item => JSON.parse(canonical(item))) : Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, JSON.parse(canonical(item))])) : value);
const sha = value => createHash('sha256').update(value).digest('hex');
const fail = message => { throw Error(`Explicit source node variant is unproven: ${message}`); };
const cleanAttributes = attributes => Object.fromEntries(Object.entries(attributes ?? {}).map(([key, value]) => [key, key === 'class' ? String(value).split(/\s+/).filter(Boolean).sort().join(' ') : value]));
const identity = node => ({ tag: node.tag, attributes: cleanAttributes(node.attributes) });
const pathValue = (value, label) => { if (!Array.isArray(value) || value.some(index => !Number.isInteger(index) || index < 0)) fail(`${label} must contain explicit finite child slots`); return value; };
function resolve(packet, root, path, regionId) {
  let node = root;
  if (!node || node.regionId !== regionId) fail('region root is missing');
  for (const index of path) { const next = packet.nodes[node.childIds?.[index]]; if (!next || next.parentId !== node.id || next.regionId !== regionId) fail('declared child-slot path leaves its actual owner'); node = next; }
  return node;
}
function descendants(packet, node, seen = new Set()) { if (seen.has(node.id)) fail('node tree repeats a child or contains a cycle'); seen.add(node.id); return [node, ...(node.childIds ?? []).flatMap(id => { const child = packet.nodes[id]; if (!child || child.parentId !== node.id || child.regionId !== node.regionId) fail('node tree has a dangling/cross-owner child'); return descendants(packet, child, seen); })]; }
function chain(packet, node, owner) { const result = [], seen = new Set(); while (node && node.id !== owner.id) { if (seen.has(node.id)) fail('cyclic source ancestry'); seen.add(node.id); result.unshift(node); node = packet.nodes[node.parentId]; } if (!node) fail('leaf left its declared owner'); return result; }
function closest(packet, node, predicate) { const seen = new Set(); while (node) { if (seen.has(node.id)) fail('cyclic source ancestry'); seen.add(node.id); if (predicate(node)) return node; node = packet.nodes[node.parentId]; } return null; }
const closestHref = (packet, node) => closest(packet, node, node => node.tag === 'a' && typeof node.attributes?.href === 'string')?.attributes.href ?? null;
const cloneOwner = (packet, node) => !!closest(packet, node, node => /(?:^|\s)(?:slick-cloned|swiper-slide-duplicate)(?:\s|$)/.test(node.attributes?.class ?? ''));
function media(packet, node) {
  return Object.values(packet.usages ?? {}).filter(usage => usage.nodeId === node.id).map(usage => {
    const resource = packet.resources?.[usage.resourceId]; if (!resource) fail('media usage has no actual resource');
    return { kind: usage.kind, attribute: usage.attribute ?? null, ...(typeof resource.inline === 'string' ? { inlineSha256: sha(resource.inline) } : { url: resource.url }) };
  }).sort((a, b) => canonical(a).localeCompare(canonical(b)));
}
function sourceTexts(packet, node) { return Object.values(packet.texts ?? {}).filter(text => text.nodeId === node.id).map(text => text.text); }
function hydrationDifferences(desktop, variant, desktopOwner, variantOwner, value) {
  const differences = [], normalizations = { desktop: new Map(), variant: new Map() };
  if (!value) return { differences, normalizations };
  if (value.kind !== 'search-external' || typeof value.rule !== 'string' || !value.rule.trim()) fail('hydration needs its explicit search external-entry adaptation');
  const before = resolve(desktop, desktopOwner, pathValue(value.desktopFormPath, 'desktop form path'), desktopOwner.regionId), after = resolve(variant, variantOwner, pathValue(value.variantFormPath, 'variant form path'), variantOwner.regionId);
  if (before.tag !== 'form' || after.tag !== 'form' || before.attributes.role !== 'search' || after.attributes.role !== 'search' || (before.attributes.action ?? null) !== value.beforeAction || after.attributes.action !== value.afterAction || value.beforeAction !== null || value.targetExternalHref !== value.afterAction) fail('search action change is not the exact observed missing-to-external transition');
  let url, source; try { url = new URL(value.afterAction); source = new URL(variant.snapshot.url); } catch { fail('search hydration has no actual public source URL'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.origin !== source.origin || url.hash) fail('search hydration leaves the actual public source origin');
  const add = (a, b, attribute, previous, next) => { differences.push({ kind: 'search-hydration', attribute, desktopNodeId: a.id, variantNodeId: b.id, before: previous, after: next, targetExternalHref: value.targetExternalHref, rule: value.rule }); normalizations.desktop.set(a.id, { ...(normalizations.desktop.get(a.id) ?? {}), [attribute]: previous }); normalizations.variant.set(b.id, { ...(normalizations.variant.get(b.id) ?? {}), [attribute]: previous }); };
  add(before, after, 'action', value.beforeAction, value.afterAction);
  if (value.input) {
    const input = value.input, a = resolve(desktop, desktopOwner, pathValue(input.desktopPath, 'desktop input path'), desktopOwner.regionId), b = resolve(variant, variantOwner, pathValue(input.variantPath, 'variant input path'), variantOwner.regionId);
    if (a.tag !== 'input' || b.tag !== 'input' || a.attributes.type !== 'search' || b.attributes.type !== 'search' || !a.attributes.id || a.attributes.id !== b.attributes.id || closest(desktop, a, node => node.tag === 'form')?.id !== before.id || closest(variant, b, node => node.tag === 'form')?.id !== after.id || (a.attributes.placeholder ?? null) !== input.beforePlaceholder || b.attributes.placeholder !== input.afterPlaceholder || input.beforePlaceholder !== null || typeof input.afterPlaceholder !== 'string' || !input.afterPlaceholder.trim()) fail('search placeholder is not the exact observed same-input hydration');
    add(a, b, 'placeholder', input.beforePlaceholder, input.afterPlaceholder);
  }
  return { differences, normalizations };
}
function normalizedIdentity(node, changes) { const result = identity(node), update = changes.get(node.id); for (const [key, value] of Object.entries(update ?? {})) { if (value === null) delete result.attributes[key]; else result.attributes[key] = value; } return result; }

/** All IDs are resolved from the declared independent paths and checked against actual public source facts. */
export function proveExplicitSourceNodeVariantV2({ desktopPacket, variantPacket, desktopPacketSha256, variantPacketSha256, declaration }) {
  const d = declaration;
  if (!d || d.version !== 1 || d.desktopSnapshotId !== desktopPacket?.snapshot?.id || d.snapshotId !== variantPacket?.snapshot?.id || d.desktopSnapshotId === d.snapshotId) fail('snapshot identities do not match the two actual packets');
  for (const [actual, expected, label] of [[desktopPacketSha256, d.desktopEvidence, 'desktop'], [variantPacketSha256, d.variantEvidence, 'variant']]) if (!/^[a-f\d]{64}$/.test(actual ?? '') || actual !== expected?.sha256 || typeof expected.path !== 'string' || !expected.path) fail(`${label} is not bound to its independently verified packet bytes`);
  const desktopRoot = desktopPacket.nodes?.[desktopPacket.regions?.find(region => region.id === d.regionId)?.nodeId], variantRoot = variantPacket.nodes?.[variantPacket.regions?.find(region => region.id === d.regionId)?.nodeId];
  if (!desktopRoot || !variantRoot || canonical(identity(desktopRoot)) !== canonical(identity(variantRoot))) fail('region roots have different actual identity');
  const desktopOwnerPath = pathValue(d.desktopOwnerPath, 'desktop owner path'), variantOwnerPath = pathValue(d.variantOwnerPath, 'variant owner path'), desktopPath = pathValue(d.desktopPath, 'desktop leaf path'), variantPath = pathValue(d.variantPath, 'variant leaf path');
  const aOwner = resolve(desktopPacket, desktopRoot, desktopOwnerPath, d.regionId), bOwner = resolve(variantPacket, variantRoot, variantOwnerPath, d.regionId), ownerIdentity = { tag: d.ownerIdentity?.tag, attributes: cleanAttributes(d.ownerIdentity?.attributes) };
  if (!d.ownerIdentity || canonical(identity(aOwner)) !== canonical(ownerIdentity) || canonical(identity(bOwner)) !== canonical(ownerIdentity)) fail('owner tag, actual DOM id or complete actual attributes differ');
  for (const [packet, owner] of [[desktopPacket, aOwner], [variantPacket, bOwner]]) {
    const parent = packet.nodes[owner.parentId]; if (parent && parent.childIds.filter(id => canonical(identity(packet.nodes[id])) === canonical(ownerIdentity)).length !== 1) fail('declared owner is ambiguous within its actual structural parent');
  }
  const before = resolve(desktopPacket, aOwner, desktopPath, d.regionId), after = resolve(variantPacket, bOwner, variantPath, d.regionId);
  if (before.id !== d.desktopNodeId || after.id !== d.variantNodeId) fail('leaf identity does not equal the declared independent endpoint');
  const { differences, normalizations } = hydrationDifferences(desktopPacket, variantPacket, aOwner, bOwner, d.hydration), normalized = (node, side) => normalizedIdentity(node, normalizations[side]);
  if (!d.leafIdentity || canonical(normalized(before, 'desktop')) !== canonical({ tag: d.leafIdentity.tag, attributes: cleanAttributes(d.leafIdentity.attributes) }) || canonical(normalized(after, 'variant')) !== canonical(normalized(before, 'desktop'))) fail('leaf tag, actual DOM id or complete actual attributes differ');
  const aChain = chain(desktopPacket, before, aOwner), bChain = chain(variantPacket, after, bOwner);
  if (canonical(aChain.map(node => normalized(node, 'desktop'))) !== canonical(bChain.map(node => normalized(node, 'variant')))) fail('intervening ancestor identity differs outside the explicit search hydration');
  const subtree = (packet, node, side) => ({ identity: normalized(node, side), texts: sourceTexts(packet, node), media: media(packet, node), children: (node.childIds ?? []).map(id => subtree(packet, packet.nodes[id], side)) });
  const aSubtree = canonical(subtree(desktopPacket, before, 'desktop')), bSubtree = canonical(subtree(variantPacket, after, 'variant')); if (aSubtree !== bSubtree) fail('ordered descendant item boundaries, destinations, media or copy differ');
  // Repeated indistinguishable slots cannot be guessed from a different numerical node ID.
  for (const [packet, owner, target, side] of [[desktopPacket, aOwner, before, 'desktop'], [variantPacket, bOwner, after, 'variant']]) {
    const signature = canonical(chain(packet, target, owner).map(node => normalized(node, side))), targetSubtree = side === 'desktop' ? aSubtree : bSubtree, candidates = descendants(packet, owner).filter(node => canonical(chain(packet, node, owner).map(item => normalized(item, side))) === signature && canonical(subtree(packet, node, side)) === targetSubtree);
    if (candidates.length !== 1 || candidates[0].id !== target.id) fail('declared owned ancestor/leaf identity is ambiguous');
  }
  const href = closestHref(desktopPacket, before); if (href !== closestHref(variantPacket, after) || cloneOwner(desktopPacket, before) !== cloneOwner(variantPacket, after)) fail('actual source destination or clone ownership changed');
  const aMedia = media(desktopPacket, before), bMedia = media(variantPacket, after); if (canonical(aMedia) !== canonical(bMedia)) fail('actual owned media bytes or source URL changed');
  if (canonical(sourceTexts(desktopPacket, before)) !== canonical(sourceTexts(variantPacket, after))) fail('static copy changed after structural pairing; declare a separate responsive text variant');
  const proof = { desktopNodeId: before.id, variantNodeId: after.id, regionId: d.regionId, path: [...desktopOwnerPath, ...desktopPath], variantPath: [...variantOwnerPath, ...variantPath], desktopOwnerNodeId: aOwner.id, variantOwnerNodeId: bOwner.id, desktopOwnerPath, variantOwnerPath, desktopPath, leafPath: variantPath, ownerIdentitySha256: sha(canonical(ownerIdentity)), leafIdentitySha256: sha(canonical(normalized(before, 'desktop'))), leafSubtreeIdentitySha256: sha(aSubtree), inlineHashes: aMedia.filter(item => item.inlineSha256).map(item => item.inlineSha256), sourceDestinations: { href, ...(d.hydration ? { searchExternalHref: d.hydration.targetExternalHref } : {}) }, declaredDifferences: differences, desktopVisible: before.visible, visible: after.visible, evidence: ['same-source-region-root', 'relative-child-slot-path', 'all-ancestor-tags', 'explicit-source-owner-path-pair', 'actual-owner-identity', 'actual-source-href', 'owner-bound-inline-bytes', 'ordered-descendant-identity'], declaration: d };
  return { ...proof, proofSha256: sha(canonical(proof)) };
}

export function validateExplicitSourceNodeVariants({ declarations, ...options }) {
  if (!Array.isArray(declarations) || !declarations.length) fail('declarations must contain actual explicit pairs');
  const proofs = declarations.map(declaration => proveExplicitSourceNodeVariantV2({ ...options, declaration })), nodePairs = {};
  for (const proof of proofs) { if (nodePairs[proof.desktopNodeId] && nodePairs[proof.desktopNodeId] !== proof.variantNodeId) fail('one desktop node has conflicting later owners'); nodePairs[proof.desktopNodeId] = proof.variantNodeId; }
  return { version: 1, passed: true, nodePairs, proofs, proofSha256: sha(canonical(proofs)) };
}
