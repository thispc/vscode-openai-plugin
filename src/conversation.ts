import { WorkerId, Turn, Conversation, TaskResult } from './models';

/**
 * One conversation that outlives any single provider.
 *
 * Each CLI can continue its own session cheaply (claude --resume <id>, codex exec resume <id>), so while the
 * same worker keeps answering, nothing is replayed. The moment the conversation moves to the other worker,
 * that worker knows none of it: it gets the transcript replayed as a preamble and starts a session of its own.
 *
 * The transcript is ours, not either provider's, so a switch never loses the thread (Pulkit, 20 Sep 2026:
 * "build it like this chat").
 */
export const MAX_REPLAY_CHARS = 24000;

export function newConversation(id = `c${Date.now().toString(36)}`): Conversation {
  return { id, turns: [], sessions: {}, createdAt: Date.now(), updatedAt: Date.now() };
}

export function addTurn(c: Conversation, turn: Omit<Turn, 'at'>): Conversation {
  c.turns.push({ ...turn, at: Date.now() });
  c.updatedAt = Date.now();
  return c;
}

/** The worker that answered last, so we can tell a continuation from a switch. */
export function lastWorker(c: Conversation): WorkerId | undefined {
  for (let i = c.turns.length - 1; i >= 0; i--) {
    if (c.turns[i].role === 'assistant' && c.turns[i].worker) return c.turns[i].worker;
  }
  return undefined;
}

/** True when this worker already holds a live session for the conversation. */
export function canResume(c: Conversation, worker: WorkerId): boolean {
  return Boolean(c.sessions[worker]) && lastWorker(c) === worker;
}

/**
 * The transcript a worker needs to pick the conversation up cold, newest turns kept when it will not all fit.
 * Trimming from the front loses the opening but keeps what the next answer depends on.
 */
export function replayText(c: Conversation, limit = MAX_REPLAY_CHARS): string {
  if (!c.turns.length) return '';
  const lines: string[] = [];
  let used = 0;
  let dropped = 0;
  for (let i = c.turns.length - 1; i >= 0; i--) {
    const t = c.turns[i];
    const who = t.role === 'user' ? 'User' : `Assistant (${t.worker ?? 'unknown'})`;
    const line = `${who}: ${t.text.trim()}`;
    if (used + line.length > limit) { dropped = i + 1; break; }
    lines.unshift(line);
    used += line.length + 1;
  }
  const head = dropped
    ? `[the first ${dropped} turn(s) are omitted for length]\n`
    : '';
  return `${head}${lines.join('\n\n')}`;
}

/** What to send a worker for the next user message: a bare prompt when it can resume, the transcript when not. */
export function promptFor(c: Conversation, worker: WorkerId, userText: string, limit = MAX_REPLAY_CHARS): {
  prompt: string; resumeId?: string; replayed: boolean;
} {
  if (canResume(c, worker)) {
    return { prompt: userText, resumeId: c.sessions[worker], replayed: false };
  }
  const prior = replayText(c, limit);
  if (!prior) return { prompt: userText, replayed: false };
  return {
    prompt: `This conversation was being handled by another assistant and has moved to you. Here is what was said so far.\n\n` +
            `--- transcript ---\n${prior}\n--- end transcript ---\n\n` +
            `Continue it. Answer the next message as if the conversation had been yours throughout, without ` +
            `remarking on the handover.\n\nUser: ${userText}`,
    replayed: true
  };
}

/** Record what a worker answered, and the session id it handed back so the next turn can resume it. */
export function recordAnswer(c: Conversation, worker: WorkerId, result: TaskResult, text: string): Conversation {
  if (result.sessionId) c.sessions[worker] = result.sessionId;
  return addTurn(c, { role: 'assistant', text, worker });
}
