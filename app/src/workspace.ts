import type { DockviewApi } from "dockview-react";
import { useUI } from "./state";

const LAYOUT_KEY = "parisil.dock";

export type PanelKind = "logs" | "diagnostics" | "system" | "params";

const PANEL_TITLES: Record<PanelKind, string> = {
  logs: "Logs",
  diagnostics: "Diagnostics",
  system: "System",
  params: "Parameters",
};

let api: DockviewApi | null = null;
let saveTimer: number | undefined;

function plotPanelIds(): string[] {
  return api ? api.panels.filter((p) => p.id.startsWith("plot-")).map((p) => p.id) : [];
}

export function addPlot(): string {
  const id = `plot-${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
  const ui = useUI.getState();
  ui.ensurePlot(id);
  if (api) {
    // Stack under the active plot: time series read best on a shared time axis.
    const plots = plotPanelIds();
    const ref = ui.activePlot && plots.includes(ui.activePlot) ? ui.activePlot : plots[plots.length - 1];
    api.addPanel({
      id,
      component: "plot",
      title: "Plot",
      params: { plotId: id },
      position: ref ? { referencePanel: ref, direction: "below" } : undefined,
    });
  }
  ui.setActivePlot(id);
  return id;
}

export function openPanel(kind: PanelKind): void {
  if (!api) return;
  const existing = api.getPanel(kind);
  if (existing) {
    existing.api.setActive();
    return;
  }
  api.addPanel({
    id: kind,
    component: kind,
    title: PANEL_TITLES[kind],
    position: { direction: kind === "logs" || kind === "diagnostics" ? "below" : "right" },
  });
}

/** Adds series to the active plot, creating a plot when there is none (or when asked to). */
export function plotSeries(ids: string[], newPlot = false): void {
  const ui = useUI.getState();
  const plots = plotPanelIds();
  let target = !newPlot && ui.activePlot && plots.includes(ui.activePlot) ? ui.activePlot : null;
  if (!target && !newPlot && plots.length) target = plots[0];
  if (!target) target = addPlot();
  for (const id of ids) {
    if (!useUI.getState().addSeries(target, id)) {
      ui.showToast("A plot holds up to 8 series — add another plot for more.");
      break;
    }
  }
}

function defaultLayout(a: DockviewApi): void {
  const id = "plot-main";
  useUI.getState().ensurePlot(id);
  a.addPanel({ id, component: "plot", title: "Plot", params: { plotId: id } });
  a.addPanel({ id: "logs", component: "logs", title: "Logs", position: { direction: "below" } });
  a.addPanel({
    id: "diagnostics",
    component: "diagnostics",
    title: "Diagnostics",
    position: { referencePanel: "logs", direction: "right" },
  });
  useUI.getState().setActivePlot(id);
}

export function initWorkspace(a: DockviewApi): void {
  api = a;
  let restored = false;
  try {
    const saved = localStorage.getItem(LAYOUT_KEY);
    if (saved) {
      a.fromJSON(JSON.parse(saved));
      restored = a.panels.length > 0;
    }
  } catch (err) {
    console.warn("parisil: saved layout could not be restored", err);
    a.clear();
  }
  if (!restored) defaultLayout(a);
  for (const id of plotPanelIds()) useUI.getState().ensurePlot(id);

  a.onDidRemovePanel((panel) => {
    if (panel.id.startsWith("plot-")) useUI.getState().removePlot(panel.id);
  });
  a.onDidLayoutChange(() => {
    clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      try {
        localStorage.setItem(LAYOUT_KEY, JSON.stringify(a.toJSON()));
      } catch {
        // storage unavailable: the layout just is not remembered
      }
    }, 300);
  });
}

export function resetLayout(): void {
  if (!api) return;
  api.clear();
  defaultLayout(api);
}
