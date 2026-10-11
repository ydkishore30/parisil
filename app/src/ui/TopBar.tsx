import { useEffect, useRef, useState } from "react";
import { hub } from "../data/hub";
import { connectLive, openBag } from "../session";
import { useUI } from "../state";
import { timeline } from "../timeline";
import { addPlot, openPanel, resetLayout } from "../workspace";
import { useHub, useTimeline } from "./hooks";
import { Icon } from "./Icon";

const SPANS = [
  [5, "5s"],
  [20, "20s"],
  [60, "1m"],
  [300, "5m"],
] as const;

const STATUS_LABEL = { idle: "Offline", connecting: "Connecting", live: "Live", file: "Bag", error: "Error" };

export function TopBar() {
  useHub();
  useTimeline();
  const url = useUI((s) => s.url);
  const theme = useUI((s) => s.theme);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(url);
  const fileRef = useRef<HTMLInputElement>(null);
  const live = hub.isLive;
  const silentCount = hub.silentTopics().length;

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const el = ev.target as HTMLElement;
      if (ev.code === "Space" && !["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(el.tagName) && hub.isLive) {
        ev.preventDefault();
        timeline.setFollow(!timeline.follow);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark">
          <Icon name="pulse" size={15} />
        </span>
        parisil
      </div>

      {editing ? (
        <form
          className="conn conn-edit"
          onSubmit={(ev) => {
            ev.preventDefault();
            setEditing(false);
            connectLive(draft.trim());
          }}
        >
          <input autoFocus value={draft} spellCheck={false} onChange={(ev) => setDraft(ev.target.value)} onBlur={() => setEditing(false)} />
        </form>
      ) : (
        <button
          className="conn"
          title="Click to change the foxglove_bridge address"
          onClick={() => {
            setDraft(url);
            setEditing(true);
          }}
        >
          <span className={`conn-dot conn-${hub.status}`} />
          <span className="conn-status">{STATUS_LABEL[hub.status]}</span>
          <span className="conn-text">{hub.statusText || url}</span>
        </button>
      )}
      {hub.status === "file" && (
        <button className="btn" onClick={() => connectLive(url)} title="Go back to the live connection">
          Back to live
        </button>
      )}
      <button className="btn" onClick={() => fileRef.current?.click()} title="Open a ROS 2 bag (.mcap) — or drop it anywhere">
        <Icon name="folder" size={14} />
        Open bag
      </button>
      <input
        ref={fileRef}
        type="file"
        accept=".mcap"
        hidden
        onChange={(ev) => {
          const file = ev.target.files?.[0];
          if (file) void openBag(file);
          ev.target.value = "";
        }}
      />

      <div className="spacer" />

      {live ? (
        <>
          <div className="seg" role="group" aria-label="Visible time span">
            {SPANS.map(([sec, label]) => (
              <button
                key={sec}
                className={`seg-btn${timeline.follow && Math.abs(timeline.span - sec) < 1e-6 ? " seg-on" : ""}`}
                onClick={() => timeline.setSpan(sec)}
                title={`Follow the last ${label}`}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            className={`btn${timeline.follow ? "" : " btn-accent"}`}
            onClick={() => timeline.setFollow(!timeline.follow)}
            title="Pause or resume following live data (Space). Data keeps recording while paused."
          >
            <Icon name={timeline.follow ? "pause" : "play"} size={13} />
            {timeline.follow ? "Pause" : "Resume"}
          </button>
          <button className="btn" onClick={() => hub.clearData()} title="Clear plotted history and logs">
            <Icon name="trash" size={13} />
            Clear
          </button>
        </>
      ) : (
        hub.status === "file" && (
          <button className="btn" onClick={() => timeline.fit()} title="Show the whole recording (double-click a plot)">
            Fit all
          </button>
        )
      )}

      <span className="divider" />
      <button className="btn btn-accent" onClick={() => addPlot()} title="Add a plot below the active one">
        <Icon name="plus" size={13} />
        Plot
      </button>
      <button className="btn" onClick={() => openPanel("logs")} title="Log viewer (/rosout)">
        <Icon name="logs" size={14} />
        Logs
      </button>
      <button className="btn" onClick={() => openPanel("diagnostics")} title="Diagnostics">
        <Icon name="pulse" size={14} />
        Diagnostics
      </button>
      <button className="btn" onClick={() => openPanel("system")} title="Topics, nodes and services">
        <Icon name="graph" size={14} />
        System
        {silentCount > 0 && (
          <span className="badge" title={`${silentCount} subscribed topic${silentCount > 1 ? "s" : ""} without data`}>
            {silentCount}
          </span>
        )}
      </button>
      <button className="btn" onClick={() => openPanel("params")} title="Node parameters">
        <Icon name="sliders" size={14} />
        Params
      </button>
      <span className="divider" />
      <button className="icon-btn" onClick={() => resetLayout()} title="Reset the panel layout">
        <Icon name="layout" size={15} />
      </button>
      <button className="icon-btn" onClick={() => useUI.getState().setTheme(theme === "dark" ? "light" : "dark")} title="Switch theme">
        <Icon name={theme === "dark" ? "sun" : "moon"} size={15} />
      </button>
    </header>
  );
}
