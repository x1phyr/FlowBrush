import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FlowField,
  History,
  Stroke,
  DEFAULT_BRUSH,
  applyStroke,
  encodeRGBA,
  validateBrush,
} from '../lib/flow/core.ts';
const near = (a: number, b: number, eps = 1e-6) =>
  assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);
void test('four axes, diagonal direction and speed clamp', () => {
  for (const angle of [0, 90, 180, 270, 45]) {
    const f = new FlowField(33, 33),
      h = new History();
    applyStroke(
      f,
      h,
      { ...DEFAULT_BRUSH, mode: 'fixed', angle, strength: 1, speed: 1 },
      [{ x: 16, y: 16 }],
    );
    near(f.data[(16 * 33 + 16) * 2], Math.cos((angle * Math.PI) / 180));
    near(f.data[(16 * 33 + 16) * 2 + 1], Math.sin((angle * Math.PI) / 180));
    for (let i = 0; i < f.data.length; i += 2)
      assert.ok(Math.hypot(f.data[i], f.data[i + 1]) <= 1.000001);
  }
});
void test('follow click is a no-op and fast sparse strokes have no holes', () => {
  const f = new FlowField(256, 64),
    h = new History();
  assert.equal(applyStroke(f, h, DEFAULT_BRUSH, [{ x: 16, y: 32 }]), false);
  assert.equal(h.past.length, 0);
  applyStroke(f, h, { ...DEFAULT_BRUSH, radius: 8, speed: 0.7, strength: 1 }, [
    { x: 16, y: 32 },
    { x: 240, y: 32 },
  ]);
  for (let x = 16; x < 238; x++) {
    assert.ok(f.data[(32 * 256 + x) * 2] > 0.6);
    near(f.data[(32 * 256 + x) * 2 + 1], 0);
  }
});
void test('arc-length sampling is invariant to event batching along straight paths', () => {
  const a = new FlowField(128, 64),
    b = new FlowField(128, 64);
  const brush = { ...DEFAULT_BRUSH, radius: 12 };
  applyStroke(a, new History(), brush, [
    { x: 10, y: 32 },
    { x: 110, y: 32 },
  ]);
  applyStroke(
    b,
    new History(),
    brush,
    Array.from({ length: 101 }, (_, i) => ({ x: 10 + i, y: 32 })),
  );
  for (let i = 0; i < a.data.length; i++) near(a.data[i], b.data[i], 1e-6);
});
void test('soft edges and strength blend; eraser zeroes center, undo/redo exact', () => {
  const f = new FlowField(33, 33),
    h = new History(),
    i = (16 * 33 + 16) * 2;
  applyStroke(
    f,
    h,
    {
      ...DEFAULT_BRUSH,
      mode: 'fixed',
      angle: 0,
      radius: 8,
      speed: 0.8,
      strength: 0.5,
    },
    [{ x: 16, y: 16 }],
  );
  near(f.data[i], 0.4);
  assert.ok(f.data[i + 8] < 0.4 && f.data[i + 8] > 0);
  near(f.data[i + 16], 0);
  const before = f.data.slice();
  applyStroke(
    f,
    h,
    { ...DEFAULT_BRUSH, tool: 'erase', radius: 8, strength: 1 },
    [{ x: 16, y: 16 }],
  );
  near(f.data[i], 0);
  h.undo(f);
  assert.deepEqual(f.data, before);
  h.redo(f);
  near(f.data[i], 0);
});
void test('smoothing uses a snapshot, is symmetric, does not normalize', () => {
  const f = new FlowField(33, 33),
    h = new History();
  f.data[(16 * 33 + 16) * 2] = 0.8;
  applyStroke(
    f,
    h,
    { ...DEFAULT_BRUSH, tool: 'smooth', radius: 8, strength: 1 },
    [{ x: 16, y: 16 }],
  );
  near(f.data[(16 * 33 + 16) * 2], 0.2);
  near(f.data[(16 * 33 + 15) * 2], f.data[(16 * 33 + 17) * 2]);
  near(f.data[(15 * 33 + 16) * 2], f.data[(17 * 33 + 16) * 2]);
  assert.ok(f.data[(16 * 33 + 17) * 2] > 0);
});
void test('cancel restores touched tiles and edge strokes stay inside field', () => {
  const f = new FlowField(31, 37),
    h = new History();
  const s = new Stroke(
    f,
    h,
    { ...DEFAULT_BRUSH, mode: 'fixed' },
    { x: 0, y: 0 },
  );
  s.move({ x: 40, y: 40 });
  s.cancel();
  assert.ok(f.data.every((v) => v === 0));
  assert.equal(h.past.length, 0);
});
void test('clear is undoable and history cap discards oldest entries', () => {
  const f = new FlowField(64, 64),
    h = new History(16384);
  applyStroke(f, h, { ...DEFAULT_BRUSH, mode: 'fixed', radius: 2 }, [
    { x: 8, y: 8 },
  ]);
  applyStroke(f, h, { ...DEFAULT_BRUSH, mode: 'fixed', radius: 2 }, [
    { x: 45, y: 45 },
  ]);
  assert.equal(h.past.length, 1);
  assert.ok(h.bytes <= h.limit);
  const full = new History();
  const before = f.data.slice();
  full.clearField(f);
  assert.ok(f.data.every((v) => v === 0));
  full.undo(f);
  assert.deepEqual(f.data, before);
  full.redo(f);
  assert.ok(f.data.every((v) => v === 0));
});
void test('diverging after undo releases redo history', () => {
  const f = new FlowField(32, 32),
    h = new History();
  applyStroke(f, h, { ...DEFAULT_BRUSH, mode: 'fixed' }, [{ x: 8, y: 8 }]);
  h.undo(f);
  applyStroke(f, h, { ...DEFAULT_BRUSH, mode: 'fixed', angle: 90 }, [
    { x: 8, y: 8 },
  ]);
  assert.equal(h.future.length, 0);
  assert.equal(h.bytes, h.past[0].bytes);
});
void test('RG encoding neutral, axes and Y-flip leave row order unchanged', () => {
  const f = new FlowField(2, 2, new Float32Array([0, 0, 1, 0, 0, 1, -1, 0]));
  assert.deepEqual(
    [...encodeRGBA(f)],
    [128, 128, 0, 255, 255, 128, 0, 255, 128, 255, 0, 255, 0, 128, 0, 255],
  );
  assert.deepEqual(
    [...encodeRGBA(f, true)],
    [128, 128, 0, 255, 255, 128, 0, 255, 128, 0, 0, 255, 0, 128, 0, 255],
  );
});
void test('invalid sizes and nonfinite brush parameters fail', () => {
  for (const size of [0, -1, 2049, NaN, 1.5])
    assert.throws(() => new FlowField(size, 64));
  assert.throws(() => validateBrush({ ...DEFAULT_BRUSH, radius: Infinity }));
  assert.throws(() => validateBrush({ ...DEFAULT_BRUSH, speed: 2 }));
});
