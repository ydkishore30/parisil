import { parse } from "@foxglove/rosmsg";
import { MessageReader } from "@foxglove/rosmsg2-serialization";

export interface TopicInfo {
  name: string;
  schemaName: string;
  encoding: string;
  schemaEncoding: string;
  schema: string;
}

export type Decoder = (data: Uint8Array) => unknown;

const readers = new Map<string, Decoder | null>();
const text = new TextDecoder();

/** Returns a decoder for the topic, or null when its encoding is not supported. */
export function getDecoder(info: TopicInfo): Decoder | null {
  const key = `${info.encoding}|${info.schemaName}|${info.schema.length}`;
  const cached = readers.get(key);
  if (cached !== undefined) return cached;
  let decoder: Decoder | null = null;
  try {
    if (info.encoding === "cdr" && info.schemaEncoding === "ros2msg") {
      const reader = new MessageReader(parse(info.schema, { ros2: true }));
      decoder = (data) => reader.readMessage(data);
    } else if (info.encoding === "json") {
      decoder = (data) => JSON.parse(text.decode(data));
    }
  } catch (err) {
    console.warn(`parisil: cannot decode ${info.name} (${info.schemaName})`, err);
  }
  readers.set(key, decoder);
  return decoder;
}

export type Key = string | number;

/** "twist.linear.x" / "position[2]" -> ["twist","linear","x"] / ["position",2] */
export function parseFieldPath(path: string): Key[] {
  const keys: Key[] = [];
  for (const part of path.split(".")) {
    const m = /^([^[]*)((?:\[\d+\])*)$/.exec(part);
    if (!m) {
      keys.push(part);
      continue;
    }
    if (m[1]) keys.push(m[1]);
    for (const idx of m[2].matchAll(/\[(\d+)\]/g)) keys.push(Number(idx[1]));
  }
  return keys;
}

function isTime(v: object): v is { sec: number; nanosec: number } {
  const o = v as Record<string, unknown>;
  return typeof o.sec === "number" && typeof o.nanosec === "number" && Object.keys(o).length === 2;
}

/** Converts a leaf value to a plottable number (NaN when it is not numeric). */
export function toNumber(v: unknown): number {
  switch (typeof v) {
    case "number":
      return v;
    case "bigint":
      return Number(v);
    case "boolean":
      return v ? 1 : 0;
    case "object":
      return v && isTime(v) ? v.sec + v.nanosec * 1e-9 : NaN;
    default:
      return NaN;
  }
}

export function extract(msg: unknown, keys: Key[]): number {
  let cur = msg as Record<Key, unknown> | undefined;
  for (const k of keys) {
    if (cur == null) return NaN;
    cur = cur[k] as Record<Key, unknown> | undefined;
  }
  return toNumber(cur);
}

export interface FieldNode {
  key: string;
  /** Field path relative to the message, usable with parseFieldPath. */
  path: string;
  kind: "num" | "str" | "struct" | "array" | "blob";
  value?: number | string;
  children?: FieldNode[];
  /** Total element count for arrays (children may be truncated). */
  count?: number;
}

const MAX_ARRAY_CHILDREN = 32;

/** Turns a decoded message into a browsable tree of its fields. */
export function flatten(value: unknown, key = "", path = ""): FieldNode {
  if (value == null) return { key, path, kind: "str", value: "null" };
  if (typeof value === "string") return { key, path, kind: "str", value };
  if (typeof value !== "object") return { key, path, kind: "num", value: toNumber(value) };
  if (isTime(value)) return { key, path, kind: "num", value: toNumber(value) };
  if (ArrayBuffer.isView(value) || Array.isArray(value)) {
    const arr = value as ArrayLike<unknown>;
    // Large numeric buffers (images, point clouds, grids) are not worth expanding.
    if (ArrayBuffer.isView(value) && arr.length > 256) return { key, path, kind: "blob", count: arr.length };
    const children: FieldNode[] = [];
    const n = Math.min(arr.length, MAX_ARRAY_CHILDREN);
    for (let i = 0; i < n; i++) children.push(flatten(arr[i], `[${i}]`, `${path}[${i}]`));
    return { key, path, kind: "array", children, count: arr.length };
  }
  const children: FieldNode[] = [];
  for (const [k, v] of Object.entries(value)) children.push(flatten(v, k, path ? `${path}.${k}` : k));
  return { key, path, kind: "struct", children };
}
