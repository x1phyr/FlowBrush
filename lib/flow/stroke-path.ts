import type { Point } from './core.ts';

type Sample = Point & { distance: number };

/** Arc-length samples with a short, symmetric tangent window.
 * The tail stays within the brush footprint until enough future path is known.
 * Only a bounded local window is retained; finish flushes the actual endpoint.
 */
export class StrokePath {
  private samples: Sample[];
  private next = 0;
  private last: Point;
  private distance = 0;
  private nextDistance: number;
  private done = false;

  constructor(
    point: Point,
    private spacing: number,
    private window: number,
    private emit: (point: Point, direction: Point) => void,
  ) {
    this.last = { ...point };
    this.samples = [{ ...point, distance: 0 }];
    this.nextDistance = spacing;
  }

  move(point: Point) {
    if (this.done) return;
    const dx = point.x - this.last.x,
      dy = point.y - this.last.y;
    const length = Math.hypot(dx, dy);
    if (length < 1e-4) return;
    const end = this.distance + length;
    while (this.nextDistance <= end + 1e-8) {
      const t = Math.min(1, (this.nextDistance - this.distance) / length);
      this.samples.push({
        x: this.last.x + dx * t,
        y: this.last.y + dy * t,
        distance: this.nextDistance,
      });
      this.nextDistance += this.spacing;
      this.flush(false);
    }
    this.distance = end;
    this.last = { ...point };
  }

  private at(distance: number): Point {
    const first = this.samples[0],
      last = this.samples[this.samples.length - 1];
    if (distance <= first.distance) return first;
    if (distance >= last.distance) return last;
    for (let i = 1; i < this.samples.length; i++) {
      const a = this.samples[i - 1],
        b = this.samples[i];
      if (distance <= b.distance) {
        const t = (distance - a.distance) / (b.distance - a.distance);
        return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      }
    }
    return last;
  }

  private flush(final: boolean) {
    const end = this.samples[this.samples.length - 1].distance;
    while (this.next < this.samples.length) {
      const point = this.samples[this.next];
      if (!final && point.distance + this.window > end) break;
      const before = this.at(point.distance - this.window);
      const after = this.at(point.distance + this.window);
      let dx = after.x - before.x,
        dy = after.y - before.y;
      // A reversal can cancel the secant. At a cusp choose the local outgoing
      // direction, or the incoming one at the endpoint, instead of a zero vector.
      if (Math.hypot(dx, dy) < 1e-6) {
        const outgoing = this.at(point.distance + this.spacing);
        dx = outgoing.x - point.x;
        dy = outgoing.y - point.y;
        if (Math.hypot(dx, dy) < 1e-6) {
          const incoming = this.at(point.distance - this.spacing);
          dx = point.x - incoming.x;
          dy = point.y - incoming.y;
        }
      }
      const length = Math.hypot(dx, dy);
      if (length > 1e-6) this.emit(point, { x: dx / length, y: dy / length });
      this.next++;
    }
    // Keep the interpolation bracket for the oldest pending tangent.
    const oldest =
      this.samples[Math.min(this.next, this.samples.length - 1)].distance -
      this.window;
    let remove = 0;
    while (remove + 1 < this.next && this.samples[remove + 1].distance < oldest)
      remove++;
    if (remove) {
      this.samples.splice(0, remove);
      this.next -= remove;
    }
  }

  finish() {
    if (this.done) return;
    this.done = true;
    if (!this.distance) return; // Follow-mode single click remains a no-op.
    const last = this.samples[this.samples.length - 1];
    if (this.distance - last.distance > 1e-6)
      this.samples.push({ ...this.last, distance: this.distance });
    this.flush(true);
    this.samples = [];
  }

  cancel() {
    this.done = true;
    this.samples = [];
  }
}
