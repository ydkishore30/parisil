import { hub } from "./hub";

/** What a topic is used for, judged from its name and message type. */
export type TopicKind = "sensor" | "navigation" | "motion" | "tf" | "visualization" | "action" | "system" | "other";

export const TOPIC_KINDS: { id: TopicKind; label: string }[] = [
  { id: "sensor", label: "Sensor" },
  { id: "motion", label: "Motion" },
  { id: "navigation", label: "Navigation" },
  { id: "tf", label: "TF" },
  { id: "visualization", label: "Visualization" },
  { id: "action", label: "Action" },
  { id: "system", label: "System" },
  { id: "other", label: "Other" },
];

const SYSTEM_TOPICS = new Set(["/rosout", "/parameter_events", "/clock", "/diagnostics", "/diagnostics_agg", "/bond", "/robot_description"]);
const SYSTEM_PACKAGES = new Set(["lifecycle_msgs", "rcl_interfaces", "rosgraph_msgs", "diagnostic_msgs", "bond", "pal_statistics_msgs", "controller_manager_msgs", "statistics_msgs"]);
const NAVIGATION_PACKAGES = new Set(["nav_msgs", "nav2_msgs", "map_msgs", "geographic_msgs"]);
const MOTION_PACKAGES = new Set(["trajectory_msgs", "control_msgs"]);
const MOTION_TYPES = new Set(["Twist", "TwistStamped", "Accel", "AccelStamped", "Wrench", "WrenchStamped", "JointState"]);

export function topicKind(name: string, type: string): TopicKind {
  const pkg = type.slice(0, type.indexOf("/"));
  const msg = type.slice(type.lastIndexOf("/") + 1);
  if (name.includes("/_action/")) return "action";
  if (name === "/tf" || name === "/tf_static" || pkg === "tf2_msgs") return "tf";
  if (SYSTEM_TOPICS.has(name) || SYSTEM_PACKAGES.has(pkg) || pkg.startsWith("foxglove") || name.endsWith("/transition_event")) return "system";
  // Odometry lives in nav_msgs but is something you plot like a sensor.
  if (msg === "Odometry" || MOTION_TYPES.has(msg) || MOTION_PACKAGES.has(pkg)) return msg === "Odometry" ? "sensor" : "motion";
  if (pkg === "sensor_msgs") return "sensor";
  if (NAVIGATION_PACKAGES.has(pkg)) return "navigation";
  if (pkg === "visualization_msgs") return "visualization";
  return "other";
}

/** Why a service exists: most of a ROS 2 graph's services are per-node infrastructure. */
export type ServiceKind = "user" | "parameter" | "lifecycle" | "action" | "introspection";

export const SERVICE_KINDS: { id: ServiceKind; label: string }[] = [
  { id: "user", label: "Application" },
  { id: "parameter", label: "Parameter" },
  { id: "lifecycle", label: "Lifecycle" },
  { id: "action", label: "Action" },
  { id: "introspection", label: "Introspection" },
];

const PARAMETER_SERVICES = new Set(["get_parameters", "set_parameters", "set_parameters_atomically", "list_parameters", "describe_parameters", "get_parameter_types"]);
const LIFECYCLE_SERVICES = new Set(["change_state", "get_state", "get_available_states", "get_available_transitions", "get_transition_graph"]);

export function serviceKind(name: string, type: string): ServiceKind {
  const leaf = name.slice(name.lastIndexOf("/") + 1);
  if (name.includes("/_action/")) return "action";
  if (PARAMETER_SERVICES.has(leaf) && (!type || type.startsWith("rcl_interfaces/"))) return "parameter";
  if (LIFECYCLE_SERVICES.has(leaf) && (!type || type.startsWith("lifecycle_msgs/"))) return "lifecycle";
  if (leaf === "get_type_description") return "introspection";
  return "user";
}

export interface ActionInfo {
  name: string;
  type: string;
  servers: string[];
  clients: string[];
}

/**
 * ROS 2 actions are not a graph primitive: each is three hidden services and two hidden
 * topics under `<name>/_action/`. This puts them back together.
 */
export function listActions(): ActionInfo[] {
  const actions = new Map<string, ActionInfo>();
  const get = (name: string) => {
    let a = actions.get(name);
    if (!a) actions.set(name, (a = { name, type: "", servers: [], clients: [] }));
    return a;
  };
  const add = (list: string[], ids: string[] | undefined) => {
    for (const id of ids ?? []) if (!list.includes(id)) list.push(id);
  };
  for (const [service, info] of hub.services) {
    const at = service.indexOf("/_action/");
    if (at < 0) continue;
    const a = get(service.slice(0, at));
    add(a.servers, info.providers);
    // "nav2_msgs/action/NavigateToPose_SendGoal" -> "nav2_msgs/action/NavigateToPose"
    if (service.endsWith("/send_goal") && info.type) a.type = info.type.replace(/_SendGoal$/, "");
  }
  for (const [topic, ids] of hub.publishers) {
    const at = topic.indexOf("/_action/");
    if (at >= 0) add(get(topic.slice(0, at)).servers, ids);
  }
  for (const [topic, ids] of hub.subscribers) {
    const at = topic.indexOf("/_action/");
    if (at >= 0) add(get(topic.slice(0, at)).clients, ids);
  }
  return [...actions.values()].sort((x, y) => x.name.localeCompare(y.name));
}

export interface NodeInfo {
  name: string;
  pubs: string[];
  subs: string[];
  /** Application services only; per-node parameter/lifecycle plumbing is counted, not listed. */
  services: string[];
  infraServices: number;
  actionServers: string[];
  actionClients: string[];
}

/** Every node in the graph with what it publishes, subscribes, serves and acts on. */
export function listNodes(actions: ActionInfo[] = listActions()): NodeInfo[] {
  const map = new Map<string, NodeInfo>();
  const get = (name: string) => {
    let v = map.get(name);
    if (!v) map.set(name, (v = { name, pubs: [], subs: [], services: [], infraServices: 0, actionServers: [], actionClients: [] }));
    return v;
  };
  // Action plumbing (hidden topics and services) is shown as actions, not as topics/services.
  for (const [topic, ids] of hub.publishers) if (!topic.includes("/_action/")) for (const id of ids) get(id).pubs.push(topic);
  for (const [topic, ids] of hub.subscribers) if (!topic.includes("/_action/")) for (const id of ids) get(id).subs.push(topic);
  for (const [name, s] of hub.services) {
    const kind = serviceKind(name, s.type);
    if (kind === "action") continue;
    for (const id of s.providers) {
      if (kind === "user") get(id).services.push(name);
      else get(id).infraServices++;
    }
  }
  for (const a of actions) {
    for (const id of a.servers) get(id).actionServers.push(a.name);
    for (const id of a.clients) get(id).actionClients.push(a.name);
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}
