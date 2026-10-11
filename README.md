# parisil

A ROS 2 debugging tool: time-series plotting, log viewing, diagnostics and system
introspection in one window. Inspired by PlotJuggler, built to need fewer clicks.

## Install

Download the latest build from the [releases page](https://github.com/ydkishore30/parisil/releases)
(Linux x86-64):

- **AppImage** – one file, nothing to install:
  `chmod +x parisil-*.AppImage && ./parisil-*.AppImage` (needs `libfuse2`, present on most desktops).
- **.deb** – `sudo apt install ./parisil-*-amd64.deb`, then start *parisil* from the applications menu.

parisil is a single application: on start it launches `foxglove_bridge` itself when nothing is
listening on port 8765, and stops it again on quit. For live data the machine needs ROS 2 with
`sudo apt install ros-$ROS_DISTRO-foxglove-bridge`; without ROS 2 it still opens `.mcap` bags.
No account, no network access beyond the connection to your robot.

## Build from source

Requirements: Node.js 20+.

```bash
cd app
npm install
npm run desktop   # build and open parisil in its own window (Electron)
npm run dist      # build app/release/parisil-<version>-x86_64.AppImage and -amd64.deb
```

For development in a browser with hot reload, run `./start.sh` from the repository root
(starts the bridge and serves http://localhost:5173).

`npm run desktop` passes `--no-sandbox` because Ubuntu's AppArmor blocks Chromium's sandbox for
binaries run out of `node_modules`; the installed .deb keeps the sandbox on.

No robot at hand? `python3 tools/demo_publisher.py` publishes synthetic data under
`/parisil_demo/…` (namespaced so it cannot collide with a real robot's topics).

## Using it

- **Plot a field** – expand a topic in the sidebar and click a numeric field. It is subscribed
  automatically; there is no topic-selection dialog. Shift-click opens it in a new plot, drag
  drops it on a specific plot, and *plot all* on a group (e.g. `linear`) adds x/y/z at once.
- **Time** – all plots share one time axis. Wheel zooms, drag pans, double-click resets,
  Space pauses/resumes (data keeps recording while paused). Click a plot to pin a time;
  the log view jumps to it. Click a log line to mark its time on the plots.
- **Bags** – *Open bag* or drop an `.mcap` file on the window. Plots stay as they are and
  refill from the file. (`.db3` bags: `ros2 bag convert` them to MCAP first.)
- **Logs** – every `rcl_interfaces/msg/Log` topic (`/rosout`) with level, node and text filters.
  Repeated lines are folded into one row with a count, the node list is ordered by
  warning/error count, and a noisy node can be hidden from a log line's detail view.
- **Diagnostics** – latest status of every `DiagnosticArray` entry, worst first.
- **System** – topics with publishers/subscribers, rate and bandwidth; services; actions; nodes.
  Everything is categorised: topics as sensor / motion / navigation / TF / visualization /
  system, services as application / parameter / lifecycle / action / introspection (the list
  opens on application services), and actions are reassembled from their hidden
  `_action` topics and services with their servers and clients.
- **Sidebar** – four tabs keep the ROS entity kinds apart: Topics (plottable fields), Services,
  Actions and Nodes. A topic under a node jumps to it in the Topics tab.
  - **Health** – subscribed topics that deliver no data (the QoS-mismatch / broken-transport
    case where a topic is listed but nothing arrives), nodes that joined or left since
    connecting, and topics that are subscribed but never published. Silent topics are also
    marked *no data* in the sidebar and counted on the System button.
- **Params** – all node parameters, searchable, editable in place (Enter applies).
- Layout, plots, theme and bridge address are remembered between sessions.

## Layout

- `app/` – the UI (Vite + React + TypeScript)
  - `src/data/` – data layer: `hub.ts` (central store), `live.ts` (foxglove_bridge client),
    `mcap.ts` (bag reader), `ros.ts` (message decoding), `series.ts` (sample buffers)
  - `src/ui/` – panels; `PlotPanel.tsx` is a custom canvas renderer
  - `src/timeline.ts` – the time range, cursor and pin shared by all panels
- `tools/demo_publisher.py` – synthetic data source
- `start.sh` – launcher

## Notes

- If the robot stack runs in Docker without `--ipc=host`, DDS shared memory delivers no data
  to the host even though topics are discovered. `start.sh` therefore runs the bridge with
  `FASTDDS_BUILTIN_TRANSPORTS=UDPv4`; set `PARISIL_SHM=1` to disable that.

## Licence

MIT — see [LICENSE](LICENSE).
