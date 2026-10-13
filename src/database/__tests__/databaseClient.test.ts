import { DatabaseClient } from '../databaseClient';
import type { SqlExecutor } from '../databaseTypes';

it('초기화 실패를 모든 호출자에게 전달하고 이후 재시도를 허용한다', async () => {
  let attempts = 0;
  const executor: SqlExecutor = {
    async execAsync() {
      if (attempts++ === 0) throw new Error('init-failed');
    },
    async getFirstAsync(sql) {
      return sql.includes('foreign_keys') ? { foreign_keys: 1 } : { user_version: 1 };
    },
    async getAllAsync() {
      return [];
    },
    async runAsync() {
      return { changes: 0, lastInsertRowId: 0 };
    },
    async closeAsync() {
      return undefined;
    },
  };
  const client = new DatabaseClient(executor);
  const a = client.initialize();
  const b = client.initialize();
  expect(a).toBe(b);
  await expect(a).rejects.toThrow('init-failed');
  await expect(b).rejects.toThrow('init-failed');
  await expect(client.initialize()).resolves.toBeUndefined();
});
