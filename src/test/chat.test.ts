import test from 'node:test';
import assert from 'node:assert/strict';
import { WorkerManager } from '../manager';
import { say, newConversation, answerOf } from '../chat';
import { AuthStatus, TaskHandle, TaskRequest, TaskResult, WorkerAdapter, WorkerId } from '../models';

/** Records what it was asked, so a test can see whether the transcript travelled with the task. */
class Spy implements WorkerAdapter {
  readonly prompts: string[] = [];
  readonly resumeIds: Array<string | undefined> = [];
  constructor(public readonly id: WorkerId, private readonly reply: string,
              private readonly limited = false) {}
  run(request: TaskRequest): TaskHandle {
    this.prompts.push(request.prompt);
    this.resumeIds.push(request.resumeId);
    const out = this.id === 'codex'
      ? `{"type":"thread.started","thread_id":"t-${this.id}"}\n{"type":"item.completed","item":{"type":"agent_message","text":${JSON.stringify(this.reply)}}}`
      : JSON.stringify({ session_id: `s-${this.id}`, result: this.reply });
    const result: TaskResult = this.limited
      ? { worker: this.id, exitCode: 1, output: 'usage limit reached', durationMs: 1, rateLimited: true, resetAt: Date.now() + 3600_000 }
      : { worker: this.id, exitCode: 0, output: out, durationMs: 1,
          sessionId: `${this.id === 'codex' ? 't' : 's'}-${this.id}` };
    return { promise: Promise.resolve(result), cancel() {} };
  }
  checkAuth(): Promise<AuthStatus> { return Promise.resolve({ authenticated: true, detail: 'ok' }); }
}

test('a conversation keeps going on one worker without resending anything', async () => {
  const claude = new Spy('claude', 'Paris.');
  const manager = new WorkerManager({ codex: new Spy('codex', 'x'), claude });
  const c = newConversation();
  await say(manager, c, 'capital of France?', { cwd: '.', worker: 'claude' });
  await say(manager, c, 'and the population?', { cwd: '.', worker: 'claude' });
  assert.equal(claude.prompts[1], 'and the population?', 'the second turn is the message alone');
  assert.equal(claude.resumeIds[1], 's-claude', 'because the session carries the thread');
  assert.equal(c.turns.length, 4);
});

test('when the window is spent the conversation moves worker and keeps its thread', async () => {
  const codex = new Spy('codex', 'About 2.1 million.');
  const claude = new Spy('claude', 'Paris.');
  const manager = new WorkerManager({ codex, claude });
  const c = newConversation();
  await say(manager, c, 'capital of France?', { cwd: '.', worker: 'claude' });

  // claude is spent from here on
  const spent = new WorkerManager({ codex, claude: new Spy('claude', '', true) });
  spent.snapshots();
  const reply = await say(spent, c, 'and the population?', { cwd: '.', worker: 'auto' });

  assert.equal(reply.worker, 'codex', 'the other worker answered');
  assert.equal(reply.text, 'About 2.1 million.');
  const handover = codex.prompts[codex.prompts.length - 1];
  assert.match(handover, /capital of France/, 'it was told what came before');
  assert.match(handover, /Paris\./, 'including what the other assistant said');
  assert.match(handover, /and the population\?$/, 'and the new message last');
  assert.equal(c.turns.length, 4, 'the transcript is one conversation, not two');
  assert.equal(c.sessions.codex, 't-codex', 'codex now holds a session of its own');
});

test('the reply text is unwrapped from each CLI format', () => {
  assert.equal(answerOf('claude', '{"session_id":"s","result":"Paris."}'), 'Paris.');
  assert.equal(answerOf('codex', '{"type":"item.completed","item":{"type":"agent_message","text":"Paris."}}'), 'Paris.');
});
