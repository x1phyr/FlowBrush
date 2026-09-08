'use client';
// Local data URL previews must never pass through a server image optimizer.
/* oxlint-disable next/no-img-element */
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useMemo,
  type ReactNode,
} from 'react';
import {
  Waves,
  MousePointer2,
  Eraser,
  Wind,
  Upload,
  Undo2,
  Redo2,
  Download,
  FolderOpen,
  Save,
  Plus,
  Maximize,
  ArrowUpRight,
  Layers,
  Settings2,
  Hand,
  Minus,
  Play,
  Pause,
  Code2,
  X,
  Trash2,
  ImageIcon,
  Check,
  Info,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Viewport } from '@/components/flow/viewport';
import {
  FlowField,
  History,
  DEFAULT_BRUSH,
  applyStroke,
  validSize,
  type Brush,
} from '@/lib/flow/core';
import {
  DEFAULT_VIEW,
  parseProject,
  serializeProject,
  encodePNG,
  download,
  loadImage,
  GLSL_EXAMPLE,
  type View,
} from '@/lib/flow/files';
import { registerFlowTools, type FlowModelContext } from '@/lib/flow/webmcp';
function Range({
  label,
  value,
  min = 0,
  max = 1,
  step = 0.01,
  unit = '',
  onChange,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  onChange: (n: number) => void;
}) {
  return (
    <label className="range-field">
      <div>
        {label}
        <output>
          {step === 1 ? value : value.toFixed(2)}
          {unit}
        </output>
      </div>
      <input
        aria-label={label}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(+e.target.value)}
      />
    </label>
  );
}
function Toggle({
  label,
  checked,
  onChange,
  children,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  children?: ReactNode;
}) {
  return (
    <label className="toggle-row">
      <span>
        {children}
        {label}
      </span>
      <input
        aria-label={label}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="switch" aria-hidden="true" />
    </label>
  );
}
function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className="modal"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div className="modal-heading">
        <h2>{title}</h2>
        <button onClick={onClose} aria-label="关闭">
          <X />
        </button>
      </div>
      {children}
    </dialog>
  );
}
function PNGPreview({ field, flipY }: { field: FlowField; flipY: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current!,
      ctx = c.getContext('2d')!;
    const image = ctx.createImageData(128, 128);
    for (let y = 0; y < 128; y++)
      for (let x = 0; x < 128; x++) {
        const i =
            (Math.min(field.height - 1, Math.floor((y * field.height) / 128)) *
              field.width +
              Math.min(field.width - 1, Math.floor((x * field.width) / 128))) *
            2,
          k = (y * 128 + x) * 4;
        image.data[k] = Math.round((field.data[i] * 0.5 + 0.5) * 255);
        image.data[k + 1] = Math.round(
          (field.data[i + 1] * (flipY ? -0.5 : 0.5) + 0.5) * 255,
        );
        image.data[k + 3] = 255;
      }
    ctx.putImageData(image, 0, 0);
  }, [field, flipY]);
  return (
    <canvas
      ref={ref}
      width={128}
      height={128}
      className="png-preview"
      aria-label="导出 RG 编码预览"
    />
  );
}
export default function Home() {
  const [field, setField] = useState(() => new FlowField()),
    [history, setHistory] = useState(() => new History()),
    [brush, setBrush] = useState<Brush>({ ...DEFAULT_BRUSH }),
    [view, setView] = useState<View>({ ...DEFAULT_VIEW, rg: false }),
    [image, setImage] = useState<HTMLImageElement | null>(null),
    [background, setBackground] = useState<string | null>(null),
    [name, setName] = useState('未命名工程'),
    [dirty, setDirty] = useState(false),
    [tick, setTick] = useState(0),
    [hand, setHand] = useState(false),
    [fitToken, setFitToken] = useState(0),
    [flipY, setFlipY] = useState(false),
    [modal, setModal] = useState<'new' | 'export' | 'shader' | null>(null),
    [newW, setNewW] = useState(512),
    [newH, setNewH] = useState(512),
    [notice, setNotice] = useState(''),
    [webglError, setWebglError] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [shaderTab, setShaderTab] = useState(false);
  const drawing = useRef(false);
  const preview = useRef<HTMLCanvasElement>(null),
    projectInput = useRef<HTMLInputElement>(null),
    imageInput = useRef<HTMLInputElement>(null),
    live = useRef({
      field,
      history,
      brush,
      view,
      image,
      background,
      name,
      dirty,
      flipY,
      busy,
    });
  useLayoutEffect(() => {
    live.current = {
      field,
      history,
      brush,
      view,
      image,
      background,
      name,
      dirty,
      flipY,
      busy,
    };
  });
  const notify = (text: string) => setNotice(text);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(''), 4500);
    return () => clearTimeout(t);
  }, [notice]);
  const edited = () => {
    setDirty(true);
    setTick((t) => t + 1);
  };
  const updateView = (patch: Partial<View>, mark = true) => {
    setView((v) => ({ ...v, ...patch }));
    if (mark) setDirty(true);
  };
  const updateBrush = (patch: Partial<Brush>) => {
    setBrush((b) => ({ ...b, ...patch }));
    setDirty(true);
  };
  const safeName = () =>
    live.current.name
      .replace(/[<>:"/\\|?*]/g, '_')
      .split('')
      .filter((c) => c.charCodeAt(0) > 31)
      .join('') || 'flowmap';
  const run = async (action: () => void | Promise<void>) => {
    if (live.current.busy || drawing.current) return;
    live.current.busy = true;
    setBusy(true);
    try {
      await new Promise<void>((r) =>
        requestAnimationFrame(() => setTimeout(r, 0)),
      );
      await action();
    } catch (e) {
      notify(e instanceof Error ? e.message : '操作失败，请重试');
    } finally {
      live.current.busy = false;
      setBusy(false);
    }
  };
  const save = () =>
    run(() => {
      const p = live.current;
      download(
        serializeProject(p),
        `${safeName()}.flowbrush`,
        'application/json',
      );
      setDirty(false);
      notify('工程已下载，可重新打开继续编辑');
    });
  const confirmReplace = () =>
    !live.current.dirty ||
    window.confirm('当前工程有未保存的修改。确定放弃修改并继续吗？');
  const undo = () => {
    const p = live.current;
    if (p.history.undo(p.field)) edited();
  };
  const redo = () => {
    const p = live.current;
    if (p.history.redo(p.field)) edited();
  };
  const importProject = (file: File) =>
    run(async () => {
      if (file.size > 100 * 1024 * 1024)
        throw new Error('工程超过 100 MiB 上限');
      const project = parseProject(await file.text());
      const nextImage = project.background
        ? await loadImage(project.background)
        : null;
      if (!confirmReplace()) return;
      setField(project.field);
      setHistory(new History());
      setName(project.name);
      setBackground(project.background);
      setImage(nextImage);
      setBrush(project.brush);
      setView(project.view);
      setFlipY(project.flipY);
      setDirty(false);
      setHand(false);
      setTick((t) => t + 1);
      notify('工程已恢复');
    });
  const importImage = (file: File) =>
    run(async () => {
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type))
        throw new Error('请选择 PNG、JPEG 或 WebP 图片');
      if (file.size > 20 * 1024 * 1024) throw new Error('底图文件最大 20 MiB');
      const src = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () =>
          typeof reader.result === 'string'
            ? resolve(reader.result)
            : reject(new Error('底图读取失败'));
        reader.onerror = () => reject(new Error('底图读取失败'));
        reader.readAsDataURL(file);
      });
      const next = await loadImage(src);
      setImage(next);
      setBackground(src);
      updateView({ background: true });
      edited();
      notify('底图已导入，保持比例居中显示');
    });
  const fresh = () => {
    if (!validSize(newW, newH)) {
      notify('宽高必须是 1–2048 的整数');
      return;
    }
    if (!confirmReplace()) return;
    setField(new FlowField(newW, newH));
    setHistory(new History());
    setName('未命名工程');
    setImage(null);
    setBackground(null);
    setBrush({ ...DEFAULT_BRUSH });
    setView({ ...DEFAULT_VIEW, rg: false });
    setFlipY(false);
    setHand(false);
    setDirty(false);
    setFitToken((t) => t + 1);
    setModal(null);
    setTick((t) => t + 1);
  };
  useEffect(() => {
    const before = (e: BeforeUnloadEvent) => {
      if (live.current.dirty) {
        e.preventDefault();
      }
    };
    window.addEventListener('beforeunload', before);
    return () => window.removeEventListener('beforeunload', before);
  }, []);
  const actions = useRef({ save, undo, redo });
  useLayoutEffect(() => {
    actions.current = { save, undo, redo };
  });
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (
        (e.target as HTMLElement).closest('input,textarea,select,dialog') ||
        document.querySelector('dialog[open]') ||
        live.current.busy ||
        drawing.current
      )
        return;
      const command = e.metaKey || e.ctrlKey;
      if (command && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void actions.current.save();
      } else if (command && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) actions.current.redo();
        else actions.current.undo();
      } else if (command && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        actions.current.redo();
      } else if (!command) {
        const k = e.key.toLowerCase();
        if (['b', 'e', 's'].includes(k)) {
          setHand(false);
          setBrush((b) => ({
            ...b,
            tool: k === 'b' ? 'brush' : k === 'e' ? 'erase' : 'smooth',
          }));
        }
        if (k === 'h') setHand(true);
        if (k === 'f') setFitToken((t) => t + 1);
        if (k === '[' || k === ']') {
          setBrush((b) => ({
            ...b,
            radius: Math.max(1, Math.min(256, b.radius + (k === ']' ? 4 : -4))),
          }));
          setDirty(true);
        }
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
  useEffect(
    () =>
      registerFlowTools(
        (document as Document & { modelContext?: FlowModelContext })
          .modelContext,
        {
          state: () => {
            const p = live.current;
            return {
              width: p.field.width,
              height: p.field.height,
              revision: p.field.revision,
              brush: p.brush,
              unsaved: p.dirty,
            };
          },
          brush: (b) => {
            if (live.current.busy || drawing.current)
              throw new Error('编辑或文件操作进行中');
            live.current.brush = b;
            live.current.dirty = true;
            setBrush(b);
            setDirty(true);
            setHand(false);
          },
          stroke: (b, points) => {
            const p = live.current;
            if (p.busy || drawing.current)
              throw new Error('编辑或文件操作进行中');
            const changed = applyStroke(p.field, p.history, b, points);
            if (changed) {
              p.dirty = true;
              edited();
            }
            return changed;
          },
        },
      ),
    [],
  );
  const hasFlow = useMemo(
    () => ({ tick, value: field.data.some((v) => v !== 0) }),
    [field, tick],
  ).value;
  const toolLabel =
    brush.tool === 'brush'
      ? '方向笔刷'
      : brush.tool === 'smooth'
        ? '平滑笔刷'
        : '擦除笔刷';
  return (
    <main className="editor" aria-busy={busy}>
      <header className="topbar">
        <div className="brand">
          <span className="brand-icon">
            <Waves />
          </span>
          <strong>FlowBrush</strong>
          <span className="version">BETA 1.0</span>
        </div>
        <div className="project-title">
          <input
            aria-label="工程名称"
            maxLength={128}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setDirty(true);
            }}
          />
          <span>{dirty ? '● 未保存' : '本地工程'}</span>
        </div>
        <nav aria-label="工程操作">
          <button
            title="新建工程"
            disabled={busy}
            onClick={() => setModal('new')}
          >
            <Plus />
            新建
          </button>
          <button
            title="打开工程"
            disabled={busy}
            onClick={() => projectInput.current?.click()}
          >
            <FolderOpen />
            打开
          </button>
          <button title="保存工程 · ⌘/Ctrl S" disabled={busy} onClick={save}>
            <Save />
            保存
          </button>
          <button
            className="primary"
            disabled={busy}
            onClick={() => setModal('export')}
          >
            <Download />
            导出 FlowMap
          </button>
        </nav>
      </header>
      <input
        ref={projectInput}
        type="file"
        accept=".flowbrush,application/json"
        hidden
        aria-label="打开 FlowBrush 工程"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) void importProject(file);
        }}
      />
      <input
        ref={imageInput}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        hidden
        aria-label="导入参考底图"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) void importImage(file);
        }}
      />
      <div className="workspace">
        <aside className="toolrail" aria-label="绘制工具">
          {(
            [
              { tool: 'brush', icon: MousePointer2, label: '绘制', key: 'B' },
              { tool: 'smooth', icon: Wind, label: '平滑', key: 'S' },
              { tool: 'erase', icon: Eraser, label: '擦除', key: 'E' },
            ] as const
          ).map((t) => (
            <button
              key={t.tool}
              aria-pressed={!hand && brush.tool === t.tool}
              title={`${t.label} · ${t.key}`}
              className={
                !hand && brush.tool === t.tool ? 'tool selected' : 'tool'
              }
              onClick={() => {
                setHand(false);
                updateBrush({ tool: t.tool });
              }}
            >
              <t.icon />
              <span>{t.label}</span>
            </button>
          ))}
          <div className="rail-divider" />
          <button
            className={hand ? 'tool selected' : 'tool'}
            title="平移 · H / 按住空格"
            aria-pressed={hand}
            onClick={() => setHand(!hand)}
          >
            <Hand />
            <span>平移</span>
          </button>
          <button
            className="tool"
            title="撤销 · ⌘/Ctrl Z"
            disabled={!history.past.length}
            onClick={undo}
          >
            <Undo2 />
            <span>撤销</span>
          </button>
          <button
            className="tool"
            title="重做 · ⌘/Ctrl Shift Z"
            disabled={!history.future.length}
            onClick={redo}
          >
            <Redo2 />
            <span>重做</span>
          </button>
          <div className="rail-spacer" />
          <button
            className="tool"
            title="Shader 接入说明"
            onClick={() => setModal('shader')}
          >
            <Code2 />
            <span>接入</span>
          </button>
        </aside>
        <section className="stage-column">
          <div className="canvas-bar">
            <div>
              <span className="live-dot" />
              流向画布{' '}
              <span className="muted">
                / {field.width} × {field.height}
              </span>
            </div>
            <div className="view-tabs">
              <button
                className={!view.rg ? 'active' : ''}
                onClick={() => updateView({ rg: false })}
              >
                流向
              </button>
              <button
                className={view.rg ? 'active' : ''}
                onClick={() => updateView({ rg: true })}
              >
                RG 编码
              </button>
            </div>
            <span className="mode-pill">
              <ArrowUpRight size={14} /> XY 向量场
            </span>
          </div>
          <div
            className="stage"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const file = e.dataTransfer.files[0];
              if (file) {
                if (file.name.endsWith('.flowbrush')) void importProject(file);
                else void importImage(file);
              }
            }}
          >
            <Viewport
              field={field}
              history={history}
              brush={brush}
              view={view}
              image={image}
              hand={hand}
              fitToken={fitToken}
              preview={preview}
              onView={updateView}
              onEdit={edited}
              onDrawing={(active) => {
                drawing.current = active;
              }}
              onWebGL={setWebglError}
            />
            {!hasFlow && !image && (
              <div className="empty-canvas">
                <div className="empty-glyph">
                  <Waves size={35} />
                  <ArrowUpRight size={20} />
                </div>
                <h1>让水流有方向</h1>
                <p>在画布上拖动，画出第一道水流</p>
                <span>也可拖入图片作为底图</span>
              </div>
            )}
            <div className="canvas-hint">
              <MousePointer2 size={14} />
              {hand
                ? '拖动画布移动视野'
                : brush.tool === 'brush'
                  ? '按住并拖动，绘制水流方向'
                  : brush.tool === 'smooth'
                    ? '轻扫局部，让相邻流向自然过渡'
                    : '涂抹区域，逐渐恢复静止'}
              <kbd>Space</kbd>平移
            </div>
            <div className="zoom-control">
              <button
                aria-label="缩小"
                onClick={() =>
                  updateView({ zoom: Math.max(0.05, view.zoom / 1.2) })
                }
              >
                <Minus />
              </button>
              <button
                className="zoom-value"
                title="恢复 100%"
                onClick={() => updateView({ zoom: 1 })}
              >
                {Math.round(view.zoom * 100)}%
              </button>
              <button
                aria-label="放大"
                onClick={() =>
                  updateView({ zoom: Math.min(16, view.zoom * 1.2) })
                }
              >
                <Plus />
              </button>
              <span className="vertical-divider" />
              <button
                aria-label="适应画布"
                title="适应画布 · F"
                onClick={() => setFitToken((t) => t + 1)}
              >
                <Maximize />
              </button>
            </div>
          </div>
          <footer className="statusbar">
            <span>
              <span className="live-dot" />
              {busy ? '正在处理…' : '就绪'}
              <span className="status-tool">{hand ? '平移' : toolLabel}</span>
            </span>
            <span>
              {field.width} × {field.height} px · Float32
            </span>
            <span title="图片与向量数据不会上传">
              仅在本机处理 <span className="local-square" />
            </span>
          </footer>
        </section>
        <aside className="inspector">
          <div className="panel-heading">
            <Settings2 size={16} />
            笔刷设置{' '}
            <span className="muted">{hand ? '平移模式' : toolLabel}</span>
          </div>
          <section className="panel-section brush-section">
            <div className="section-label">
              {toolLabel}
              <span>
                {brush.tool === 'brush'
                  ? 'B'
                  : brush.tool === 'smooth'
                    ? 'S'
                    : 'E'}
              </span>
            </div>
            {brush.tool === 'brush' ? (
              <>
                <div className="segmented">
                  <button
                    className={brush.mode === 'follow' ? 'active' : ''}
                    onClick={() => updateBrush({ mode: 'follow' })}
                  >
                    跟随笔画
                  </button>
                  <button
                    className={brush.mode === 'fixed' ? 'active' : ''}
                    onClick={() => updateBrush({ mode: 'fixed' })}
                  >
                    固定方向
                  </button>
                </div>
                {brush.mode === 'fixed' && (
                  <Range
                    label="方向角度"
                    value={brush.angle}
                    min={0}
                    max={360}
                    step={1}
                    unit="°"
                    onChange={(angle) => updateBrush({ angle })}
                  />
                )}
              </>
            ) : (
              <p className="muted">
                {brush.tool === 'smooth'
                  ? '柔化邻域向量，保留自然的流速变化。'
                  : '将局部流向与速度逐渐归零。'}
              </p>
            )}
            <Range
              label="笔刷半径"
              value={brush.radius}
              min={1}
              max={256}
              step={1}
              unit=" px"
              onChange={(radius) => updateBrush({ radius })}
            />
            {brush.tool === 'brush' && (
              <Range
                label="流动速度"
                value={brush.speed}
                onChange={(speed) => updateBrush({ speed })}
              />
            )}
            <Range
              label="笔刷强度"
              value={brush.strength}
              onChange={(strength) => updateBrush({ strength })}
            />
            <div className="brush-note">
              <span className="soft-brush" />
              <span>柔边笔刷</span>
              <span className="muted">[ / ] 调整大小</span>
            </div>
          </section>
          <section className="panel-section water-section">
            <div className="section-label">
              <Waves size={16} />
              水流预览<span className="live-label">LIVE</span>
            </div>
            <div className="water-preview">
              <canvas
                ref={preview}
                width={480}
                height={300}
                style={{ aspectRatio: `${field.width}/${field.height}` }}
                aria-label="动态水纹预览"
              />
              {webglError && (
                <div className="webgl-error">
                  <Info size={20} />
                  <span>{webglError}</span>
                </div>
              )}
              <button
                className="play-button"
                aria-label={view.playing ? '暂停预览' : '播放预览'}
                disabled={!!webglError}
                onClick={() => updateView({ playing: !view.playing })}
              >
                {view.playing ? <Pause /> : <Play />}
              </button>
              <span className="water-caption">
                示例水纹 · {view.rate.toFixed(1)}×
              </span>
            </div>
            <Range
              label="预览倍率"
              value={view.rate}
              min={0.1}
              max={3}
              step={0.1}
              unit="×"
              onChange={(rate) => updateView({ rate })}
            />
          </section>
          <section className="panel-section layer-section">
            <div className="section-label">
              <Layers size={16} />
              画布显示
            </div>
            <Toggle
              label="方向箭头"
              checked={view.arrows}
              onChange={(arrows) => updateView({ arrows })}
            >
              <ArrowUpRight size={16} />
            </Toggle>
            <Toggle
              label="RG 编码"
              checked={view.rg}
              onChange={(rg) => updateView({ rg })}
            >
              <span className="rg-swatch" />
            </Toggle>
          </section>
          <section className="panel-section">
            <div className="section-label">
              <ImageIcon size={16} />
              参考底图
              {image && (
                <button
                  className="icon-button"
                  title="移除底图"
                  aria-label="移除底图"
                  onClick={() => {
                    setImage(null);
                    setBackground(null);
                    edited();
                  }}
                >
                  <X />
                </button>
              )}
            </div>
            <button
              className={image ? 'image-import' : 'upload-button'}
              disabled={busy}
              onClick={() => imageInput.current?.click()}
            >
              {image ? (
                <>
                  <img src={background!} alt="当前参考底图缩略图" />
                  <span>
                    更换底图
                    <small>
                      {image.naturalWidth} × {image.naturalHeight}
                    </small>
                  </span>
                  <Upload />
                </>
              ) : (
                <>
                  <Upload size={22} />
                  <span>点击或拖入底图</span>
                  <small>PNG、JPG、WebP · 最大 20 MB</small>
                </>
              )}
            </button>
            {image && (
              <>
                <Toggle
                  label="显示底图"
                  checked={view.background}
                  onChange={(background) => updateView({ background })}
                />
                <Range
                  label="底图透明度"
                  value={view.opacity}
                  onChange={(opacity) => updateView({ opacity })}
                />
              </>
            )}
          </section>
          <section className="panel-section utility-section">
            <button
              className="subtle-danger"
              disabled={!hasFlow}
              onClick={() => {
                if (history.clearField(field)) {
                  edited();
                  notify('向量场已清空，可撤销');
                }
              }}
            >
              <Trash2 size={15} />
              清空向量场
            </button>
            <span className="muted">可撤销</span>
          </section>
        </aside>
      </div>
      {notice && (
        <output className="toast">
          <Info size={16} />
          {notice}
          <button onClick={() => setNotice('')} aria-label="关闭提示">
            <X size={14} />
          </button>
        </output>
      )}
      {busy && (
        <div className="busy-shield">
          <span className="spinner" />
          正在处理文件…
        </div>
      )}
      {modal === 'new' && (
        <Modal title="新建 FlowMap" onClose={() => setModal(null)}>
          <p className="modal-intro">
            选择纹理分辨率。每个像素保存一个流向向量。
          </p>
          <div className="preset-grid">
            {[256, 512, 1024, 2048].map((n) => (
              <button
                key={n}
                className={newW === n && newH === n ? 'active' : ''}
                onClick={() => {
                  setNewW(n);
                  setNewH(n);
                }}
              >
                {n}²
              </button>
            ))}
          </div>
          <div className="dimension-inputs">
            <label>
              宽度
              <input
                aria-label="画布宽度"
                type="number"
                min={1}
                max={2048}
                value={newW}
                onChange={(e) => setNewW(+e.target.value)}
              />
            </label>
            <X size={16} />
            <label>
              高度
              <input
                aria-label="画布高度"
                type="number"
                min={1}
                max={2048}
                value={newH}
                onChange={(e) => setNewH(+e.target.value)}
              />
            </label>
          </div>
          <p className="muted">支持非方形画布，单边最大 2048 px。</p>
          <div className="modal-actions">
            <button onClick={() => setModal(null)}>取消</button>
            <Button className="primary" onClick={fresh}>
              创建画布
              <ArrowUpRight />
            </Button>
          </div>
        </Modal>
      )}
      {modal === 'export' && (
        <Modal title="导出 FlowMap" onClose={() => setModal(null)}>
          <div className="export-summary">
            <PNGPreview field={field} flipY={flipY} />
            <div>
              <strong>{name || 'flowmap'}.png</strong>
              <p>
                {field.width} × {field.height} px
              </p>
              <span className="format-badge">PNG · RGBA 8-bit</span>
              <small>仅导出向量场，不包含底图或箭头</small>
            </div>
          </div>
          <Toggle
            label="反转 Y 分量（G 通道）"
            checked={flipY}
            onChange={(v) => {
              setFlipY(v);
              setDirty(true);
            }}
          />
          <p className="muted">
            {flipY
              ? '正 Y 向上。只反转向量符号，不翻转图像行序。'
              : '正 X 向右，正 Y 向下，与编辑画布一致。'}
          </p>
          <div className="encoding-info">
            <span>
              <i className="channel red">R</i>X 方向
            </span>
            <span>
              <i className="channel green">G</i>Y 方向
            </span>
            <span>
              <i className="channel blue">B</i>0
            </span>
            <span>
              <i className="channel">A</i>255
            </span>
          </div>
          <p className="import-note">
            <Info size={16} />
            引擎内关闭 sRGB，将其作为线性数据纹理读取。
          </p>
          <div className="modal-actions">
            <button
              onClick={() => {
                setModal('shader');
                setShaderTab(true);
              }}
            >
              <Code2 />
              接入示例
            </button>
            <Button
              disabled={busy}
              className="primary"
              onClick={() =>
                run(() => {
                  const p = live.current;
                  download(
                    encodePNG(p.field, p.flipY).buffer as ArrayBuffer,
                    `${safeName()}.png`,
                    'image/png',
                  );
                  setModal(null);
                  notify('FlowMap PNG 已导出');
                })
              }
            >
              <Download />
              下载 PNG
            </Button>
          </div>
        </Modal>
      )}
      {modal === 'shader' && (
        <Modal
          title="Shader 接入"
          onClose={() => {
            setModal(null);
            setShaderTab(false);
          }}
        >
          <p className="modal-intro">
            使用 RG 通道解码二维向量，向量长度表示流速。
          </p>
          <ul className="shader-notes">
            <li>
              FlowMap 使用线性采样，关闭 sRGB；建议关闭有损压缩与 mipmap。
            </li>
            <li>
              内部 Y 向下；按引擎 UV 约定选择是否反转 G。底图与 FlowMap
              必须使用一致的图像行序。
            </li>
            <li>
              静止像素为 (128, 128, 0, 255)。8
              位中点存在量化误差，示例对一个量化步长以内的向量归零。
            </li>
            <li>
              水纹设为 Repeat，FlowMap 设为
              Clamp。预览倍率只影响预览，不改变导出数据。
            </li>
          </ul>
          <pre className="shader-code">
            <code>{GLSL_EXAMPLE}</code>
          </pre>
          <div className="modal-actions">
            <button
              onClick={() =>
                download(GLSL_EXAMPLE, 'flowbrush.glsl', 'text/plain')
              }
            >
              <Download />
              下载 GLSL
            </button>
            <Button
              className="primary"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(GLSL_EXAMPLE);
                  notify('Shader 示例已复制');
                } catch {
                  notify('无法访问剪贴板，请下载 GLSL 文件');
                }
              }}
            >
              <Check />
              复制代码
            </Button>
            {shaderTab && (
              <button onClick={() => setModal('export')}>返回导出</button>
            )}
          </div>
        </Modal>
      )}
    </main>
  );
}
