import test from 'node:test';
import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import { FlowField, DEFAULT_BRUSH, encodeRGBA } from '../lib/flow/core.ts';
import {
  serializeProject,
  parseProject,
  encodePNG,
  DEFAULT_VIEW,
} from '../lib/flow/files.ts';
const project = () => ({
  field: new FlowField(
    3,
    2,
    new Float32Array([
      0.12345678, -0.333333, 0, 0, 1, 0, 0, 1, -1, 0, 0.3, 0.4,
    ]),
  ),
  brush: { ...DEFAULT_BRUSH },
  view: { ...DEFAULT_VIEW, zoom: 2, panX: 23, panY: -45 },
  background: null,
  name: '河流测试',
  flipY: true,
});
void test('project roundtrip preserves exact Float32 bits and all settings', () => {
  const p = project(),
    restored = parseProject(serializeProject(p));
  assert.deepEqual(restored.field.data, p.field.data);
  assert.deepEqual(restored.brush, p.brush);
  assert.deepEqual(restored.view, p.view);
  assert.equal(restored.flipY, true);
  assert.equal(restored.name, p.name);
  const file = JSON.parse(serializeProject(p)),
    bytes = Buffer.from(file.vectors, 'base64');
  assert.equal(bytes.readFloatLE(0), p.field.data[0]);
});
void test('unknown versions, corrupt data, invalid vectors and settings reject', () => {
  const base = JSON.parse(serializeProject(project()));
  for (const change of [
    { version: 2 },
    { byteOrder: 'big-endian' },
    { width: 2049 },
    { vectors: 'aaa' },
    { view: { ...base.view, zoom: Infinity } },
    { brush: { ...base.brush, strength: 2 } },
    { background: 'javascript:alert(1)' },
    { name: 123 },
  ])
    assert.throws(() => parseProject(JSON.stringify({ ...base, ...change })));
  const b = Buffer.from(base.vectors, 'base64');
  b.writeFloatLE(NaN, 0);
  assert.throws(() =>
    parseProject(JSON.stringify({ ...base, vectors: b.toString('base64') })),
  );
  b.writeFloatLE(2, 0);
  assert.throws(() =>
    parseProject(JSON.stringify({ ...base, vectors: b.toString('base64') })),
  );
});
function inspectPNG(bytes: Uint8Array) {
  const b = Buffer.from(bytes);
  assert.deepEqual([...b.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  let pos = 8;
  let width = 0,
    height = 0;
  const idats: Buffer[] = [];
  while (pos < b.length) {
    const len = b.readUInt32BE(pos),
      name = b.toString('ascii', pos + 4, pos + 8),
      data = b.subarray(pos + 8, pos + 8 + len);
    let crc = 0xffffffff;
    for (const byte of b.subarray(pos + 4, pos + 8 + len)) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++)
        crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
    assert.equal((crc ^ 0xffffffff) >>> 0, b.readUInt32BE(pos + 8 + len));
    if (name === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      assert.deepEqual([...data.subarray(8)], [8, 6, 0, 0, 0]);
    } else if (name === 'IDAT') idats.push(data);
    else assert.equal(name, 'IEND');
    pos += len + 12;
  }
  return { width, height, raw: inflateSync(Buffer.concat(idats)) };
}
void test('PNG CRCs, dimensions, RGBA bytes and rows decode correctly', () => {
  const f = project().field;
  for (const flip of [false, true]) {
    const png = inspectPNG(encodePNG(f, flip));
    assert.equal(png.width, 3);
    assert.equal(png.height, 2);
    const rgba = encodeRGBA(f, flip);
    for (let y = 0; y < 2; y++) {
      assert.equal(png.raw[y * 13], 0);
      assert.deepEqual(
        [...png.raw.subarray(y * 13 + 1, y * 13 + 13)],
        [...rgba.subarray(y * 12, (y + 1) * 12)],
      );
    }
  }
});
void test('PNG supports multi-block DEFLATE and 2048 texture export', () => {
  const f = new FlowField(2048, 2048);
  f.data[(2048 * 2048 - 1) * 2] = 1;
  const png = inspectPNG(encodePNG(f));
  assert.equal(png.width, 2048);
  assert.equal(png.height, 2048);
  assert.deepEqual([...png.raw.subarray(-4)], [255, 128, 0, 255]);
});
void test('RG decode error is bounded by half a quantization step per channel', () => {
  const f = new FlowField(100, 1);
  for (let i = 0; i < 100; i++) {
    f.data[i * 2] = Math.cos(i) * 0.8;
    f.data[i * 2 + 1] = Math.sin(i) * 0.8;
  }
  const rgba = encodeRGBA(f);
  for (let i = 0; i < 100; i++) {
    assert.ok(
      Math.abs((rgba[i * 4] / 255) * 2 - 1 - f.data[i * 2]) <= 1 / 255 + 1e-7,
    );
    assert.ok(
      Math.abs((rgba[i * 4 + 1] / 255) * 2 - 1 - f.data[i * 2 + 1]) <=
        1 / 255 + 1e-7,
    );
  }
});
