import { useEffect, useMemo, useRef, useState } from "react";
import { listActions, listNodes, serviceKind } from "../data/classify";
import { hub, seriesId } from "../data/hub";
import { flatten, type FieldNode } from "../data/ros";
import { formatRate, formatValue, shortType } from "../format";
import { useUI } from "../state";
import { plotSeries } from "../workspace";
import { useHub } from "./hooks";
import { Icon } from "./Icon";
import { SERIES_MIME } from "./PlotPanel";

/** Set by the desktop shell when ROS 2 is installed but the bridge package is not. */
const MISSING_BRIDGE = new URLSearchParams(window.location.search).get("missingBridge");

type Tab = "topics" | "services" | "actions" | "nodes";

function Caret({ open }: { open: boolean }) {
  return (
    <span className={`caret${open ? " caret-open" : ""}`}>
      <Icon name="chevron" size={11} />
    </span>
  );
}

function Group({ title, names, onPick }: { title: string; names: string[]; onPick?(name: string): void }) {
  if (!names.length) return null;
  return (
    <div className="side-group">
      <div className="side-group-title">
        {title} · {names.length}
      </div>
      {[...names].sort().map((n, i) =>
        onPick ? (
          <button key={`${n}${i}`} className="side-link" title="Show this topic" onClick={() => onPick(n)}>
            {n}
          </button>
        ) : (
          <div key={`${n}${i}`} className="side-name">
            {n}
          </div>
        ),
      )}
    </div>
  );
}

function countLeaves(node: FieldNode): number {
  return node.children ? node.children.reduce((n, c) => n + countLeaves(c), 0) : 1;
}

interface TreeCtx {
  topic: string;
  open: Map<string, boolean>;
  toggle(key: string, value: boolean): void;
  defaultOpen: boolean;
  plotted: Set<string>;
}

function plotClick(ev: React.MouseEvent, ids: string[]): void {
  // Shift/Ctrl/⌘-click opens the field in a new plot instead of the active one.
  plotSeries(ids, ev.shiftKey || ev.ctrlKey || ev.metaKey);
}

function FieldRow({ node, depth, ctx }: { node: FieldNode; depth: number; ctx: TreeCtx }) {
  const pad = { paddingLeft: 22 + depth * 14 };
  if (node.kind === "num") {
    const id = seriesId(ctx.topic, node.path);
    return (
      <div
        className={`field field-num${ctx.plotted.has(id) ? " field-plotted" : ""}`}
        style={pad}
        draggable
        title="Click to plot · Shift-click for a new plot · or drag onto a plot"
        onDragStart={(ev) => {
          ev.dataTransfer.setData(SERIES_MIME, JSON.stringify([id]));
          ev.dataTransfer.effectAllowed = "copy";
        }}
        onClick={(ev) => plotClick(ev, [id])}
      >
        <span className="field-key">{node.key}</span>
        <span className="field-value">{formatValue(node.value as number)}</span>
      </div>
    );
  }
  if (node.kind === "str" || node.kind === "blob") {
    const shown = node.kind === "blob" ? `${node.count} values` : String(node.value);
    return (
      <div className="field field-inert" style={pad}>
        <span className="field-key">{node.key}</span>
        <span className="field-value field-text" title={shown}>
          {shown}
        </span>
      </div>
    );
  }
  const key = `${ctx.topic}:${node.path}`;
  const isOpen = ctx.open.get(key) ?? ctx.defaultOpen;
  const numeric = (node.children ?? []).filter((c) => c.kind === "num");
  return (
    <>
      <div className="field field-group" style={{ paddingLeft: 8 + depth * 14 }} onClick={() => ctx.toggle(key, !isOpen)}>
        <span className={`caret${isOpen ? " caret-open" : ""}`}>
          <Icon name="chevron" size={11} />
        </span>
        <span className="field-key">{node.key}</span>
        {node.kind === "array" && <span className="field-count">[{node.count}]</span>}
        {numeric.length > 1 && numeric.length <= 8 && (
          <button
            className="field-all"
            title={`Plot all ${numeric.length} values`}
            onClick={(ev) => {
              ev.stopPropagation();
              plotClick(
                ev,
                numeric.map((c) => seriesId(ctx.topic, c.path)),
              );
            }}
          >
            plot all
          </button>
        )}
      </div>
      {isOpen && node.children!.map((c) => <FieldRow key={c.path} node={c} depth={depth + 1} ctx={ctx} />)}
      {isOpen && node.kind === "array" && node.count! > node.children!.length && (
        <div className="field field-inert" style={{ paddingLeft: 22 + (depth + 1) * 14 }}>
          <span className="field-count">… {node.count! - node.children!.length} more</span>
        </div>
      )}
    </>
  );
}

export function Sidebar() {
  useHub();
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<Tab>("topics");
  const [openItem, setOpenItem] = useState<string | null>(null);
  const [allServices, setAllServices] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<Map<string, boolean>>(new Map());
  const inputRef = useRef<HTMLInputElement>(null);
  const plots = useUI((s) => s.plots);
  const activePlot = useUI((s) => s.activePlot);
  const plotted = useMemo(
    () => new Set((activePlot ? plots[activePlot]?.series : undefined)?.map((s) => s.id) ?? []),
    [plots, activePlot],
  );

  // Expanded topics are sampled so their fields and live values can be shown.
  const epoch = hub.epoch;
  useEffect(() => {
    for (const topic of expanded) hub.retain(topic, "peek");
    return () => {
      for (const topic of expanded) hub.release(topic, "peek");
    };
  }, [expanded, epoch]);

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const el = ev.target as HTMLElement;
      if (ev.key === "/" && el.tagName !== "INPUT" && el.tagName !== "TEXTAREA") {
        ev.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const matches = (text: string) => {
    const hay = text.toLowerCase();
    return terms.every((term) => hay.includes(term));
  };
  const topics = [...hub.topics.values()].filter((t) => matches(`${t.name} ${t.schemaName}`)).sort((a, b) => a.name.localeCompare(b.name));
  // Parameter, lifecycle and action plumbing services are hidden unless asked for.
  const serviceList = [...hub.services.entries()]
    .map(([name, sv]) => ({ name, ...sv, kind: serviceKind(name, sv.type) }))
    .filter((sv) => sv.kind !== "action")
    .sort((a, b) => a.name.localeCompare(b.name));
  const appServices = serviceList.filter((sv) => sv.kind === "user");
  const services = (allServices ? serviceList : appServices).filter((sv) => matches(`${sv.name} ${sv.type}`));
  const allActions = listActions();
  const actions = allActions.filter((a) => matches(a.name));
  const allNodes = listNodes(allActions);
  const nodes = allNodes.filter((n) => matches(n.name));
  const tabs: { id: Tab; label: string; count: number }[] = [
    { id: "topics", label: "Topics", count: hub.topics.size },
    { id: "services", label: "Services", count: appServices.length },
    { id: "actions", label: "Actions", count: allActions.length },
    { id: "nodes", label: "Nodes", count: allNodes.length },
  ];
  const shownCount = { topics: topics.length, services: services.length, actions: actions.length, nodes: nodes.length }[tab];
  /** Jump from a node's topic list to that topic in the Topics tab. */
  const showTopic = (name: string) => {
    setTab("topics");
    setQuery(name);
    if (hub.topics.has(name)) setExpanded((prev) => new Set(prev).add(name));
  };
  const toggleItem = (name: string) => setOpenItem((prev) => (prev === name ? null : name));
  const needsLive = <div className="sidebar-empty">{hub.isLive ? "Nothing found." : "Only available on a live connection."}</div>;

  const silent = new Map(hub.silentTopics().map((t) => [t.topic, t]));

  const toggleTopic = (name: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (!next.delete(name)) next.add(name);
      return next;
    });
  const toggleField = (key: string, value: boolean) => setOpen((prev) => new Map(prev).set(key, value));

  return (
    <aside className="sidebar">
      <div className="sidebar-search">
        <Icon name="search" size={13} />
        <input
          ref={inputRef}
          value={query}
          placeholder={`Search ${tab}…  ( / )`}
          spellCheck={false}
          onChange={(ev) => setQuery(ev.target.value)}
          onKeyDown={(ev) => ev.key === "Escape" && (setQuery(""), inputRef.current?.blur())}
        />
        <span className="sidebar-count">{shownCount}</span>
      </div>
      <div className="side-tabs" role="tablist">
        {tabs.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={`side-tab${tab === t.id ? " side-tab-on" : ""}`} onClick={() => (setTab(t.id), setOpenItem(null))}>
            {t.label}
            <span>{t.count}</span>
          </button>
        ))}
      </div>
      <div className="sidebar-list">
        {tab === "services" && (
          <>
            <label className="check side-option">
              <input type="checkbox" checked={allServices} onChange={(ev) => setAllServices(ev.target.checked)} />
              Include parameter and lifecycle services ({serviceList.length - appServices.length})
            </label>
            {services.length === 0 && needsLive}
            {services.map((sv) => (
              <div key={sv.name} className="topic">
                <div className={`topic-row${openItem === sv.name ? " topic-open" : ""}`} onClick={() => toggleItem(sv.name)} title={sv.type}>
                  <Caret open={openItem === sv.name} />
                  <span className="topic-name">{sv.name}</span>
                  <span className="topic-meta">{shortType(sv.type)}</span>
                </div>
                {openItem === sv.name && (
                  <div className="side-detail">
                    <Group title="Type" names={[sv.type || "unknown"]} />
                    <Group title="Provided by" names={sv.providers} />
                  </div>
                )}
              </div>
            ))}
          </>
        )}
        {tab === "actions" && (
          <>
            {actions.length === 0 && needsLive}
            {actions.map((a) => (
              <div key={a.name} className="topic">
                <div className={`topic-row${openItem === a.name ? " topic-open" : ""}`} onClick={() => toggleItem(a.name)}>
                  <Caret open={openItem === a.name} />
                  <span className="topic-name">{a.name}</span>
                  <span className={`topic-meta${a.servers.length ? "" : " lvl-text-warn"}`}>{a.servers.length ? `${a.clients.length} client${a.clients.length === 1 ? "" : "s"}` : "no server"}</span>
                </div>
                {openItem === a.name && (
                  <div className="side-detail">
                    <Group title="Server" names={a.servers} />
                    <Group title="Clients" names={a.clients} />
                  </div>
                )}
              </div>
            ))}
          </>
        )}
        {tab === "nodes" && (
          <>
            {nodes.length === 0 && needsLive}
            {nodes.map((n) => (
              <div key={n.name} className="topic">
                <div className={`topic-row${openItem === n.name ? " topic-open" : ""}`} onClick={() => toggleItem(n.name)}>
                  <Caret open={openItem === n.name} />
                  <span className="topic-name">{n.name}</span>
                  <span className="topic-meta">
                    {n.pubs.length}↑ {n.subs.length}↓
                  </span>
                </div>
                {openItem === n.name && (
                  <div className="side-detail">
                    <Group title="Publishes" names={n.pubs} onPick={showTopic} />
                    <Group title="Subscribes" names={n.subs} onPick={showTopic} />
                    <Group title="Services" names={n.services} />
                    <Group title="Action servers" names={n.actionServers} />
                    <Group title="Action clients" names={n.actionClients} />
                  </div>
                )}
              </div>
            ))}
          </>
        )}
        {tab === "topics" && topics.length === 0 && (
          <div className="sidebar-empty">
            {hub.topics.size === 0
              ? hub.status === "live"
                ? "Connected — no topics yet."
                : MISSING_BRIDGE
                  ? `Live data needs foxglove_bridge. Install it with: sudo apt install ${MISSING_BRIDGE} — then restart parisil. Bags (.mcap) open without it.`
                  : "Waiting for foxglove_bridge on the address above. Bags (.mcap) open without it."
              : "No topic matches."}
          </div>
        )}
        {tab === "topics" && topics.map((t) => {
          const isOpen = expanded.has(t.name);
          const st = hub.stats.get(t.name);
          const sample = isOpen ? hub.samples.get(t.name) : undefined;
          let tree: FieldNode | null = null;
          if (sample !== undefined) tree = flatten(sample);
          return (
            <div key={t.name} className="topic">
              <div className={`topic-row${isOpen ? " topic-open" : ""}`} onClick={() => toggleTopic(t.name)} title={t.schemaName}>
                <span className={`caret${isOpen ? " caret-open" : ""}`}>
                  <Icon name="chevron" size={11} />
                </span>
                <span className="topic-name">{t.name}</span>
                {silent.has(t.name) ? (
                  <span className="topic-meta lvl-text-warn" title="Subscribed, but no messages are arriving. See System → Health.">
                    no data
                  </span>
                ) : (
                  <span className="topic-meta">{st?.hz ? formatRate(st.hz) : shortType(t.schemaName)}</span>
                )}
              </div>
              {isOpen &&
                (tree?.children ? (
                  (() => {
                    const ctx: TreeCtx = {
                      topic: t.name,
                      open,
                      toggle: toggleField,
                      defaultOpen: countLeaves(tree) <= 24,
                      plotted,
                    };
                    return tree.children.map((c) => <FieldRow key={c.path} node={c} depth={0} ctx={ctx} />);
                  })()
                ) : (
                  <div className="field field-inert" style={{ paddingLeft: 22 }}>
                    <span className="field-count">
                      {t.encoding !== "cdr" && t.encoding !== "json" ? `Unsupported encoding: ${t.encoding}` : "Waiting for a message…"}
                    </span>
                  </div>
                ))}
            </div>
          );
        })}
      </div>
    </aside>
  );
}
