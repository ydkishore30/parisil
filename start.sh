#!/usr/bin/env bash
# Starts foxglove_bridge (unless something already listens on the port) and the parisil UI.
#   ./start.sh            live ROS 2 data on ws://localhost:8765, UI on http://localhost:5173
#   PORT=9000 ./start.sh  use another bridge port (then set the address in the UI's connection box)
set -euo pipefail
cd "$(dirname "$0")"

PORT="${PORT:-8765}"
ROS_SETUP="/opt/ros/${ROS_DISTRO:-jazzy}/setup.bash"

if ! command -v node >/dev/null && [ -s "$HOME/.nvm/nvm.sh" ]; then
  # shellcheck disable=SC1091
  . "$HOME/.nvm/nvm.sh"
fi

bridge_pid=""
if ss -ltn 2>/dev/null | grep -q ":$PORT "; then
  echo "parisil: using the bridge already listening on port $PORT"
elif [ -f "$ROS_SETUP" ]; then
  set +u
  # shellcheck disable=SC1090
  . "$ROS_SETUP"
  set -u
  # UDP-only DDS: shared memory silently delivers nothing when the robot stack runs in a
  # Docker container without --ipc=host. Set PARISIL_SHM=1 to keep Fast DDS defaults.
  [ -n "${PARISIL_SHM:-}" ] || export FASTDDS_BUILTIN_TRANSPORTS=UDPv4
  ros2 run foxglove_bridge foxglove_bridge --ros-args -p port:="$PORT" >/tmp/parisil-bridge.log 2>&1 &
  bridge_pid=$!
  echo "parisil: started foxglove_bridge on port $PORT (log: /tmp/parisil-bridge.log)"
else
  echo "parisil: ROS 2 not found at $ROS_SETUP — starting the UI only (you can still open .mcap bags)"
fi
trap '[ -z "$bridge_pid" ] || kill "$bridge_pid" 2>/dev/null' EXIT

cd app
[ -d node_modules ] || npm install
npm run dev -- --open
