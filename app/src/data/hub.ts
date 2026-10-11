import { extract, getDecoder, parseFieldPath, type Decoder, type Key, type TopicInfo } from "./ros";
import { Series } from "./series";

export interface LogEntry {
  id: number;
  t: number;
  level: number;
  name: string;
  msg: string;
  file: string;
  line: number;
  fn: string;
}

export interface DiagStatus {
  name: string;
  level: number;
  message: string;
  hardwareId: string;
  values: { key: string; value: string }[];
  t: number;
}

export interface TopicStats {
  count: number;
  hz: number;
  bps: number;
  winCount: number;
  winBytes: number;
}

export interface Param {
  name: string;
  value: unknown;
  type?: string;
}

export interface NodeEvent {
  /** Wall-clock milliseconds. */
  at: number;
  node: string;
  kind: "joined" | "left";
}

export interface SilentTopic {
  topic: string;
  /** "never": nothing since subscribing. "stalled": data was flowing and stopped. */
  kind: "never" | "stalled";
  seconds: number;
  publishers: number | null;
}

interface Arrival {
  since: number;
  count: number;
  first: number;
  last: number;
}

export type MessageSink = (t: number, data: Uint8Array) => void;

export interface Source {
  kind: "live" | "file";
  label: string;
  /** Live sources: start or stop receiving a topic. */
  setSubscribed?(topic: string, on: boolean): void;
  /** File sources: read up to `limit` messages of a topic in time order. */
  readTopic?(topic: string, sink: MessageSink, limit?: number): Promise<void>;
  requestParameters?(): void;
  setParameter?(param: Param): void;
  close(): void;
}

export type Status = "idle" | "connecting" | "live" | "file" | "error";

interface SeriesEntry {
  id: string;
  topic: string;
  keys: Key[];
  series: Series;
  refs: number;
  /** File mode: buffer still has to be filled from the file. */
  pending: boolean;
}

const LOG_TYPE = "rcl_interfaces/msg/Log";
const DIAG_TYPE = "diagnostic_msgs/msg/DiagnosticArray";
const MAX_LOGS = 50_000;
const MAX_HISTORY_BYTES = 8 << 20;
const PEEK_INTERVAL = 0.2;

export function seriesId(topic: string, field: string): string {
  return `${topic}:${field}`;
}

export function splitSeriesId(id: string): { topic: string; field: string } {
  const i = id.indexOf(":");
  return { topic: id.slice(0, i), field: id.slice(i + 1) };
}

/**
 * Central data store. Sources push raw messages in; panels read series buffers,
 * logs and diagnostics out. Lives outside React so high-rate data never triggers
 * renders by itself — components poll `rev` (throttled) and plots poll `dataRev`.
 */
class Hub {
  status: Status = "idle";
  statusText = "";
  source: Source | null = null;

  topics = new Map<string, TopicInfo>();
  stats = new Map<string, TopicStats>();
  samples = new Map<string, unknown>();
  logs: LogEntry[] = [];
  diags = new Map<string, DiagStatus>();
  publishers = new Map<string, string[]>();
  subscribers = new Map<string, string[]>();
  services = new Map<string, { type: string; providers: string[] }>();
  params: Param[] = [];
  paramsLoading = false;

  /** Nodes that appeared or vanished from the graph, newest last. */
  nodeEvents: NodeEvent[] = [];

  /** Time of the first / latest message seen, in seconds since the epoch. */
  tMin = Infinity;
  tMax = -Infinity;
  /** Time shown as zero on time axes (first message of the session or file). */
  origin = NaN;
  /** Seconds of live history to keep. */
  bufferSec = 120;

  /** Bumped (throttled) when anything UI-visible changed. */
  rev = 0;
  /** Bumped on every plotted sample. */
  dataRev = 0;
  /** Bumped when buffers were cleared, so views can reset. */
  epoch = 0;

  private retains = new Map<string, Set<string>>();
  /** Wall-clock arrival bookkeeping per subscribed topic, to spot topics that deliver nothing. */
  private arrivals = new Map<string, Arrival>();
  private knownNodes: Set<string> | null = null;
  private graphSettledAt = 0;
  private series = new Map<string, SeriesEntry>();
  private byTopic = new Map<string, SeriesEntry[]>();
  private history = new Map<string, { bytes: number; msgs: { t: number; data: Uint8Array }[] }>();
  private lastPeek = new Map<string, number>();
  private listeners = new Set<() => void>();
  private emitTimer: number | undefined;
  private logId = 0;
  private fillQueue: Promise<void> = Promise.resolve();
  private fillScheduled = new Set<string>();

  constructor() {
    setInterval(() => this.tick(), 1000);
  }

  // ---- change notification -------------------------------------------------

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getRev = (): number => this.rev;

  /** Notify React listeners, at most ~6 times a second. */
  emit(): void {
    if (this.emitTimer !== undefined) return;
    this.emitTimer = window.setTimeout(() => this.emitNow(), 160);
  }

  emitNow(): void {
    clearTimeout(this.emitTimer);
    this.emitTimer = undefined;
    this.rev++;
    for (const fn of this.listeners) fn();
  }

  // ---- source management ---------------------------------------------------

  get isLive(): boolean {
    return this.source?.kind === "live";
  }

  setSource(source: Source | null): void {
    this.source?.close();
    this.source = source;
    this.reset();
    this.status = source ? (source.kind === "live" ? "connecting" : "file") : "idle";
    this.statusText = source?.label ?? "";
    this.emitNow();
  }

  setStatus(status: Status, text?: string): void {
    this.status = status;
    if (text !== undefined) this.statusText = text;
    this.emitNow();
  }

  /** Drops all received data but keeps what the UI asked for (series, retains). */
  reset(): void {
    this.topics.clear();
    this.stats.clear();
    this.samples.clear();
    this.logs = [];
    this.diags.clear();
    this.publishers.clear();
    this.subscribers.clear();
    this.services.clear();
    this.params = [];
    this.history.clear();
    this.lastPeek.clear();
    this.nodeEvents = [];
    this.knownNodes = null;
    const now = Date.now();
    for (const a of this.arrivals.values()) Object.assign(a, { since: now, count: 0, first: 0, last: 0 });
    this.tMin = Infinity;
    this.tMax = -Infinity;
    this.origin = NaN;
    // Sidebar and auto-subscriptions re-request their topics for the new source.
    for (const [topic, set] of this.retains) {
      set.delete("peek");
      set.delete("auto");
      if (!set.size) this.retains.delete(topic);
    }
    for (const e of this.series.values()) {
      e.series.clear();
      e.pending = true;
    }
    this.epoch++;
    this.dataRev++;
  }

  /** Clears plotted history without disconnecting. */
  clearData(): void {
    for (const e of this.series.values()) e.series.clear();
    this.history.clear();
    this.logs = [];
    this.tMin = this.tMax;
    this.epoch++;
    this.dataRev++;
    this.emitNow();
  }

  setTopics(infos: TopicInfo[], removed: string[] = []): void {
    for (const name of removed) this.topics.delete(name);
    for (const info of infos) {
      this.topics.set(info.name, info);
      if (info.schemaName === LOG_TYPE || info.schemaName === DIAG_TYPE) this.retain(info.name, "auto");
      else if (this.retains.get(info.name)?.size) this.source?.setSubscribed?.(info.name, true);
      if (this.source?.kind === "file" && this.byTopic.get(info.name)?.length) this.scheduleFill(info.name);
    }
    this.emitNow();
  }

  // ---- topic retention -----------------------------------------------------

  /** Asks for a topic to be received. `token` identifies the consumer. */
  retain(topic: string, token: string): void {
    let set = this.retains.get(topic);
    if (!set) this.retains.set(topic, (set = new Set()));
    if (set.has(token)) return;
    set.add(token);
    if (!this.arrivals.has(topic)) this.arrivals.set(topic, { since: Date.now(), count: 0, first: 0, last: 0 });
    const src = this.source;
    if (!src) return;
    if (src.kind === "live") {
      if (set.size === 1) src.setSubscribed?.(topic, true);
    } else if (token === "peek") {
      void this.enqueue(() => src.readTopic!(topic, (t, data) => this.onMessage(topic, t, data), 1));
    } else if (token === "auto") {
      void this.enqueue(() => src.readTopic!(topic, (t, data) => this.onMessage(topic, t, data)));
    }
  }

  release(topic: string, token: string): void {
    const set = this.retains.get(topic);
    if (!set?.delete(token)) return;
    if (set.size === 0) {
      this.retains.delete(topic);
      this.arrivals.delete(topic);
      this.source?.setSubscribed?.(topic, false);
      const st = this.stats.get(topic);
      if (st) st.hz = st.bps = 0;
    }
  }

  isRetained(topic: string, token: string): boolean {
    return this.retains.get(topic)?.has(token) ?? false;
  }

  /** Topics the active source should currently deliver. */
  wantedTopics(): string[] {
    return [...this.retains.keys()];
  }

  // ---- series --------------------------------------------------------------

  acquireSeries(id: string): Series {
    let e = this.series.get(id);
    if (!e) {
      const { topic, field } = splitSeriesId(id);
      e = { id, topic, keys: parseFieldPath(field), series: new Series(), refs: 0, pending: true };
      this.series.set(id, e);
      const list = this.byTopic.get(topic);
      if (list) list.push(e);
      else this.byTopic.set(topic, [e]);
      this.retain(topic, "series");
      if (this.source?.kind === "file") this.scheduleFill(topic);
      else this.backfill(e);
    }
    e.refs++;
    return e.series;
  }

  releaseSeries(id: string): void {
    const e = this.series.get(id);
    if (!e || --e.refs > 0) return;
    this.series.delete(id);
    const list = (this.byTopic.get(e.topic) ?? []).filter((x) => x !== e);
    if (list.length) this.byTopic.set(e.topic, list);
    else {
      this.byTopic.delete(e.topic);
      this.history.delete(e.topic);
      this.release(e.topic, "series");
    }
  }

  /** Live mode: fill a newly added field from the raw messages already buffered for its topic. */
  private backfill(e: SeriesEntry): void {
    e.pending = false;
    const hist = this.history.get(e.topic);
    const info = this.topics.get(e.topic);
    const decode = info && getDecoder(info);
    if (!hist || !decode) return;
    for (const m of hist.msgs) {
      try {
        e.series.push(m.t, extract(decode(m.data), e.keys));
      } catch {
        // skip undecodable message
      }
    }
    this.dataRev++;
  }

  private enqueue(job: () => Promise<void>): Promise<void> {
    this.fillQueue = this.fillQueue.then(job).catch((err) => console.error("parisil: read failed", err));
    return this.fillQueue;
  }

  /** File mode: (re)read a topic to fill the series that do not have their data yet. */
  private scheduleFill(topic: string): void {
    if (this.fillScheduled.has(topic)) return;
    this.fillScheduled.add(topic);
    const src = this.source;
    void this.enqueue(async () => {
      this.fillScheduled.delete(topic);
      const info = this.topics.get(topic);
      const decode = info && getDecoder(info);
      const pending = (this.byTopic.get(topic) ?? []).filter((e) => e.pending);
      if (!src?.readTopic || src !== this.source || !decode || !pending.length) return;
      for (const e of pending) e.series.clear();
      await src.readTopic(topic, (t, data) => {
        const msg = decode(data);
        for (const e of pending) e.series.push(t, extract(msg, e.keys));
      });
      for (const e of pending) e.pending = false;
      this.dataRev++;
      this.emit();
    });
  }

  // ---- ingest --------------------------------------------------------------

  onMessage(topic: string, t: number, data: Uint8Array): void {
    if (t < this.tMin) this.tMin = t;
    if (t > this.tMax) this.tMax = t;
    // Latched log lines arrive with their original (old) timestamps; do not anchor the axis on them.
    if (Number.isNaN(this.origin) && !(this.isLive && this.topics.get(topic)?.schemaName === LOG_TYPE)) this.origin = t;

    // File sources publish exact counts up front; only live traffic is measured here.
    if (this.source?.kind === "live") {
      let st = this.stats.get(topic);
      if (!st) this.stats.set(topic, (st = { count: 0, hz: 0, bps: 0, winCount: 0, winBytes: 0 }));
      st.count++;
      st.winCount++;
      st.winBytes += data.byteLength;
      const a = this.arrivals.get(topic);
      if (a) {
        a.last = Date.now();
        if (!a.count++) a.first = a.last;
      }
    }

    const info = this.topics.get(topic);
    if (!info) return;
    const entries = this.byTopic.get(topic);
    const live = this.source?.kind === "live";
    const hasSeries = live && !!entries?.length;
    const isLog = info.schemaName === LOG_TYPE;
    const isDiag = info.schemaName === DIAG_TYPE;
    let wantSample = false;
    if (!hasSeries && !isLog && !isDiag) {
      // Only being inspected in the sidebar: decoding a few times a second is enough.
      if (!this.retains.get(topic)?.has("peek") || t - (this.lastPeek.get(topic) ?? -1) < PEEK_INTERVAL) return;
      wantSample = true;
    }
    const decode: Decoder | null = getDecoder(info);
    if (!decode) return;
    let msg: unknown;
    try {
      msg = decode(data);
    } catch (err) {
      console.warn(`parisil: failed to decode a message on ${topic}`, err);
      return;
    }
    this.samples.set(topic, msg);
    if (wantSample) this.lastPeek.set(topic, t);

    if (hasSeries) {
      for (const e of entries!) e.series.push(t, extract(msg, e.keys));
      this.dataRev++;
      let hist = this.history.get(topic);
      if (!hist) this.history.set(topic, (hist = { bytes: 0, msgs: [] }));
      hist.msgs.push({ t, data });
      hist.bytes += data.byteLength;
    }
    if (isLog) this.addLog(t, msg as Record<string, unknown>);
    if (isDiag) this.addDiagnostics(t, msg as { status?: Record<string, unknown>[] });
    this.emit();
  }

  private addLog(t: number, m: Record<string, unknown>): void {
    // Replayed history can arrive out of order; keep the list sorted by time.
    let at = this.logs.length;
    while (at > 0 && this.logs[at - 1].t > t) at--;
    this.logs.splice(at, 0, {
      id: this.logId++,
      t,
      level: Number(m.level ?? 0),
      name: String(m.name ?? ""),
      msg: String(m.msg ?? ""),
      file: String(m.file ?? ""),
      line: Number(m.line ?? 0),
      fn: String(m.function ?? ""),
    });
    if (this.isLive && this.logs.length > MAX_LOGS) this.logs = this.logs.slice(MAX_LOGS / 5);
  }

  private addDiagnostics(t: number, m: { status?: Record<string, unknown>[] }): void {
    for (const s of m.status ?? []) {
      const name = String(s.name ?? "");
      this.diags.set(name, {
        name,
        level: Number(s.level ?? 0),
        message: String(s.message ?? ""),
        hardwareId: String(s.hardware_id ?? ""),
        values: ((s.values as { key: string; value: string }[]) ?? []).map((kv) => ({
          key: String(kv.key),
          value: String(kv.value),
        })),
        t,
      });
    }
  }

  // ---- health -------------------------------------------------------------

  /**
   * Subscribed topics that deliver nothing — the "it is in the topic list but I get no data"
   * situation typical of QoS mismatches and broken DDS transports.
   */
  silentTopics(): SilentTopic[] {
    if (!this.isLive || this.status !== "live") return [];
    const now = Date.now();
    const out: SilentTopic[] = [];
    for (const [topic, a] of this.arrivals) {
      if (!this.topics.has(topic)) continue;
      const tokens = this.retains.get(topic);
      // Log and diagnostic topics are bursty by nature; only flag what the user asked to see.
      if (!tokens || (tokens.size === 1 && tokens.has("auto"))) continue;
      const publishers = this.publishers.get(topic)?.length ?? null;
      if (a.count === 0) {
        if (now - a.since > 5000) out.push({ topic, kind: "never", seconds: (now - a.since) / 1000, publishers });
      } else if (a.count >= 3) {
        const period = (a.last - a.first) / (a.count - 1);
        if (now - a.last > Math.max(3000, period * 10)) out.push({ topic, kind: "stalled", seconds: (now - a.last) / 1000, publishers });
      }
    }
    return out.sort((x, y) => x.topic.localeCompare(y.topic));
  }

  /** Topics somebody subscribes to but nobody publishes (often a typo or a missing remap). */
  unpublishedTopics(): { topic: string; subscribers: string[] }[] {
    const out: { topic: string; subscribers: string[] }[] = [];
    for (const [topic, subs] of this.subscribers) {
      if (this.publishers.get(topic)?.length) continue;
      const others = subs.filter((s) => !s.endsWith("/foxglove_bridge"));
      if (others.length) out.push({ topic, subscribers: others });
    }
    return out.sort((x, y) => x.topic.localeCompare(y.topic));
  }

  /** Call after the connection graph changed: records nodes that joined or left. */
  graphChanged(): void {
    const nodes = new Set<string>();
    for (const ids of this.publishers.values()) for (const id of ids) nodes.add(id);
    for (const ids of this.subscribers.values()) for (const id of ids) nodes.add(id);
    for (const s of this.services.values()) for (const id of s.providers) nodes.add(id);
    const now = Date.now();
    if (!this.knownNodes) this.graphSettledAt = now + 5000;
    else if (now > this.graphSettledAt) {
      // The first seconds after connecting are discovery, not real joins.
      for (const n of nodes) if (!this.knownNodes.has(n)) this.nodeEvents.push({ at: now, node: n, kind: "joined" });
      for (const n of this.knownNodes) if (!nodes.has(n)) this.nodeEvents.push({ at: now, node: n, kind: "left" });
      if (this.nodeEvents.length > 500) this.nodeEvents = this.nodeEvents.slice(-400);
    }
    this.knownNodes = nodes;
    this.emit();
  }

  /** Once a second: update rates and drop live data older than the buffer. */
  private tick(): void {
    if (!this.isLive) return;
    let active = false;
    for (const st of this.stats.values()) {
      if (st.winCount || st.hz) active = true;
      st.hz = st.winCount;
      st.bps = st.winBytes;
      st.winCount = st.winBytes = 0;
    }
    if (this.isLive && isFinite(this.tMax)) {
      const cutoff = this.tMax - this.bufferSec;
      for (const e of this.series.values()) e.series.trimBefore(cutoff);
      for (const hist of this.history.values()) {
        let drop = 0;
        while (
          drop < hist.msgs.length &&
          (hist.msgs[drop].t < cutoff || hist.bytes > MAX_HISTORY_BYTES)
        ) {
          hist.bytes -= hist.msgs[drop].data.byteLength;
          drop++;
        }
        if (drop) hist.msgs.splice(0, drop);
      }
      if (this.tMin < cutoff) this.tMin = cutoff;
    }
    // Keep emitting while subscribed so stalled topics surface even when nothing arrives.
    if (active || this.arrivals.size) this.emit();
  }
}

export const hub = new Hub();
