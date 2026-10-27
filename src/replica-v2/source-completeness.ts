import type { ValidatedObservationV2 } from './observation.js';

export function assessSourceCompleteness(observation: ValidatedObservationV2) {
  const snapshots = (observation.sceneInventories ?? []).map(({ inventory }) => {
    const packets = observation.packets.filter(packet => packet.snapshot.id === inventory.snapshotId);
    const content = inventory.content;
    const gaps = [...(content?.gaps ?? [])];
    const normalize = (value: string) => value.replace(/:nth-of-type\(1\)/g, '').replace(/\s+/g, ' ').trim();
    const nodes = new Map<string, Array<{ texts: Set<string>; hrefs: Set<string>; media: Set<string>; control: boolean; style: Record<string, string> }>>();
    for (const packet of packets) {
      const texts = new Map<string, Set<string>>(), hrefs = new Map<string, Set<string>>();
      const media = new Map<string, Set<string>>(), controls = new Set(Object.values(packet.interactions).map(item => item.nodeId));
      for (const usage of Object.values(packet.usages)) { const values = media.get(usage.nodeId) ?? new Set<string>(); values.add(packet.resources[usage.resourceId].url); if (usage.kind === 'svg') values.add('inline-svg'); media.set(usage.nodeId, values); }
      for (const text of Object.values(packet.texts)) { const values = texts.get(text.nodeId) ?? new Set(); values.add(normalize(text.text)); texts.set(text.nodeId, values); }
      for (const item of Object.values(packet.interactions).filter(item => item.kind === 'link' && item.href)) { const values = hrefs.get(item.nodeId) ?? new Set(); values.add(item.href!); hrefs.set(item.nodeId, values); }
      for (const node of Object.values(packet.nodes)) {
        const key = `${node.regionId}\u0000${normalize(node.selector)}`, values = nodes.get(key) ?? [];
        const mediaSources = new Set(media.get(node.id));
        if (['video', 'audio'].includes(node.tag) && node.attributes.src) mediaSources.add(node.attributes.src);
        values.push({ texts: texts.get(node.id) ?? new Set(), hrefs: hrefs.get(node.id) ?? new Set(), media: mediaSources, control: controls.has(node.id), style: packet.styles[node.styleId] ?? {} }); nodes.set(key, values);
      }
    }
    const items = (content?.entries ?? []).map(entry => {
      const matches = nodes.get(`${entry.ownerRegionId}\u0000${normalize(entry.selector)}`) ?? [];
      const captured = matches.some(node => {
        if (entry.kind === 'text') return node.texts.has(normalize(entry.text ?? ''));
        if (entry.kind === 'link') return node.hrefs.has(entry.href ?? '');
        if (entry.kind === 'media') {
          const urls = [...(entry.resource ?? '').matchAll(/url\(["']?([^"')]+)["']?\)/g)].map(match => new URL(match[1], inventory.sourceUrl).href);
          return urls.length ? urls.every(url => node.media.has(url)) : node.media.has(entry.resource ?? '');
        }
        if (entry.kind === 'control') return node.control;
        return Object.entries(entry.paint ?? {}).every(([key, value]) => node.style[key] === value);
      });
      return { ...entry, status: captured ? 'captured' as const : 'missing' as const };
    });
    for (const packet of packets) for (const interaction of Object.values(packet.interactions)) {
      if ((interaction.kind === 'carousel' || interaction.kind === 'control' && ['tab', 'disclosure', 'counter'].includes(String(interaction.details?.type))) && interaction.status !== 'observed') gaps.push({ selector: packet.nodes[interaction.nodeId].selector, code: 'source-state-needs-observation', message: 'Loaded content is retained; default, changed and restored states still need observation.' });
    }
    for (const packet of packets) for (const gap of packet.gaps) gaps.push({ selector: gap.nodeId ? packet.nodes[gap.nodeId]?.selector ?? '' : '', code: gap.code, message: gap.message });
    return { snapshotId: inventory.snapshotId, status: !content ? 'unassessed' : items.some(item => item.status === 'missing') || gaps.length ? 'open-items' : 'captured', items, gaps };
  });
  const unassessedSnapshotIds = [...new Set(observation.packets.map(packet => packet.snapshot.id))].filter(id => !snapshots.some(snapshot => snapshot.snapshotId === id));
  return { version: 1, kind: 'source-completeness', sourceUrl: observation.manifest.sourceUrl, scope: 'loaded-document-and-declared-states', status: !snapshots.length || unassessedSnapshotIds.length || snapshots.some(snapshot => snapshot.status === 'unassessed') ? 'unassessed' : snapshots.some(snapshot => snapshot.status === 'open-items') ? 'open-items' : 'captured', snapshots, unassessedSnapshotIds };
}
