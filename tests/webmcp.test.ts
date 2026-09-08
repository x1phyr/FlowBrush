import test from 'node:test';
import assert from 'node:assert/strict';
import {
  registerFlowTools,
  type FlowModelContext,
} from '../lib/flow/webmcp.ts';
import {
  FlowField,
  History,
  DEFAULT_BRUSH,
  applyStroke,
} from '../lib/flow/core.ts';
void test('WebMCP registration, actions, readback, validation and cleanup contract', () => {
  const tools = new Map<
    string,
    Parameters<FlowModelContext['registerTool']>[0]
  >();
  let signal: AbortSignal | undefined;
  const ctx: FlowModelContext = {
    registerTool: (tool, opts) => {
      tools.set(tool.name, tool);
      signal = opts.signal;
    },
  };
  const f = new FlowField(64, 64),
    h = new History();
  let brush = { ...DEFAULT_BRUSH },
    unsaved = false;
  const close = registerFlowTools(ctx, {
    state: () => ({
      width: f.width,
      height: f.height,
      revision: f.revision,
      brush,
      unsaved,
    }),
    brush: (b) => {
      brush = b;
      unsaved = true;
    },
    stroke: (b, p) => {
      const changed = applyStroke(f, h, b, p);
      unsaved ||= changed;
      return changed;
    },
  });
  assert.equal(tools.size, 3);
  const get = tools.get('flowbrush_get_state')!,
    set = tools.get('flowbrush_set_brush')!,
    stroke = tools.get('flowbrush_apply_stroke')!;
  assert.equal(get.annotations.readOnlyHint, true);
  set.execute({ radius: 8, speed: 0.9 });
  assert.equal(
    (get.execute({}) as { brush: { radius: number } }).brush.radius,
    8,
  );
  assert.throws(() => set.execute({ radius: 0 }));
  assert.throws(() => set.execute({ speed: NaN }));
  assert.throws(() =>
    stroke.execute({
      points: [
        { x: 10, y: 10 },
        { x: 65, y: 10 },
      ],
    }),
  );
  assert.equal(f.revision, 0);
  stroke.execute({
    points: [
      { x: 10, y: 32 },
      { x: 50, y: 32 },
    ],
  });
  assert.ok(f.revision > 0);
  assert.equal(h.past.length, 1);
  assert.throws(() => get.execute({ unknown: true }));
  close();
  assert.equal(signal?.aborted, true);
});
