import { useSyncExternalStore } from "react";
import { hub } from "../data/hub";
import { timeline } from "../timeline";

/** Re-renders the component when hub state changed (throttled to a few Hz). */
export function useHub(): number {
  return useSyncExternalStore(hub.subscribe, hub.getRev);
}

export function useTimeline(): number {
  return useSyncExternalStore(timeline.subscribe, timeline.getRev);
}
