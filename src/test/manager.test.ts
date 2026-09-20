import test from 'node:test';
import assert from 'node:assert/strict';
import { WorkerManager } from '../manager';
import { WorkerAdapter, TaskHandle, TaskRequest, StreamChunk, AuthStatus, TaskResult } from '../models';

class Fake implements WorkerAdapter {
  constructor(public readonly id: 'codex' | 'claude' | 'gemini', private readonly fail = false) {}
  run(request: TaskRequest, onChunk: (chunk: StreamChunk) => void): TaskHandle {
    const promise = Promise.resolve<TaskResult>({ worker: this.id, exitCode: this.fail ? 1 : 0, output: request.prompt, durationMs: 1 }).then(r => { onChunk({ text: r.output, stream: 'stdout' }); return r; });
    return { promise, cancel() {} };
  }
  checkAuth(_cwd: string): Promise<AuthStatus> { return Promise.resolve({ authenticated: true, detail: 'ok' }); }
}
test('manual override routes to selected worker', async () => {
  const manager = new WorkerManager({ codex: new Fake('codex'), claude: new Fake('claude'), gemini: new Fake('gemini') });
  const result = await manager.run({ prompt: 'hello', cwd: '.', worker: 'claude' }, () => {});
  assert.equal(result.worker, 'claude');
});
test('usage snapshots record completion', async () => {
  const manager = new WorkerManager({ codex: new Fake('codex'), claude: new Fake('claude'), gemini: new Fake('gemini') });
  await manager.run({ prompt: 'hello', cwd: '.', worker: 'codex' }, () => {});
  assert.equal(manager.snapshots().find(s => s.worker === 'codex')?.completed, 1);
});
test('automatic routing falls back after a failed worker', async () => {
  const manager = new WorkerManager({ codex: new Fake('codex', true), claude: new Fake('claude'), gemini: new Fake('gemini') });
  const result = await manager.run({ prompt: 'hello', cwd: '.', worker: 'auto' }, () => {});
  assert.notEqual(result.worker, 'codex');
  assert.equal(result.attempts?.length, 2);
});
test('automatic routing avoids workers at the estimated usage threshold', async () => {
  const manager = new WorkerManager(
    { codex: new Fake('codex'), claude: new Fake('claude'), gemini: new Fake('gemini') },
    1,
    3,
    1
  );
  await manager.run({ prompt: 'first', cwd: '.', worker: 'codex' }, () => {});
  const result = await manager.run({ prompt: 'second', cwd: '.', worker: 'auto' }, () => {});
  assert.equal(result.worker, 'claude');
});
