import { DockviewReact, themeAbyss, themeLight } from "dockview-react";
import "dockview-react/dist/styles/dockview.css";
import { useEffect, useState } from "react";
import { connectLive, openBag } from "./session";
import { useUI } from "./state";
import { DiagPanel } from "./ui/DiagPanel";
import { LogPanel } from "./ui/LogPanel";
import { ParamsPanel } from "./ui/ParamsPanel";
import { PlotPanel } from "./ui/PlotPanel";
import { Sidebar } from "./ui/Sidebar";
import { SystemPanel } from "./ui/SystemPanel";
import { TopBar } from "./ui/TopBar";
import { initWorkspace } from "./workspace";

const components = {
  plot: PlotPanel,
  logs: LogPanel,
  diagnostics: DiagPanel,
  system: SystemPanel,
  params: ParamsPanel,
};

export default function App() {
  const theme = useUI((s) => s.theme);
  const toast = useUI((s) => s.toast);
  const [dropping, setDropping] = useState(false);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  // Connect straight away: no dialog between starting the app and seeing data.
  useEffect(() => {
    connectLive(useUI.getState().url);
  }, []);

  return (
    <div
      className="app"
      onDragOver={(ev) => {
        if (ev.dataTransfer.types.includes("Files")) {
          ev.preventDefault();
          setDropping(true);
        }
      }}
      onDragLeave={(ev) => ev.currentTarget === ev.target && setDropping(false)}
      onDrop={(ev) => {
        setDropping(false);
        const file = ev.dataTransfer.files[0];
        if (!file) return;
        ev.preventDefault();
        void openBag(file);
      }}
    >
      <TopBar />
      <div className="main">
        <Sidebar />
        <div className="workspace">
          <DockviewReact components={components} theme={theme === "dark" ? themeAbyss : themeLight} onReady={(ev) => initWorkspace(ev.api)} />
        </div>
      </div>
      {dropping && <div className="drop-overlay">Drop an .mcap bag to open it</div>}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
