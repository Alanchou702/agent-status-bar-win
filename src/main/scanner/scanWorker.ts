import { parentPort } from 'node:worker_threads';
import { scanAll } from './scanAll.js';
import type { AppConfig } from '../config.js';

parentPort?.on('message', async (config: AppConfig) => {
  try {
    parentPort?.postMessage({ result: await scanAll(config) });
  } catch (error) {
    parentPort?.postMessage({ error: error instanceof Error ? error.message : String(error) });
  }
});

