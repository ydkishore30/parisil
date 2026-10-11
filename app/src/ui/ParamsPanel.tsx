import { useEffect, useMemo, useState } from "react";
import { hub, type Param } from "../data/hub";
import { useHub } from "./hooks";
import { Icon } from "./Icon";

function display(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

/** Parses edited text back into the type the parameter already has. */
function parseLike(original: unknown, text: string): unknown {
  if (typeof original === "string") return text;
  if (typeof original === "number") {
    const n = Number(text);
    if (text.trim() === "" || Number.isNaN(n)) throw new Error("Expected a number");
    return n;
  }
  if (typeof original === "boolean") {
    if (text !== "true" && text !== "false") throw new Error("Expected true or false");
    return text === "true";
  }
  return JSON.parse(text);
}

function ParamRow({ param, label }: { param: Param; label: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState("");
  const commit = () => {
    if (draft === null) return;
    try {
      const value = parseLike(param.value, draft);
      hub.source?.setParameter?.({ name: param.name, value, type: param.type });
      setDraft(null);
      setError("");
    } catch (err) {
      setError((err as Error).message);
    }
  };
  return (
    <div className="param-row">
      <span className="param-name mono" title={param.name}>
        {label}
      </span>
      {typeof param.value === "boolean" ? (
        <label className="param-bool">
          <input
            type="checkbox"
            checked={param.value}
            onChange={(ev) => hub.source?.setParameter?.({ name: param.name, value: ev.target.checked, type: param.type })}
          />
          {String(param.value)}
        </label>
      ) : (
        <input
          className={`param-input mono${error ? " param-error" : ""}`}
          value={draft ?? display(param.value)}
          title={error || "Enter to apply · Esc to cancel"}
          spellCheck={false}
          onChange={(ev) => setDraft(ev.target.value)}
          onBlur={() => (setDraft(null), setError(""))}
          onKeyDown={(ev) => {
            if (ev.key === "Enter") commit();
            if (ev.key === "Escape") (setDraft(null), setError(""));
          }}
        />
      )}
    </div>
  );
}

export function ParamsPanel() {
  useHub();
  const [query, setQuery] = useState("");
  const [opened, setOpened] = useState<Set<string>>(new Set());
  const status = hub.status;

  useEffect(() => {
    if (status === "live" && !hub.params.length) hub.source?.requestParameters?.();
  }, [status]);

  const params = hub.params;
  const groups = useMemo(() => {
    const q = query.toLowerCase();
    const map = new Map<string, { param: Param; label: string }[]>();
    for (const p of params) {
      if (q && !p.name.toLowerCase().includes(q)) continue;
      // foxglove_bridge names parameters "<node>.<parameter>".
      const dot = p.name.indexOf(".");
      const node = dot > 0 ? p.name.slice(0, dot) : "(global)";
      const list = map.get(node) ?? [];
      list.push({ param: p, label: dot > 0 ? p.name.slice(dot + 1) : p.name });
      map.set(node, list);
    }
    return [...map.entries()];
  }, [params, query]);

  return (
    <div className="panel params">
      <div className="panel-bar">
        <div className="input-icon grow">
          <Icon name="search" size={13} />
          <input value={query} placeholder="Filter parameters…" spellCheck={false} onChange={(ev) => setQuery(ev.target.value)} />
        </div>
        <span className="panel-note">{params.length.toLocaleString()} parameters</span>
        <button className="btn" disabled={!hub.isLive || hub.paramsLoading} onClick={() => hub.source?.requestParameters?.()}>
          <Icon name="refresh" size={13} />
          {hub.paramsLoading ? "Loading…" : "Refresh"}
        </button>
      </div>
      <div className="panel-scroll">
        {groups.length === 0 && (
          <div className="panel-empty">
            {!hub.isLive
              ? "Parameters are only available on a live connection."
              : hub.paramsLoading
                ? "Asking every node for its parameters…"
                : params.length
                  ? "No parameter matches."
                  : "No parameters received. Press Refresh to ask again."}
          </div>
        )}
        {groups.map(([node, list]) => {
          const isOpen = opened.has(node) || !!query;
          return (
            <div key={node} className="node-item">
              <div
                className="node-row"
                onClick={() =>
                  setOpened((prev) => {
                    const next = new Set(prev);
                    if (!next.delete(node)) next.add(node);
                    return next;
                  })
                }
              >
                <span className={`caret${isOpen ? " caret-open" : ""}`}>
                  <Icon name="chevron" size={11} />
                </span>
                <span className="mono">{node}</span>
                <span className="panel-note">{list.length}</span>
              </div>
              {isOpen && list.map(({ param, label }) => <ParamRow key={param.name} param={param} label={label} />)}
            </div>
          );
        })}
      </div>
    </div>
  );
}
