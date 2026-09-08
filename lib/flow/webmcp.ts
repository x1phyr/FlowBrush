import { validateBrush, type Brush, type Point } from './core.ts';
type Context = {
  registerTool: (
    tool: {
      name: string;
      title: string;
      description: string;
      inputSchema: object;
      annotations: { readOnlyHint: boolean; untrustedContentHint: boolean };
      execute: (input: unknown) => unknown;
    },
    options: { signal: AbortSignal },
  ) => void | Promise<void>;
};
type Actions = {
  state: () => {
    width: number;
    height: number;
    revision: number;
    brush: Brush;
    unsaved: boolean;
  };
  brush: (b: Brush) => void;
  stroke: (b: Brush, points: Point[]) => boolean;
};
export function registerFlowTools(
  context: Context | undefined,
  actions: Actions,
  onError: (e: unknown) => void = console.warn,
) {
  if (!context?.registerTool) return () => {};
  const lifecycle = new AbortController();
  const object = (input: unknown): Record<string, unknown> => {
    if (!input || typeof input !== 'object' || Array.isArray(input))
      throw new Error('需要对象参数');
    return input as Record<string, unknown>;
  };
  const register = (
    name: string,
    title: string,
    description: string,
    inputSchema: object,
    readOnlyHint: boolean,
    execute: (input: unknown) => unknown,
  ) => {
    try {
      void Promise.resolve(
        context.registerTool(
          {
            name,
            title,
            description,
            inputSchema,
            annotations: { readOnlyHint, untrustedContentHint: false },
            execute,
          },
          { signal: lifecycle.signal },
        ),
      ).catch(onError);
    } catch (e) {
      onError(e);
    }
  };
  register(
    'flowbrush_get_state',
    '读取工程状态',
    '读取画布尺寸、笔刷参数与是否有未保存修改。',
    { type: 'object', properties: {}, additionalProperties: false },
    true,
    (input) => {
      if (Object.keys(object(input)).length) throw new Error('不接受额外参数');
      return actions.state();
    },
  );
  register(
    'flowbrush_set_brush',
    '设置笔刷',
    '设置当前笔刷，不绘制。',
    {
      type: 'object',
      properties: {
        tool: { enum: ['brush', 'smooth', 'erase'] },
        mode: { enum: ['follow', 'fixed'] },
        radius: { type: 'number', minimum: 1, maximum: 256 },
        speed: { type: 'number', minimum: 0, maximum: 1 },
        strength: { type: 'number', minimum: 0, maximum: 1 },
        angle: { type: 'number', minimum: 0, maximum: 360 },
      },
      additionalProperties: false,
    },
    false,
    (input) => {
      const p = object(input);
      if (
        Object.keys(p).some(
          (k) =>
            !['tool', 'mode', 'radius', 'speed', 'strength', 'angle'].includes(
              k,
            ),
        )
      )
        throw new Error('未知笔刷参数');
      const b = { ...actions.state().brush, ...p } as Brush;
      validateBrush(b);
      actions.brush(b);
      return { brush: b };
    },
  );
  register(
    'flowbrush_apply_stroke',
    '绘制笔画',
    '使用当前笔刷按纹理像素坐标绘制一条可撤销笔画。',
    {
      type: 'object',
      properties: {
        points: {
          type: 'array',
          minItems: 1,
          maxItems: 1000,
          items: {
            type: 'object',
            properties: { x: { type: 'number' }, y: { type: 'number' } },
            required: ['x', 'y'],
            additionalProperties: false,
          },
        },
      },
      required: ['points'],
      additionalProperties: false,
    },
    false,
    (input) => {
      const p = object(input),
        s = actions.state();
      if (
        Object.keys(p).some((k) => k !== 'points') ||
        !Array.isArray(p.points) ||
        !p.points.length ||
        p.points.length > 1000
      )
        throw new Error('需要 1–1000 个点');
      let distance = 0;
      const points = p.points.map((raw, i) => {
        const point = object(raw);
        if (
          Object.keys(point).some((k) => !['x', 'y'].includes(k)) ||
          typeof point.x !== 'number' ||
          typeof point.y !== 'number' ||
          !Number.isFinite(point.x) ||
          !Number.isFinite(point.y) ||
          point.x < 0 ||
          point.y < 0 ||
          point.x >= s.width ||
          point.y >= s.height
        )
          throw new Error('笔画坐标超出画布');
        if (i) {
          const prev = p.points as Point[];
          distance += Math.hypot(
            point.x - prev[i - 1].x,
            point.y - prev[i - 1].y,
          );
        }
        return { x: point.x, y: point.y };
      });
      if (distance > 20000) throw new Error('单次笔画过长，请拆分');
      const changed = actions.stroke(s.brush, points);
      return { ...actions.state(), changed };
    },
  );
  return () => lifecycle.abort();
}
export type { Context as FlowModelContext };
