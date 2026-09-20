import test from 'node:test';
import assert from 'node:assert/strict';
import { TurnQueue } from '../queue';

const defer = () => { let go: () => void; const p = new Promise<void>(r => { go = r; }); return { p, go: go! }; };

test('a message typed while one is in flight waits its turn', async () => {
  const order: string[] = [];
  const first = defer();
  const q = new TurnQueue(async text => { order.push(`start:${text}`); if (text === 'a') await first.p; order.push(`end:${text}`); });
  q.push('a');
  q.push('b');
  assert.deepEqual(order, ['start:a'], 'the second does not start while the first runs');
  assert.deepEqual(q.waiting, ['b'], 'and it is visibly waiting');
  first.go();
  await new Promise(r => setTimeout(r, 10));
  assert.deepEqual(order, ['start:a', 'end:a', 'start:b', 'end:b'], 'they run in the order typed');
  assert.deepEqual(q.waiting, []);
  assert.equal(q.busy, false);
});

test('the message being answered is not shown as queued', async () => {
  const seen: string[][] = [];
  const hold = defer();
  const q = new TurnQueue(async () => { await hold.p; }, w => seen.push([...w]));
  q.push('one');
  assert.deepEqual(q.waiting, [], 'the one in flight is not waiting');
  q.push('two');
  assert.deepEqual(q.waiting, ['two']);
  hold.go();
  await new Promise(r => setTimeout(r, 10));
  assert.deepEqual(seen[seen.length - 1], []);
});

test('a failed turn does not stop the ones behind it', async () => {
  const done: string[] = [];
  const errors: string[] = [];
  const q = new TurnQueue(
    async t => { if (t === 'bad') throw new Error('boom'); done.push(t); },
    () => {}, e => errors.push(String(e)));
  q.push('bad');
  q.push('good');
  await new Promise(r => setTimeout(r, 10));
  assert.deepEqual(done, ['good'], 'the queue keeps going');
  assert.equal(errors.length, 1);
  assert.match(errors[0], /boom/);
});

test('stopping drops what has not started', async () => {
  const done: string[] = [];
  const hold = defer();
  const q = new TurnQueue(async t => { if (t === 'a') await hold.p; done.push(t); });
  q.push('a'); q.push('b'); q.push('c');
  q.clear();
  assert.deepEqual(q.waiting, [], 'b and c are gone');
  hold.go();
  await new Promise(r => setTimeout(r, 10));
  assert.deepEqual(done, ['a'], 'the one already running still finished');
  assert.equal(q.busy, false);
});

test('idle fires once the queue empties', async () => {
  let idle = 0;
  const q = new TurnQueue(async () => {}, () => {}, () => {}, () => { idle++; });
  q.push('a'); q.push('b');
  await new Promise(r => setTimeout(r, 10));
  assert.equal(idle, 1, 'once, not per message');
});
