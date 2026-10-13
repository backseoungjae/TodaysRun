import type { SqlExecutor } from './databaseTypes';
import { migration001 } from './migrations/migration001';

export class DatabaseClient {
  private tail: Promise<void> = Promise.resolve();
  private initialization: Promise<void> | null = null;
  private closed = false;
  constructor(private readonly connection: SqlExecutor) {}

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(() => {
      if (this.closed) throw new Error('database-closed');
      return operation();
    });
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  // 전용 연결에서 읽기와 쓰기를 모두 직렬화해 다른 작업의 Transaction 혼입을 막는다.
  private async transaction<T>(operation: (txn: SqlExecutor) => Promise<T>): Promise<T> {
    await this.connection.execAsync('BEGIN IMMEDIATE');
    try {
      const result = await operation(this.connection);
      await this.connection.execAsync('COMMIT');
      return result;
    } catch (error) {
      await this.connection.execAsync('ROLLBACK');
      throw error;
    }
  }

  initialize(): Promise<void> {
    if (!this.initialization) {
      this.initialization = this.enqueue(async () => {
        await this.connection.execAsync(
          'PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;',
        );
        const foreignKeys = await this.connection.getFirstAsync('PRAGMA foreign_keys');
        if (
          typeof foreignKeys !== 'object' ||
          foreignKeys === null ||
          !('foreign_keys' in foreignKeys) ||
          foreignKeys.foreign_keys !== 1
        ) {
          throw new Error('foreign-keys-not-enabled');
        }
        await this.transaction(async (txn) => {
          const version = await txn.getFirstAsync('PRAGMA user_version');
          if (typeof version !== 'object' || version === null || !('user_version' in version))
            throw new Error('invalid-schema-version');
          if (version.user_version === 0) await txn.execAsync(migration001);
          else if (version.user_version !== 1) throw new Error('unsupported-schema-version');
        });
      }).catch((error: unknown) => {
        this.initialization = null;
        throw error;
      });
    }
    return this.initialization;
  }

  async read<T>(operation: (db: SqlExecutor) => Promise<T>): Promise<T> {
    await this.initialize();
    return this.enqueue(() => operation(this.connection));
  }
  async write<T>(operation: (txn: SqlExecutor) => Promise<T>): Promise<T> {
    await this.initialize();
    return this.enqueue(() => this.transaction(operation));
  }
  close(): Promise<void> {
    return this.enqueue(async () => {
      await this.connection.closeAsync();
      this.closed = true;
    });
  }
}
