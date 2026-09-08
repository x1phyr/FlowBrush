import { StrokePath } from './stroke-path.ts';

export type Tool = 'brush' | 'smooth' | 'erase';
export type Brush = {
  tool: Tool;
  radius: number;
  speed: number;
  strength: number;
  mode: 'follow' | 'fixed';
  angle: number;
};
export type Point = { x: number; y: number };
export type Rect = { x: number; y: number; w: number; h: number };
export const DEFAULT_BRUSH: Brush = {
  tool: 'brush',
  radius: 32,
  speed: 0.65,
  strength: 0.35,
  mode: 'follow',
  angle: 0,
};
const TILE = 32;
export function validSize(w: number, h: number) {
  return (
    Number.isInteger(w) &&
    Number.isInteger(h) &&
    w >= 1 &&
    h >= 1 &&
    w <= 2048 &&
    h <= 2048
  );
}
export function validateBrush(b: Brush) {
  if (
    !b ||
    !['brush', 'smooth', 'erase'].includes(b.tool) ||
    !['follow', 'fixed'].includes(b.mode) ||
    !Number.isFinite(b.radius) ||
    b.radius < 1 ||
    b.radius > 256 ||
    !Number.isFinite(b.speed) ||
    b.speed < 0 ||
    b.speed > 1 ||
    !Number.isFinite(b.strength) ||
    b.strength < 0 ||
    b.strength > 1 ||
    !Number.isFinite(b.angle) ||
    b.angle < 0 ||
    b.angle > 360
  )
    throw new Error('笔刷参数无效');
}
type TilePatch = { rect: Rect; before: Float32Array; after: Float32Array };
type Edit = { patches: TilePatch[]; bytes: number };
export class FlowField {
  readonly width: number;
  readonly height: number;
  readonly data: Float32Array;
  revision = 0;
  dirty: Rect | null;
  constructor(w = 512, h = 512, data?: Float32Array) {
    if (!validSize(w, h) || (data && data.length !== w * h * 2))
      throw new Error('画布尺寸或向量数据无效');
    this.width = w;
    this.height = h;
    this.data = data ?? new Float32Array(w * h * 2);
    this.dirty = { x: 0, y: 0, w, h };
  }
  touch(r: Rect) {
    this.revision++;
    const d = this.dirty;
    if (!d) this.dirty = { ...r };
    else {
      const x = Math.min(d.x, r.x),
        y = Math.min(d.y, r.y);
      this.dirty = {
        x,
        y,
        w: Math.max(d.x + d.w, r.x + r.w) - x,
        h: Math.max(d.y + d.h, r.y + r.h) - y,
      };
    }
  }
  region(r: Rect) {
    const out = new Float32Array(r.w * r.h * 2);
    for (let y = 0; y < r.h; y++)
      out.set(
        this.data.subarray(
          ((r.y + y) * this.width + r.x) * 2,
          ((r.y + y) * this.width + r.x + r.w) * 2,
        ),
        y * r.w * 2,
      );
    return out;
  }
  restore(r: Rect, values: Float32Array) {
    for (let y = 0; y < r.h; y++)
      this.data.set(
        values.subarray(y * r.w * 2, (y + 1) * r.w * 2),
        ((r.y + y) * this.width + r.x) * 2,
      );
    this.touch(r);
  }
}
export class History {
  past: Edit[] = [];
  future: Edit[] = [];
  bytes = 0;
  constructor(public limit = 128 * 1024 * 1024) {}
  push(patches: TilePatch[]) {
    patches = patches.filter((p) => p.before.some((v, i) => v !== p.after[i]));
    if (!patches.length) return false;
    for (const e of this.future) this.bytes -= e.bytes;
    this.future = [];
    const edit = {
      patches,
      bytes: patches.reduce(
        (n, p) => n + p.before.byteLength + p.after.byteLength,
        0,
      ),
    };
    this.past.push(edit);
    this.bytes += edit.bytes;
    while (this.bytes > this.limit && this.past.length)
      this.bytes -= this.past.shift()!.bytes;
    return true;
  }
  undo(f: FlowField) {
    const e = this.past.pop();
    if (!e) return false;
    for (const p of e.patches) f.restore(p.rect, p.before);
    this.future.push(e);
    return true;
  }
  redo(f: FlowField) {
    const e = this.future.pop();
    if (!e) return false;
    for (const p of e.patches) f.restore(p.rect, p.after);
    this.past.push(e);
    return true;
  }
  clearField(f: FlowField) {
    const patches: TilePatch[] = [];
    for (let y = 0; y < f.height; y += TILE)
      for (let x = 0; x < f.width; x += TILE) {
        const rect = {
          x,
          y,
          w: Math.min(TILE, f.width - x),
          h: Math.min(TILE, f.height - y),
        };
        const before = f.region(rect);
        if (before.some((v) => v !== 0))
          patches.push({
            rect,
            before,
            after: new Float32Array(before.length),
          });
      }
    if (!this.push(patches)) return false;
    f.data.fill(0);
    f.touch({ x: 0, y: 0, w: f.width, h: f.height });
    return true;
  }
}
export class Stroke {
  private tiles = new Map<number, { rect: Rect; before: Float32Array }>();
  private last: Point;
  private started = false;
  private remaining = 0;
  private path: StrokePath | null = null;
  constructor(
    private f: FlowField,
    private history: History,
    public brush: Brush,
    point: Point,
  ) {
    validateBrush(brush);
    this.brush = { ...brush };
    this.last = { ...point };
    if (brush.tool === 'brush' && brush.mode === 'follow') {
      this.path = new StrokePath(
        point,
        Math.max(1, brush.radius * 0.18),
        Math.max(2, Math.min(24, brush.radius * 0.4)),
        (p, direction) => this.dab(p, direction.x, direction.y),
      );
    } else {
      this.dab(
        point,
        Math.cos((brush.angle * Math.PI) / 180),
        Math.sin((brush.angle * Math.PI) / 180),
      );
      this.started = true;
    }
  }
  private capture(r: Rect) {
    for (let y = Math.floor(r.y / TILE) * TILE; y < r.y + r.h; y += TILE)
      for (let x = Math.floor(r.x / TILE) * TILE; x < r.x + r.w; x += TILE) {
        const key = y * this.f.width + x;
        if (!this.tiles.has(key)) {
          const rect = {
            x,
            y,
            w: Math.min(TILE, this.f.width - x),
            h: Math.min(TILE, this.f.height - y),
          };
          this.tiles.set(key, { rect, before: this.f.region(rect) });
        }
      }
  }
  private dab(p: Point, dx: number, dy: number) {
    const f = this.f,
      b = this.brush,
      r = b.radius;
    const x0 = Math.max(0, Math.ceil(p.x - r)),
      y0 = Math.max(0, Math.ceil(p.y - r)),
      x1 = Math.min(f.width - 1, Math.floor(p.x + r)),
      y1 = Math.min(f.height - 1, Math.floor(p.y + r));
    if (x1 < x0 || y1 < y0) return;
    const rect = { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
    this.capture(rect);
    const sr = { x: Math.max(0, x0 - 1), y: Math.max(0, y0 - 1), w: 0, h: 0 };
    sr.w = Math.min(f.width - 1, x1 + 1) - sr.x + 1;
    sr.h = Math.min(f.height - 1, y1 + 1) - sr.y + 1;
    const snapshot = b.tool === 'smooth' ? f.region(sr) : null;
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const d = Math.hypot(x - p.x, y - p.y) / r;
        if (d >= 1) continue;
        const edge = 1 - d,
          weight = b.strength * edge * edge * (3 - 2 * edge),
          i = (y * f.width + x) * 2;
        let tx = dx * b.speed,
          ty = dy * b.speed;
        if (b.tool === 'erase') {
          tx = 0;
          ty = 0;
        }
        if (snapshot) {
          tx = 0;
          ty = 0;
          let total = 0;
          for (let oy = -1; oy <= 1; oy++)
            for (let ox = -1; ox <= 1; ox++) {
              const sx = Math.max(0, Math.min(f.width - 1, x + ox)),
                sy = Math.max(0, Math.min(f.height - 1, y + oy));
              const k = ((sy - sr.y) * sr.w + sx - sr.x) * 2;
              const w = (ox === 0 ? 2 : 1) * (oy === 0 ? 2 : 1);
              tx += snapshot[k] * w;
              ty += snapshot[k + 1] * w;
              total += w;
            }
          tx /= total;
          ty /= total;
        }
        let vx = f.data[i] + (tx - f.data[i]) * weight,
          vy = f.data[i + 1] + (ty - f.data[i + 1]) * weight;
        const len = Math.hypot(vx, vy);
        if (len > 1) {
          vx /= len;
          vy /= len;
        }
        f.data[i] = vx;
        f.data[i + 1] = vy;
      }
    f.touch(rect);
  }
  move(p: Point) {
    if (this.path) {
      this.path.move(p);
      return;
    }
    const dx = p.x - this.last.x,
      dy = p.y - this.last.y,
      len = Math.hypot(dx, dy);
    if (len < 0.0001) return;
    const ux =
        this.brush.mode === 'fixed'
          ? Math.cos((this.brush.angle * Math.PI) / 180)
          : dx / len,
      uy =
        this.brush.mode === 'fixed'
          ? Math.sin((this.brush.angle * Math.PI) / 180)
          : dy / len;
    if (!this.started) {
      this.dab(this.last, ux, uy);
      this.started = true;
    }
    const spacing = Math.max(1, this.brush.radius * 0.18);
    let distance = spacing - this.remaining;
    for (; distance <= len; distance += spacing)
      this.dab(
        {
          x: this.last.x + (dx * distance) / len,
          y: this.last.y + (dy * distance) / len,
        },
        ux,
        uy,
      );
    this.remaining = (this.remaining + len) % spacing;
    this.last = { ...p };
  }
  finish() {
    this.path?.finish();
    const patches = [...this.tiles.values()].map((p) => ({
      ...p,
      after: this.f.region(p.rect),
    }));
    this.tiles.clear();
    return this.history.push(patches);
  }
  cancel() {
    this.path?.cancel();
    for (const p of this.tiles.values()) this.f.restore(p.rect, p.before);
    this.tiles.clear();
  }
}
export function encodeRGBA(
  f: FlowField,
  flipY = false,
  rect: Rect = { x: 0, y: 0, w: f.width, h: f.height },
) {
  const bytes = new Uint8Array(rect.w * rect.h * 4);
  for (let y = 0; y < rect.h; y++)
    for (let x = 0; x < rect.w; x++) {
      const s = ((y + rect.y) * f.width + x + rect.x) * 2,
        i = (y * rect.w + x) * 4;
      bytes[i] = Math.round((f.data[s] * 0.5 + 0.5) * 255);
      bytes[i + 1] = Math.round(
        (f.data[s + 1] * (flipY ? -0.5 : 0.5) + 0.5) * 255,
      );
      bytes[i + 2] = 0;
      bytes[i + 3] = 255;
    }
  return bytes;
}
export function applyStroke(
  field: FlowField,
  history: History,
  brush: Brush,
  points: Point[],
) {
  if (!points.length) return false;
  const stroke = new Stroke(field, history, brush, points[0]);
  for (const point of points.slice(1)) stroke.move(point);
  return stroke.finish();
}
