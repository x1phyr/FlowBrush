import test from 'node:test';
import assert from 'node:assert/strict';
import { StrokePath } from '../lib/flow/stroke-path.ts';
import {
  FlowField,
  History,
  DEFAULT_BRUSH,
  applyStroke,
  type Point,
} from '../lib/flow/core.ts';
type Dab = { point: Point; direction: Point };
const sample = (points: Point[], spacing = 4, window = 12) => {
  const dabs: Dab[] = [];
  const path = new StrokePath(points[0], spacing, window, (point, direction) =>
    dabs.push({ point, direction }),
  );
  for (const p of points.slice(1)) path.move(p);
  path.finish();
  return dabs;
};
const angle = (d: Dab) => Math.atan2(d.direction.y, d.direction.x);
const spread = (a: number[]) =>
  Math.sqrt(a.reduce((sum, v) => sum + v * v, 0) / a.length);
void test('pixel staircase at 22 degrees produces continuous tangents instead of axial snapping', () => {
  const slope = Math.tan((22 * Math.PI) / 180),
    points = Array.from({ length: 181 }, (_, x) => ({
      x,
      y: Math.round(x * slope),
    }));
  const raw = points
    .slice(1)
    .map((p, i) => Math.atan2(p.y - points[i].y, 1) - Math.atan(slope));
  const filtered = sample(points)
    .filter((d) => d.point.x > 15 && d.point.x < 165)
    .map((d) => angle(d) - Math.atan(slope));
  assert.ok(spread(filtered) < spread(raw) * 0.1);
  for (const value of filtered)
    assert.ok(Math.abs(value) < (2 * Math.PI) / 180);
});
void test('right-angle corner transitions through intermediate angles without speed loss', () => {
  const dabs = sample(
    [
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 40, y: 40 },
    ],
    2,
    12,
  );
  const angles = dabs.map(angle);
  assert.ok(angles.filter((a) => a > 0.1 && a < 1.4).length >= 8);
  for (let i = 1; i < angles.length; i++)
    assert.ok(Math.abs(angles[i] - angles[i - 1]) < (15 * Math.PI) / 180);
  for (const d of dabs)
    assert.ok(Math.abs(Math.hypot(d.direction.x, d.direction.y) - 1) < 1e-12);
});
void test('sampled circle follows its tangent continuously including angle wraparound', () => {
  const points = Array.from({ length: 361 }, (_, i) => {
    const a = (i * Math.PI) / 180;
    return { x: 160 + 100 * Math.cos(a), y: 160 + 100 * Math.sin(a) };
  });
  const dabs = sample(points, 3, 10);
  for (const d of dabs.slice(5, -5)) {
    const a = Math.atan2(d.point.y - 160, d.point.x - 160),
      expected = { x: -Math.sin(a), y: Math.cos(a) };
    assert.ok(
      d.direction.x * expected.x + d.direction.y * expected.y >
        Math.cos((2 * Math.PI) / 180),
    );
  }
});
void test('corner output is independent of pointer event subdivision', () => {
  const sparse = [
    { x: 0, y: 0 },
    { x: 40, y: 0 },
    { x: 40, y: 40 },
  ];
  const dense = [
    ...Array.from({ length: 41 }, (_, x) => ({ x, y: 0 })),
    ...Array.from({ length: 40 }, (_, i) => ({ x: 40, y: i + 1 })),
  ];
  const a = sample(sparse),
    b = sample(dense);
  assert.equal(a.length, b.length);
  for (let i = 0; i < a.length; i++) assert.deepEqual(a[i], b[i]);
});
void test('short strokes and endpoint flush once; click and cancelled tail never paint', () => {
  assert.equal(sample([{ x: 0, y: 0 }]).length, 0);
  const dabs: Dab[] = [];
  const p = new StrokePath({ x: 0, y: 0 }, 4, 12, (point, direction) =>
    dabs.push({ point, direction }),
  );
  p.move({ x: 1, y: 0.25 });
  assert.equal(dabs.length, 0);
  p.finish();
  assert.equal(dabs.length, 2);
  assert.deepEqual(dabs[1].point, {
    x: 1,
    y: 0.25,
    distance: Math.hypot(1, 0.25),
  });
  p.finish();
  assert.equal(dabs.length, 2);
  const cancelled = new StrokePath({ x: 0, y: 0 }, 4, 12, () =>
    assert.fail('cancelled tail painted'),
  );
  cancelled.move({ x: 3, y: 0 });
  cancelled.cancel();
  cancelled.finish();
});
void test('sharp reversals remain finite and follow the return direction', () => {
  const dabs = sample(
    [
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 0, y: 0 },
    ],
    2,
    12,
  );
  for (const d of dabs)
    assert.ok(Number.isFinite(d.direction.x) && Number.isFinite(d.direction.y));
  assert.ok(dabs[dabs.length - 1].direction.x < -0.99);
});
void test('arbitrary follow angle and buffered end preserve history and exported vector precision', () => {
  const f = new FlowField(100, 80),
    h = new History();
  applyStroke(f, h, { ...DEFAULT_BRUSH, radius: 8, speed: 0.8, strength: 1 }, [
    { x: 15, y: 15 },
    { x: 75, y: 40 },
  ]);
  const i = (40 * 100 + 75) * 2;
  assert.ok(f.data[i] > 0.6 && f.data[i + 1] > 0.2);
  const before = f.data.slice();
  assert.equal(h.past.length, 1);
  h.undo(f);
  assert.ok(f.data.every((v) => v === 0));
  h.redo(f);
  assert.deepEqual(f.data, before);
});
