/** Compact number for readouts: keeps ~5 significant digits without exponent noise. */
export function formatValue(v: number): string {
  if (Number.isNaN(v)) return "–";
  if (!isFinite(v)) return v > 0 ? "∞" : "−∞";
  const a = Math.abs(v);
  if (a === 0) return "0";
  if (a >= 1e7 || a < 1e-4) return v.toExponential(3).replace("-", "−");
  const digits = a >= 1000 ? 1 : a >= 100 ? 2 : a >= 1 ? 3 : 4;
  return v.toFixed(digits).replace("-", "−");
}

/** Axis tick label with just enough decimals for the tick step. */
export function formatTick(v: number, step: number): string {
  if (v === 0) return "0";
  // Very large or very small scales read better in scientific notation.
  if (Math.abs(v) >= 1e6 || step < 1e-4) return v.toExponential(1).replace("-", "−");
  const decimals = Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
  return v.toFixed(decimals).replace("-", "−");
}

/** Seconds since the session origin, as s or m:ss. */
export function formatTime(sec: number, step = 1): string {
  const decimals = Math.max(0, Math.min(4, -Math.floor(Math.log10(step) + 1e-9)));
  if (Math.abs(sec) < 120) return `${sec.toFixed(decimals).replace("-", "−")}s`;
  const sign = sec < 0 ? "−" : "";
  const a = Math.abs(sec);
  const m = Math.floor(a / 60);
  const s = a - m * 60;
  return `${sign}${m}:${s.toFixed(decimals).padStart(decimals ? decimals + 3 : 2, "0")}`;
}

export function niceTicks(min: number, max: number, target: number): { ticks: number[]; step: number } {
  const span = max - min;
  if (!(span > 0) || !isFinite(span)) return { ticks: [min], step: 1 };
  const raw = span / Math.max(1, target);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm < 1.5 ? 1 : norm < 3.5 ? 2 : norm < 7.5 ? 5 : 10) * mag;
  const ticks: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) ticks.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  return { ticks, step };
}

export function formatRate(hz: number): string {
  if (!hz) return "";
  return hz >= 100 ? `${Math.round(hz)} Hz` : `${hz.toFixed(hz < 10 ? 1 : 0)} Hz`;
}

export function formatBytes(bps: number): string {
  if (!bps) return "";
  if (bps < 1024) return `${bps} B/s`;
  if (bps < 1024 * 1024) return `${(bps / 1024).toFixed(1)} kB/s`;
  return `${(bps / 1024 / 1024).toFixed(2)} MB/s`;
}

/** "sensor_msgs/msg/Imu" -> "Imu" */
export function shortType(type: string): string {
  return type.slice(type.lastIndexOf("/") + 1);
}
