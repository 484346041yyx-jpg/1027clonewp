import path from 'node:path';
import { createHash } from 'node:crypto';
import { BodySourceEvidenceSchema, BodySourceUnitsSchema } from '../replica-full/body-prepare.js';
import { validateObservationPacketV2 } from '../replica-v2/observation.js';
import { readResponsiveSource } from './source.js';
import type { ResponsivePlan } from './contract.js';
import type { ResponsiveDecisionContext } from './decisions.js';

type Ref = { path: string; sha256: string };
export type ResponsiveVisibilityIdentity = { version?: number; taskId: string; sourceUrl?: string; sourceEvidence?: Ref; body?: { sourceUnits: Ref }; sourcePartition?: { bodyUnits: string[] } } & ResponsiveDecisionContext;
type Read = (reference: Ref, base?: string) => Promise<{ filename: string; bytes: Buffer }>;
const fail = (reason: string): never => { throw Error(`replica_responsive_source_visibility_${reason}`); };
export async function responsiveSourceVisibility(plan: ResponsivePlan, identity: ResponsiveVisibilityIdentity, read: Read): Promise<Map<string, boolean> | undefined> {
  if (identity.version !== 4) return undefined;
  if (!identity.sourceUrl || !identity.sourceEvidence || !identity.body?.sourceUnits || !identity.sourcePartition) return fail('context');
  const sourceUrl = identity.sourceUrl, sourcePartition = identity.sourcePartition;
  const bound: Read = async (reference, base) => { const file = await read(reference, base); if (createHash('sha256').update(file.bytes).digest('hex') !== reference.sha256) fail('hash'); return file; };
  const evidenceFile = await bound(identity.sourceEvidence), unitsFile = await bound(identity.body.sourceUnits);
  const evidence = BodySourceEvidenceSchema.parse(JSON.parse(evidenceFile.bytes.toString('utf8'))), units = BodySourceUnitsSchema.parse(JSON.parse(unitsFile.bytes.toString('utf8')));
  if ([evidence, units].some(value => value.taskId !== identity.taskId || value.sourceUrl !== sourceUrl)) fail('identity');
  const result = new Map<string, boolean>(), shared = plan.sections.filter(section => section.mode === 'shared');
  const desktops = evidence.snapshots.filter(snapshot => [[1920, 1080], [1440, 1000]].some(([width, height]) => snapshot.viewport.width === width && snapshot.viewport.height === height));
  if (desktops.length !== 2) fail('desktop_coverage');
  for (const snapshot of desktops) {
    const packets = await Promise.all(snapshot.packets.map(async reference => validateObservationPacketV2(JSON.parse((await bound(reference, path.dirname(evidenceFile.filename))).bytes.toString('utf8')))));
    if (packets.some(packet => packet.snapshot.id !== snapshot.id || packet.snapshot.url !== sourceUrl || packet.snapshot.viewport.width !== snapshot.viewport.width || packet.snapshot.viewport.height !== snapshot.viewport.height)) fail('desktop_snapshot');
    for (const section of shared) {
      const owners = units.units.filter(unit => unit.snapshotId === snapshot.id && sourcePartition.bodyUnits.includes(unit.id) && unit.componentKeys.includes(section.key));
      if (owners.length !== 1) fail(`desktop_owner:${section.key}`);
      const nodes = packets.flatMap(packet => packet.nodes[owners[0].ownerNodeId] ? [packet.nodes[owners[0].ownerNodeId]] : []);
      if (!nodes.length || nodes.some(node => node.visible !== nodes[0].visible)) fail(`desktop_node:${section.key}`);
      result.set(`${snapshot.viewport.width}x${snapshot.viewport.height}:${section.key}`, nodes[0].visible);
    }
  }
  const { sections: _sections, ...policy } = plan;
  const phones = await readResponsiveSource(policy, { ...identity, sourceUrl }, bound);
  for (const viewport of plan.viewports) for (const section of shared) {
    const owners = section.evidence.flatMap(owner => phones.packets.filter(packet => packet.snapshot.id === owner.snapshotId && packet.snapshot.viewport.width === viewport.width && packet.snapshot.viewport.height === viewport.height && packet.nodes[owner.nodeId]).map(packet => packet.nodes[owner.nodeId]));
    if (owners.length !== 1) fail(`phone_owner:${section.key}`);
    result.set(`${viewport.width}x${viewport.height}:${section.key}`, owners[0].visible);
  }
  const inherited = desktops.reduce((left, right) => left.viewport.width < right.viewport.width ? left : right);
  for (const section of shared) result.set(`tablet:${section.key}`, result.get(`${inherited.viewport.width}x${inherited.viewport.height}:${section.key}`)!);
  return result;
}
