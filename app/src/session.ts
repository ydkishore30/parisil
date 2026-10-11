import { hub } from "./data/hub";
import { LiveSource } from "./data/live";
import { McapSource } from "./data/mcap";
import { useUI } from "./state";
import { timeline } from "./timeline";

export function connectLive(url: string): void {
  if (!url) return;
  useUI.getState().setUrl(url);
  timeline.setPin(null, "plot");
  timeline.setFollow(true);
  hub.setSource(new LiveSource(url));
}

export async function openBag(file: File): Promise<void> {
  if (!file.name.endsWith(".mcap")) {
    useUI.getState().showToast("Only .mcap bags are supported. Convert .db3 bags with: ros2 bag convert");
    return;
  }
  try {
    const source = await McapSource.open(file);
    timeline.setPin(null, "plot");
    hub.setSource(source);
    source.announce();
    timeline.fit();
  } catch (err) {
    console.error(err);
    useUI.getState().showToast(`Could not open ${file.name}: ${(err as Error).message}`);
  }
}
