import test from 'node:test';
import assert from 'node:assert/strict';
import { screenToField, zoomAt } from '../lib/flow/coordinates.ts';
void test('screen to texel stays accurate across zoom, pan and non-square fields', () => {
  const field = { width: 1024, height: 512 },
    size = { w: 900, h: 720 };
  for (const zoom of [0.05, 0.5, 1, 2, 16]) {
    const view = { zoom, panX: 47, panY: -81 },
      texel = { x: 317.25, y: 121.5 };
    const screen = {
      x: (size.w - field.width * zoom) / 2 + view.panX + texel.x * zoom,
      y: (size.h - field.height * zoom) / 2 + view.panY + texel.y * zoom,
    };
    const actual = screenToField(screen, field, size, view);
    assert.ok(Math.abs(actual.x - texel.x) < 1e-9);
    assert.ok(Math.abs(actual.y - texel.y) < 1e-9);
  }
});
void test('zoom anchors the texel under the pointer, independent of device pixel ratio', () => {
  const size = { w: 900, h: 720 },
    field = { width: 1024, height: 512 },
    view = { zoom: 0.7, panX: 65, panY: -30 },
    pointer = { x: 332, y: 481 };
  const before = screenToField(pointer, field, size, view);
  for (const zoom of [0.05, 1, 3, 16]) {
    const next = zoomAt(pointer, size, view, zoom),
      after = screenToField(pointer, field, size, next);
    assert.ok(Math.abs(before.x - after.x) < 1e-9);
    assert.ok(Math.abs(before.y - after.y) < 1e-9);
  }
});
