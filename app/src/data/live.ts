import { hub, type Param, type Source } from "./hub";
import type { TopicInfo } from "./ros";

interface Channel {
  id: number;
  topic: string;
  encoding: string;
  schemaName: string;
  schemaEncoding?: string;
  schema: string;
}

interface GraphEntry {
  name: string;
  publisherIds?: string[];
  subscriberIds?: string[];
  providerIds?: string[];
}

const OP_MESSAGE_DATA = 1;
const RECONNECT_MS = 1500;

/** Live ROS 2 data through foxglove_bridge (Foxglove WebSocket protocol). */
export class LiveSource implements Source {
  readonly kind = "live";
  readonly label: string;
  private url: string;
  private ws: WebSocket | null = null;
  private closed = false;
  private channels = new Map<number, Channel>();
  private channelByTopic = new Map<string, number>();
  private subTopic = new Map<number, string>();
  private subByTopic = new Map<string, number>();
  private nextSubId = 1;
  private capabilities: string[] = [];

  constructor(url: string) {
    this.url = url;
    this.label = url;
    this.connect();
  }

  private connect(): void {
    if (this.closed) return;
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url, ["foxglove.sdk.v1", "foxglove.websocket.v1"]);
    } catch (err) {
      hub.setStatus("error", `${this.url} — ${(err as Error).message}`);
      return;
    }
    ws.binaryType = "arraybuffer";
    this.ws = ws;
    ws.onopen = () => hub.setStatus("live", this.url);
    ws.onmessage = (ev) => {
      if (typeof ev.data === "string") this.onJson(JSON.parse(ev.data));
      else this.onBinary(ev.data as ArrayBuffer);
    };
    ws.onclose = () => {
      if (this.closed || this.ws !== ws) return;
      this.channels.clear();
      this.channelByTopic.clear();
      this.subTopic.clear();
      this.subByTopic.clear();
      hub.setStatus("connecting", `${this.url} — waiting for foxglove_bridge`);
      setTimeout(() => this.connect(), RECONNECT_MS);
    };
  }

  private send(msg: object): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  private onBinary(buf: ArrayBuffer): void {
    const view = new DataView(buf);
    if (view.getUint8(0) !== OP_MESSAGE_DATA) return;
    const topic = this.subTopic.get(view.getUint32(1, true));
    if (!topic) return;
    const t = Number(view.getBigUint64(5, true)) / 1e9;
    hub.onMessage(topic, t, new Uint8Array(buf, 13));
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private onJson(msg: any): void {
    switch (msg.op) {
      case "serverInfo":
        this.capabilities = msg.capabilities ?? [];
        if (this.capabilities.includes("connectionGraph")) this.send({ op: "subscribeConnectionGraph" });
        break;
      case "advertise": {
        const infos: TopicInfo[] = [];
        for (const ch of msg.channels as Channel[]) {
          this.channels.set(ch.id, ch);
          this.channelByTopic.set(ch.topic, ch.id);
          infos.push({
            name: ch.topic,
            schemaName: ch.schemaName,
            encoding: ch.encoding,
            schemaEncoding: ch.schemaEncoding ?? "",
            schema: ch.schema,
          });
        }
        hub.setTopics(infos);
        for (const topic of hub.wantedTopics()) this.setSubscribed(topic, true);
        break;
      }
      case "unadvertise": {
        const removed: string[] = [];
        for (const id of msg.channelIds as number[]) {
          const ch = this.channels.get(id);
          if (!ch) continue;
          this.channels.delete(id);
          if (this.channelByTopic.get(ch.topic) === id) this.channelByTopic.delete(ch.topic);
          const sub = this.subByTopic.get(ch.topic);
          if (sub !== undefined) {
            this.subByTopic.delete(ch.topic);
            this.subTopic.delete(sub);
          }
          removed.push(ch.topic);
        }
        hub.setTopics([], removed);
        break;
      }
      case "advertiseServices":
        for (const s of msg.services as { name: string; type: string }[]) {
          const cur = hub.services.get(s.name);
          hub.services.set(s.name, { type: s.type, providers: cur?.providers ?? [] });
        }
        hub.emit();
        break;
      case "connectionGraphUpdate":
        for (const e of (msg.publishedTopics ?? []) as GraphEntry[]) hub.publishers.set(e.name, e.publisherIds ?? []);
        for (const e of (msg.subscribedTopics ?? []) as GraphEntry[]) hub.subscribers.set(e.name, e.subscriberIds ?? []);
        for (const e of (msg.advertisedServices ?? []) as GraphEntry[]) {
          const cur = hub.services.get(e.name);
          hub.services.set(e.name, { type: cur?.type ?? "", providers: e.providerIds ?? [] });
        }
        for (const name of (msg.removedTopics ?? []) as string[]) {
          hub.publishers.delete(name);
          hub.subscribers.delete(name);
        }
        for (const name of (msg.removedServices ?? []) as string[]) hub.services.delete(name);
        hub.graphChanged();
        break;
      case "parameterValues":
        if (msg.id === "all") {
          hub.params = (msg.parameters as Param[]).sort((a, b) => a.name.localeCompare(b.name));
          hub.paramsLoading = false;
        } else {
          // Reply to a set, or a pushed update: merge into what we have.
          const byName = new Map(hub.params.map((p) => [p.name, p]));
          for (const p of msg.parameters as Param[]) byName.set(p.name, p);
          hub.params = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
        }
        hub.emitNow();
        break;
      case "status":
        console.info(`foxglove_bridge: ${msg.message}`);
        break;
    }
  }

  setSubscribed(topic: string, on: boolean): void {
    const sub = this.subByTopic.get(topic);
    if (on) {
      const channelId = this.channelByTopic.get(topic);
      if (sub !== undefined || channelId === undefined) return;
      const id = this.nextSubId++;
      this.subByTopic.set(topic, id);
      this.subTopic.set(id, topic);
      this.send({ op: "subscribe", subscriptions: [{ id, channelId }] });
    } else if (sub !== undefined) {
      this.subByTopic.delete(topic);
      this.subTopic.delete(sub);
      this.send({ op: "unsubscribe", subscriptionIds: [sub] });
    }
  }

  requestParameters(): void {
    if (!this.capabilities.includes("parameters")) return;
    hub.paramsLoading = true;
    hub.emitNow();
    this.send({ op: "getParameters", parameterNames: [], id: "all" });
  }

  setParameter(param: Param): void {
    this.send({ op: "setParameters", parameters: [param], id: "set" });
  }

  close(): void {
    this.closed = true;
    this.ws?.close();
  }
}
