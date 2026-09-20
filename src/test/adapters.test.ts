import test from 'node:test';
import assert from 'node:assert/strict';
import { isRateLimited, parseResetAt, CodexAdapter } from '../adapters';

test('a spent subscription reads differently from a broken task', () => {
  assert.ok(isRateLimited('Error: usage limit reached for your plan', 1));
  assert.ok(isRateLimited('429 Too Many Requests', 1));
  assert.ok(isRateLimited('You have hit your weekly limit, resets at 3pm', 1));
  assert.ok(!isRateLimited('SyntaxError: unexpected token', 1), 'a real failure is not a limit');
  assert.ok(!isRateLimited('usage limit reached', 0), 'a run that succeeded is never limited');
});

test('a reset time is read out of the message when one is given', () => {
  const now = Date.UTC(2026, 8, 20, 10, 0, 0);
  assert.equal(parseResetAt('try again in 42 minutes', now), now + 42 * 60_000);
  assert.equal(parseResetAt('resets in 2 hours', now), now + 2 * 3_600_000);
  assert.equal(parseResetAt('no time here', now), undefined);
});

test('codex gets the prompt as an argument, not on stdin', () => {
  const args = (new CodexAdapter('codex') as unknown as { argumentsFor(p: string): string[] }).argumentsFor('do a thing');
  assert.deepEqual(args, ['exec', '--json', '--sandbox', 'read-only', '--skip-git-repo-check', 'do a thing']);
  assert.ok(!args.includes('--'), 'the -- separator made codex wait on stdin instead of reading the prompt');
});

test('a model the plan does not cover falls back like any other spent quota', () => {
  assert.ok(isRateLimited('Fable 5.1 requires usage credits. Switch to another model', 1),
    'an entitlement answer must hand the task to the other provider, not count as a crash');
});

test('each worker can be pinned to a model its plan covers', () => {
  const claude = (new (require('../adapters').ClaudeAdapter)('claude', 'sonnet') as unknown as
    { argumentsFor(p: string): string[] }).argumentsFor('hi');
  assert.deepEqual(claude, ['--model', 'sonnet', '-p', '--output-format', 'json', 'hi']);
  const codex = (new CodexAdapter('codex', 'read-only', 'gpt-5') as unknown as
    { argumentsFor(p: string): string[] }).argumentsFor('hi');
  assert.ok(codex.includes('-m') && codex.includes('gpt-5'));
});

test('a worker resuming its own session says so on the command line', () => {
  const codex = (new CodexAdapter('codex') as unknown as { argumentsFor(p: string, r?: string): string[] })
    .argumentsFor('next', 'thread-9');
  assert.deepEqual(codex.slice(0, 3), ['exec', 'resume', 'thread-9']);
  const { ClaudeAdapter } = require('../adapters');
  const claude = (new ClaudeAdapter('claude', 'sonnet') as unknown as { argumentsFor(p: string, r?: string): string[] })
    .argumentsFor('next', 'sess-9');
  assert.ok(claude.includes('--resume') && claude.includes('sess-9'));
});

test('the session id and token cost are read back out of each CLI', () => {
  const { ClaudeAdapter } = require('../adapters');
  const codexOut = [
    '{"type":"thread.started","thread_id":"01a0-abc"}',
    '{"type":"item.completed","item":{"id":"i0","type":"agent_message","text":"Hello there"}}',
    '{"type":"turn.completed","usage":{"input_tokens":120,"output_tokens":9}}'
  ].join('\n');
  const cm = (new CodexAdapter('codex') as unknown as { readMeta(o: string): { sessionId?: string; tokens?: { input?: number } } }).readMeta(codexOut);
  assert.equal(cm.sessionId, '01a0-abc');
  assert.equal(cm.tokens?.input, 120);
  assert.equal(CodexAdapter.answer(codexOut), 'Hello there', 'the envelope comes off the reply');

  const claudeOut = '{"session_id":"sess-x","result":"Paris.","usage":{"input_tokens":2,"output_tokens":4}}';
  const am = (new ClaudeAdapter('claude') as unknown as { readMeta(o: string): { sessionId?: string } }).readMeta(claudeOut);
  assert.equal(am.sessionId, 'sess-x');
  assert.equal(ClaudeAdapter.answer(claudeOut), 'Paris.');
  assert.equal(ClaudeAdapter.answer('plain text reply'), 'plain text reply', 'non-JSON output still reads');
});
