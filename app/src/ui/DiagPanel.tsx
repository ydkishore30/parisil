import { useState } from "react";
import { hub } from "../data/hub";
import { useHub } from "./hooks";
import { Icon } from "./Icon";

const LEVELS = [
  { label: "OK", cls: "ok", icon: "ok" },
  { label: "WARN", cls: "warn", icon: "warn" },
  { label: "ERROR", cls: "error", icon: "error" },
  { label: "STALE", cls: "stale", icon: "stale" },
];
/** Worst first. */
const ORDER = [2, 1, 3, 0];

export function DiagPanel() {
  useHub();
  const [open, setOpen] = useState<Set<string>>(new Set());
  const items = [...hub.diags.values()].sort(
    (a, b) => ORDER.indexOf(a.level) - ORDER.indexOf(b.level) || a.name.localeCompare(b.name),
  );
  const counts = [0, 0, 0, 0];
  for (const d of items) counts[d.level] = (counts[d.level] ?? 0) + 1;

  return (
    <div className="panel diag">
      <div className="panel-bar">
        {ORDER.map((lvl) => (
          <span key={lvl} className={`diag-chip lvl-text-${LEVELS[lvl].cls}`}>
            <Icon name={LEVELS[lvl].icon} size={13} />
            {counts[lvl]} {LEVELS[lvl].label}
          </span>
        ))}
      </div>
      <div className="panel-scroll">
        {items.length === 0 && (
          <div className="panel-empty">No diagnostics yet — DiagnosticArray topics are subscribed automatically.</div>
        )}
        {items.map((d) => {
          const lvl = LEVELS[d.level] ?? LEVELS[3];
          const isOpen = open.has(d.name);
          return (
            <div key={d.name} className="diag-item">
              <div
                className="diag-row"
                onClick={() =>
                  setOpen((prev) => {
                    const next = new Set(prev);
                    if (!next.delete(d.name)) next.add(d.name);
                    return next;
                  })
                }
              >
                <span className={`diag-level lvl-text-${lvl.cls}`}>
                  <Icon name={lvl.icon} size={14} />
                  {lvl.label}
                </span>
                <span className="diag-name">{d.name}</span>
                <span className="diag-msg">{d.message}</span>
                <span className="diag-hw">{d.hardwareId}</span>
              </div>
              {isOpen && (
                <div className="diag-values">
                  {d.values.length === 0 && <span className="panel-note">No values reported.</span>}
                  {d.values.map((kv) => (
                    <div key={kv.key} className="kv">
                      <span>{kv.key}</span>
                      <span>{kv.value}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
