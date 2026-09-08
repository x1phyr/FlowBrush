# FlowBrush

中文 2D FlowMap 编辑器。图片、向量场、工程文件始终在浏览器本地处理；无素材上传或业务数据库。

## 本地开发

需要 Node.js 22.17+ 和 npm。

```sh
npm ci
npm run dev
```

打开终端显示的地址（默认 http://localhost:3000）。

```sh
npm run typecheck
npm run lint
npm test
npm run bench
npm run build
```

框架为 React 19 / TypeScript / vinext。`npm run build` 输出静态客户端资源至 `dist/client`。普通使用不需要开发者配置 API 密钥。

## 开源与部署

本项目以 [MIT License](LICENSE) 发布。GitHub Pages 会在推送到 `main` 分支后自动构建并发布静态客户端版本；应用不需要服务端、数据库或环境变量。

## 工作流程

1. 默认打开 512×512 空白画布。新建支持 256 / 512 / 1024 / 2048 预设，也支持每边 1–2048 的自定义尺寸。
2. 点击或拖入 PNG/JPEG/WebP 底图。图片最大 20 MiB，解码后最大 6400 万像素，最长边不超过 16384；保持比例居中显示。调整底图透明度或关闭底图。
3. 方向笔刷沿拖动方向绘制：按距离重采样，在笔刷范围内用前后短段轨迹估算平滑切线，减少低速像素跳动与转弯方向突变；收笔时补齐末端。或用固定角度点涂（0° 向右，90° 向下）。速度控制目标向量长度；强度控制单次混合。跟随模式单击不改变数据。
4. 平滑工具使用局部快照做 3×3 加权邻域平均；擦除将向量逐渐混合至零。两者都使用柔边笔刷，不强制归一化。
5. 查看箭头、RG 编码与动态水纹；预览倍率仅影响动画，不影响导出。
6. 保存 `.flowbrush` 工程，以便恢复完整精度的数据和底图；导出 PNG 用于 Shader。

快捷键：B 绘制，S 平滑，E 擦除，H 平移，按住 Space 临时平移，F 适应画布，[ / ] 改变半径，⌘/Ctrl Z 撤销，⌘/Ctrl Shift Z 或 Ctrl Y 重做，⌘/Ctrl S 保存。输入框内保留文本编辑快捷键。滚轮以鼠标位置为中心缩放。

每个笔画为一次撤销；清空可撤销。历史使用 32×32 局部块的前后快照，向量载荷预算 128 MiB，超额移除最早操作。工程文件不保存撤销历史。刷新前请保存工程；浏览器退出提醒取决于浏览器对 beforeunload 的支持。

## PNG 与 Shader 接入

PNG 与画布等尺寸，8 位 RGBA，无 gamma / ICC 元数据，无底图和箭头：

```text
R = round((vx × 0.5 + 0.5) × 255)
G = round((vy × 0.5 + 0.5) × 255)
B = 0
A = 255
```

内部 X 向右、Y 向下。导出“反转 Y 分量”在编码前取反 vy，不翻转图片行。向量长度为 0–1；方向和速度共享 RG 数据。零向量编码 `(128,128,0,255)`。8 位纹理每通道解码步长为 `2/255`，因此 0.5 无法精确表示，单通道最大量化误差为 `1/255`。

```glsl
vec2 flow = texture2D(flowMap, uv).rg * 2.0 - 1.0;
if (length(flow) <= 2.0 / 255.0) flow = vec2(0.0);
vec4 color = texture2D(waterTexture, uv - flow * time * speedScale);
```

上例只展示移动方向。工具“接入”面板提供完整的双相位偏移和交叉混合 GLSL，避免 UV 随时间无限累积。内置水纹为周期函数，不依赖网络素材。预览按浮点场生成的 RG 纹理展示，采用与接入示例一致的静止阈值。

- 在引擎中禁用 FlowMap 的 sRGB 解码，按线性数据读取。
- 建议 FlowMap 使用 bilinear + clamp，关闭有损纹理压缩和 mipmap；水纹使用 repeat。
- 图片行序和 Y 分量符号是两个独立设置。底图、水纹和 FlowMap 的 UV 方向必须一致。
- Shader 采样位置减去流向，画面上的纹理特征才会沿箭头方向移动。
- 当前验证目标为通用 GLSL，未包含 Cocos / Unity / Godot 专用材质或实机引擎验证。
- PNG 使用标准无压缩 DEFLATE 块以确保字节可控；2048² 导出约 16 MiB。可用保持 RGBA 原值的无损 PNG 优化器压缩，避免调色板量化或颜色空间转换。

## 工程格式与实现

`.flowbrush` 是版本化 JSON，包含 `format: "flowbrush"`、`version: 1`、`byteOrder: "little-endian"`、`name`、`width`、`height`、`vectors`、`background`、`brush`、`view`、`flipY`。

`vectors` 是交错 `(vx, vy)` 的 IEEE-754 Float32，小端字节排列后进行 Base64 编码；`background` 为受支持图片的 data URL 或 null。打开前检查版本、边界、数据长度、有限值、向量长度、笔刷和视图参数。文件最大 100 MiB。全部校验与图片解码成功后才替换当前工程。

- `lib/flow/core.ts`：浮点场、距离重采样、柔边混合、局部平滑、差异历史、RGBA 编码。
- `lib/flow/files.ts`：工程编解码、PNG 字节编码及 GLSL 示例。
- `components/flow/viewport.tsx`：CSS 像素坐标换算、画布绘制、局部贴图更新和 WebGL 生命周期。
- `lib/flow/water.ts`：双相位水纹预览。WebGL 不可用时，2D 编辑和 PNG 编码不依赖 WebGL，仍可使用。

WebMCP 在 `document.modelContext` 可用时注册 `flowbrush_get_state`、`flowbrush_set_brush`、`flowbrush_apply_stroke`。工具与 UI 共用笔刷、向量场及历史；输入验证先于任何写入。画笔坐标为纹理像素，单次最多 1000 点、总路径长度不超过 20000 像素。无 WebMCP 支持时不影响常规功能。

## 验证与已知限制

见 `VALIDATION.md`。首版面向桌面鼠标操作；窄窗口将设置面板移至画布下方。不包含触控压感、多层合成、物理流体模拟、自动河流识别或云端持久化。动态水纹用于方向与速度检查，并非最终引擎效果。

如果嵌入式预览浏览器不接收下载，请在支持标准文件下载的桌面浏览器打开应用链接。关闭页面前确认工程文件实际落盘。
