import { createHash } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { buildAiClient } from '../ai/client.ts';
import { env } from '../config/env.ts';
import { features } from '../config/features.ts';

/**
 * Gmail, Calendar, Drive, Docs, and People go through an open-source
 * Workspace MCP server (stdio). Funke does not reimplement those APIs.
 * Recommended server: https://github.com/taylorwilsdon/google_workspace_mcp
 *   WORKSPACE_MCP_COMMAND=uvx
 *   WORKSPACE_MCP_ARGS=workspace-mcp
 *
 * Write tools are listed only when WORKSPACE_MCP_WRITES=true, and they never
 * run immediately: they become an approvals-rail item (workspace.write).
 * Approve on a screen re-invokes the same tool. Voice cannot approve.
 */

const WRITE_TOOL =
  /\b(send|create|insert|update|patch|delete|remove|trash|move|rename|upload|write|compose|reply|forward|share|export|modify|append|clear|batch)\b/i;

export type WorkspaceAskResult = {
  ok: boolean;
  reply: string;
  approval?: {
    id: number;
    title: string;
    summary: string;
    preview: string | null;
    actionType: string;
    expiresAt: string | null;
  };
};

export function workspaceConfigured(): boolean {
  return Boolean(env.workspaceMcpCommand.trim());
}

/**
 * True when the user is asking for Google Workspace (Gmail/Drive/Docs/People),
 * not local Funke memory/calendar/drafts.
 *
 * Do not trap: "update contact", "customer contact", "Remember for Bola",
 * or "draft a follow-up email" when they mean a pasteable letter (no MCP).
 */
export function isWorkspaceAsk(text: string): boolean {
  const t = text.trim();
  if (/\b(gmail|google docs?|google drive|google sheets?|google slides?|address book)\b/i.test(t)) {
    return true;
  }
  // Explicit inbox / unread mail
  if (/\b(check|read|search|open)\b[\s\S]{0,40}\b(inbox|unread)\b/i.test(t)) return true;
  if (/\binbox\b/i.test(t) && /\b(email|mail|gmail|messages?)\b/i.test(t)) return true;
  // People API / Google contacts only when clearly Workspace-scoped
  if (/\b(google\s+)?contacts?\b/i.test(t) && /\b(google|gmail|workspace|people api|address book)\b/i.test(t)) {
    return true;
  }
  // Send/check real email via Gmail (not "draft a follow-up email" for paste)
  if (
    /\b(send|check|read|search|find)\b[\s\S]{0,40}\b(e-?mail|mail)\b/i.test(t)
    && !/\b(draft|write|compose)\b[\s\S]{0,40}\b(follow-?up\s+)?(e-?mail|mail|letter|memo)\b/i.test(t)
  ) {
    return true;
  }
  if (/\b(e-?mail|mail)\b[\s\S]{0,40}\b(from|inbox|unread)\b/i.test(t)) return true;
  if (isInboxTriageAsk(t)) return true;
  return false;
}

/** Morning digest / “what needs a reply” phrasing. */
export function isInboxTriageAsk(text: string): boolean {
  const t = text.trim();
  return (
    /\b(triage|digest)\b[\s\S]{0,40}\b(inbox|mail|gmail|e-?mails?)\b/i.test(t)
    || /\b(inbox|gmail|e-?mails?)\b[\s\S]{0,40}\b(triage|digest)\b/i.test(t)
    || /\bwhat\s+needs\s+(a\s+)?reply\b/i.test(t)
    || /\bneeds?\s+(me|you|a reply)\b[\s\S]{0,40}\b(inbox|mail|gmail|e-?mail)\b/i.test(t)
    || /\b(inbox|gmail)\b[\s\S]{0,40}\b(needs?\s+me|needs?\s+you|urgent)\b/i.test(t)
  );
}

export function isWorkspaceWriteTool(name: string, description = ''): boolean {
  return WRITE_TOOL.test(name) || WRITE_TOOL.test(description);
}

export function workspaceSetupReply(): string {
  return [
    'Email, contacts, docs, and Drive go through a Google Workspace MCP server (Gmail, Calendar, Drive, People).',
    '',
    'I do not have one configured yet. Add this to .env, then restart:',
    'WORKSPACE_MCP_COMMAND=uvx',
    'WORKSPACE_MCP_ARGS=workspace-mcp',
    '',
    'That is the open-source server at github.com/taylorwilsdon/google_workspace_mcp.',
    'You still create a Google OAuth client and enable Gmail, Calendar, Drive, and People.',
    'Read-only works as soon as the server is up. Writes need WORKSPACE_MCP_WRITES=true and still wait on Approvals — voice cannot approve.',
    'Calendar invites I can already store locally until that server is connected.',
  ].join('\n');
}

function childEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === 'string') out[key] = value;
  }
  return out;
}

function toolText(result: { content?: { type?: string; text?: string }[]; isError?: boolean }): string {
  const parts = (result.content ?? [])
    .filter((c) => c.type === 'text' && c.text)
    .map((c) => c.text as string);
  const text = parts.join('\n').trim();
  if (result.isError) return text || 'The Workspace tool returned an error.';
  return text || 'Done. The Workspace tool returned no text.';
}

function previewForWrite(tool: string, args: Record<string, unknown>, note: string): string {
  const keys = ['to', 'recipient', 'subject', 'body', 'text', 'content', 'summary', 'title', 'query', 'path', 'name'];
  const lines: string[] = [`Tool: ${tool}`];
  if (note) lines.push(note);
  for (const key of keys) {
    const val = args[key];
    if (val == null || val === '') continue;
    const text = typeof val === 'string' ? val : JSON.stringify(val);
    lines.push(`${key}: ${text.slice(0, 500)}`);
  }
  if (lines.length <= 2) {
    lines.push(`Arguments: ${JSON.stringify(args).slice(0, 800)}`);
  }
  return lines.join('\n');
}

async function withWorkspaceClient<T>(
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  if (!workspaceConfigured()) {
    throw new Error('Workspace MCP is not configured.');
  }
  const args = env.workspaceMcpArgs.trim() ? env.workspaceMcpArgs.trim().split(/\s+/) : [];
  const transport = new StdioClientTransport({
    command: env.workspaceMcpCommand.trim(),
    args,
    env: childEnv(),
    stderr: 'pipe',
  });
  const client = new Client({ name: 'funke', version: '0.1.0' });
  try {
    await client.connect(transport);
    return await fn(client);
  } finally {
    await client.close().catch(() => undefined);
  }
}

/** Run one Workspace MCP tool. Used by Chat reads and by the approvals executor. */
export async function callWorkspaceTool(
  name: string,
  args: Record<string, unknown> = {},
): Promise<{ ok: boolean; reply: string }> {
  try {
    return await withWorkspaceClient(async (client) => {
      const listed = await client.listTools();
      const meta = (listed.tools ?? []).find((t) => t.name === name);
      if (!meta) {
        return { ok: false, reply: `Workspace tool “${name}” is not available on the connected server.` };
      }
      if (isWorkspaceWriteTool(name, meta.description ?? '') && !features.workspaceMcpWrites) {
        return {
          ok: false,
          reply: 'Workspace writes are off (WORKSPACE_MCP_WRITES=false). I did not run that tool.',
        };
      }
      const result = await client.callTool({ name, arguments: args });
      const body = toolText(result as { content?: { type?: string; text?: string }[]; isError?: boolean });
      return { ok: !(result as { isError?: boolean }).isError, reply: body.slice(0, 4000) };
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      reply: `I could not reach the Workspace MCP server (${env.workspaceMcpCommand}). ${message}`,
    };
  }
}

export async function askWorkspace(text: string): Promise<WorkspaceAskResult> {
  if (!workspaceConfigured()) return { ok: false, reply: workspaceSetupReply() };

  try {
    return await withWorkspaceClient(async (client) => {
      const listed = await client.listTools();
      const all = (listed.tools ?? []).slice(0, 80).map((tool) => ({
        name: tool.name,
        description: (tool.description ?? '').slice(0, 180),
        write: isWorkspaceWriteTool(tool.name, tool.description ?? ''),
      }));
      const tools = features.workspaceMcpWrites ? all : all.filter((t) => !t.write);
      if (tools.length === 0) {
        return {
          ok: false,
          reply: features.workspaceMcpWrites
            ? 'The Workspace MCP server started, but it exposed no tools.'
            : 'Workspace is in read-only mode. Write tools (send, create, delete) stay off until WORKSPACE_MCP_WRITES=true. Ask me to read or search instead.',
        };
      }

      const ai = buildAiClient();
      const raw = await ai.text({
        system: [
          'Pick one Workspace MCP tool for the user request.',
          'Return ONLY JSON: {"tool":"exact tool name","arguments":{},"note":"one short sentence"}.',
          'arguments must match the request. Use {} if the tool needs nothing.',
          'If none of the tools can do it, set tool to empty string.',
          features.workspaceMcpWrites
            ? 'Write tools are allowed: they will wait for the owner to Approve on screen before running. Prefer draft/create tools over send when both exist.'
            : 'Only read/search/list tools are available. Never invent a write tool name.',
        ].filter(Boolean).join('\n'),
        prompt: `Request:\n${text}\n\nTools:\n${tools.map((t) => `- ${t.name}: ${t.description}`).join('\n')}`,
        maxTokens: 600,
      });
      const start = raw.indexOf('{');
      const end = raw.lastIndexOf('}');
      if (start < 0 || end < start) {
        return { ok: false, reply: 'I could not choose a Workspace tool for that. Try a shorter request.' };
      }
      const picked = JSON.parse(raw.slice(start, end + 1)) as {
        tool?: string;
        arguments?: Record<string, unknown>;
        note?: string;
      };
      const name = String(picked.tool ?? '').trim();
      const allowed = tools.find((t) => t.name === name);
      if (!name || !allowed) {
        return {
          ok: false,
          reply: 'None of the connected Workspace tools match that. Try asking about Gmail, Drive, Docs, or contacts directly.',
        };
      }

      const args = picked.arguments ?? {};
      const note = String(picked.note ?? '').trim();

      if (allowed.write) {
        if (!features.workspaceMcpWrites) {
          return {
            ok: false,
            reply: 'That would change something in Google Workspace. Set WORKSPACE_MCP_WRITES=true, then I will queue it for your approval. I can still read or search.',
          };
        }
        const { requestAction, approvalToCard } = await import('../guardrails/approvals.ts');
        const preview = previewForWrite(name, args, note);
        const idem = createHash('sha256')
          .update(JSON.stringify({ name, args, text: text.slice(0, 200) }))
          .digest('hex')
          .slice(0, 24);
        const outcome = await requestAction({
          actionType: 'workspace.write',
          title: `Workspace: ${name}`,
          summary: note || `Run ${name} in Google Workspace`,
          preview,
          sourceText: text,
          idempotencyKey: `ws-${idem}`,
          payload: { tool: name, arguments: args, note },
        });
        return {
          ok: outcome.ok,
          reply: outcome.reply,
          approval: outcome.approval ? approvalToCard(outcome.approval) : undefined,
        };
      }

      const result = await client.callTool({ name, arguments: args });
      const body = toolText(result as { content?: { type?: string; text?: string }[]; isError?: boolean });
      const reply = [note, body].filter(Boolean).join('\n\n').slice(0, 4000);
      return { ok: !(result as { isError?: boolean }).isError, reply };
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      reply: `I could not reach the Workspace MCP server (${env.workspaceMcpCommand}). ${message}`,
    };
  }
}
