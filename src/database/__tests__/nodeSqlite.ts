/// <reference types="node" />
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
