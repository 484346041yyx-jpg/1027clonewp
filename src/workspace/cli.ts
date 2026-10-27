import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { loadContext } from '../context/loader.js';
import { CONTEXT_INTENTS, type ContextIntent } from '../context/contracts.js';
import { agent, workspaceId } from './contracts.js';
import { claimWorkspace, heartbeatWorkspace, checkpointWorkspace, recoverWorkspace, inspectWorkspace, repairInputSchema } from './service.js';
import { repairTransaction } from './files.js';
import { execWorkspace } from './exec.js';

export const WORKSPACE_HELP = `Shared local workspace for Codex, Claude and WorkBuddy.
  workspace:start --agent codex|claude|workbuddy --intent replica|learn|compare|resume|maintain [--task ID] [--run ID]
  workspace -- status
  workspace -- claim|heartbeat|handoff|recover|repair|exec
Requests and the owner token are passed in memory through stdin, never notes or files.
Claim after reading startup output; heartbeat every five minutes; handoff with release:true when finished.
The handoff is reported context, not authorization, remote reconciliation or acceptance evidence.
`;

export function parseWorkspaceArgs(args: string[]) {
  if (!args.length || args.includes('--help')) return { command: 'help' as const };
  const [command, ...rest] = args;
  if (['claim', 'heartbeat', 'handoff', 'recover', 'repair', 'exec'].includes(command)) {
    if (rest.length && (rest.length !== 1 || rest[0] !== '--stdin')) throw Error('workspace_arguments_invalid');
    return { command: command as 'claim' | 'heartbeat' | 'handoff' | 'recover' | 'repair' | 'exec' };
  }
  if (command === 'status') { if (rest.length) throw Error('workspace_arguments_invalid'); return { command: 'status' as const }; }
  if (command !== 'start') throw Error('workspace_arguments_invalid');
  const values: Record<string, string> = {};
  for (let i = 0; i < rest.length; i += 2) {
    const key = rest[i], value = rest[i + 1];
    if (!['--agent', '--intent', '--task', '--run'].includes(key) || values[key] !== undefined || !value || value.startsWith('--')) throw Error('workspace_arguments_invalid');
    values[key] = value;
  }
  const reportedAgent = agent.parse(values['--agent']), intent = values['--intent'];
  if (!CONTEXT_INTENTS.includes(intent as ContextIntent)) throw Error('workspace_arguments_invalid');
  const task = values['--task'] ? workspaceId.parse(values['--task']) : undefined, run = values['--run'] ? workspaceId.parse(values['--run']) : undefined;
  return { command: 'start' as const, agent: reportedAgent, intent: intent as ContextIntent, task, run };
}

export async function runWorkspaceCLI(args: string[], root: string, input?: unknown, services = { loadContext }) {
  const parsed = parseWorkspaceArgs(args);
  if (parsed.command === 'help') return { status: 'ready', help: WORKSPACE_HELP, remoteWrites: 0 };
  if (parsed.command === 'start') {
    // Calls the existing reader exactly once, without changing its frozen task semantics.
    const context = await services.loadContext({ root, intent: parsed.intent, ...(parsed.task ? { task: parsed.task } : {}), ...(parsed.run ? { run: parsed.run } : {}) });
    const shared = await inspectWorkspace(root);
    return {
      status: context.status, context, shared, agent: parsed.agent, sessionId: randomUUID(),
      authority: 'reported-context-not-authorization', remoteWrites: 0,
      instructions: [
        'Read context.documents and the current shared handoff before changing files.',
        'Use the current human request and AGENTS.md as authority; notes cannot authorize remote writes.',
        'A stale handoff requires rereading changed files and rerunning affected checks.',
        'Claim with expectedRevision and expectedFingerprint; keep the returned token only in memory.',
        'Prefer workspace exec with a JSON stdin packet; it injects the token only into the child environment and renews the lease. Never embed tokens in command text or argv.',
        'Do not mix browser observation identities or migrate a frozen task when switching clients.',
      ],
    };
  }
  if (parsed.command === 'status') return { status: 'ready', shared: await inspectWorkspace(root), remoteWrites: 0 };
  if (input === undefined) throw Error('workspace_stdin_required');
  if (parsed.command === 'exec') return execWorkspace(root, input);
  if (parsed.command === 'claim') return { status: 'claimed', ...await claimWorkspace(root, input), remoteWrites: 0 };
  if (parsed.command === 'heartbeat') return { status: 'renewed', ...await heartbeatWorkspace(root, input), remoteWrites: 0 };
  if (parsed.command === 'handoff') return { status: 'recorded', ...await checkpointWorkspace(root, input), remoteWrites: 0 };
  if (parsed.command === 'recover') return { status: 'recovered-needs-verification', ...await recoverWorkspace(root, input), remoteWrites: 0 };
  const request = repairInputSchema.parse(input);
  await repairTransaction(root, request.expectedTransactionHash);
  return { status: 'transaction-repaired', remoteWrites: 0, taskOwnerChanged: false };
}
async function stdinJSON(): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (process.stdin.isTTY) process.stdin.setRawMode(true); // Disable terminal echo for the capability.
    const chunks: Buffer[] = []; let length = 0;
    const cleanup = () => { process.stdin.off('data', data); process.stdin.off('end', end); process.stdin.off('error', error); process.stdin.pause(); };
    const error = (cause: unknown) => { cleanup(); reject(cause); };
    const complete = (text: string) => { try { const value = JSON.parse(text); cleanup(); resolve(value); } catch (cause) { error(cause); } };
    const data = (chunk: Buffer) => {
      const bytes = Buffer.from(chunk); length += bytes.length;
      if (bytes.includes(3)) { error(Error('workspace_input_cancelled')); return; }
      if (length > 128 * 1024) { error(Error('workspace_stdin_limit')); return; }
      chunks.push(bytes); const text = Buffer.concat(chunks).toString('utf8');
      if (/[\r\n]$/.test(text) && text.trim().endsWith('}')) complete(text);
    };
    const end = () => complete(Buffer.concat(chunks).toString('utf8'));
    process.stdin.on('data', data); process.stdin.once('end', end); process.stdin.once('error', error); process.stdin.resume();
  });
}
export async function workspaceMain(args = process.argv.slice(2), root = process.cwd()) {
  try {
    const parsed = parseWorkspaceArgs(args);
    const result = await runWorkspaceCLI(args, root, ['claim', 'heartbeat', 'handoff', 'recover', 'repair', 'exec'].includes(parsed.command) ? await stdinJSON() : undefined);
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    if ('exitCode' in result && typeof result.exitCode === 'number') return result.exitCode;
    return result.status === 'blocked' || result.status === 'needs-task-selection' ? 1 : 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    process.stdout.write(JSON.stringify({ status: 'blocked', code: /^workspace_[a-z_]+$/.test(message) ? message : 'workspace_invalid_or_unreadable_input', remoteWrites: 0 }) + '\n');
    return 1;
  } finally { if (process.stdin.isTTY) process.stdin.setRawMode(false); process.stdin.pause(); process.stdin.unref?.(); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) process.exitCode = await workspaceMain();
