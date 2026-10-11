import type { IDockviewPanelProps } from "dockview-react";
import { useEffect, useRef } from "react";
import { hub, splitSeriesId } from "../data/hub";
import type { Series } from "../data/series";
import { formatTick, formatTime, formatValue, niceTicks } from "../format";
import { useUI, type PlotSeries } from "../state";
import { timeline } from "../timeline";
import { plotSeries } from "../workspace";
import { Icon } from "./Icon";

export const SERIES_MIME = "application/x-parisil-series";

const M = { left: 58, right: 14, top: 12, bottom: 26 };

interface Palette {
  surface: string;
  grid: string;
  axis: string;
  muted: string;
  text: string;
  accent: string;
  series: string[];
}

let paletteCache: { theme: string; palette: Palette } | null = null;

function getPalette(theme: string): Palette {
  if (paletteCache?.theme === theme) return paletteCache.palette;
  const css = getComputedStyle(document.documentElement);
  const v = (name: string) => css.getPropertyValue(name).trim();
  const palette: Palette = {
    surface: v("--plot-surface"),
    grid: v("--plot-grid"),
    axis: v("--plot-axis"),
    muted: v("--text-muted"),
    text: v("--text"),
    accent: v("--accent"),
    series: Array.from({ length: 8 }, (_, i) => v(`--series-${i + 1}`)),
  };
  paletteCache = { theme, palette };
  return palette;
}

interface Live {
  series: Map<string, Series>;
  config: PlotSeries[];
  values: Map<string, HTMLSpanElement>;
  theme: string;
}

function draw(canvas: HTMLCanvasElement, live: Live): void {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (w < 40 || h < 40) return;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext("2d")!;
  const pal = getPalette(live.theme);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  if (live.config.length === 0) return;
  const pw = w - M.left - M.right;
  const ph = h - M.top - M.bottom;
  const [a, b] = timeline.range();
  const xOf = (t: number) => M.left + ((t - a) / (b - a)) * pw;

  // Visible index window per series and the y extent of what is visible.
  const windows: { s: Series; i0: number; i1: number; color: string; id: string }[] = [];
  let lo = Infinity;
  let hi = -Infinity;
  for (const cfg of live.config) {
    const s = live.series.get(cfg.id);
    if (!s) continue;
    const i0 = Math.max(s.start, s.lowerBound(a) - 1);
    const i1 = Math.min(s.end, s.lowerBound(b) + 1);
    for (let i = i0; i < i1; i++) {
      const y = s.v[i];
      if (y < lo) lo = y;
      if (y > hi) hi = y;
    }
    windows.push({ s, i0, i1, color: pal.series[cfg.slot] ?? pal.text, id: cfg.id });
  }
  if (!isFinite(lo) || !isFinite(hi)) {
    lo = 0;
    hi = 1;
  } else if (hi - lo < 1e-12) {
    const pad = Math.abs(hi) * 0.1 || 0.5;
    lo -= pad;
    hi += pad;
  } else {
    const pad = (hi - lo) * 0.08;
    lo -= pad;
    hi += pad;
  }
  const yOf = (v: number) => M.top + (1 - (v - lo) / (hi - lo)) * ph;

  // Grid and axis labels (recessive: hairlines and muted ink).
  ctx.font = "11px ui-sans-serif, system-ui, sans-serif";
  ctx.lineWidth = 1;
  ctx.strokeStyle = pal.grid;
  ctx.fillStyle = pal.muted;
  ctx.textBaseline = "middle";
  ctx.textAlign = "right";
  const yTicks = niceTicks(lo, hi, Math.max(2, Math.floor(ph / 44)));
  for (const v of yTicks.ticks) {
    const y = Math.round(yOf(v)) + 0.5;
    ctx.beginPath();
    ctx.moveTo(M.left, y);
    ctx.lineTo(w - M.right, y);
    ctx.stroke();
    ctx.fillText(formatTick(v, yTicks.step), M.left - 8, y);
  }
  const origin = Number.isNaN(hub.origin) ? 0 : hub.origin;
  const xTicks = niceTicks(a - origin, b - origin, Math.max(2, Math.floor(pw / 96)));
  ctx.textBaseline = "top";
  ctx.textAlign = "center";
  for (const rel of xTicks.ticks) {
    const x = Math.round(xOf(rel + origin)) + 0.5;
    ctx.beginPath();
    ctx.moveTo(x, M.top);
    ctx.lineTo(x, M.top + ph);
    ctx.stroke();
    ctx.fillText(formatTime(rel, xTicks.step), x, M.top + ph + 7);
  }
  ctx.strokeStyle = pal.axis;
  ctx.beginPath();
  ctx.moveTo(M.left, M.top + ph + 0.5);
  ctx.lineTo(w - M.right, M.top + ph + 0.5);
  ctx.stroke();

  // Series.
  ctx.save();
  ctx.beginPath();
  ctx.rect(M.left, M.top - 2, pw, ph + 4);
  ctx.clip();
  ctx.lineWidth = 2;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  for (const { s, i0, i1, color } of windows) {
    if (i1 - i0 < 1) continue;
    ctx.strokeStyle = color;
    ctx.beginPath();
    let pen = false;
    if (i1 - i0 > pw * 3) {
      // More samples than pixels: draw each pixel column's first/min/max/last.
      let col = -1;
      let first = 0;
      let last = 0;
      let mn = 0;
      let mx = 0;
      const flush = () => {
        if (col < 0) return;
        const x = M.left + col + 0.5;
        if (pen) ctx.lineTo(x, yOf(first));
        else ctx.moveTo(x, yOf(first));
        ctx.lineTo(x, yOf(mn));
        ctx.lineTo(x, yOf(mx));
        ctx.lineTo(x, yOf(last));
        pen = true;
      };
      for (let i = i0; i < i1; i++) {
        const y = s.v[i];
        if (y !== y) continue;
        const c = Math.floor(xOf(s.t[i]) - M.left);
        if (c !== col) {
          flush();
          col = c;
          first = mn = mx = y;
        } else {
          if (y < mn) mn = y;
          if (y > mx) mx = y;
        }
        last = y;
      }
      flush();
    } else {
      for (let i = i0; i < i1; i++) {
        const y = s.v[i];
        if (y !== y) {
          pen = false;
          continue;
        }
        if (pen) ctx.lineTo(xOf(s.t[i]), yOf(y));
        else ctx.moveTo(xOf(s.t[i]), yOf(y));
        pen = true;
      }
    }
    ctx.stroke();
  }
  ctx.restore();

  // Pinned time (set by clicking a plot or a log line).
  const pin = timeline.pin;
  if (pin !== null && pin >= a && pin <= b) {
    const x = Math.round(xOf(pin)) + 0.5;
    ctx.strokeStyle = pal.accent;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(x, M.top);
    ctx.lineTo(x, M.top + ph);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Crosshair shared by every plot, with a marker on each series' nearest sample.
  const cursor = timeline.cursor;
  const readAt = cursor !== null && cursor >= a && cursor <= b ? cursor : null;
  if (readAt !== null) {
    const x = Math.round(xOf(readAt)) + 0.5;
    ctx.strokeStyle = pal.muted;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, M.top);
    ctx.lineTo(x, M.top + ph);
    ctx.stroke();
    const label = formatTime(readAt - origin, (b - a) / 200);
    const tw = ctx.measureText(label).width + 10;
    const lx = Math.min(Math.max(x - tw / 2, M.left), w - M.right - tw);
    ctx.fillStyle = pal.text;
    ctx.beginPath();
    ctx.roundRect(lx, M.top + ph + 4, tw, 17, 4);
    ctx.fill();
    ctx.fillStyle = pal.surface;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(label, lx + 5, M.top + ph + 13);
  }
  for (const { s, color, id } of windows) {
    // Read the sample under the crosshair; outside the recorded range fall back to the newest one.
    const covered = readAt !== null && s.length > 0 && readAt >= s.t[s.start] && readAt <= s.t[s.end - 1];
    const i = covered ? s.nearest(readAt) : s.end - 1;
    const el = live.values.get(id);
    const ok = i >= s.start && i < s.end;
    if (el) el.textContent = ok ? formatValue(s.v[i]) : "–";
    if (!covered || !ok || s.v[i] !== s.v[i]) continue;
    const px = xOf(s.t[i]);
    if (px < M.left || px > w - M.right) continue;
    ctx.beginPath();
    ctx.arc(px, yOf(s.v[i]), 4, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = pal.surface;
    ctx.stroke();
  }
}

export function PlotPanel({ params, api }: IDockviewPanelProps<{ plotId: string }>) {
  const plotId = params.plotId;
  const config = useUI((s) => s.plots[plotId]?.series) ?? EMPTY;
  const active = useUI((s) => s.activePlot === plotId);
  const theme = useUI((s) => s.theme);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const live = useRef<Live>({ series: new Map(), config, values: new Map(), theme });
  const dirty = useRef(true);

  live.current.config = config;
  live.current.theme = theme;
  dirty.current = true;

  // Keep hub series in step with the plot's configuration.
  useEffect(() => {
    const held = live.current.series;
    const wanted = new Set(config.map((c) => c.id));
    for (const id of wanted) if (!held.has(id)) held.set(id, hub.acquireSeries(id));
    for (const id of [...held.keys()]) {
      if (!wanted.has(id)) {
        held.delete(id);
        hub.releaseSeries(id);
      }
    }
    api.setTitle(config.length ? config.map((c) => leafName(c.id)).join(", ") : "Plot");
    dirty.current = true;
  }, [config, api]);

  useEffect(() => {
    const held = live.current.series;
    return () => {
      for (const id of held.keys()) hub.releaseSeries(id);
      held.clear();
    };
  }, []);

  // Redraw on animation frames, only when something visible changed.
  useEffect(() => {
    const canvas = canvasRef.current!;
    let raf = 0;
    let seen = "";
    const frame = () => {
      raf = requestAnimationFrame(frame);
      const [a, b] = timeline.range();
      const key = `${hub.dataRev}|${a}|${b}|${timeline.cursor}|${timeline.pin}|${canvas.clientWidth}x${canvas.clientHeight}`;
      if (key === seen && !dirty.current) return;
      seen = key;
      dirty.current = false;
      draw(canvas, live.current);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  // Pointer interaction: hover = crosshair, wheel = zoom time, drag = pan, click = pin.
  useEffect(() => {
    const canvas = canvasRef.current!;
    const timeAt = (ev: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const [a, b] = timeline.range();
      const frac = (ev.clientX - rect.left - M.left) / (rect.width - M.left - M.right);
      return a + Math.min(Math.max(frac, 0), 1) * (b - a);
    };
    let drag: { x: number; moved: boolean } | null = null;
    const onWheel = (ev: WheelEvent) => {
      ev.preventDefault();
      timeline.zoom(Math.pow(1.0015, ev.deltaY), timeAt(ev));
    };
    const onDown = (ev: PointerEvent) => {
      if (ev.button !== 0) return;
      drag = { x: ev.clientX, moved: false };
      canvas.setPointerCapture(ev.pointerId);
    };
    const onMove = (ev: PointerEvent) => {
      if (drag) {
        const dx = ev.clientX - drag.x;
        if (!drag.moved && Math.abs(dx) < 4) return;
        drag.moved = true;
        drag.x = ev.clientX;
        const [a, b] = timeline.range();
        timeline.pan((-dx / (canvas.clientWidth - M.left - M.right)) * (b - a));
        timeline.setCursor(null);
      } else timeline.setCursor(timeAt(ev));
    };
    const onUp = (ev: PointerEvent) => {
      if (drag && !drag.moved) {
        const t = timeAt(ev);
        const [a, b] = timeline.range();
        const near = timeline.pin !== null && Math.abs(timeline.pin - t) < (b - a) * 0.01;
        timeline.setPin(near ? null : t, "plot");
      }
      drag = null;
    };
    const onLeave = () => timeline.setCursor(null);
    const onDouble = () => timeline.reset();
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointerleave", onLeave);
    canvas.addEventListener("dblclick", onDouble);
    return () => {
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointerleave", onLeave);
      canvas.removeEventListener("dblclick", onDouble);
    };
  }, []);

  const ui = useUI.getState();
  return (
    <div
      className={`plot${active ? " plot-active" : ""}`}
      onPointerDownCapture={() => ui.setActivePlot(plotId)}
      onDragOver={(ev) => {
        if (ev.dataTransfer.types.includes(SERIES_MIME)) {
          ev.preventDefault();
          ev.dataTransfer.dropEffect = "copy";
        }
      }}
      onDrop={(ev) => {
        const data = ev.dataTransfer.getData(SERIES_MIME);
        if (!data) return;
        ev.preventDefault();
        ui.setActivePlot(plotId);
        plotSeries(JSON.parse(data) as string[]);
      }}
    >
      <canvas ref={canvasRef} />
      {config.length === 0 ? (
        <div className="plot-empty">
          <Icon name="plot" size={22} />
          <div>Click a field in the sidebar, or drag it here</div>
        </div>
      ) : (
        <div className="legend">
          {config.map((c) => {
            const { topic, field } = splitSeriesId(c.id);
            return (
              <div className="legend-row" key={c.id} title={`${topic} → ${field}`}>
                <span className="legend-swatch" style={{ background: `var(--series-${c.slot + 1})` }} />
                <span className="legend-topic">{topic}</span>
                <span className="legend-field">{field}</span>
                <span
                  className="legend-value"
                  ref={(el) => {
                    if (el) live.current.values.set(c.id, el);
                    else live.current.values.delete(c.id);
                  }}
                />
                <button className="legend-remove" title="Remove from plot" onClick={() => ui.removeSeries(plotId, c.id)}>
                  <Icon name="close" size={11} />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const EMPTY: PlotSeries[] = [];

function leafName(id: string): string {
  const { topic, field } = splitSeriesId(id);
  const parts = field.split(".");
  // "x" alone says little; keep its parent ("linear.x") or fall back to the topic.
  return parts.length > 1 ? parts.slice(-2).join(".") : `${topic.slice(topic.lastIndexOf("/") + 1)}.${field}`;
}
