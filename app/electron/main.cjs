// Desktop shell: opens the UI in its own window and runs foxglove_bridge alongside it,
// so starting parisil is a single action.
const { app, BrowserWindow, Menu, shell } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");

const BRIDGE_PORT = Number(process.env.PARISIL_BRIDGE_PORT || 8765);
const DEV_URL = process.env.PARISIL_DEV_URL;

let bridge = null;
/** apt package to suggest when ROS 2 is installed but the bridge is not. */
let missingBridge = "";

function portOpen(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: "127.0.0.1" });
    socket.once("connect", () => (socket.destroy(), resolve(true)));
    socket.once("error", () => resolve(false));
  });
}

function findRosSetup() {
  const distro = process.env.ROS_DISTRO;
  if (distro && fs.existsSync(`/opt/ros/${distro}/setup.bash`)) return `/opt/ros/${distro}/setup.bash`;
  try {
    const found = fs.readdirSync("/opt/ros").find((d) => fs.existsSync(`/opt/ros/${d}/setup.bash`));
    return found ? `/opt/ros/${found}/setup.bash` : null;
  } catch {
    return null;
  }
}

/** Starts foxglove_bridge unless something already listens on its port. */
async function startBridge() {
  if (await portOpen(BRIDGE_PORT)) return;
  const setup = findRosSetup();
  if (!setup) return; // No ROS 2 here: the app still opens .mcap bags.
  const distro = path.basename(path.dirname(setup));
  if (!fs.existsSync(`/opt/ros/${distro}/share/foxglove_bridge`)) {
    missingBridge = `ros-${distro}-foxglove-bridge`;
    return;
  }
  const env = { ...process.env };
  // UDP-only DDS: shared memory silently delivers nothing when the robot stack runs in a
  // Docker container without --ipc=host. Set PARISIL_SHM=1 to keep Fast DDS defaults.
  if (!env.PARISIL_SHM) env.FASTDDS_BUILTIN_TRANSPORTS = "UDPv4";
  bridge = spawn(
    "bash",
    ["-c", `source "${setup}" && exec ros2 run foxglove_bridge foxglove_bridge --ros-args -p port:=${BRIDGE_PORT}`],
    { env, detached: true, stdio: "ignore" },
  );
  bridge.once("exit", () => (bridge = null));
}

function stopBridge() {
  if (!bridge) return;
  try {
    // `ros2 run` starts the bridge as a child: signal the whole process group.
    process.kill(-bridge.pid, "SIGINT");
  } catch {
    // already gone
  }
  bridge = null;
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1600,
    height: 950,
    minWidth: 900,
    minHeight: 560,
    backgroundColor: "#0e0e0d",
    title: "parisil",
    icon: path.join(__dirname, "../build/icon.png"),
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  // Links never navigate the app window; they open in the user's browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  const query = missingBridge ? { missingBridge } : undefined;
  if (DEV_URL) void win.loadURL(DEV_URL + (query ? `?missingBridge=${missingBridge}` : ""));
  else void win.loadFile(path.join(__dirname, "../dist/index.html"), { query });
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) (win.isMinimized() && win.restore(), win.focus());
  });
  app.whenReady().then(async () => {
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        { role: "fileMenu" },
        { role: "editMenu" },
        { label: "View", submenu: [{ role: "reload" }, { role: "toggleDevTools" }, { type: "separator" }, { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" }, { type: "separator" }, { role: "togglefullscreen" }] },
      ]),
    );
    await startBridge();
    createWindow();
  });
  app.on("window-all-closed", () => app.quit());
  app.on("quit", stopBridge);
  for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => app.quit());
}
