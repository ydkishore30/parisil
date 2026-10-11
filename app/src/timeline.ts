import { hub } from "./data/hub";

/**
 * Shared time view for every panel: all plots show the same time range, and the
 * hover cursor and pinned time are mirrored across plots and the log view.
 */
class Timeline {
  /** Live mode: keep the right edge glued to the newest data. */
  follow = true;
  /** Visible seconds while following. */
  span = 20;
  t0 = 0;
  t1 = 1;
  cursor: number | null = null;
  pin: number | null = null;
  /** Where the pin was set, so the log view only scrolls for pins made elsewhere. */
  pinSource: "plot" | "log" = "plot";
  rev = 0;
  private listeners = new Set<() => void>();

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getRev = (): number => this.rev;

  private changed(): void {
    this.rev++;
    for (const fn of this.listeners) fn();
  }

  range(): [number, number] {
    if (!isFinite(hub.tMax)) return [0, this.span];
    if (hub.isLive && this.follow) return [hub.tMax - this.span, hub.tMax];
    return [this.t0, this.t1];
  }

  setSpan(span: number): void {
    this.span = span;
    this.follow = true;
    if (hub.bufferSec < span) hub.bufferSec = span;
    this.changed();
  }

  setFollow(on: boolean): void {
    if (!on) [this.t0, this.t1] = this.range();
    this.follow = on;
    this.changed();
  }

  /** Show everything that is loaded. */
  fit(): void {
    this.follow = false;
    this.t0 = isFinite(hub.tMin) ? hub.tMin : 0;
    this.t1 = isFinite(hub.tMax) && hub.tMax > this.t0 ? hub.tMax : this.t0 + 1;
    this.changed();
  }

  reset(): void {
    if (hub.isLive) this.setFollow(true);
    else this.fit();
  }

  zoom(factor: number, anchor: number): void {
    const [a, b] = this.range();
    if (hub.isLive && this.follow) {
      this.span = Math.min(Math.max(this.span * factor, 0.05), 3600);
      if (hub.bufferSec < this.span) hub.bufferSec = this.span;
    } else {
      if ((b - a) * factor < 1e-4) return;
      this.t0 = anchor - (anchor - a) * factor;
      this.t1 = anchor + (b - anchor) * factor;
    }
    this.changed();
  }

  pan(dt: number): void {
    const [a, b] = this.range();
    this.t0 = a + dt;
    this.t1 = b + dt;
    // Dragging back to the newest data resumes following.
    if (hub.isLive && this.t1 >= hub.tMax) {
      this.span = b - a;
      this.follow = true;
    } else this.follow = false;
    this.changed();
  }

  setCursor(t: number | null): void {
    this.cursor = t;
  }

  setPin(t: number | null, source: "plot" | "log"): void {
    this.pin = t;
    this.pinSource = source;
    this.changed();
  }
}

export const timeline = new Timeline();
