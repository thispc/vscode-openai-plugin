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
  assert.deepEqual(args, ['exec', '--sandbox', 'read-only', '--skip-git-repo-check', 'do a thing']);
  assert.ok(!args.includes('--'), 'the -- separator made codex wait on stdin instead of reading the prompt');
});

test('a model the plan does not cover falls back like any other spent quota', () => {
  assert.ok(isRateLimited('Fable 5.1 requires usage credits. Switch to another model', 1),
    'an entitlement answer must hand the task to the other provider, not count as a crash');
});

test('each worker can be pinned to a model its plan covers', () => {
  const claude = (new (require('../adapters').ClaudeAdapter)('claude', 'sonnet') as unknown as
    { argumentsFor(p: string): string[] }).argumentsFor('hi');
  assert.deepEqual(claude, ['--model', 'sonnet', '-p', 'hi']);
  const codex = (new CodexAdapter('codex', 'read-only', 'gpt-5') as unknown as
    { argumentsFor(p: string): string[] }).argumentsFor('hi');
  assert.ok(codex.includes('-m') && codex.includes('gpt-5'));
});
