import { Worker } from 'node:worker_threads';
import * as path from 'node:path';
import type { AppConfig } from '../config.js';
import type { ScanResult } from './scanAll.js';

/** SQLite and transcript reads stay off Electron's UI thread. One worker per scan,
 * with an overall deadline so a stuck database never wedges future refreshes. */
export function scanInWorker(config: AppConfig): Promise<ScanResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, 'scanWorker.js'));
    const timeout = setTimeout(() => finish(new Error('扫描超时，请稍后重试。')), 25_000);
    let settled = false;
    function finish(error?: Error, result?: ScanResult): void {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      void worker.terminate();
      if (error) reject(error);
      else resolve(result!);
    }
    worker.once('error', error => finish(error instanceof Error ? error : new Error(String(error))));
    worker.once('exit', code => {
      if (!settled) finish(new Error(`扫描进程提前退出（${code}）`));
    });
    worker.once('message', (message: { result?: ScanResult; error?: string }) => {
      if (message.result) finish(undefined, message.result);
      else finish(new Error(message.error ?? '无法读取 Agent 状态'));
    });
    worker.postMessage(config);
  });
}

