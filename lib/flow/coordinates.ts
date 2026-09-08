import type { Point } from './core.ts';
import type { View } from './files.ts';
type Size = { width: number; height: number };
type ViewportSize = { w: number; h: number };
export function screenToField(
  p: Point,
  field: Size,
  size: ViewportSize,
  view: Pick<View, 'zoom' | 'panX' | 'panY'>,
): Point {
  return {
    x: (p.x - (size.w - field.width * view.zoom) / 2 - view.panX) / view.zoom,
    y: (p.y - (size.h - field.height * view.zoom) / 2 - view.panY) / view.zoom,
  };
}
export function zoomAt(
  p: Point,
  size: ViewportSize,
  view: Pick<View, 'zoom' | 'panX' | 'panY'>,
  requestedZoom: number,
) {
  const zoom = Math.max(0.05, Math.min(16, requestedZoom)),
    ratio = zoom / view.zoom;
  return {
    zoom,
    panX: (p.x - size.w / 2) * (1 - ratio) + view.panX * ratio,
    panY: (p.y - size.h / 2) * (1 - ratio) + view.panY * ratio,
  };
}
