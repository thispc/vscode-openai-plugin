import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readQuota, gearFor, planFor, describe as describeQuota, DEFAULT_THRESHOLDS } from '../quota';

function cacheWith(fiveUsed: number, weekUsed: number, fetchedAt = Date.now()): string {
  const dir = mkdtempSync(join(tmpdir(), 'q-'));
  const p = join(dir, 'usage-cache.json');
  writeFileSync(p, JSON.stringify({ fetchedAt, data: {
    five_hour: { utilization: fiveUsed, resets_at: '2026-09-20T23:30:00.000Z' },
    seven_day: { utilization: weekUsed, resets_at: '2026-09-24T20:00:00.000Z' } } }));
  return p;
}

test('the window that runs out first is the one that decides', () => {
  const q = readQuota(cacheWith(72, 9));
  assert.equal(q.fiveHour, 28);
  assert.equal(q.sevenDay, 91);
  assert.equal(q.remaining, 28, 'plenty of weekly left does not matter when the session is nearly spent');
});

test('the gears fall where the thresholds say', () => {
  assert.equal(gearFor(readQuota(cacheWith(10, 5))), 'plenty');   // 90 left
  assert.equal(gearFor(readQuota(cacheWith(50, 5))), 'normal');   // 50 left
  assert.equal(gearFor(readQuota(cacheWith(72, 9))), 'saver');    // 28 left
  assert.equal(gearFor(readQuota(cacheWith(70, 5))), 'saver', '30 left is at the line, so it saves');
  assert.equal(gearFor(readQuota(cacheWith(30, 5))), 'plenty', '70 left is at the line, so it splurges');
});

test('saver sends the work away instead of spending the rest', () => {
  assert.deepEqual(planFor('saver'), { worker: 'codex' });
  assert.deepEqual(planFor('plenty'), { worker: 'claude', model: 'fable' });
  assert.deepEqual(planFor('normal'), { worker: 'claude', model: 'sonnet' });
});

test('the thresholds and the models are all settable', () => {
  const mine = { bestAbove: 90, saverBelow: 50, bestModel: 'opus', normalModel: 'haiku' };
  assert.equal(gearFor(readQuota(cacheWith(20, 5)), mine), 'normal', '80 left is no longer plenty at 90');
  assert.equal(gearFor(readQuota(cacheWith(55, 5)), mine), 'saver', '45 left is already saving at 50');
  assert.deepEqual(planFor('plenty', mine), { worker: 'claude', model: 'opus' });
});

test('an unreadable or missing cache does not pick a gear', () => {
  const q = readQuota(join(tmpdir(), 'definitely-not-here.json'));
  assert.match(q.error ?? '', /no usage cache/);
  assert.equal(gearFor(q), 'unknown');
  assert.match(describeQuota(q), /usage unknown/);
});

test('a stale figure is said to be stale rather than trusted quietly', () => {
  const old = readQuota(cacheWith(72, 9, Date.now() - 90 * 60000));
  assert.match(describeQuota(old), /90 min old/);
  const fresh = readQuota(cacheWith(72, 9));
  assert.ok(!/min old/.test(describeQuota(fresh)));
  assert.match(describeQuota(fresh, DEFAULT_THRESHOLDS), /Gear: saver → codex/);
});
