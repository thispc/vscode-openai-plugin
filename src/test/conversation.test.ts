import test from 'node:test';
import assert from 'node:assert/strict';
import { newConversation, addTurn, lastWorker, canResume, replayText, promptFor, recordAnswer } from '../conversation';
import { TaskResult } from '../models';

function convo() {
  const c = newConversation('c1');
  addTurn(c, { role: 'user', text: 'what is the capital of France?' });
  recordAnswer(c, 'claude', { worker: 'claude', exitCode: 0, output: '', durationMs: 1, sessionId: 'sess-a' } as TaskResult, 'Paris.');
  addTurn(c, { role: 'user', text: 'and its population?' });
  recordAnswer(c, 'claude', { worker: 'claude', exitCode: 0, output: '', durationMs: 1, sessionId: 'sess-a' } as TaskResult, 'About 2.1 million.');
  return c;
}

test('the same worker continues its own session instead of resending the transcript', () => {
  const c = convo();
  assert.equal(lastWorker(c), 'claude');
  assert.ok(canResume(c, 'claude'));
  const plan = promptFor(c, 'claude', 'and the country?');
  assert.equal(plan.prompt, 'and the country?', 'nothing is replayed to a worker that already has the thread');
  assert.equal(plan.resumeId, 'sess-a');
  assert.equal(plan.replayed, false);
});

test('a worker taking over gets the whole conversation, not just the new message', () => {
  const c = convo();
  assert.ok(!canResume(c, 'codex'));
  const plan = promptFor(c, 'codex', 'and the country?');
  assert.equal(plan.replayed, true);
  assert.equal(plan.resumeId, undefined);
  assert.match(plan.prompt, /capital of France/);
  assert.match(plan.prompt, /Paris\./);
  assert.match(plan.prompt, /2\.1 million/);
  assert.match(plan.prompt, /and the country\?$/);
  assert.match(plan.prompt, /without remarking on the handover/, 'the seam should not show to the reader');
});

test('the first message of a conversation is sent as itself', () => {
  const c = newConversation('c2');
  const plan = promptFor(c, 'claude', 'hello');
  assert.equal(plan.prompt, 'hello');
  assert.equal(plan.replayed, false);
});

test('a transcript too long to replay keeps the newest turns and says what it dropped', () => {
  const c = newConversation('c3');
  for (let i = 0; i < 40; i++) {
    addTurn(c, { role: 'user', text: `question ${i} ` + 'x'.repeat(400) });
    recordAnswer(c, 'claude', { worker: 'claude', exitCode: 0, output: '', durationMs: 1 } as TaskResult, `answer ${i}`);
  }
  const text = replayText(c, 3000);
  assert.ok(text.length <= 3200, 'it fits the budget');
  assert.match(text, /answer 39/, 'the newest turn survives');
  assert.ok(!text.includes('question 0 '), 'the oldest is dropped');
  assert.match(text, /turn\(s\) are omitted for length/, 'and the gap is admitted');
});

test('each worker keeps its own session id', () => {
  const c = convo();
  recordAnswer(c, 'codex', { worker: 'codex', exitCode: 0, output: '', durationMs: 1, sessionId: 'thread-b' } as TaskResult, 'Also Paris.');
  assert.equal(c.sessions.claude, 'sess-a');
  assert.equal(c.sessions.codex, 'thread-b');
  assert.ok(canResume(c, 'codex'), 'codex answered last, so it can resume');
  assert.ok(!canResume(c, 'claude'), 'claude has an id but no longer holds the thread');
});
