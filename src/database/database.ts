import { openDatabaseAsync } from 'expo-sqlite';
import { DatabaseClient } from './databaseClient';

let sharedDatabase: Promise<DatabaseClient> | null = null;

export async function openDatabase(name: string): Promise<DatabaseClient> {
  const connection = await openDatabaseAsync(name, { useNewConnection: true });
  const client = new DatabaseClient(connection);
  try {
    await client.initialize();
    return client;
  } catch (error) {
    await connection.closeAsync();
    throw error;
  }
}

// React 마운트 없이 Service와 백그라운드 작업에서 같은 쓰기 큐를 사용한다.
export function getDatabase(): Promise<DatabaseClient> {
  if (!sharedDatabase) {
    sharedDatabase = openDatabase('todaysrun.db').catch((error: unknown) => {
      sharedDatabase = null;
      throw error;
    });
  }
  return sharedDatabase;
}
