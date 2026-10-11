import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { hub, type LogEntry } from "../data/hub";
import { formatTime } from "../format";
import { timeline } from "../timeline";
import { useHub, useTimeline } from "./hooks";
import { Icon } from "./Icon";

const ROW = 24;
const LEVELS = [
  { value: 10, label: "DEBUG", cls: "debug" },
  { value: 20, label: "INFO", cls: "info" },
  { value: 30, label: "WARN", cls: "warn" },
  { value: 40, label: "ERROR", cls: "error" },
  { value: 50, label: "FATAL", cls: "fatal" },
];

interface Row extends LogEntry {
  repeat: number;
}

function levelOf(level: number) {
  return LEVELS.find((l) => level <= l.value) ?? LEVELS[4];
}

export function LogPanel() {
  const rev = useHub();
  useTimeline();
  const [minLevel, setMinLevel] = useState(20);
  const [query, setQuery] = useState("");
  const [node, setNode] = useState("");
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(300);
  const [selected, setSelected] = useState<LogEntry | null>(null);
  const [collapse, setCollapse] = useState(true);
  const [muted, setMuted] = useState<Set<string>>(new Set());
  const listRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  const logs = hub.logs;
  // Nodes with the most warnings and errors first: usually the one to look at.
  const nodes = useMemo(() => {
    const problems = new Map<string, number>();
    for (const l of logs) problems.set(l.name, (problems.get(l.name) ?? 0) + (l.level >= 30 ? 1 : 0));
    return [...problems.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [logs, rev]);
  const counts = useMemo(() => {
    const c: Record<number, number> = {};
    for (const l of logs) c[levelOf(l.level).value] = (c[levelOf(l.level).value] ?? 0) + 1;
    return c;
  }, [logs, rev]);
  const rows = useMemo(() => {
    const q = query.toLowerCase();
    const out: Row[] = [];
    for (const l of logs) {
      if (l.level < minLevel || (node && l.name !== node) || muted.has(l.name)) continue;
      if (q && !l.msg.toLowerCase().includes(q) && !l.name.toLowerCase().includes(q)) continue;
      const prev = out[out.length - 1];
      // A node repeating the same line is folded into one row with a count.
      if (collapse && prev && prev.name === l.name && prev.msg === l.msg && prev.level === l.level) prev.repeat++;
      else out.push({ ...l, repeat: 1 });
    }
    return out;
  }, [logs, rev, minLevel, query, node, muted, collapse]);

  useEffect(() => {
    const el = listRef.current!;
    const ro = new ResizeObserver(() => setHeight(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Stay on the newest line unless the user scrolled up.
  useLayoutEffect(() => {
    const el = listRef.current!;
    if (stick.current) el.scrollTop = el.scrollHeight;
  }, [rows.length]);

  // A time pinned on a plot scrolls the log to that moment.
  const pin = timeline.pin;
  const pinIndex = useMemo(() => {
    if (pin === null || !rows.length) return -1;
    let lo = 0;
    let hi = rows.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (rows[mid].t < pin) lo = mid + 1;
      else hi = mid;
    }
    return lo > 0 && pin - rows[lo - 1].t < rows[lo].t - pin ? lo - 1 : lo;
  }, [pin, rows]);
  useEffect(() => {
    if (pinIndex < 0 || timeline.pinSource !== "plot") return;
    const el = listRef.current!;
    stick.current = false;
    el.scrollTop = Math.max(0, pinIndex * ROW - el.clientHeight / 2);
    // only when the pin itself moves
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin]);

  const first = Math.max(0, Math.floor(scrollTop / ROW) - 5);
  const last = Math.min(rows.length, Math.ceil((scrollTop + height) / ROW) + 5);
  const origin = Number.isNaN(hub.origin) ? 0 : hub.origin;

  return (
    <div className="panel logs">
      <div className="panel-bar">
        <div className="seg" role="group" aria-label="Minimum level">
          {LEVELS.map((l) => (
            <button
              key={l.value}
              className={`seg-btn${minLevel === l.value ? " seg-on" : ""}`}
              title={`Show ${l.label} and above`}
              onClick={() => setMinLevel(l.value)}
            >
              <span className={`lvl-dot lvl-${l.cls}`} />
              {l.label}
              <span className="seg-count">{counts[l.value] ?? 0}</span>
            </button>
          ))}
        </div>
        <select value={node} onChange={(ev) => setNode(ev.target.value)} title="Filter by node">
          <option value="">All nodes</option>
          {nodes.map(([n, problems]) => (
            <option key={n} value={n}>
              {n}
              {problems ? ` (${problems} warn/error)` : ""}
            </option>
          ))}
        </select>
        <div className="input-icon grow">
          <Icon name="search" size={13} />
          <input value={query} placeholder="Filter messages…" spellCheck={false} onChange={(ev) => setQuery(ev.target.value)} />
        </div>
        <label className="check" title="Fold consecutive identical lines from the same node into one row">
          <input type="checkbox" checked={collapse} onChange={(ev) => setCollapse(ev.target.checked)} />
          Collapse repeats
        </label>
        {[...muted].map((n) => (
          <button key={n} className="chip" title="Show this node again" onClick={() => setMuted((prev) => new Set([...prev].filter((x) => x !== n)))}>
            {n}
            <Icon name="close" size={10} />
          </button>
        ))}
        <span className="panel-note">
          {rows.length.toLocaleString()} / {logs.length.toLocaleString()}
        </span>
      </div>
      <div
        className="log-list"
        ref={listRef}
        onScroll={(ev) => {
          const el = ev.currentTarget;
          stick.current = el.scrollTop + el.clientHeight >= el.scrollHeight - ROW;
          setScrollTop(el.scrollTop);
        }}
      >
        {rows.length === 0 ? (
          <div className="panel-empty">
            {logs.length ? "No log line matches the filters." : "No log messages yet — /rosout is subscribed automatically."}
          </div>
        ) : (
          <div style={{ height: rows.length * ROW, position: "relative" }}>
            {rows.slice(first, last).map((l, i) => {
              const lvl = levelOf(l.level);
              const index = first + i;
              return (
                <div
                  key={l.id}
                  className={`log-row log-${lvl.cls}${index === pinIndex ? " log-pinned" : ""}`}
                  style={{ top: index * ROW }}
                  onClick={() => {
                    setSelected(l);
                    timeline.setPin(l.t, "log");
                  }}
                >
                  <span className="log-time">{formatTime(l.t - origin, 0.001)}</span>
                  <span className={`log-level lvl-text-${lvl.cls}`}>
                    <span className={`lvl-dot lvl-${lvl.cls}`} />
                    {lvl.label}
                  </span>
                  <span className="log-node" title={l.name}>
                    {l.name}
                  </span>
                  <span className="log-msg">{l.msg}</span>
                  {l.repeat > 1 && <span className="log-repeat">×{l.repeat}</span>}
                </div>
              );
            })}
          </div>
        )}
      </div>
      {selected && (
        <div className="log-detail">
          <button className="icon-btn" title="Close" onClick={() => setSelected(null)}>
            <Icon name="close" size={12} />
          </button>
          <div className="log-detail-msg">{selected.msg}</div>
          <div className="log-detail-actions">
            <button className="btn" onClick={() => setNode(selected.name)}>
              Only this node
            </button>
            <button className="btn" onClick={() => (setMuted((prev) => new Set(prev).add(selected.name)), setSelected(null))}>
              Hide this node
            </button>
          </div>
          <div className="log-detail-meta">
            {selected.name} · {levelOf(selected.level).label} · {new Date(selected.t * 1000).toISOString()}
            {selected.file && ` · ${selected.file}:${selected.line}`}
            {selected.fn && ` · ${selected.fn}()`}
          </div>
        </div>
      )}
    </div>
  );
}
