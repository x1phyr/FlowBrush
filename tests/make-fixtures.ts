import { mkdirSync, writeFileSync } from 'node:fs';
import {
  FlowField,
  DEFAULT_BRUSH,
  History,
  applyStroke,
} from '../lib/flow/core.ts';
import {
  serializeProject,
  DEFAULT_VIEW,
  encodePNG,
} from '../lib/flow/files.ts';
const dir = '/tmp/flowbrush-qa';
mkdirSync(dir, { recursive: true });
const reference = new FlowField(192, 96);
for (let y = 0; y < 96; y++)
  for (let x = 0; x < 192; x++) {
    const i = (y * 192 + x) * 2;
    reference.data[i] = (x / 191 - 0.5) * 1.2;
    reference.data[i + 1] = (y / 95 - 0.5) * 1.2;
  }
const png = encodePNG(reference);
writeFileSync(`${dir}/reference.png`, png);
for (const size of [512, 1024, 2048]) {
  const field = new FlowField(size, size);
  applyStroke(field, new History(), { ...DEFAULT_BRUSH, radius: 64 }, [
    { x: size * 0.3, y: size * 0.1 },
    { x: size * 0.4, y: size * 0.3 },
    { x: size * 0.6, y: size * 0.5 },
    { x: size * 0.5, y: size * 0.7 },
    { x: size * 0.6, y: size * 0.9 },
  ]);
  writeFileSync(
    `${dir}/river-${size}.flowbrush`,
    serializeProject({
      field,
      name: `QA 河流 ${size}`,
      background: `data:image/png;base64,${Buffer.from(png).toString('base64')}`,
      brush: { ...DEFAULT_BRUSH, radius: 64 },
      view: {
        ...DEFAULT_VIEW,
        rg: false,
        zoom: size === 512 ? 1 : size === 1024 ? 0.6 : 0.3,
      },
      flipY: false,
    }),
  );
}
writeFileSync(
  `${dir}/invalid.flowbrush`,
  '{"format":"flowbrush","version":99}',
);
