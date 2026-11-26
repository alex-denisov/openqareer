/**
 * B649-3: entry of dist/heavy-read-worker.mjs. One job per thread, own
 * read-only connection, reply then exit.
 */
import { parentPort, workerData } from 'node:worker_threads';
import { runHeavyReadJob, type HeavyReadArgs, type HeavyReadJob } from './heavyReadJobs';

const { path, job, args } = workerData as { path: string; job: HeavyReadJob; args: HeavyReadArgs };
try {
  parentPort?.postMessage({ result: runHeavyReadJob(path, job, args) });
} catch (error: unknown) {
  parentPort?.postMessage({ error: error instanceof Error ? error.message : String(error) });
}
