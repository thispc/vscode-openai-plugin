import test from 'node:test';
import assert from 'node:assert/strict';
import { WorkerManager } from '../manager';
import { WorkerAdapter, TaskHandle, TaskRequest, StreamChunk, AuthStatus, TaskResult } from '../models';

class Fake implements WorkerAdapter {
  constructor(public readonly id: 'codex' | 'claude', private readonly fail = false) {}
  run(request: TaskRequest, onChunk: (chunk: StreamChunk) => void): TaskHandle {
    const promise = Promise.resolve<TaskResult>({ worker: this.id, exitCode: this.fail ? 1 : 0, output: request.prompt, durationMs: 1 }).then(r => { onChunk({ text: r.output, stream: 'stdout' }); return r; });
    return { promise, cancel() {} };
  }
  checkAuth(_cwd: string): Promise<AuthStatus> { return Promise.resolve({ authenticated: true, detail: 'ok' }); }
}
test('manual override routes to selected worker', async () => {
  const manager = new WorkerManager({ codex: new Fake('codex'), claude: new Fake('claude') });
  const result = await manager.run({ prompt: 'hello', cwd: '.', worker: 'claude' }, () => {});
  assert.equal(result.worker, 'claude');
});
test('usage snapshots record completion', async () => {
  const manager = new WorkerManager({ codex: new Fake('codex'), claude: new Fake('claude') });
  await manager.run({ prompt: 'hello', cwd: '.', worker: 'codex' }, () => {});
  assert.equal(manager.snapshots().find(s => s.worker === 'codex')?.completed, 1);
});
test('automatic routing falls back after a failed worker', async () => {
  const manager = new WorkerManager({ codex: new Fake('codex', true), claude: new Fake('claude') });
  const result = await manager.run({ prompt: 'hello', cwd: '.', worker: 'auto' }, () => {});
  assert.notEqual(result.worker, 'codex');
  assert.equal(result.attempts?.length, 2);
});
test('automatic routing avoids workers at the estimated usage threshold', async () => {
  const manager = new WorkerManager(
    { codex: new Fake('codex'), claude: new Fake('claude') },
    1,
    3,
    1
  );
  await manager.run({ prompt: 'first', cwd: '.', worker: 'codex' }, () => {});
  const result = await manager.run({ prompt: 'second', cwd: '.', worker: 'auto' }, () => {});
  assert.equal(result.worker, 'claude');
});
test('manager emits lifecycle events for streamed work', async () => {
  const manager = new WorkerManager({ codex: new Fake('codex'), claude: new Fake('claude') });
  const events: string[] = [];
  manager.events.on('started', () => events.push('started'));
  manager.events.on('finished', () => events.push('finished'));
  await manager.run({ prompt: 'stream', cwd: '.', worker: 'codex' }, () => {});
  assert.deepEqual(events, ['started', 'finished']);
});

test('a worker reported out of quota is rested, not blamed', async () => {
  class Limited implements WorkerAdapter {
    readonly id = 'codex' as const;
    run(): TaskHandle {
      return { promise: Promise.resolve<TaskResult>({ worker: 'codex', exitCode: 1, durationMs: 1,
        output: 'usage limit reached, try again in 2 hours', rateLimited: true,
        resetAt: Date.now() + 7_200_000 }), cancel() {} };
    }
    checkAuth(): Promise<AuthStatus> { return Promise.resolve({ authenticated: true, detail: 'ok' }); }
  }
  const manager = new WorkerManager({ codex: new Limited(), claude: new Fake('claude') });
  const result = await manager.run({ prompt: 'x', cwd: '.', worker: 'auto' }, () => {});
  assert.equal(result.worker, 'claude', 'the task lands on the worker that still has quota');
  const codex = manager.snapshots().find(s => s.worker === 'codex')!;
  assert.equal(codex.failures, 0, 'running out of quota is not a failure');
  assert.ok((codex.limitedUntil ?? 0) > Date.now(), 'it is rested until the window resets');
});

test('a rested worker comes back once its window passes', async () => {
  const manager = new WorkerManager({ codex: new Fake('codex'), claude: new Fake('claude') });
  const codex = manager.snapshots().find(s => s.worker === 'codex')!;
  // reach in the way the manager would after a limit that has already expired
  (manager as unknown as { usage: Map<string, typeof codex> }).usage.get('codex')!.limitedUntil = Date.now() - 1000;
  const result = await manager.run({ prompt: 'x', cwd: '.', worker: 'auto' }, () => {});
  assert.ok(['codex', 'claude'].includes(result.worker));
  assert.equal((manager as unknown as { usage: Map<string, typeof codex> }).usage.get('codex')!.limitedUntil, undefined);
});

test('every worker out of quota says when one returns', async () => {
  class Limited implements WorkerAdapter {
    constructor(public readonly id: 'codex' | 'claude') {}
    run(): TaskHandle {
      return { promise: Promise.resolve<TaskResult>({ worker: this.id, exitCode: 1, durationMs: 1,
        output: 'rate limit', rateLimited: true, resetAt: Date.now() + 60_000 }), cancel() {} };
    }
    checkAuth(): Promise<AuthStatus> { return Promise.resolve({ authenticated: true, detail: 'ok' }); }
  }
  const manager = new WorkerManager({ codex: new Limited('codex'), claude: new Limited('claude') });
  await manager.run({ prompt: 'x', cwd: '.', worker: 'auto' }, () => {}).catch(() => {});
  await assert.rejects(() => Promise.resolve().then(() => manager.run({ prompt: 'y', cwd: '.', worker: 'auto' }, () => {})),
    /out of quota|first comes back/);
});

test('the limited event names who is taking over', async () => {
  class Limited implements WorkerAdapter {
    readonly id = 'codex' as const;
    run(): TaskHandle {
      return { promise: Promise.resolve<TaskResult>({ worker: 'codex', exitCode: 1, durationMs: 1,
        output: 'stream error\nYou have hit your usage limit, resets in 2 hours', rateLimited: true,
        resetAt: Date.now() + 7_200_000 }), cancel() {} };
    }
    checkAuth(): Promise<AuthStatus> { return Promise.resolve({ authenticated: true, detail: 'ok' }); }
  }
  const manager = new WorkerManager({ codex: new Limited(), claude: new Fake('claude') });
  const seen: Array<{ worker: string; next?: string; reason?: string }> = [];
  manager.events.on('limited', e => seen.push(e));
  const result = await manager.run({ prompt: 'x', cwd: '.', worker: 'auto' }, () => {});
  assert.equal(seen.length, 1);
  assert.equal(seen[0].worker, 'codex');
  assert.equal(seen[0].next, 'claude', 'the message can say where the task went');
  assert.match(seen[0].reason ?? '', /usage limit/, 'and why, in the CLI own words');
  assert.deepEqual(result.attempts, ['codex', 'claude']);
});
