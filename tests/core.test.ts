import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Calibration, condition, observe, unknown, hull, inside } from '../src/video-analysis/vision.ts';
import type { Point } from '../src/video-analysis/vision.ts';
import { TestSession, swipe, SIZES } from '../src/session.ts';

function face(): Point[] {
  const points = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5 }));
  for (const [a, b, top, bottom, iris, x] of [[33, 133, 159, 145, 468, 0.35], [362, 263, 386, 374, 473, 0.65]]) {
    points[a] = { x: x - 0.05, y: 0.4 }; points[b] = { x: x + 0.05, y: 0.4 };
    points[top] = { x, y: 0.39 }; points[bottom] = { x, y: 0.41 }; points[iris] = { x, y: 0.4 };
  }
  points[10] = { x: 0.5, y: 0.2 }; points[152] = { x: 0.5, y: 0.8 }; points[1] = { x: 0.5, y: 0.5 };
  return points;
}
function hand(x: number): Point[] {
  return Array.from({ length: 21 }, (_, i) => ({ x: x + (i % 2 ? 0.07 : -0.07), y: i % 4 < 2 ? 0.3 : 0.5 }));
}

test('anatomical sides, covering, gaze, unknown and stale observations', () => {
  const f = face(); const baseline = observe([f], [], 0, null).signals!;
  const o = observe([f], [hand(0.65)], 100, baseline);
  assert.deepEqual(o.covered, { left: true, right: false });
  assert.equal(condition(o, 'right', 110), null);
  assert.match(condition(o, 'left', 110)!, /правый/);
  assert.match(condition(o, 'right', 900)!, /свежие/);
  assert.equal(observe([f], [hand(0.35)], 100, baseline).covered.right, true);
  assert.equal(observe([], [hand(0.65)], 100, baseline).covered.left, null);
  assert.equal(observe([f, f], [], 100, baseline).valid, false);
  f[468] = { x: 0.4, y: 0.4 };
  assert.equal(observe([f], [hand(0.65)], 100, baseline).gaze, false);
  f[468] = { x: 0.35, y: 0.4 }; f[159].y = 0.4; f[145].y = 0.4;
  assert.match(condition(observe([f], [hand(0.65)], 100, baseline), 'right', 100)!, /Откройте/);
  assert.equal(inside({ x: 0.5, y: 0.5 }, hull([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }])), true);
  assert.equal(inside({ x: 0, y: 0 }, []), false);
});

test('calibration needs consecutive fresh frames and both covering checks', () => {
  const c = new Calibration(), f = face();
  for (let t = 0; t <= 1000; t += 100) c.update(observe([f], [], t, c.baseline), t);
  c.update(unknown(1100), 1100);
  assert.equal(c.progress, 0);
  for (let t = 1200; t <= 3200; t += 100) c.update(observe([f], [], t, c.baseline), t);
  assert.equal(c.step, 'left'); assert.ok(c.baseline);
  for (let t = 3300; t <= 4300; t += 100) c.update(observe([f], [hand(0.65)], t, c.baseline), t);
  assert.equal(c.step, 'right');
  for (let t = 4400; t <= 5400; t += 100) c.update(observe([f], [hand(0.35)], t, c.baseline), t);
  assert.equal(c.step, 'done');
  c.reset(); assert.equal(c.baseline, null); assert.equal(c.step, 'center');
});

test('swipes reject taps and diagonals and use direction of E prongs', () => {
  assert.equal(swipe(50, 3), 'right'); assert.equal(swipe(-50, 0), 'left');
  assert.equal(swipe(2, -60), 'up'); assert.equal(swipe(0, 60), 'down');
  assert.equal(swipe(12, 0), null); assert.equal(swipe(50, 50), null); assert.equal(swipe(NaN, 0), null);
});

test('pauses debounce, resume replaces E without scoring, stale/rotation suspend immediately', () => {
  const s = new TestSession(() => 0);
  s.update(true, 0); s.update(true, 600);
  const previous = s.direction, token = s.token;
  s.update(false, 1000); s.update(false, 1499); assert.equal(s.paused, false);
  s.update(false, 1500); assert.equal(s.paused, true);
  assert.equal(s.answer(previous, token, 2000), false);
  s.update(true, 2000); s.update(true, 2600);
  assert.notEqual(s.direction, previous); assert.equal(s.index, 0); assert.equal(s.size, 120);
  assert.equal(s.answer(previous, token, 3000), false);
  s.update(true, 3000, true); assert.equal(s.paused, true);
});

test('rotation suspension preserves accepted answers and rejects the unfinished swipe', () => {
  const s = new TestSession(() => 0.5);
  s.update(true, 0); s.update(true, 600);
  assert.equal(s.answer(s.direction, s.token, 800), true);
  const token = s.token;
  s.suspend();
  assert.equal(s.index, 1);
  assert.deepEqual(s.answers, { right: [true], left: [] });
  assert.equal(s.answer(s.direction, token, 1200), false);
  s.update(true, 2000); s.update(true, 2600);
  assert.equal(s.answer(s.direction, token, 2800), false);
  assert.equal(s.index, 1);
  assert.equal(s.answer(s.direction, s.token, 2800), true);
});

test('ten answers, duplicate protection, identical sizes, skip, and final result', () => {
  const s = new TestSession(() => 0.5); let now = 0;
  for (const eye of ['right', 'left'] as const) {
    s.update(true, now); now += 600; s.update(true, now); now += 200;
    assert.equal(s.eye, eye);
    for (let i = 0; i < 5; i++) {
      assert.equal(s.size, SIZES[i]); const token = s.token;
      assert.equal(s.answer(i === 4 ? null : s.direction, token, now), true);
      assert.equal(s.answer(s.direction, token, now), false);
      now += 400;
    }
  }
  assert.equal(s.done, true);
  assert.equal(s.answers.left.filter(Boolean).length, 4);
  assert.equal(s.answers.right.filter(Boolean).length, 4);
  assert.equal(s.answer('right', s.token, now), false);
});
