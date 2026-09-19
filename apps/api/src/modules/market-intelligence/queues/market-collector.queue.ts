import Bull, { ConnectionOptions, Queue } from 'bullmq';

export const marketCollectorQueueName = 'market-collector';

export function createMarketCollectorQueue(connection: ConnectionOptions): Queue {
  return new Bull.Queue(marketCollectorQueueName, { connection });
}
