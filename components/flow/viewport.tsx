'use client';
import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import {
  FlowField,
  History,
  Stroke,
  encodeRGBA,
  type Brush,
  type Point,
} from '@/lib/flow/core';
import { type View } from '@/lib/flow/files';
import { WaterRenderer } from '@/lib/flow/water';
import { screenToField, zoomAt } from '@/lib/flow/coordinates';
type Props = {
  field: FlowField;
  history: History;
  brush: Brush;
  view: View;
  image: HTMLImageElement | null;
  hand: boolean;
  fitToken: number;
  preview: RefObject<HTMLCanvasElement | null>;
  onView: (v: Partial<View>, dirty?: boolean) => void;
  onEdit: () => void;
  onDrawing: (active: boolean) => void;
  onWebGL: (error: string | null) => void;
};
export function Viewport(props: Props) {
  const canvas = useRef<HTMLCanvasElement>(null),
    latest = useRef(props);
  useLayoutEffect(() => {
    latest.current = props;
  });
  const interaction = useRef<{
    stroke: Stroke | null;
    pointer: number | null;
    pan: Point | null;
    cursor: Point | null;
    space: boolean;
  }>({ stroke: null, pointer: null, pan: null, cursor: null, space: false });
  const dimensions = useRef({ w: 0, h: 0 });
  useEffect(() => {
    const c = canvas.current!,
      ctx = c.getContext('2d')!,
      cache = document.createElement('canvas'),
      cacheCtx = cache.getContext('2d')!;
    let water: WaterRenderer | null = null,
      frame = 0,
      disposed = false,
      lastTime = performance.now(),
      time = 0,
      lastRender = 0,
      lastField: FlowField | null = null,
      lastRevision = -1,
      lastView: View | null = null,
      lastImage: HTMLImageElement | null = null,
      lastCursor = '',
      lastSize = '',
      lastBrush: Brush | null = null;
    let fpsStart = performance.now(),
      frames = 0;
    const pc = latest.current.preview.current;
    const init = () => {
      try {
        if (pc) {
          water = new WaterRenderer(pc);
          latest.current.onWebGL(null);
        }
      } catch (error) {
        latest.current.onWebGL(
          error instanceof Error ? error.message : '动态预览暂不可用',
        );
      }
    };
    const lost = (e: Event) => {
      e.preventDefault();
      water = null;
      latest.current.onWebGL('WebGL 上下文已丢失，编辑与导出仍可使用');
    };
    const restored = () => init();
    pc?.addEventListener('webglcontextlost', lost);
    pc?.addEventListener('webglcontextrestored', restored);
    init();
    const resize = () => {
      const r = c.getBoundingClientRect();
      dimensions.current = { w: r.width, h: r.height };
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      c.width = Math.round(r.width * dpr);
      c.height = Math.round(r.height * dpr);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(c);
    resize();
    const draw = (now: number) => {
      if (disposed) return;
      frame = requestAnimationFrame(draw);
      const p = latest.current,
        s = interaction.current,
        f = p.field,
        v = p.view,
        { w, h } = dimensions.current;
      const dt = Math.min((now - lastTime) / 1000, 0.1);
      lastTime = now;
      if (v.playing) time += dt * v.rate;
      if (!w || !h || now - lastRender < 1000 / 60 - 0.5) return;
      lastRender = now;
      frames++;
      if (now - fpsStart >= 1000) {
        if (process.env.NODE_ENV !== 'production')
          c.dataset.renderFps = String(
            Math.round((frames * 1000) / (now - fpsStart)),
          );
        frames = 0;
        fpsStart = now;
      }
      // Both consumers upload the same dirty region before it is cleared.
      water?.render(f, time);
      const signature = `${s.cursor?.x},${s.cursor?.y},${s.space},${p.hand}`,
        size = `${w},${h},${c.width},${c.height}`;
      if (
        f === lastField &&
        f.revision === lastRevision &&
        v === lastView &&
        lastImage === p.image &&
        lastCursor === signature &&
        lastSize === size &&
        lastBrush === p.brush
      )
        return;
      if (lastField !== f) {
        cache.width = f.width;
        cache.height = f.height;
        lastRevision = -1;
      }
      if (f.revision !== lastRevision) {
        const r =
          lastField === f
            ? (f.dirty ?? { x: 0, y: 0, w: f.width, h: f.height })
            : { x: 0, y: 0, w: f.width, h: f.height };
        cacheCtx.putImageData(
          new ImageData(
            new Uint8ClampedArray(encodeRGBA(f, false, r)),
            r.w,
            r.h,
          ),
          r.x,
          r.y,
        );
      }
      f.dirty = null;
      lastField = f;
      lastRevision = f.revision;
      lastView = v;
      lastImage = p.image;
      lastCursor = signature;
      lastSize = size;
      lastBrush = p.brush;
      const dpr = c.width / w;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const ox = (w - f.width * v.zoom) / 2 + v.panX,
        oy = (h - f.height * v.zoom) / 2 + v.panY;
      ctx.save();
      ctx.translate(ox, oy);
      ctx.scale(v.zoom, v.zoom);
      ctx.shadowColor = '#0006';
      ctx.shadowBlur = 24;
      ctx.fillStyle = '#13212a';
      ctx.fillRect(0, 0, f.width, f.height);
      ctx.shadowBlur = 0;
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, f.width, f.height);
      ctx.clip();
      if (v.rg) {
        ctx.globalAlpha = p.image && v.background ? 0.6 : 1;
        ctx.drawImage(cache, 0, 0);
        ctx.globalAlpha = 1;
      }
      if (p.image && v.background) {
        const scale = Math.min(
          f.width / p.image.naturalWidth,
          f.height / p.image.naturalHeight,
        );
        const iw = p.image.naturalWidth * scale,
          ih = p.image.naturalHeight * scale;
        ctx.globalAlpha = v.opacity;
        ctx.drawImage(p.image, (f.width - iw) / 2, (f.height - ih) / 2, iw, ih);
        ctx.globalAlpha = 1;
      }
      if (!v.rg && !p.image) {
        ctx.fillStyle = '#29414c';
        const spacing = 32;
        for (let y = spacing / 2; y < f.height; y += spacing)
          for (let x = spacing / 2; x < f.width; x += spacing)
            ctx.fillRect(x, y, 1 / v.zoom, 1 / v.zoom);
      }
      if (v.arrows) {
        const step = Math.max(8, Math.ceil(28 / v.zoom)),
          startX = Math.max(0, Math.floor(-ox / v.zoom / step) * step),
          startY = Math.max(0, Math.floor(-oy / v.zoom / step) * step);
        ctx.lineWidth = 1.2 / v.zoom;
        ctx.strokeStyle = v.rg ? '#edfff5' : '#8ceadd';
        ctx.shadowColor = '#061716';
        ctx.shadowBlur = 2;
        for (
          let y = startY + step / 2;
          y < Math.min(f.height, (h - oy) / v.zoom);
          y += step
        )
          for (
            let x = startX + step / 2;
            x < Math.min(f.width, (w - ox) / v.zoom);
            x += step
          ) {
            const i = (Math.floor(y) * f.width + Math.floor(x)) * 2,
              dx = f.data[i],
              dy = f.data[i + 1],
              speed = Math.hypot(dx, dy);
            if (speed < 0.008) continue;
            const len = step * 0.7 * speed,
              head = Math.min(len * 0.4, 4 / v.zoom);
            ctx.save();
            ctx.translate(x, y);
            ctx.rotate(Math.atan2(dy, dx));
            ctx.beginPath();
            ctx.moveTo(-len / 2, 0);
            ctx.lineTo(len / 2, 0);
            ctx.lineTo(len / 2 - head, -head * 0.65);
            ctx.moveTo(len / 2, 0);
            ctx.lineTo(len / 2 - head, head * 0.65);
            ctx.stroke();
            ctx.restore();
          }
        ctx.shadowBlur = 0;
      }
      ctx.restore();
      ctx.strokeStyle = '#71848c';
      ctx.lineWidth = 1 / v.zoom;
      ctx.strokeRect(0, 0, f.width, f.height);
      ctx.restore();
      ctx.fillStyle = '#83959f';
      ctx.font = '11px monospace';
      ctx.fillText('0, 0', ox, oy - 10);
      ctx.fillText(
        `${f.width} × ${f.height}`,
        ox + f.width * v.zoom - 82,
        oy + f.height * v.zoom + 21,
      );
      if (s.cursor && !p.hand && !s.space) {
        const r = p.brush.radius * v.zoom;
        ctx.beginPath();
        ctx.arc(s.cursor.x, s.cursor.y, r, 0, Math.PI * 2);
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(s.cursor.x, s.cursor.y, Math.max(0, r - 1), 0, Math.PI * 2);
        ctx.strokeStyle = '#102828';
        ctx.stroke();
        ctx.fillStyle = '#fff';
        ctx.fillRect(s.cursor.x - 1, s.cursor.y - 1, 2, 2);
      }
    };
    frame = requestAnimationFrame(draw);
    const keydown = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input,select,textarea,dialog'))
        return;
      if (e.code === 'Space') {
        e.preventDefault();
        interaction.current.space = true;
        c.style.cursor = 'grab';
      }
    };
    const keyup = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        interaction.current.space = false;
        c.style.cursor = latest.current.hand ? 'grab' : 'none';
      }
    };
    const blur = () => {
      const s = interaction.current;
      if (s.stroke) {
        s.stroke.cancel();
        s.stroke = null;
      }
      s.pan = null;
      s.pointer = null;
      s.space = false;
      latest.current.onDrawing(false);
    };
    window.addEventListener('keydown', keydown);
    window.addEventListener('keyup', keyup);
    window.addEventListener('blur', blur);
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      if (interaction.current.pointer !== null) return;
      const p = latest.current,
        r = c.getBoundingClientRect(),
        x = e.clientX - r.left,
        y = e.clientY - r.top,
        { w, h } = dimensions.current;
      const old = p.view.zoom,
        z = Math.max(0.05, Math.min(16, old * Math.exp(-e.deltaY * 0.0015)));
      p.onView(zoomAt({ x, y }, { w, h }, p.view, z));
    };
    c.addEventListener('wheel', wheel, { passive: false });
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      water?.dispose();
      pc?.removeEventListener('webglcontextlost', lost);
      pc?.removeEventListener('webglcontextrestored', restored);
      window.removeEventListener('keydown', keydown);
      window.removeEventListener('keyup', keyup);
      window.removeEventListener('blur', blur);
      c.removeEventListener('wheel', wheel);
      blur();
    };
  }, []);
  useEffect(() => {
    void props.fitToken;
    const { w, h } = dimensions.current,
      p = latest.current;
    p.onView(
      {
        zoom: Math.max(
          0.05,
          Math.min(2, (w - 110) / p.field.width, (h - 130) / p.field.height),
        ),
        panX: 0,
        panY: 0,
      },
      props.fitToken > 0,
    );
  }, [props.fitToken]); // explicit fit only; loading preserves saved view
  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const toField = (p: Point) =>
    screenToField(p, props.field, dimensions.current, props.view);
  return (
    <canvas
      ref={canvas}
      className="viewport"
      aria-label="FlowMap 绘制画布"
      tabIndex={0}
      style={{ cursor: props.hand ? 'grab' : 'none' }}
      onContextMenu={(e) => e.preventDefault()}
      onPointerDown={(e) => {
        if (e.button !== 0 && e.button !== 1) return;
        const s = interaction.current;
        if (s.pointer !== null) return;
        const p = point(e),
          fp = toField(p);
        if (
          !props.hand &&
          !s.space &&
          e.button !== 1 &&
          (fp.x < 0 ||
            fp.y < 0 ||
            fp.x >= props.field.width ||
            fp.y >= props.field.height)
        )
          return;
        e.preventDefault();
        e.currentTarget.focus({ preventScroll: true });
        e.currentTarget.setPointerCapture(e.pointerId);
        s.pointer = e.pointerId;
        props.onDrawing(true);
        if (props.hand || s.space || e.button === 1) s.pan = p;
        else s.stroke = new Stroke(props.field, props.history, props.brush, fp);
      }}
      onPointerMove={(e) => {
        const s = interaction.current,
          p = point(e);
        s.cursor = p;
        if (s.pointer !== e.pointerId) return;
        if (s.pan) {
          props.onView({
            panX: props.view.panX + p.x - s.pan.x,
            panY: props.view.panY + p.y - s.pan.y,
          });
          s.pan = p;
        } else if (s.stroke) {
          const events = e.nativeEvent.getCoalescedEvents?.() ?? [];
          for (const event of events) {
            const r = e.currentTarget.getBoundingClientRect();
            s.stroke.move(
              toField({ x: event.clientX - r.left, y: event.clientY - r.top }),
            );
          }
          s.stroke.move(toField(p));
        }
      }}
      onPointerUp={(e) => {
        const s = interaction.current;
        if (s.pointer !== e.pointerId) return;
        if (s.stroke) {
          s.stroke.move(toField(point(e)));
          if (s.stroke.finish()) props.onEdit();
        }
        s.stroke = null;
        s.pan = null;
        s.pointer = null;
        props.onDrawing(false);
        if (e.currentTarget.hasPointerCapture(e.pointerId))
          e.currentTarget.releasePointerCapture(e.pointerId);
      }}
      onPointerCancel={() => {
        const s = interaction.current;
        s.stroke?.cancel();
        s.stroke = null;
        s.pan = null;
        s.pointer = null;
        props.onDrawing(false);
      }}
      onLostPointerCapture={() => {
        const s = interaction.current;
        if (s.stroke) {
          s.stroke.cancel();
          s.stroke = null;
        }
        s.pan = null;
        s.pointer = null;
        props.onDrawing(false);
      }}
      onPointerLeave={() => {
        interaction.current.cursor = null;
      }}
    />
  );
}
