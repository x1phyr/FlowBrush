import {
  FlowField,
  encodeRGBA,
  validSize,
  validateBrush,
  type Brush,
} from './core.ts';
export type View = {
  zoom: number;
  panX: number;
  panY: number;
  arrows: boolean;
  rg: boolean;
  background: boolean;
  opacity: number;
  playing: boolean;
  rate: number;
};
export const DEFAULT_VIEW: View = {
  zoom: 1,
  panX: 0,
  panY: 0,
  arrows: true,
  rg: true,
  background: true,
  opacity: 0.7,
  playing: true,
  rate: 1,
};
export type Project = {
  field: FlowField;
  name: string;
  background: string | null;
  brush: Brush;
  view: View;
  flipY: boolean;
};
function b64encode(bytes: Uint8Array) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 16384)
    s += String.fromCharCode(...bytes.subarray(i, i + 16384));
  return btoa(s);
}
export function serializeProject(p: Project) {
  const bytes = new Uint8Array(p.field.data.length * 4),
    dv = new DataView(bytes.buffer);
  for (let i = 0; i < p.field.data.length; i++)
    dv.setFloat32(i * 4, p.field.data[i], true);
  return JSON.stringify({
    format: 'flowbrush',
    version: 1,
    byteOrder: 'little-endian',
    name: p.name,
    width: p.field.width,
    height: p.field.height,
    vectors: b64encode(bytes),
    background: p.background,
    brush: p.brush,
    view: p.view,
    flipY: p.flipY,
  });
}
export function parseProject(text: string): Project {
  if (text.length > 100 * 1024 * 1024) throw new Error('工程超过 100 MiB 上限');
  const p = JSON.parse(text);
  if (
    !p ||
    p.format !== 'flowbrush' ||
    p.version !== 1 ||
    p.byteOrder !== 'little-endian'
  )
    throw new Error('无法识别工程格式或版本');
  if (!validSize(p.width, p.height))
    throw new Error('工程尺寸无效，单边最大 2048');
  const count = p.width * p.height * 2,
    expected = 4 * Math.ceil((count * 4) / 3);
  if (
    typeof p.vectors !== 'string' ||
    p.vectors.length !== expected ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(p.vectors)
  )
    throw new Error('向量数据长度或编码无效');
  const bin = atob(p.vectors);
  if (bin.length !== count * 4) throw new Error('向量数据长度不符');
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const dv = new DataView(bytes.buffer),
    data = new Float32Array(count);
  for (let i = 0; i < count; i += 2) {
    const x = dv.getFloat32(i * 4, true),
      y = dv.getFloat32((i + 1) * 4, true);
    if (
      !Number.isFinite(x) ||
      !Number.isFinite(y) ||
      Math.hypot(x, y) > 1.000001
    )
      throw new Error('工程包含无效向量');
    data[i] = x;
    data[i + 1] = y;
  }
  validateBrush(p.brush);
  const v = p.view;
  if (
    !v ||
    !Number.isFinite(v.zoom) ||
    v.zoom < 0.05 ||
    v.zoom > 16 ||
    !Number.isFinite(v.panX) ||
    !Number.isFinite(v.panY) ||
    Math.abs(v.panX) > 100000 ||
    Math.abs(v.panY) > 100000 ||
    !Number.isFinite(v.opacity) ||
    v.opacity < 0 ||
    v.opacity > 1 ||
    !Number.isFinite(v.rate) ||
    v.rate < 0.1 ||
    v.rate > 3 ||
    ['arrows', 'rg', 'background', 'playing'].some(
      (k) => typeof v[k] !== 'boolean',
    ) ||
    typeof p.flipY !== 'boolean'
  )
    throw new Error('工程视图设置无效');
  if (
    p.background !== null &&
    (typeof p.background !== 'string' ||
      p.background.length > 30 * 1024 * 1024 ||
      !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(
        p.background,
      ))
  )
    throw new Error('工程底图无效');
  if (typeof p.name !== 'string' || p.name.length > 128)
    throw new Error('工程名称无效');
  return {
    field: new FlowField(p.width, p.height, data),
    name: p.name,
    background: p.background,
    brush: { ...p.brush },
    view: { ...v },
    flipY: p.flipY,
  };
}
const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
  for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
function chunk(type: string, data: Uint8Array) {
  const out = new Uint8Array(data.length + 12),
    dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  let crc = 0xffffffff;
  for (let i = 4; i < out.length - 4; i++)
    crc = crcTable[(crc ^ out[i]) & 255] ^ (crc >>> 8);
  dv.setUint32(out.length - 4, (crc ^ 0xffffffff) >>> 0);
  return out;
}
/** Lossless PNG with stored DEFLATE blocks. No color profile, gamma, or canvas conversion. */
export function encodePNG(field: FlowField, flipY = false): Uint8Array {
  const rgba = encodeRGBA(field, flipY),
    stride = field.width * 4,
    raw = new Uint8Array((stride + 1) * field.height);
  for (let y = 0; y < field.height; y++)
    raw.set(rgba.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  const blocks = Math.ceil(raw.length / 65535),
    z = new Uint8Array(2 + raw.length + blocks * 5 + 4);
  z.set([0x78, 0x01]);
  let pos = 2,
    a = 1,
    b = 0;
  for (let start = 0; start < raw.length; start += 65535) {
    const len = Math.min(65535, raw.length - start);
    z[pos++] = start + len === raw.length ? 1 : 0;
    z[pos++] = len & 255;
    z[pos++] = len >>> 8;
    z[pos++] = ~len & 255;
    z[pos++] = (~len >>> 8) & 255;
    z.set(raw.subarray(start, start + len), pos);
    pos += len;
  }
  for (let i = 0; i < raw.length; i++) {
    a = (a + raw[i]) % 65521;
    b = (b + a) % 65521;
  }
  new DataView(z.buffer).setUint32(pos, ((b << 16) | a) >>> 0);
  const ihdr = new Uint8Array(13),
    head = new DataView(ihdr.buffer);
  head.setUint32(0, field.width);
  head.setUint32(4, field.height);
  ihdr.set([8, 6, 0, 0, 0], 8);
  const chunks = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', z),
    chunk('IEND', new Uint8Array()),
  ];
  const result = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let offset = 0;
  for (const c of chunks) {
    result.set(c, offset);
    offset += c.length;
  }
  return result;
}
export function download(data: BlobPart, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      if (
        image.naturalWidth > 16384 ||
        image.naturalHeight > 16384 ||
        image.naturalWidth * image.naturalHeight > 64 * 1024 * 1024
      )
        reject(new Error('底图过大，请缩小至 6400 万像素以内'));
      else resolve(image);
    };
    image.onerror = () =>
      reject(new Error('底图无法解码，请选择有效的 PNG、JPEG 或 WebP'));
    image.src = src;
  });
}
export const GLSL_EXAMPLE = `// FlowMap must be sampled as LINEAR DATA (sRGB disabled).
// Match both textures' UV orientation. Internal +Y points down.
// Flip G only if your engine's UV +Y points up.
vec2 decodeFlow(vec2 rg) {
    vec2 flow = rg * 2.0 - 1.0;
    return length(flow) <= 2.0 / 255.0 ? vec2(0.0) : flow;
}
vec4 sampleFlow(sampler2D water, sampler2D flowMap,
                vec2 uv, float time, float speedScale) {
    vec2 flow = decodeFlow(texture2D(flowMap, uv).rg);
    float phase0 = fract(time * 0.25);
    float phase1 = fract(time * 0.25 + 0.5);
    float blend = abs(phase0 * 2.0 - 1.0);
    // Subtract flow: visible features move WITH the vector.
    vec4 a = texture2D(water, uv - flow * phase0 * speedScale);
    vec4 b = texture2D(water, uv - flow * phase1 * speedScale);
    return mix(a, b, blend);
}`;
