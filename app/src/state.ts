import { create } from "zustand";
import { persist } from "zustand/middleware";

/** Categorical slots per plot; a 9th series goes into another plot instead of a generated hue. */
export const MAX_SERIES = 8;

export interface PlotSeries {
  id: string;
  /** Color slot, fixed when the series is added so removing others never repaints it. */
  slot: number;
}

export interface PlotConfig {
  series: PlotSeries[];
}

interface UIState {
  plots: Record<string, PlotConfig>;
  activePlot: string | null;
  theme: "dark" | "light";
  url: string;
  toast: string | null;
  ensurePlot(id: string): void;
  removePlot(id: string): void;
  /** Returns false when the plot is full. */
  addSeries(plotId: string, id: string): boolean;
  removeSeries(plotId: string, id: string): void;
  clearPlot(plotId: string): void;
  setActivePlot(id: string | null): void;
  setTheme(theme: "dark" | "light"): void;
  setUrl(url: string): void;
  showToast(text: string): void;
}

let toastTimer: number | undefined;

export const useUI = create<UIState>()(
  persist(
    (set, get) => ({
      plots: {},
      activePlot: null,
      theme: "dark",
      url: "ws://localhost:8765",
      toast: null,
      ensurePlot: (id) => {
        if (!get().plots[id]) set((s) => ({ plots: { ...s.plots, [id]: { series: [] } } }));
      },
      removePlot: (id) =>
        set((s) => {
          const plots = { ...s.plots };
          delete plots[id];
          return { plots, activePlot: s.activePlot === id ? null : s.activePlot };
        }),
      addSeries: (plotId, id) => {
        const plot = get().plots[plotId] ?? { series: [] };
        if (plot.series.some((x) => x.id === id)) return true;
        const used = new Set(plot.series.map((x) => x.slot));
        let slot = 0;
        while (used.has(slot)) slot++;
        if (slot >= MAX_SERIES) return false;
        set((s) => ({ plots: { ...s.plots, [plotId]: { series: [...plot.series, { id, slot }] } } }));
        return true;
      },
      removeSeries: (plotId, id) =>
        set((s) => {
          const plot = s.plots[plotId];
          if (!plot) return s;
          return { plots: { ...s.plots, [plotId]: { series: plot.series.filter((x) => x.id !== id) } } };
        }),
      clearPlot: (plotId) => set((s) => ({ plots: { ...s.plots, [plotId]: { series: [] } } })),
      setActivePlot: (id) => {
        if (get().activePlot !== id) set({ activePlot: id });
      },
      setTheme: (theme) => set({ theme }),
      setUrl: (url) => set({ url }),
      showToast: (text) => {
        clearTimeout(toastTimer);
        set({ toast: text });
        toastTimer = window.setTimeout(() => set({ toast: null }), 3500);
      },
    }),
    {
      name: "parisil.ui",
      partialize: (s) => ({ plots: s.plots, activePlot: s.activePlot, theme: s.theme, url: s.url }),
    },
  ),
);
