import { useMemo, useState } from "react";
import { listActions, listNodes, SERVICE_KINDS, serviceKind, TOPIC_KINDS, topicKind, type ServiceKind, type TopicKind } from "../data/classify";
import { hub } from "../data/hub";
import { formatBytes, formatRate } from "../format";
import { useHub } from "./hooks";
import { Icon } from "./Icon";

type Tab = "health" | "topics" | "services" | "actions" | "nodes";

function Chips<T extends string>({ kinds, counts, value, onChange }: { kinds: { id: T; label: string }[]; counts: Map<T, number>; value: T | "all"; onChange(v: T | "all"): void }) {
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  return (
    <div className="kind-bar">
      <button className={`kind-chip${value === "all" ? " kind-on" : ""}`} onClick={() => onChange("all")}>
        All <span>{total}</span>
      </button>
      {kinds
        .filter((k) => counts.get(k.id))
        .map((k) => (
          <button key={k.id} className={`kind-chip${value === k.id ? " kind-on" : ""}`} onClick={() => onChange(value === k.id ? "all" : k.id)}>
            <span className={`kind-dot kind-${k.id}`} />
            {k.label} <span>{counts.get(k.id)}</span>
          </button>
        ))}
    </div>
  );
}

function KindTag({ kind, label }: { kind: string; label: string }) {
  return (
    <span className="kind-tag">
      <span className={`kind-dot kind-${kind}`} />
      {label}
    </span>
  );
}

export function SystemPanel() {
  const rev = useHub();
  const [tab, setTab] = useState<Tab>("health");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [topicFilter, setTopicFilter] = useState<TopicKind | "all">("all");
  // Parameter and lifecycle services are per-node plumbing: start on the ones the application defines.
  const [serviceFilter, setServiceFilter] = useState<ServiceKind | "all">("user");
  const q = query.toLowerCase();

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const actions = useMemo(() => listActions(), [rev]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const nodes = useMemo(() => listNodes(actions), [rev, actions]);

  const allTopics = [...hub.topics.values()]
    .filter((t) => `${t.name} ${t.schemaName}`.toLowerCase().includes(q))
    .map((t) => ({ ...t, kind: topicKind(t.name, t.schemaName) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const topicCounts = new Map<TopicKind, number>();
  for (const t of allTopics) topicCounts.set(t.kind, (topicCounts.get(t.kind) ?? 0) + 1);
  const topics = allTopics.filter((t) => topicFilter === "all" || t.kind === topicFilter);

  const allServices = [...hub.services.entries()]
    .filter(([name, s]) => `${name} ${s.type}`.toLowerCase().includes(q))
    .map(([name, s]) => ({ name, ...s, kind: serviceKind(name, s.type) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const serviceCounts = new Map<ServiceKind, number>();
  for (const sv of allServices) serviceCounts.set(sv.kind, (serviceCounts.get(sv.kind) ?? 0) + 1);
  const services = allServices.filter((sv) => serviceFilter === "all" || sv.kind === serviceFilter);
  const shownActions = actions.filter((a) => `${a.name} ${a.type}`.toLowerCase().includes(q));
  const topicLabel = new Map(TOPIC_KINDS.map((k) => [k.id, k.label]));
  const serviceLabel = new Map(SERVICE_KINDS.map((k) => [k.id, k.label]));
  const shownNodes = nodes.filter((n) => n.name.toLowerCase().includes(q));
  const live = hub.isLive;
  const silent = hub.silentTopics();
  const unpublished = hub.unpublishedTopics().filter((u) => u.topic.toLowerCase().includes(q));
  const events = hub.nodeEvents.filter((e) => e.node.toLowerCase().includes(q));

  return (
    <div className="panel system">
      <div className="panel-bar">
        <div className="seg">
          {(
            [
              ["health", silent.length ? `Health · ${silent.length}` : "Health"],
              ["topics", `Topics ${hub.topics.size}`],
              ["services", `Services ${serviceCounts.get("user") ?? 0}`],
              ["actions", `Actions ${actions.length}`],
              ["nodes", `Nodes ${nodes.length}`],
            ] as [Tab, string][]
          ).map(([id, label]) => (
            <button key={id} className={`seg-btn${tab === id ? " seg-on" : ""}`} onClick={() => (setTab(id), setOpen(null))}>
              {label}
            </button>
          ))}
        </div>
        <div className="input-icon grow">
          <Icon name="search" size={13} />
          <input value={query} placeholder={`Filter ${tab}…`} spellCheck={false} onChange={(ev) => setQuery(ev.target.value)} />
        </div>
      </div>
      <div className="panel-scroll">
        {tab === "health" && (
          <div className="health">
            <section>
              <h3>
                <span className={silent.length ? "lvl-text-warn" : "lvl-text-ok"}>
                  <Icon name={silent.length ? "warn" : "ok"} size={14} />
                </span>
                Subscribed topics without data · {silent.length}
              </h3>
              <p className="health-hint">
                Topics you plot or inspect that deliver nothing. A publisher that exists but sends nothing usually means a QoS mismatch
                (reliable subscriber on a best-effort publisher) or a DDS transport problem such as shared memory across Docker containers.
              </p>
              {silent.map((t) => (
                <div key={t.topic} className="health-row">
                  <span className="mono">{t.topic}</span>
                  <span className="dim">
                    {t.kind === "never" ? `no message in the ${Math.round(t.seconds)} s since subscribing` : `stopped ${Math.round(t.seconds)} s ago`} ·{" "}
                    {t.publishers === null ? "publishers unknown" : t.publishers === 0 ? "no publisher" : `${t.publishers} publisher${t.publishers > 1 ? "s" : ""} present`}
                  </span>
                </div>
              ))}
              {!silent.length && <div className="health-row dim">{live ? "Everything you subscribed to is delivering." : "Only checked on a live connection."}</div>}
            </section>
            <section>
              <h3>Nodes that joined or left · {events.length}</h3>
              <p className="health-hint">A node that leaves unexpectedly has usually crashed. Recorded while parisil is connected.</p>
              {events
                .slice(-50)
                .reverse()
                .map((e, i) => (
                  <div key={`${e.at}${e.node}${i}`} className="health-row">
                    <span className="dim mono">{new Date(e.at).toLocaleTimeString()}</span>
                    <span className={e.kind === "left" ? "lvl-text-error health-kind" : "lvl-text-ok health-kind"}>
                      <Icon name={e.kind === "left" ? "error" : "ok"} size={13} />
                      {e.kind === "left" ? "left" : "joined"}
                    </span>
                    <span className="mono">{e.node}</span>
                  </div>
                ))}
              {!events.length && <div className="health-row dim">No changes since connecting.</div>}
            </section>
            <section>
              <h3>Subscribed but never published · {unpublished.length}</h3>
              <p className="health-hint">
                Someone listens, nobody publishes. Expected for inputs such as goal topics; otherwise check for a typo or a missing remap.
              </p>
              {unpublished.map((u) => (
                <div key={u.topic} className="health-row">
                  <span className="mono">{u.topic}</span>
                  <span className="dim">← {u.subscribers.join(", ")}</span>
                </div>
              ))}
            </section>
          </div>
        )}
        {tab === "topics" && <Chips<TopicKind> kinds={TOPIC_KINDS} counts={topicCounts} value={topicFilter} onChange={setTopicFilter} />}
        {tab === "topics" && (
          <table className="table">
            <thead>
              <tr>
                <th>Topic</th>
                <th>Category</th>
                <th>Type</th>
                <th className="num">Pubs</th>
                <th className="num">Subs</th>
                <th className="num">Rate</th>
                <th className="num">{live ? "Bandwidth" : "Messages"}</th>
                {live && <th title="Subscribe to measure rate and bandwidth">Measure</th>}
              </tr>
            </thead>
            <tbody>
              {topics.map((t) => {
                const st = hub.stats.get(t.name);
                const pubs = hub.publishers.get(t.name);
                const subs = hub.subscribers.get(t.name);
                const isOpen = open === t.name;
                return [
                  <tr key={t.name} className="clickable" onClick={() => setOpen(isOpen ? null : t.name)}>
                    <td className="mono">{t.name}</td>
                    <td>
                      <KindTag kind={t.kind} label={topicLabel.get(t.kind)!} />
                    </td>
                    <td className="dim">{t.schemaName}</td>
                    <td className="num">{pubs?.length ?? "–"}</td>
                    <td className="num">{subs?.length ?? "–"}</td>
                    <td className="num">{st?.hz ? formatRate(st.hz) : "–"}</td>
                    <td className="num">{live ? formatBytes(st?.bps ?? 0) || "–" : (st?.count.toLocaleString() ?? "–")}</td>
                    {live && (
                      <td onClick={(ev) => ev.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={hub.isRetained(t.name, "stats")}
                          onChange={(ev) => {
                            if (ev.target.checked) hub.retain(t.name, "stats");
                            else hub.release(t.name, "stats");
                            hub.emitNow();
                          }}
                        />
                      </td>
                    )}
                  </tr>,
                  isOpen && (
                    <tr key={`${t.name}/detail`} className="detail">
                      <td colSpan={live ? 8 : 7}>
                        <div className="detail-cols">
                          <NameList title="Publishers" names={pubs} />
                          <NameList title="Subscribers" names={subs} />
                        </div>
                      </td>
                    </tr>
                  ),
                ];
              })}
            </tbody>
          </table>
        )}
        {tab === "nodes" && (
          <>
            {shownNodes.length === 0 && <div className="panel-empty">{live ? "No nodes reported yet." : "The node graph is only available on a live connection."}</div>}
            {shownNodes.map((info) => {
              const name = info.name;
              const isOpen = open === name;
              return (
                <div key={name} className="node-item">
                  <div className="node-row" onClick={() => setOpen(isOpen ? null : name)}>
                    <span className={`caret${isOpen ? " caret-open" : ""}`}>
                      <Icon name="chevron" size={11} />
                    </span>
                    <span className="mono">{name}</span>
                    <span className="panel-note">
                      {info.pubs.length} pub · {info.subs.length} sub · {info.services.length} srv
                      {info.actionServers.length + info.actionClients.length > 0 && ` · ${info.actionServers.length + info.actionClients.length} action`}
                    </span>
                  </div>
                  {isOpen && (
                    <div className="detail-cols node-detail">
                      <NameList title="Publishes" names={info.pubs} />
                      <NameList title="Subscribes" names={info.subs} />
                      <NameList title="Services" names={info.services} note={info.infraServices ? `+ ${info.infraServices} parameter/lifecycle` : undefined} />
                      <NameList title="Action servers" names={info.actionServers} />
                      <NameList title="Action clients" names={info.actionClients} />
                    </div>
                  )}
                </div>
              );
            })}
          </>
        )}
        {tab === "services" && <Chips<ServiceKind> kinds={SERVICE_KINDS} counts={serviceCounts} value={serviceFilter} onChange={setServiceFilter} />}
        {tab === "services" && (
          <table className="table">
            <thead>
              <tr>
                <th>Service</th>
                <th>Category</th>
                <th>Type</th>
                <th>Provider</th>
              </tr>
            </thead>
            <tbody>
              {services.map((sv) => (
                <tr key={sv.name}>
                  <td className="mono">{sv.name}</td>
                  <td>
                    <KindTag kind={sv.kind} label={serviceLabel.get(sv.kind)!} />
                  </td>
                  <td className="dim">{sv.type || "–"}</td>
                  <td className="dim">{sv.providers.join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {tab === "actions" && (
          <>
            {shownActions.length === 0 && <div className="panel-empty">{live ? "No actions found." : "Actions are only available on a live connection."}</div>}
            {shownActions.length > 0 && (
              <table className="table">
                <thead>
                  <tr>
                    <th>Action</th>
                    <th>Server</th>
                    <th>Clients</th>
                  </tr>
                </thead>
                <tbody>
                  {shownActions.map((a) => (
                    <tr key={a.name}>
                      <td className="mono">
                        {a.name}
                        {a.type && <span className="dim"> · {a.type}</span>}
                      </td>
                      <td className={a.servers.length ? "dim" : "lvl-text-warn"}>{a.servers.join(", ") || "no server"}</td>
                      <td className="dim wrap">{a.clients.join(", ") || "–"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function NameList({ title, names, note }: { title: string; names?: string[]; note?: string }) {
  if (!names?.length && !note && title.startsWith("Action")) return null;
  return (
    <div>
      <div className="detail-title">
        {title} · {names?.length ?? 0}
      </div>
      {(names ?? []).sort().map((n, i) => (
        <div key={`${n}${i}`} className="mono dim">
          {n}
        </div>
      ))}
      {note && <div className="panel-note">{note}</div>}
    </div>
  );
}
