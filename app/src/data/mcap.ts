import { McapIndexedReader } from "@mcap/core";
import { decompress as zstdDecompress } from "fzstd";
import lz4 from "lz4js";
import { hub, type MessageSink, type Source } from "./hub";
import type { TopicInfo } from "./ros";

class BlobReadable {
  private file: Blob;
  constructor(file: Blob) {
    this.file = file;
  }
  async size(): Promise<bigint> {
    return BigInt(this.file.size);
  }
  async read(offset: bigint, length: bigint): Promise<Uint8Array> {
    const start = Number(offset);
    return new Uint8Array(await this.file.slice(start, start + Number(length)).arrayBuffer());
  }
}

/** A recorded ROS 2 bag in MCAP format, read lazily per topic. */
export class McapSource implements Source {
  readonly kind = "file";
  readonly label: string;
  private reader: McapIndexedReader;

  private constructor(label: string, reader: McapIndexedReader) {
    this.label = label;
    this.reader = reader;
  }

  static async open(file: File): Promise<McapSource> {
    const reader = await McapIndexedReader.Initialize({
      readable: new BlobReadable(file),
      decompressHandlers: {
        zstd: (buf, size) => zstdDecompress(buf, new Uint8Array(Number(size))),
        lz4: (buf, size) => lz4.decompress(buf, Number(size)),
      },
    });
    return new McapSource(file.name, reader);
  }

  /** Publishes the file's topics and time range to the hub. Call after hub.setSource. */
  announce(): void {
    const text = new TextDecoder();
    const infos = new Map<string, TopicInfo>();
    for (const ch of this.reader.channelsById.values()) {
      const schema = this.reader.schemasById.get(ch.schemaId);
      infos.set(ch.topic, {
        name: ch.topic,
        schemaName: schema?.name ?? "",
        encoding: ch.messageEncoding,
        schemaEncoding: schema?.encoding ?? "",
        schema: schema ? text.decode(schema.data) : "",
      });
    }
    const stats = this.reader.statistics;
    if (stats && stats.messageCount > 0n) {
      hub.tMin = hub.origin = Number(stats.messageStartTime) / 1e9;
      hub.tMax = Number(stats.messageEndTime) / 1e9;
      const duration = hub.tMax - hub.tMin;
      for (const ch of this.reader.channelsById.values()) {
        const count = Number(stats.channelMessageCounts.get(ch.id) ?? 0n);
        const hz = duration > 0 ? count / duration : 0;
        hub.stats.set(ch.topic, { count, hz, bps: 0, winCount: 0, winBytes: 0 });
      }
    }
    hub.setTopics([...infos.values()]);
  }

  async readTopic(topic: string, sink: MessageSink, limit = Infinity): Promise<void> {
    let n = 0;
    for await (const m of this.reader.readMessages({ topics: [topic] })) {
      sink(Number(m.logTime) / 1e9, m.data);
      if (++n >= limit) break;
    }
  }

  close(): void {}
}
