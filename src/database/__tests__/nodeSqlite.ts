/// <reference types="node" />
import { Worker } from 'node:worker_threads';
import { DatabaseSync } from 'node:sqlite';
import { DatabaseClient } from '../databaseClient';
import type { SqlExecutor } from '../databaseTypes';

// SQL을 모사하지 않고 Node에 내장된 실제 SQLite 엔진에 같은 쿼리를 전달한다.
export async function openNodeDatabase(path: string): Promise<DatabaseClient> {
  const engine = new DatabaseSync(path);
  const executor: SqlExecutor = {
    async execAsync(sql) {
      engine.exec(sql);
    },
    async runAsync(sql, ...params) {
      const result = engine.prepare(sql).run(...params);
      return { changes: Number(result.changes), lastInsertRowId: Number(result.lastInsertRowid) };
    },
    async getFirstAsync(sql, ...params) {
      return engine.prepare(sql).get(...params) ?? null;
    },
    async getAllAsync(sql, ...params) {
      return engine.prepare(sql).all(...params);
    },
    async closeAsync() {
      engine.close();
    },
  };
  const client = new DatabaseClient(executor);
  try {
    await client.initialize();
    return client;
  } catch (error) {
    engine.close();
    throw error;
  }
}

// 각 연결을 별도 스레드에 둬 DatabaseSync의 busy wait가 JS Transaction 진행을 막지 않게 한다.
export async function openNodeWorkerDatabase(path: string): Promise<DatabaseClient> {
  const worker = new Worker(
    `
    const { parentPort, workerData } = require('node:worker_threads');
    const { DatabaseSync } = require('node:sqlite');
    const engine = new DatabaseSync(workerData);
    parentPort.on('message', ({ id, method, sql, params }) => {
      try {
        let value = null;
        if (method === 'exec') engine.exec(sql);
        else if (method === 'run') {
          const result = engine.prepare(sql).run(...params);
          value = { changes: Number(result.changes), lastInsertRowId: Number(result.lastInsertRowid) };
        } else if (method === 'get') value = engine.prepare(sql).get(...params) ?? null;
        else if (method === 'all') value = engine.prepare(sql).all(...params);
        else if (method === 'close') engine.close();
        parentPort.postMessage({ id, value });
      } catch (error) { parentPort.postMessage({ id, error: error.message }); }
    });
  `,
    { eval: true, workerData: path },
  );
  let sequence = 0;
  const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
  worker.on('message', (message: { id: number; value?: unknown; error?: string }) => {
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error));
    else request.resolve(message.value);
  });
  worker.on('error', (error) => {
    for (const request of pending.values())
      request.reject(error instanceof Error ? error : new Error('sqlite-worker-failed'));
    pending.clear();
  });
  const call = (method: string, sql = '', params: (string | number | null)[] = []) =>
    new Promise<unknown>((resolve, reject) => {
      const id = ++sequence;
      pending.set(id, { resolve, reject });
      worker.postMessage({ id, method, sql, params });
    });
  const executor: SqlExecutor = {
    async execAsync(sql) {
      await call('exec', sql);
    },
    async runAsync(sql, ...params) {
      const value = await call('run', sql, params);
      if (
        typeof value !== 'object' ||
        value === null ||
        !('changes' in value) ||
        typeof value.changes !== 'number' ||
        !('lastInsertRowId' in value) ||
        typeof value.lastInsertRowId !== 'number'
      )
        throw new Error('invalid-worker-result');
      return { changes: value.changes, lastInsertRowId: value.lastInsertRowId };
    },
    getFirstAsync: (sql, ...params) => call('get', sql, params),
    async getAllAsync(sql, ...params) {
      const value = await call('all', sql, params);
      if (!Array.isArray(value)) throw new Error('invalid-worker-result');
      return value;
    },
    async closeAsync() {
      try {
        await call('close');
      } finally {
        await worker.terminate();
      }
    },
  };
  const client = new DatabaseClient(executor);
  try {
    await client.initialize();
    return client;
  } catch (error) {
    await worker.terminate();
    throw error;
  }
}
