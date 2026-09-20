import { WorkerManager } from './manager';
import { Conversation, StreamChunk, WorkerId, WorkerSelection } from './models';
import { addTurn, newConversation, promptFor, recordAnswer } from './conversation';
import { ClaudeAdapter, CodexAdapter } from './adapters';

/** Turn a worker's raw stdout into the words it actually said. */
export function answerOf(worker: WorkerId, output: string): string {
  return worker === 'codex' ? CodexAdapter.answer(output) : ClaudeAdapter.answer(output);
}

export interface ChatReply {
  worker: WorkerId;
  text: string;
  /** The transcript had to be replayed because the conversation changed hands. */
  replayed: boolean;
  /** Workers tried, in order, when the first was out of quota. */
  attempts?: WorkerId[];
  tokens?: { input?: number; output?: number };
}

/**
 * One message in a conversation that outlives either provider.
 *
 * The same worker continues its own session, so nothing is resent. When quota sends the turn to the other
 * worker, the transcript goes with it and the answer comes back as if the conversation had always been there.
 */
export async function say(manager: WorkerManager, conv: Conversation, text: string, opts: {
  cwd: string; worker?: WorkerSelection; timeoutMs?: number;
  onChunk?: (c: StreamChunk) => void;
} ): Promise<ChatReply> {
  addTurn(conv, { role: 'user', text });
  const wanted = opts.worker ?? 'auto';
  // what the preferred worker would need; if quota moves the task, the manager tells us who really answered
  const planned = wanted === 'auto' ? (manager.preferredWorker() ?? 'claude') : wanted;
  const plan = promptFor(conv, planned, text);
  const result = await manager.run({
    prompt: plan.prompt, cwd: opts.cwd, worker: wanted, timeoutMs: opts.timeoutMs,
    resumeId: plan.resumeId
  }, opts.onChunk ?? (() => {}));

  // the task may have landed on the other worker, which never saw the transcript: say it again, with it
  if (result.worker !== planned && !plan.replayed && conv.turns.length > 1) {
    const second = promptFor(conv, result.worker, text);
    if (second.replayed) {
      const retry = await manager.run({ prompt: second.prompt, cwd: opts.cwd, worker: result.worker,
                                        timeoutMs: opts.timeoutMs }, opts.onChunk ?? (() => {}));
      const answer = answerOf(retry.worker, retry.output);
      recordAnswer(conv, retry.worker, retry, answer);
      return { worker: retry.worker, text: answer, replayed: true, attempts: result.attempts, tokens: retry.tokens };
    }
  }
  const answer = answerOf(result.worker, result.output);
  recordAnswer(conv, result.worker, result, answer);
  return { worker: result.worker, text: answer, replayed: plan.replayed, attempts: result.attempts, tokens: result.tokens };
}

export { newConversation };
