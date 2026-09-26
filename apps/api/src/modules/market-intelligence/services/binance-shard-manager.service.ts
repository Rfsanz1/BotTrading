import { Injectable } from '@nestjs/common';
import { BinanceStreamManager, BinanceStreamMarket } from './binance-stream.manager';

export interface BinanceStreamShardOptions {
  maxStreamsPerShard?: number;
  maxUrlBytes?: number;
  maxShards?: number;
}

export interface StreamShardStatus {
  id: number;
  market: BinanceStreamMarket;
  symbols: string[];
  assignedStreams: number;
  health: ReturnType<BinanceStreamManager['status']>;
}

export interface StreamShardAggregate {
  market: BinanceStreamMarket;
  shardCount: number;
  streamsRequested: number;
  streamsAssigned: number;
  streamsActive: number;
  streamsFailed: number;
  coveragePercent: number;
  healthyShards: number;
  degradedShards: number;
  failedShards: number;
  reconnects: number;
  messagesReceived: number;
  eventsReceived: number;
  lastMessageAt: number | null;
  lastEventAt: number | null;
  staleShards: number;
}

const DEFAULT_MAX_STREAMS_PER_SHARD = 80;
const DEFAULT_MAX_URL_BYTES = 6_000;
const DEFAULT_MAX_SHARDS = 64;

export function partitionBinanceStreams(
  streams: string[],
  options: BinanceStreamShardOptions = {},
): string[][] {
  const maxStreams = Math.max(1, options.maxStreamsPerShard ?? DEFAULT_MAX_STREAMS_PER_SHARD);
  const maxUrlBytes = Math.max(512, options.maxUrlBytes ?? DEFAULT_MAX_URL_BYTES);
  const maxShards = Math.max(1, options.maxShards ?? DEFAULT_MAX_SHARDS);
  const unique = [...new Set(streams.map((stream) => stream.toLowerCase()))].sort();
  const shards: string[][] = [];
  let current: string[] = [];
  let currentBytes = Buffer.byteLength('wss://stream.binance.com:9443/stream?streams=', 'utf8');

  for (const stream of unique) {
    const separatorBytes = current.length === 0 ? 0 : Buffer.byteLength('/', 'utf8');
    const streamBytes = Buffer.byteLength(stream, 'utf8');
    if (
      current.length > 0 &&
      (current.length >= maxStreams || currentBytes + separatorBytes + streamBytes > maxUrlBytes)
    ) {
      shards.push(current);
      current = [];
      currentBytes = Buffer.byteLength('wss://stream.binance.com:9443/stream?streams=', 'utf8');
    }
    current.push(stream);
    currentBytes += (current.length === 1 ? 0 : Buffer.byteLength('/', 'utf8')) + streamBytes;
  }
  if (current.length > 0) shards.push(current);
  if (shards.length > maxShards) {
    throw new Error(`BINANCE_STREAM_SHARD_LIMIT_EXCEEDED: shards=${shards.length} max=${maxShards}`);
  }
  return shards;
}

@Injectable()
export class BinanceShardManagerService {
  private readonly shards = new Map<number, { manager: BinanceStreamManager; symbols: string[]; streams: string[] }>();

  createShards(market: BinanceStreamMarket, symbols: string[], capacity = 100): void {
    const unique = [...new Set(symbols.map((symbol) => symbol.toLowerCase()))];
    this.createStreamShards(market, unique.flatMap((symbol) => [`${symbol}@aggtrade`]), {
      maxStreamsPerShard: Math.max(1, capacity),
    });
  }

  createStreamShards(
    market: BinanceStreamMarket,
    streams: string[],
    options: BinanceStreamShardOptions = {},
    onEvent?: (event: Record<string, unknown>) => void,
  ): void {
    this.stop();
    this.shards.clear();
    const partitions = partitionBinanceStreams(streams, options);
    for (const [index, assignedStreams] of partitions.entries()) {
      const id = this.shards.size + 1;
      const manager = new BinanceStreamManager(market);
      for (const stream of assignedStreams) manager.subscribe(stream);
      if (onEvent) manager.onEvent(onEvent);
      const symbols = [...new Set(assignedStreams.map((stream) => stream.split('@', 1)[0]))];
      this.shards.set(id, { manager, symbols, streams: assignedStreams });
    }
  }

  statuses(): StreamShardStatus[] {
    return [...this.shards.entries()].map(([id, shard]) => ({
      id,
      market: shard.manager.status().market,
      symbols: [...shard.symbols],
      assignedStreams: shard.streams.length,
      health: shard.manager.status(),
    }));
  }

  start(): void { for (const shard of this.shards.values()) shard.manager.connect(); }
  stop(): void { for (const shard of this.shards.values()) shard.manager.close(); }
  shardFor(symbol: string): number | null {
    const normalized = symbol.toLowerCase();
    for (const [id, shard] of this.shards.entries()) if (shard.symbols.includes(normalized)) return id;
    return null;
  }

  aggregate(market: BinanceStreamMarket): StreamShardAggregate {
    const statuses = this.statuses().filter((status) => status.market === market);
    const streamsRequested = statuses.reduce((total, status) => total + status.assignedStreams, 0);
    const streamsActive = statuses.reduce((total, status) => total + status.health.activeSubscriptions, 0);
    const healthyShards = statuses.filter((status) => status.health.health === 'HEALTHY').length;
    const failedShards = statuses.filter((status) => ['DISCONNECTED', 'HALTED'].includes(status.health.health)).length;
    const degradedShards = statuses.length - healthyShards - failedShards;
    const lastMessageAt = statuses.reduce<number | null>((latest, status) => maxTimestamp(latest, status.health.lastMessageAt), null);
    const lastEventAt = statuses.reduce<number | null>((latest, status) => maxTimestamp(latest, status.health.lastEventAt), null);
    return {
      market,
      shardCount: statuses.length,
      streamsRequested,
      streamsAssigned: streamsRequested,
      streamsActive,
      streamsFailed: Math.max(0, streamsRequested - streamsActive),
      coveragePercent: streamsRequested === 0 ? 0 : Number(((streamsActive / streamsRequested) * 100).toFixed(2)),
      healthyShards,
      degradedShards,
      failedShards,
      reconnects: statuses.reduce((total, status) => total + status.health.reconnects, 0),
      messagesReceived: statuses.reduce((total, status) => total + status.health.messagesReceived, 0),
      eventsReceived: statuses.reduce((total, status) => total + status.health.eventsReceived, 0),
      lastMessageAt,
      lastEventAt,
      staleShards: statuses.filter((status) => status.health.health === 'DEGRADED').length,
    };
  }
}

function maxTimestamp(left: number | null, right: number | null): number | null {
  if (left === null) return right;
  if (right === null) return left;
  return Math.max(left, right);
}
