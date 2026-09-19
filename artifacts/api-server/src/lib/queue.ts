import { Queue, Worker, QueueScheduler } from 'bullmq';
import { redis } from './redis';

const connection = { connection: redis } as any;

export const jobQueue = new Queue('jobs', connection);
export const jobScheduler = new QueueScheduler('jobs', connection);

// Simple worker that logs jobs; in production, implement processors
export const worker = new Worker('jobs', async (job) => {
  console.log('Processing job', job.id, job.name, job.data);
  // placeholder job processing
  return { ok: true };
}, connection);

worker.on('failed', (job, err) => {
  console.error('Job failed', job?.id, err);
});

export default { jobQueue, worker, jobScheduler };
