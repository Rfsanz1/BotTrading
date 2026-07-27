import Bull, { Queue } from 'bullmq';

export const marketCollectorQueueName = 'market-collector';

export function createMarketCollectorQueue(connection: Bull.RedisConnection): Queue {
  return new Bull.Queue(marketCollectorQueueName, { connection });
}
