import { cpus, totalmem, platform, release } from 'node:os';
import { performance } from 'node:perf_hooks';
import {
  FlowField,
  History,
  Stroke,
  DEFAULT_BRUSH,
  encodeRGBA,
} from '../lib/flow/core.ts';
import {
  encodePNG,
  serializeProject,
  parseProject,
  DEFAULT_VIEW,
} from '../lib/flow/files.ts';
console.log(
  JSON.stringify({
    cpu: cpus()[0].model,
    cores: cpus().length,
    memoryGiB: totalmem() / 2 ** 30,
    platform: platform(),
    release: release(),
    node: process.version,
  }),
);
for (const n of [1024, 2048]) {
  const f = new FlowField(n, n),
    h = new History(),
    b = { ...DEFAULT_BRUSH, radius: 64 };
  const start = performance.now(),
    s = new Stroke(f, h, b, { x: 100, y: 100 }),
    times: number[] = [];
  for (let i = 1; i <= 120; i++) {
    const t = performance.now();
    s.move({
      x: 100 + ((n - 200) * i) / 120,
      y: n / 2 + (Math.sin(i / 20) * n) / 4,
    });
    if (f.dirty) encodeRGBA(f, false, f.dirty);
    f.dirty = null;
    times.push(performance.now() - t);
  }
  s.finish();
  const exportStart = performance.now(),
    png = encodePNG(f),
    exportMs = performance.now() - exportStart,
    saveStart = performance.now();
  const text = serializeProject({
    field: f,
    name: 'benchmark',
    brush: b,
    view: DEFAULT_VIEW,
    background: null,
    flipY: false,
  });
  parseProject(text);
  times.sort((a, b) => a - b);
  console.log(
    JSON.stringify({
      size: n,
      strokeMs: exportStart - start,
      editAndEncodeP95Ms: times[Math.floor(times.length * 0.95)],
      pngMs: exportMs,
      pngMiB: png.length / 2 ** 20,
      saveAndReopenMs: performance.now() - saveStart,
      historyMiB: h.bytes / 2 ** 20,
    }),
  );
}
