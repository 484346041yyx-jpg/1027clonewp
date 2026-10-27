import { z } from 'zod';

export const WORKSPACE_LEASE_MS = 15 * 60_000;
export const workspaceId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/).refine(value => !value.includes('..'));
export const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const agent = z.enum(['codex', 'claude', 'workbuddy']);
const timestamp = z.iso.datetime();
export const safeText = z.string().trim().min(1).max(3000).refine(value =>
  !/https?:\/\/|\b(?:Bearer|Basic)\s|CLONEWP_WORKSPACE_TOKEN|\b[a-f0-9]{64}\b|(?:password|wp_app_password|authorization|cookie|api[_-]?key|access[_-]?token|secret)\s*[=:]|[\x00-\x08\x0b\x0c\x0e-\x1f]/i.test(value),
  'Do not put credentials, browser sessions, access URLs or control characters in shared notes');
export const trackedPath = z.string().min(1).max(400).refine(value =>
  !value.includes('\\') && !value.startsWith('/') && !value.includes(':') &&
  value.split('/').every(part => !!part && part !== '.' && part !== '..') &&
  !/(?:^|\/)(?:\.git|\.env[^/]*|credentials[^/]*|node_modules)(?:\/|$)/i.test(value));

export const snapshotSchema = z.object({
  fingerprint: digest, rulesFingerprint: digest,
  files: z.array(z.object({ path: trackedPath, sha256: digest }).strict()).max(5000),
}).strict();
export type WorkspaceSnapshot = z.infer<typeof snapshotSchema>;
export const recordRef = z.object({ id: workspaceId, sha256: digest }).strict();
export const lockSchema = z.object({
  agent, sessionId: workspaceId, taskId: workspaceId, runId: workspaceId.optional(),
  goal: safeText.optional(),
  fence: z.number().int().positive(), tokenHash: digest,
  claimedAt: timestamp, heartbeatAt: timestamp, expiresAt: timestamp, baseline: snapshotSchema,
  runStateHash: digest.optional(),
}).strict();
export const stateSchema = z.object({
  version: z.literal(1), kind: z.literal('clonewp-shared-workspace'),
  revision: z.number().int().nonnegative(), fence: z.number().int().nonnegative(),
  lock: lockSchema.nullable(), head: recordRef.nullable(),
}).strict();
export type WorkspaceState = z.infer<typeof stateSchema>;
export const initialState = (): WorkspaceState => ({ version: 1, kind: 'clonewp-shared-workspace', revision: 0, fence: 0, lock: null, head: null });
export const checkSchema = z.object({ command: safeText, status: z.enum(['passed', 'failed', 'skipped', 'not-run']) }).strict();
export const notesSchema = z.object({
  goal: safeText, summary: safeText,
  progress: z.enum(['in-progress', 'blocked', 'ready-for-next-step', 'completed']),
  decisions: z.array(safeText).max(30), changes: z.array(safeText).max(50),
  checks: z.array(checkSchema).max(30), openItems: z.array(safeText).max(50),
  nextSteps: z.array(safeText).min(1).max(30),
}).strict();
export type HandoffNotes = z.infer<typeof notesSchema>;
export const handoffSchema = z.object({
  version: z.literal(1), kind: z.literal('clonewp-shared-handoff'),
  authority: z.literal('reported-context-not-authorization'), id: workspaceId,
  revision: z.number().int().positive(), createdAt: timestamp,
  agent, sessionId: workspaceId, taskId: workspaceId, runId: workspaceId.optional(),
  fence: z.number().int().positive(), previous: recordRef.nullable(),
  snapshot: snapshotSchema, changedFiles: z.array(trackedPath).max(5000), notes: notesSchema,
  runStateHash: digest.optional(),
  recovery: z.object({ previousAgent: agent, previousSession: workspaceId, reason: safeText }).strict().optional(),
}).strict();
export type SharedHandoff = z.infer<typeof handoffSchema>;
export const claimSchema = z.object({
  agent, sessionId: workspaceId, taskId: workspaceId, runId: workspaceId.optional(),
  goal: safeText.optional(),
  expectedRevision: z.number().int().nonnegative(), expectedFingerprint: digest,
}).strict();
export const ownedSchema = z.object({ token: z.string().regex(/^[a-f0-9]{64}$/), expectedRevision: z.number().int().nonnegative() }).strict();
export const checkpointSchema = ownedSchema.extend({ expectedFingerprint: digest, notes: notesSchema, release: z.boolean() }).strict();
export const recoverSchema = claimSchema.extend({
  expectedFence: z.number().int().positive(), confirmPreviousSessionStopped: z.literal(true), reason: safeText,
}).strict();
